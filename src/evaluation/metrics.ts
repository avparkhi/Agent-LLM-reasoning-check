/**
 * Metrics aggregation for evaluation results.
 *
 * Takes a flat list of EvalResult objects and computes per-model statistics:
 * average scores, standard deviations, latency percentiles, token counts,
 * estimated cost, and a weighted composite "overall score".
 *
 * Exported functions:
 *   aggregateMetrics(results, modelConfig) → ModelMetrics
 *   rankModels(metrics[])                  → ModelMetrics[]  (best first)
 *   getBestModel(metrics[])               → { model, reasoning }
 */

import type { EvalResult, ModelConfig } from "../core/types.js";

// ---------------------------------------------------------------------------
// ModelMetrics interface
// ---------------------------------------------------------------------------

export interface ModelMetrics {
  modelId: string;
  label: string;
  /** Evaluator name → average score across all runs and test cases. */
  avgScores: Record<string, number>;
  /** Evaluator name → standard deviation. */
  stdDevScores: Record<string, number>;
  avgLatencyMs: number;
  p95LatencyMs: number;
  totalCost: number;
  totalTokens: { input: number; output: number };
  /** Weighted composite score (0–100). */
  overallScore: number;
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

/**
 * Very rough token-cost estimates in USD per 1 000 tokens.
 * These are used only as a ballpark for the composite ranking.
 */
const COST_PER_1K: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-3-5-sonnet": { input: 0.003, output: 0.015 },
  "claude-3-haiku":    { input: 0.00025, output: 0.00125 },
  "claude-3-opus":     { input: 0.015, output: 0.075 },
  // OpenAI
  "gpt-4o":            { input: 0.005, output: 0.015 },
  "gpt-4o-mini":       { input: 0.00015, output: 0.0006 },
  "gpt-4-turbo":       { input: 0.01, output: 0.03 },
  // Generic fallback
  default:             { input: 0.001, output: 0.002 },
};

function estimateCostUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  // Match the modelId (case-insensitive) against our cost table keys
  const lc = modelId.toLowerCase();
  const key = Object.keys(COST_PER_1K).find((k) => k !== "default" && lc.includes(k));
  const rates = key ? COST_PER_1K[key] : COST_PER_1K.default;
  return (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output;
}

// ---------------------------------------------------------------------------
// Statistical helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdDev(values: number[], avg?: number): number {
  if (values.length < 2) return 0;
  const mu = avg ?? mean(values);
  const variance =
    values.reduce((sum, v) => sum + (v - mu) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ---------------------------------------------------------------------------
// Composite score weights
// ---------------------------------------------------------------------------

/**
 * Weights used to compute the overall score.
 * Keys match evaluator names; "latency" is a synthetic penalty term.
 * Weights should sum to 1.0.
 */
const EVALUATOR_WEIGHTS: Record<string, number> = {
  helpfulness:  0.30,
  coherence:    0.20,
  faithfulness: 0.20,
  toolAccuracy: 0.15,
  trajectory:   0.10,
  conciseness:  0.05,
};

/**
 * Compute a 0–100 overall score from the average evaluator scores.
 * Each evaluator contributes weight * (avgScore / maxScore) to the total.
 * Unknown evaluators share any remaining weight equally.
 */
function computeOverallScore(
  avgScores: Record<string, number>,
  maxScores: Record<string, number>,
): number {
  let weightedSum = 0;
  let totalWeight = 0;

  const knownNames = Object.keys(EVALUATOR_WEIGHTS);
  const unknownNames = Object.keys(avgScores).filter((n) => !knownNames.includes(n));
  const assignedWeight = Object.values(EVALUATOR_WEIGHTS).reduce((a, b) => a + b, 0);
  const remainingWeight = Math.max(0, 1 - assignedWeight);
  const perUnknown = unknownNames.length > 0 ? remainingWeight / unknownNames.length : 0;

  for (const [evaluatorName, avg] of Object.entries(avgScores)) {
    const max = maxScores[evaluatorName] ?? 0;
    if (max === 0) continue; // skipped evaluator — don't count it

    const weight =
      EVALUATOR_WEIGHTS[evaluatorName] !== undefined
        ? EVALUATOR_WEIGHTS[evaluatorName]
        : perUnknown;

    weightedSum += weight * (avg / max);
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;
  return Math.round((weightedSum / totalWeight) * 100 * 100) / 100;
}

// ---------------------------------------------------------------------------
// aggregateMetrics
// ---------------------------------------------------------------------------

/**
 * Aggregate a set of EvalResults (all belonging to one model) into ModelMetrics.
 *
 * @param results     - All EvalResults for the model (may include error runs).
 * @param modelConfig - The model's configuration (for cost estimation and label).
 */
export function aggregateMetrics(
  results: EvalResult[],
  modelConfig: ModelConfig,
): ModelMetrics {
  const modelId = results[0]?.modelId ?? modelConfig.modelId;
  const label = modelConfig.label ?? modelId;

  // ------------------------------------------------------------------
  // Collect per-evaluator score lists and latencies
  // ------------------------------------------------------------------
  const scoresByEvaluator: Record<string, number[]> = {};
  const maxScoreByEvaluator: Record<string, number> = {};
  const latencies: number[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  for (const result of results) {
    if (result.error) continue; // skip fully errored runs for score aggregation

    latencies.push(result.response.latencyMs);
    totalInput += result.response.usage.inputTokens;
    totalOutput += result.response.usage.outputTokens;

    for (const [evName, evScore] of Object.entries(result.scores)) {
      if (evScore.maxScore === 0) continue; // evaluator was skipped

      if (!scoresByEvaluator[evName]) {
        scoresByEvaluator[evName] = [];
      }
      scoresByEvaluator[evName].push(evScore.score);

      // Keep the highest maxScore seen (it should be constant per evaluator)
      if ((maxScoreByEvaluator[evName] ?? 0) < evScore.maxScore) {
        maxScoreByEvaluator[evName] = evScore.maxScore;
      }
    }
  }

  // ------------------------------------------------------------------
  // Compute averages and std deviations
  // ------------------------------------------------------------------
  const avgScores: Record<string, number> = {};
  const stdDevScores: Record<string, number> = {};

  for (const [evName, scores] of Object.entries(scoresByEvaluator)) {
    const avg = mean(scores);
    avgScores[evName] = Math.round(avg * 1000) / 1000;
    stdDevScores[evName] = Math.round(stdDev(scores, avg) * 1000) / 1000;
  }

  // ------------------------------------------------------------------
  // Latency stats
  // ------------------------------------------------------------------
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const avgLatencyMs = Math.round(mean(latencies));
  const p95LatencyMs = Math.round(percentile(sortedLatencies, 95));

  // ------------------------------------------------------------------
  // Cost estimation
  // ------------------------------------------------------------------
  const totalCost = estimateCostUsd(modelId, totalInput, totalOutput);

  // ------------------------------------------------------------------
  // Overall score
  // ------------------------------------------------------------------
  const overallScore = computeOverallScore(avgScores, maxScoreByEvaluator);

  return {
    modelId,
    label,
    avgScores,
    stdDevScores,
    avgLatencyMs,
    p95LatencyMs,
    totalCost: Math.round(totalCost * 1_000_000) / 1_000_000,
    totalTokens: { input: totalInput, output: totalOutput },
    overallScore,
  };
}

// ---------------------------------------------------------------------------
// rankModels
// ---------------------------------------------------------------------------

/**
 * Sort a list of ModelMetrics from best to worst by overallScore.
 * Returns a new sorted array (does not mutate the input).
 */
export function rankModels(metrics: ModelMetrics[]): ModelMetrics[] {
  return [...metrics].sort((a, b) => b.overallScore - a.overallScore);
}

// ---------------------------------------------------------------------------
// getBestModel
// ---------------------------------------------------------------------------

/**
 * Return the best-performing model and a human-readable reasoning string
 * that explains why it ranked first.
 */
export function getBestModel(metrics: ModelMetrics[]): {
  model: ModelMetrics;
  reasoning: string;
} {
  if (metrics.length === 0) {
    throw new Error("Cannot determine best model: metrics list is empty.");
  }

  const ranked = rankModels(metrics);
  const best = ranked[0];

  const strengths: string[] = [];

  // Highlight top evaluator scores
  for (const [evName, avg] of Object.entries(best.avgScores)) {
    const isTopForEval = ranked.every(
      (m) => m.modelId === best.modelId || (m.avgScores[evName] ?? 0) <= avg,
    );
    if (isTopForEval && avg > 0) {
      strengths.push(`highest ${evName} score (${avg})`);
    }
  }

  // Latency advantage
  const isLowestLatency = ranked.every(
    (m) => m.modelId === best.modelId || m.avgLatencyMs >= best.avgLatencyMs,
  );
  if (isLowestLatency && ranked.length > 1) {
    strengths.push(`lowest average latency (${best.avgLatencyMs} ms)`);
  }

  // Cost advantage
  const isLowestCost = ranked.every(
    (m) => m.modelId === best.modelId || m.totalCost >= best.totalCost,
  );
  if (isLowestCost && ranked.length > 1) {
    strengths.push(`lowest total cost ($${best.totalCost.toFixed(6)})`);
  }

  const strengthText =
    strengths.length > 0
      ? ` It leads in: ${strengths.join("; ")}.`
      : "";

  const runnerUp = ranked[1];
  const gap = runnerUp
    ? ` It scored ${(best.overallScore - runnerUp.overallScore).toFixed(2)} points ahead of ${runnerUp.label}.`
    : "";

  const reasoning =
    `${best.label} achieved the highest overall score of ${best.overallScore}/100.` +
    gap +
    strengthText;

  return { model: best, reasoning };
}
