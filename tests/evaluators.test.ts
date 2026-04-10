import { describe, it, expect } from "vitest";
import { toolAccuracyEvaluator, trajectoryEvaluator } from "../src/evaluation/evaluators.js";
import type { ModelResponse, TestCase } from "../src/core/types.js";

function makeResponse(toolNames: string[]): ModelResponse {
  return {
    content: "test response",
    toolCalls: toolNames.map((name, i) => ({
      id: `call-${i}`,
      name,
      arguments: {},
    })),
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    latencyMs: 500,
  };
}

function makeTestCase(expectedTools?: string[]): TestCase {
  return {
    id: "tc-001",
    name: "test",
    category: "happy_path",
    input: "test input",
    expectedToolCalls: expectedTools,
    difficulty: "easy",
  };
}

describe("toolAccuracyEvaluator", () => {
  it("scores 5 when all expected tools are called", () => {
    const response = makeResponse(["add", "multiply"]);
    const testCase = makeTestCase(["add", "multiply"]);
    const score = toolAccuracyEvaluator(response, testCase);
    expect(score.score).toBe(5);
    expect(score.maxScore).toBe(5);
  });

  it("scores proportionally for partial matches", () => {
    const response = makeResponse(["add"]);
    const testCase = makeTestCase(["add", "multiply"]);
    const score = toolAccuracyEvaluator(response, testCase);
    expect(score.score).toBe(2.5);
  });

  it("scores 0 when no expected tools are called", () => {
    const response = makeResponse(["divide"]);
    const testCase = makeTestCase(["add", "multiply"]);
    const score = toolAccuracyEvaluator(response, testCase);
    expect(score.score).toBe(0);
  });

  it("skips when no expected tools defined", () => {
    const response = makeResponse(["add"]);
    const testCase = makeTestCase(undefined);
    const score = toolAccuracyEvaluator(response, testCase);
    expect(score.maxScore).toBe(0);
  });
});

describe("trajectoryEvaluator", () => {
  it("scores 5 for exact sequence match", () => {
    const response = makeResponse(["add", "multiply", "subtract"]);
    const testCase = makeTestCase(["add", "multiply", "subtract"]);
    const score = trajectoryEvaluator(response, testCase);
    expect(score.score).toBe(5);
  });

  it("deducts for wrong order", () => {
    const response = makeResponse(["multiply", "add", "subtract"]);
    const testCase = makeTestCase(["add", "multiply", "subtract"]);
    const score = trajectoryEvaluator(response, testCase);
    expect(score.score).toBeLessThan(5);
    expect(score.score).toBeGreaterThan(0);
  });

  it("skips when no expected tools defined", () => {
    const response = makeResponse(["add"]);
    const testCase = makeTestCase(undefined);
    const score = trajectoryEvaluator(response, testCase);
    expect(score.maxScore).toBe(0);
  });
});
