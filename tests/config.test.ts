import { describe, it, expect } from "vitest";
import { EvalConfigSchema } from "../src/core/config.js";

describe("EvalConfigSchema", () => {
  const validConfig = {
    agent: {
      name: "test-agent",
      systemPrompt: "You are a test assistant.",
      tools: [
        {
          name: "greet",
          description: "Greet someone",
          parameters: {
            name: { type: "string", description: "Name to greet", required: true },
          },
        },
      ],
    },
    models: [
      {
        provider: "anthropic" as const,
        modelId: "claude-sonnet-4-20250514",
        label: "Claude Sonnet",
      },
    ],
    evaluation: {
      evaluators: ["helpfulness", "toolAccuracy"],
      runsPerTest: 2,
    },
    testGeneration: {
      enabled: true,
      numCases: 10,
      categories: ["happy_path", "edge_case"],
    },
    observability: {
      otel: { enabled: false },
      langfuse: { enabled: false },
      mlflow: { enabled: false },
    },
    reporting: {
      outputDir: "./reports",
      formats: ["markdown" as const],
    },
  };

  it("validates a correct config", () => {
    const result = EvalConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("rejects invalid provider", () => {
    const bad = {
      ...validConfig,
      models: [{ provider: "invalid", modelId: "x", label: "X" }],
    };
    const result = EvalConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects missing agent name", () => {
    const bad = {
      ...validConfig,
      agent: { ...validConfig.agent, name: undefined },
    };
    const result = EvalConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects empty models array", () => {
    const bad = { ...validConfig, models: [] };
    const result = EvalConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("accepts config with optional fields omitted", () => {
    const minimal = {
      agent: {
        name: "minimal",
        systemPrompt: "Hello",
        tools: [],
      },
      models: [{ provider: "openai" as const, modelId: "gpt-4o" }],
      evaluation: { evaluators: ["helpfulness"], runsPerTest: 1 },
      testGeneration: { enabled: false, numCases: 5, categories: [] },
      observability: {
        otel: { enabled: false },
        langfuse: { enabled: false },
        mlflow: { enabled: false },
      },
      reporting: { outputDir: "./out", formats: ["markdown" as const] },
    };
    const result = EvalConfigSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });
});
