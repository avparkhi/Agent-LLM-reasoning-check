import { describe, it, expect } from "vitest";
import { CostTracker } from "../src/observability/cost-tracker.js";

describe("CostTracker", () => {
  it("tracks cost for known models", () => {
    const tracker = new CostTracker();
    tracker.record("claude-sonnet-4-20250514", {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    });

    const summary = tracker.getSummary("claude-sonnet-4-20250514");
    expect(summary.totalInput).toBe(1000);
    expect(summary.totalOutput).toBe(500);
    expect(summary.totalCost).toBeGreaterThan(0);
  });

  it("accumulates across multiple records", () => {
    const tracker = new CostTracker();
    tracker.record("gpt-4o", { inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    tracker.record("gpt-4o", { inputTokens: 200, outputTokens: 100, totalTokens: 300 });

    const summary = tracker.getSummary("gpt-4o");
    expect(summary.totalInput).toBe(300);
    expect(summary.totalOutput).toBe(150);
  });

  it("returns zero for unknown models", () => {
    const tracker = new CostTracker();
    tracker.record("unknown-model", { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });

    const cost = tracker.getCost("unknown-model");
    expect(cost).toBe(0);
  });

  it("resets all tracking", () => {
    const tracker = new CostTracker();
    tracker.record("gpt-4o", { inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    tracker.reset();

    const cost = tracker.getCost("gpt-4o");
    expect(cost).toBe(0);
  });
});
