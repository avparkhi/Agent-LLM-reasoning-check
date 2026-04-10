import { describe, it, expect } from "vitest";
import { TestCaseSchema } from "../src/test-generator/models.js";
import { buildGenerationPrompt } from "../src/test-generator/templates.js";
import type { AgentConfig, TestGenerationSettings } from "../src/core/types.js";

describe("TestCaseSchema", () => {
  it("validates a correct test case", () => {
    const tc = {
      id: "tc-happy-001",
      name: "basic addition",
      category: "happy_path",
      input: "What is 2 + 3?",
      expectedToolCalls: ["add"],
      expectedFacts: ["5"],
      difficulty: "easy",
    };
    const result = TestCaseSchema.safeParse(tc);
    expect(result.success).toBe(true);
  });

  it("rejects invalid category", () => {
    const tc = {
      id: "tc-001",
      name: "test",
      category: "invalid_category",
      input: "test",
      difficulty: "easy",
    };
    const result = TestCaseSchema.safeParse(tc);
    expect(result.success).toBe(false);
  });

  it("accepts optional fields omitted", () => {
    const tc = {
      id: "tc-001",
      name: "test",
      category: "edge_case",
      input: "test",
      difficulty: "medium",
    };
    const result = TestCaseSchema.safeParse(tc);
    expect(result.success).toBe(true);
  });
});

describe("buildGenerationPrompt", () => {
  it("includes agent name and tools in prompt", () => {
    const agent: AgentConfig = {
      name: "calculator",
      systemPrompt: "You are a calculator.",
      tools: [
        {
          name: "add",
          description: "Add two numbers",
          parameters: {
            a: { type: "number", description: "First number", required: true },
            b: { type: "number", description: "Second number", required: true },
          },
        },
      ],
    };
    const settings: TestGenerationSettings = {
      enabled: true,
      numCases: 10,
      categories: ["happy_path", "edge_case"],
    };

    const prompt = buildGenerationPrompt(agent, settings);

    expect(prompt).toContain("calculator");
    expect(prompt).toContain("add");
    expect(prompt).toContain("Add two numbers");
    expect(prompt).toContain("happy_path");
    expect(prompt).toContain("edge_case");
    expect(prompt).toContain("10");
  });
});
