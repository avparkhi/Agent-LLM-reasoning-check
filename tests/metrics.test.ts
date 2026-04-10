import { describe, it, expect } from "vitest";
import { aggregateMetrics, rankModels, getBestModel } from "../src/evaluation/metrics.js";
import type { EvalResult, ModelConfig } from "../src/core/types.js";

function makeResult(modelId: string, scores: Record<string, number>): EvalResult {
  const evalScores: Record<string, { name: string; score: number; maxScore: number; reasoning?: string }> = {};
  for (const [name, score] of Object.entries(scores)) {
    evalScores[name] = { name, score, maxScore: 5, reasoning: "test" };
  }
  return {
    testCaseId: "tc-001",
    modelId,
    runIndex: 0,
    response: {
      content: "response",
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      latencyMs: 500,
    },
    scores: evalScores,
  };
}

describe("aggregateMetrics", () => {
  it("computes average scores across results", () => {
    const results: EvalResult[] = [
      makeResult("model-a", { helpfulness: 4, coherence: 3 }),
      makeResult("model-a", { helpfulness: 5, coherence: 4 }),
    ];
    const config: ModelConfig = { provider: "anthropic", modelId: "model-a", label: "Model A" };
    const metrics = aggregateMetrics(results, config);

    expect(metrics.avgScores.helpfulness).toBe(4.5);
    expect(metrics.avgScores.coherence).toBe(3.5);
    expect(metrics.modelId).toBe("model-a");
    expect(metrics.label).toBe("Model A");
  });

  it("computes overall score", () => {
    const results: EvalResult[] = [
      makeResult("model-a", { helpfulness: 5, coherence: 5 }),
    ];
    const config: ModelConfig = { provider: "anthropic", modelId: "model-a" };
    const metrics = aggregateMetrics(results, config);

    expect(metrics.overallScore).toBeGreaterThan(0);
    expect(metrics.overallScore).toBeLessThanOrEqual(100);
  });
});

describe("rankModels", () => {
  it("sorts models by overall score descending", () => {
    const results1 = [makeResult("a", { helpfulness: 3 })];
    const results2 = [makeResult("b", { helpfulness: 5 })];
    const m1 = aggregateMetrics(results1, { provider: "anthropic", modelId: "a" });
    const m2 = aggregateMetrics(results2, { provider: "openai", modelId: "b" });

    const ranked = rankModels([m1, m2]);
    expect(ranked[0].modelId).toBe("b");
    expect(ranked[1].modelId).toBe("a");
  });
});

describe("getBestModel", () => {
  it("returns the highest scoring model with reasoning", () => {
    const results1 = [makeResult("a", { helpfulness: 3, coherence: 3 })];
    const results2 = [makeResult("b", { helpfulness: 5, coherence: 5 })];
    const m1 = aggregateMetrics(results1, { provider: "anthropic", modelId: "a", label: "Model A" });
    const m2 = aggregateMetrics(results2, { provider: "openai", modelId: "b", label: "Model B" });

    const best = getBestModel([m1, m2]);
    expect(best.model.modelId).toBe("b");
    expect(best.reasoning).toBeTruthy();
    expect(best.reasoning.length).toBeGreaterThan(10);
  });
});
