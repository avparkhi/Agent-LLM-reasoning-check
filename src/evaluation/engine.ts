/**
 * EvaluationEngine — main orchestrator for Phase 4.
 *
 * Runs every test case against every model, scores results with all
 * configured evaluators (deterministic first, LLM-as-judge last), and
 * returns aggregated metrics and rankings.
 *
 * Evaluator execution order (cost ascending):
 *   1. Deterministic — toolAccuracy, trajectory
 *   2. LLM-as-judge  — helpfulness, coherence, faithfulness, conciseness
 *
 * Concurrency is controlled by a simple semaphore so that the system does
 * not launch thousands of simultaneous HTTP calls.
 */

import type {
  EvalConfig,
  EvalResult,
  EvaluatorScore,
  ModelConfig,
  ModelProvider,
  TestCase,
  ToolSpec,
} from "../core/types.js";

import {
  toolAccuracyEvaluator,
  trajectoryEvaluator,
  helpfulnessEvaluator,
  coherenceEvaluator,
  faithfulnessEvaluator,
  concisenessEvaluator,
} from "./evaluators.js";

import { runTestCase } from "./runner.js";

import {
  aggregateMetrics,
  getBestModel,
  rankModels,
  type ModelMetrics,
} from "./metrics.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EvaluationResults {
  results: EvalResult[];
  metrics: ModelMetrics[];
  bestModel: { model: ModelMetrics; reasoning: string };
  timestamp: string;
  config: EvalConfig;
}

// ---------------------------------------------------------------------------
// Simple concurrency limiter (no external deps)
// ---------------------------------------------------------------------------

function createLimiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    while (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

// ---------------------------------------------------------------------------
// Tool spec conversion helper
// ---------------------------------------------------------------------------

/**
 * Convert agent ToolDefinition array (from config) into ToolSpec array
 * (the format expected by ModelProvider.invoke).
 */
function buildToolSpecs(config: EvalConfig): ToolSpec[] {
  return config.agent.tools.map((tool) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [paramName, paramDef] of Object.entries(tool.parameters)) {
      const prop: Record<string, unknown> = {
        type: paramDef.type,
        description: paramDef.description,
      };
      if (paramDef.default !== undefined) {
        prop.default = paramDef.default;
      }
      properties[paramName] = prop;
      if (paramDef.required !== false) {
        required.push(paramName);
      }
    }

    return {
      name: tool.name,
      description: tool.description,
      inputSchema: { type: "object", properties, required },
    };
  });
}

// ---------------------------------------------------------------------------
// Per-evaluator registry
// ---------------------------------------------------------------------------

const DETERMINISTIC_EVALUATORS = new Set(["toolAccuracy", "trajectory"]);

const LLM_JUDGE_EVALUATORS = new Set([
  "helpfulness",
  "coherence",
  "faithfulness",
  "conciseness",
]);

// ---------------------------------------------------------------------------
// EvaluationEngine
// ---------------------------------------------------------------------------

export class EvaluationEngine {
  /**
   * Run the full evaluation pipeline.
   *
   * @param config        - Parsed eval config (includes models, evaluators, runsPerTest).
   * @param testCases     - Test cases to run.
   * @param providers     - Map of modelId → ModelProvider.
   * @param judgeProvider - Provider used for LLM-as-judge evaluators.
   * @returns Full EvaluationResults.
   */
  async evaluate(
    config: EvalConfig,
    testCases: TestCase[],
    providers: Map<string, ModelProvider>,
    judgeProvider: ModelProvider,
  ): Promise<EvaluationResults> {
    const toolSpecs = buildToolSpecs(config);
    const systemPrompt = config.agent.systemPrompt;
    const runsPerTest = config.evaluation.runsPerTest;
    const enabledEvaluators = new Set(config.evaluation.evaluators);

    // Concurrency: cap at 5 simultaneous model calls to avoid rate limits
    const limit = createLimiter(5);

    const allResults: EvalResult[] = [];

    // -----------------------------------------------------------------------
    // For each provider × test case × run
    // -----------------------------------------------------------------------
    const providerEntries = Array.from(providers.entries());

    const tasks: Array<() => Promise<EvalResult>> = [];

    for (const [modelId, provider] of providerEntries) {
      for (const testCase of testCases) {
        for (let runIndex = 0; runIndex < runsPerTest; runIndex++) {
          tasks.push(() =>
            this.runAndScore(
              provider,
              testCase,
              toolSpecs,
              systemPrompt,
              runIndex,
              enabledEvaluators,
              judgeProvider,
            ),
          );
        }
      }
    }

    // Execute all tasks with the concurrency limiter
    const settled = await Promise.allSettled(
      tasks.map((task) => limit(task)),
    );

    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        allResults.push(outcome.value);
      } else {
        // A task-level error (shouldn't happen as runAndScore is guarded,
        // but be defensive).
        console.error("[EvaluationEngine] Unexpected task failure:", outcome.reason);
      }
    }

    // -----------------------------------------------------------------------
    // Aggregate metrics per model
    // -----------------------------------------------------------------------
    const metricsPerModel: ModelMetrics[] = [];

    for (const [modelId, _provider] of providerEntries) {
      const modelResults = allResults.filter((r) => r.modelId === modelId);
      if (modelResults.length === 0) continue;

      // Find the matching ModelConfig for label/cost info
      const modelConfig: ModelConfig =
        config.models.find((m) => `${m.provider}::${m.modelId}` === modelId) ??
        config.models.find((m) => m.modelId === modelId) ??
        { provider: "anthropic", modelId, label: modelId };

      metricsPerModel.push(aggregateMetrics(modelResults, modelConfig));
    }

    const rankedMetrics = rankModels(metricsPerModel);
    const best =
      rankedMetrics.length > 0
        ? getBestModel(rankedMetrics)
        : { model: rankedMetrics[0], reasoning: "No models evaluated." };

    return {
      results: allResults,
      metrics: rankedMetrics,
      bestModel: best,
      timestamp: new Date().toISOString(),
      config,
    };
  }

  // -------------------------------------------------------------------------
  // Private: run one test case and apply all evaluators
  // -------------------------------------------------------------------------

  private async runAndScore(
    provider: ModelProvider,
    testCase: TestCase,
    toolSpecs: ToolSpec[],
    systemPrompt: string,
    runIndex: number,
    enabledEvaluators: Set<string>,
    judgeProvider: ModelProvider,
  ): Promise<EvalResult> {
    // Step 1: Run the test case
    const runResult = await runTestCase(
      provider,
      testCase,
      toolSpecs,
      systemPrompt,
      runIndex,
    );

    const scores: Record<string, EvaluatorScore> = {};

    // Step 2: Deterministic evaluators (always first — free)
    if (enabledEvaluators.has("toolAccuracy")) {
      try {
        scores.toolAccuracy = toolAccuracyEvaluator(runResult.response, testCase);
      } catch (err) {
        scores.toolAccuracy = this.errorScore("toolAccuracy", 5, err);
      }
    }

    if (enabledEvaluators.has("trajectory")) {
      try {
        scores.trajectory = trajectoryEvaluator(runResult.response, testCase);
      } catch (err) {
        scores.trajectory = this.errorScore("trajectory", 5, err);
      }
    }

    // Step 3: Decide whether to proceed to expensive evaluators.
    // If the run itself errored out, we skip LLM-as-judge to avoid
    // wasting judge calls on empty responses.
    const shouldRunJudge = !runResult.error;

    if (shouldRunJudge) {
      const input = testCase.input;
      const response = runResult.response.content;

      // Run LLM-as-judge evaluators concurrently among themselves
      const judgePromises: Array<Promise<void>> = [];

      if (enabledEvaluators.has("helpfulness")) {
        judgePromises.push(
          helpfulnessEvaluator(judgeProvider, input, response)
            .then((s) => { scores.helpfulness = s; })
            .catch((err) => { scores.helpfulness = this.errorScore("helpfulness", 5, err); }),
        );
      }

      if (enabledEvaluators.has("coherence")) {
        judgePromises.push(
          coherenceEvaluator(judgeProvider, input, response)
            .then((s) => { scores.coherence = s; })
            .catch((err) => { scores.coherence = this.errorScore("coherence", 5, err); }),
        );
      }

      if (enabledEvaluators.has("faithfulness")) {
        judgePromises.push(
          faithfulnessEvaluator(judgeProvider, input, response, testCase.expectedFacts ?? [])
            .then((s) => { scores.faithfulness = s; })
            .catch((err) => { scores.faithfulness = this.errorScore("faithfulness", 5, err); }),
        );
      }

      if (enabledEvaluators.has("conciseness")) {
        judgePromises.push(
          concisenessEvaluator(judgeProvider, input, response)
            .then((s) => { scores.conciseness = s; })
            .catch((err) => { scores.conciseness = this.errorScore("conciseness", 3, err); }),
        );
      }

      await Promise.all(judgePromises);
    }

    return {
      testCaseId: testCase.id,
      modelId: provider.id,
      runIndex,
      response: runResult.response,
      scores,
      error: runResult.error,
    };
  }

  // -------------------------------------------------------------------------
  // Private: build a zero-score entry when an evaluator throws
  // -------------------------------------------------------------------------

  private errorScore(name: string, maxScore: number, err: unknown): EvaluatorScore {
    const message = err instanceof Error ? err.message : String(err);
    return { name, score: 0, maxScore, reasoning: `Evaluator error: ${message}` };
  }
}
