/**
 * Report orchestrator.
 *
 * Generates and writes Markdown and/or HTML reports to the configured
 * output directory based on the ReportingConfig.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReportingConfig } from "../core/types.js";
import type { EvaluationResults } from "../evaluation/engine.js";
import { generateMarkdownReport } from "./markdown-report.js";
import { generateHtmlReport } from "./html-report.js";

/**
 * Generate reports from evaluation results.
 *
 * Steps:
 *  1. Create the output directory if it does not exist.
 *  2. If formats includes "markdown": write report.md.
 *  3. If formats includes "html": write report.html.
 *  4. Log the paths of all generated reports.
 *
 * @param results - Full evaluation results from EvaluationEngine.
 * @param config  - Reporting configuration (outputDir, formats).
 */
export async function generateReports(
  results: EvaluationResults,
  config: ReportingConfig,
): Promise<void> {
  const { outputDir, formats } = config;

  // 1. Create output directory (recursive, no-op if it already exists)
  try {
    mkdirSync(outputDir, { recursive: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to create output directory "${outputDir}": ${message}`);
  }

  const generated: string[] = [];

  // 2. Markdown report
  if (formats.includes("markdown")) {
    const markdown = generateMarkdownReport(results);
    const mdPath = join(outputDir, "report.md");
    try {
      writeFileSync(mdPath, markdown, "utf-8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to write Markdown report to "${mdPath}": ${message}`);
    }
    generated.push(mdPath);
  }

  // 3. HTML report
  if (formats.includes("html")) {
    const html = generateHtmlReport(results);
    const htmlPath = join(outputDir, "report.html");
    try {
      writeFileSync(htmlPath, html, "utf-8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to write HTML report to "${htmlPath}": ${message}`);
    }
    generated.push(htmlPath);
  }

  // 4. Log generated paths
  if (generated.length === 0) {
    console.log("[Reports] No formats requested — nothing written.");
    return;
  }

  console.log("[Reports] Generated reports:");
  for (const path of generated) {
    console.log(`  → ${path}`);
  }
}
