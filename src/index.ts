#!/usr/bin/env node
/**
 * agent-eval CLI — main entry point.
 *
 * Commands:
 *   generate  — Generate test cases using an LLM judge.
 *   evaluate  — Run full evaluation and generate reports.
 *   report    — Generate reports from saved results JSON.
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { resolve } from "node:path";

import { loadConfig } from "./core/config.js";
import { ModelRegistry, createAllProviders } from "./core/model-registry.js";
import { TestCaseGenerator } from "./test-generator/generator.js";
import { EvaluationEngine } from "./evaluation/engine.js";
import type { EvaluationResults } from "./evaluation/engine.js";
import { generateReports } from "./reporting/generator.js";
import type { ReportingConfig } from "./core/types.js";

// ---------------------------------------------------------------------------
// Utility: exit with a user-friendly error
// ---------------------------------------------------------------------------

function fatal(message: string, err?: unknown): never {
  const detail = err instanceof Error ? err.message : err ? String(err) : "";
  console.error(chalk.red.bold("Error:"), chalk.red(message));
  if (detail) {
    console.error(chalk.dim(detail));
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Program definition
// ---------------------------------------------------------------------------

const program = new Command()
  .name("agent-eval")
  .description("Evaluate AI agents across multiple LLM providers")
  .version("0.1.0");

// ===========================================================================
// Command: generate
// ===========================================================================

program
  .command("generate")
  .description("Generate test cases using an LLM judge")
  .requiredOption("--config <path>", "Path to the evaluation config YAML")
  .option("--output <path>", "Output path for the generated test cases YAML", "test-cases.yaml")
  .option("--num-cases <n>", "Number of test cases to generate (overrides config)")
  .action(async (opts: { config: string; output: string; numCases?: string }) => {
    // 1. Load config
    let config;
    try {
      config = loadConfig(resolve(opts.config));
    } catch (err) {
      fatal("Failed to load config", err);
    }

    // 2. Determine num cases
    const numCases = opts.numCases !== undefined
      ? parseInt(opts.numCases, 10)
      : config.testGeneration.numCases;

    if (isNaN(numCases) || numCases < 1) {
      fatal("--num-cases must be a positive integer");
    }

    // 3. Create judge provider
    const spinner = ora("Creating judge provider…").start();
    let judgeProvider;
    try {
      const registry = new ModelRegistry();
      const judgeModelConfig = config.evaluation.judgeModel ?? config.models[0];
      judgeProvider = await registry.createProvider(judgeModelConfig);
      spinner.succeed("Judge provider ready");
    } catch (err) {
      spinner.fail("Failed to create judge provider");
      fatal("Could not initialise judge provider", err);
    }

    // 4. Generate test cases
    const genSpinner = ora(`Generating ${numCases} test cases…`).start();
    let testCases;
    try {
      const generator = new TestCaseGenerator(judgeProvider);
      const settings = {
        ...config.testGeneration,
        numCases,
      };
      testCases = await generator.generate(config.agent, settings);
      genSpinner.succeed(`Generated ${testCases.length} test cases`);
    } catch (err) {
      genSpinner.fail("Test case generation failed");
      fatal("Generation error", err);
    }

    // 5. Save to YAML
    const outputPath = resolve(opts.output);
    const saveSpinner = ora(`Saving to ${outputPath}…`).start();
    try {
      const generator = new TestCaseGenerator(judgeProvider);
      await generator.saveToFile(testCases, outputPath);
      saveSpinner.succeed(`Saved ${testCases.length} test cases to ${chalk.cyan(outputPath)}`);
    } catch (err) {
      saveSpinner.fail("Failed to save test cases");
      fatal("File write error", err);
    }
  });

// ===========================================================================
// Command: evaluate
// ===========================================================================

program
  .command("evaluate")
  .description("Run full evaluation and generate reports")
  .requiredOption("--config <path>", "Path to the evaluation config YAML")
  .option("--models <labels...>", "Filter to only these model labels")
  .option("--output-dir <path>", "Override the report output directory")
  .action(async (opts: {
    config: string;
    models?: string[];
    outputDir?: string;
  }) => {
    // -----------------------------------------------------------------------
    // 1. Load config
    // -----------------------------------------------------------------------
    let config;
    try {
      config = loadConfig(resolve(opts.config));
    } catch (err) {
      fatal("Failed to load config", err);
    }

    // Apply model filter if provided
    let modelConfigs = config.models;
    if (opts.models && opts.models.length > 0) {
      const filter = new Set(opts.models);
      modelConfigs = modelConfigs.filter(
        (m) => filter.has(m.label ?? m.modelId) || filter.has(m.modelId),
      );
      if (modelConfigs.length === 0) {
        fatal(
          `No models matched the filter: ${opts.models.join(", ")}. ` +
          `Available: ${config.models.map((m) => m.label ?? m.modelId).join(", ")}`,
        );
      }
    }

    // -----------------------------------------------------------------------
    // 2. Create providers
    // -----------------------------------------------------------------------
    console.log(chalk.bold("\nInitialising model providers…"));

    const providerSpinner = ora("Creating providers…").start();
    let providers: Map<string, import("./core/types.js").ModelProvider>;
    let judgeProvider: import("./core/types.js").ModelProvider;

    try {
      providers = await createAllProviders(modelConfigs);

      const registry = new ModelRegistry();
      const judgeModelConfig = config.evaluation.judgeModel ?? config.models[0];
      judgeProvider = await registry.createProvider(judgeModelConfig);

      providerSpinner.succeed(`${providers.size} model provider(s) ready`);
    } catch (err) {
      providerSpinner.fail("Failed to create providers");
      fatal("Provider initialisation error", err);
    }

    // -----------------------------------------------------------------------
    // 3. Load or generate test cases
    // -----------------------------------------------------------------------
    let testCases = config.testCases ?? [];

    if (config.testGeneration.enabled) {
      const genSpinner = ora(
        `Generating ${config.testGeneration.numCases} test case(s)…`,
      ).start();
      try {
        const generator = new TestCaseGenerator(judgeProvider);
        const generated = await generator.generate(config.agent, config.testGeneration);
        testCases = await generator.mergeWithManual(generated, testCases);
        genSpinner.succeed(`${testCases.length} test case(s) ready (including manual)`);
      } catch (err) {
        genSpinner.warn("Test case generation failed — using inline test cases only");
        console.error(chalk.dim(err instanceof Error ? err.message : String(err)));
      }
    }

    if (testCases.length === 0) {
      fatal("No test cases available. Add testCases to your config or enable testGeneration.");
    }

    // -----------------------------------------------------------------------
    // 4. Run evaluation with progress reporting
    // -----------------------------------------------------------------------
    console.log(chalk.bold("\nRunning evaluation…"));

    const modelList = Array.from(providers.values()).map((p) => p.label).join(", ");
    console.log(`  Models: ${chalk.cyan(modelList)}`);
    console.log(`  Test cases: ${chalk.cyan(testCases.length)}`);
    console.log(`  Runs per test: ${chalk.cyan(config.evaluation.runsPerTest)}`);
    console.log();

    const totalRuns = providers.size * testCases.length * config.evaluation.runsPerTest;
    let completedRuns = 0;
    const modelEntries = Array.from(providers.entries());

    const evalSpinner = ora("Starting evaluation…").start();

    // We run the engine and update spinner text from the outside
    // The engine itself runs tasks concurrently, so we track model/case progress
    // by intercepting the evaluation flow with a custom engine wrapper
    let results: EvaluationResults;

    try {
      // We use a ticker to show progress even though tasks run concurrently
      const ticker = setInterval(() => {
        const pct = totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0;
        evalSpinner.text =
          `Evaluating ${modelList} — ${completedRuns}/${totalRuns} runs (${pct}%)`;
      }, 500);

      const engine = new EvaluationEngine();

      // Wrap providers to count completions
      const instrumentedProviders = new Map<string, import("./core/types.js").ModelProvider>();
      for (const [id, provider] of providers) {
        instrumentedProviders.set(id, {
          ...provider,
          invoke: async (...args) => {
            const res = await provider.invoke(...args);
            completedRuns++;
            return res;
          },
        });
      }

      results = await engine.evaluate(
        { ...config, models: modelConfigs },
        testCases,
        instrumentedProviders,
        judgeProvider,
      );

      clearInterval(ticker);
      evalSpinner.succeed(chalk.green("Evaluation complete!"));
    } catch (err) {
      evalSpinner.fail("Evaluation failed");
      fatal("Evaluation error", err);
    }

    // -----------------------------------------------------------------------
    // 5. Show summary
    // -----------------------------------------------------------------------
    const best = results.bestModel.model;
    console.log();
    console.log(chalk.bold.green("  Best Model:"), chalk.cyan(best.label), chalk.dim(`(Overall: ${best.overallScore})`));
    console.log();

    // -----------------------------------------------------------------------
    // 6. Generate reports
    // -----------------------------------------------------------------------
    const reportingConfig: ReportingConfig = {
      outputDir: opts.outputDir ?? config.reporting.outputDir,
      formats: config.reporting.formats,
    };

    const reportSpinner = ora("Generating reports…").start();
    try {
      // Also save raw results JSON for later use
      const resultsPath = `${reportingConfig.outputDir}/results.json`;
      mkdirSync(reportingConfig.outputDir, { recursive: true });
      writeFileSync(resultsPath, JSON.stringify(results, null, 2), "utf-8");

      await generateReports(results, reportingConfig);
      reportSpinner.succeed("Reports generated");
    } catch (err) {
      reportSpinner.fail("Report generation failed");
      fatal("Reporting error", err);
    }

    // -----------------------------------------------------------------------
    // 7. Print report paths
    // -----------------------------------------------------------------------
    console.log(chalk.bold("\n  Reports:"));
    const dir = reportingConfig.outputDir;
    if (reportingConfig.formats.includes("markdown")) {
      console.log(chalk.dim("    →"), chalk.cyan(`${dir}/report.md`));
    }
    if (reportingConfig.formats.includes("html")) {
      console.log(chalk.dim("    →"), chalk.cyan(`${dir}/report.html`));
    }
    console.log(chalk.dim("    →"), chalk.cyan(`${dir}/results.json`));
    console.log();
  });

// ===========================================================================
// Command: report
// ===========================================================================

program
  .command("report")
  .description("Generate reports from saved results JSON")
  .requiredOption("--results <path>", "Path to the results JSON file")
  .option(
    "--format <format>",
    'Report format: "markdown", "html", or "both" (default: both)',
    "both",
  )
  .option("--output-dir <path>", "Output directory for reports", "./reports")
  .action(async (opts: { results: string; format: string; outputDir: string }) => {
    // 1. Load results JSON
    const resultsPath = resolve(opts.results);
    const loadSpinner = ora(`Loading results from ${resultsPath}…`).start();

    let results: EvaluationResults;
    try {
      const raw = readFileSync(resultsPath, "utf-8");
      results = JSON.parse(raw) as EvaluationResults;
      loadSpinner.succeed("Results loaded");
    } catch (err) {
      loadSpinner.fail("Failed to load results");
      fatal("Could not read results file", err);
    }

    // 2. Determine formats
    let formats: ("markdown" | "html")[];
    if (opts.format === "both") {
      formats = ["markdown", "html"];
    } else if (opts.format === "markdown" || opts.format === "html") {
      formats = [opts.format];
    } else {
      fatal(`Invalid format "${opts.format}". Use "markdown", "html", or "both".`);
    }

    const reportingConfig: ReportingConfig = {
      outputDir: resolve(opts.outputDir),
      formats,
    };

    // 3. Generate reports
    const reportSpinner = ora("Generating reports…").start();
    try {
      await generateReports(results, reportingConfig);
      reportSpinner.succeed("Reports generated");
    } catch (err) {
      reportSpinner.fail("Report generation failed");
      fatal("Reporting error", err);
    }

    // 4. Print paths
    console.log(chalk.bold("\n  Reports:"));
    const dir = reportingConfig.outputDir;
    if (formats.includes("markdown")) {
      console.log(chalk.dim("    →"), chalk.cyan(`${dir}/report.md`));
    }
    if (formats.includes("html")) {
      console.log(chalk.dim("    →"), chalk.cyan(`${dir}/report.html`));
    }
    console.log();
  });

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

program.parse(process.argv);
