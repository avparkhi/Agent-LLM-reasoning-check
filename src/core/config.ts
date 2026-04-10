/**
 * Configuration loading and validation.
 *
 * Reads a YAML config file, interpolates ${ENV_VAR} references,
 * validates against Zod schemas, and returns a fully-typed EvalConfig.
 */

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { EvalConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ProviderEnum = z.enum(["bedrock", "anthropic", "openai", "ollama"]);

const ModelConfigSchema = z.object({
  provider: ProviderEnum,
  modelId: z.string().min(1),
  label: z.string().optional(),
  params: z.record(z.unknown()).optional(),
});

const ParameterDefSchema = z.object({
  type: z.string().min(1),
  description: z.string(),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
});

const ToolDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  parameters: z.record(ParameterDefSchema),
});

const AgentConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  systemPrompt: z.string().min(1),
  tools: z.array(ToolDefinitionSchema),
  module: z.string().optional(),
  exportName: z.string().optional(),
});

const TurnMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const TestCaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(["happy_path", "edge_case", "multi_turn", "error_handling"]),
  input: z.string(),
  expectedToolCalls: z.array(z.string()).optional(),
  expectedFacts: z.array(z.string()).optional(),
  multiTurn: z.array(TurnMessageSchema).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]),
});

const EvaluationSettingsSchema = z.object({
  evaluators: z.array(z.string().min(1)),
  judgeModel: ModelConfigSchema.optional(),
  runsPerTest: z.number().int().positive(),
});

const TestGenerationSettingsSchema = z.object({
  enabled: z.boolean(),
  numCases: z.number().int().nonnegative(),
  categories: z.array(z.string().min(1)),
});

const ObservabilityConfigSchema = z.object({
  otel: z.object({
    enabled: z.boolean(),
    endpoint: z.string().optional(),
  }),
  langfuse: z.object({
    enabled: z.boolean(),
  }),
  mlflow: z.object({
    enabled: z.boolean(),
    trackingUri: z.string().optional(),
    experimentName: z.string().optional(),
  }),
});

const ReportingConfigSchema = z.object({
  outputDir: z.string().min(1),
  formats: z.array(z.enum(["markdown", "html"])),
});

const EvalConfigSchema = z.object({
  agent: AgentConfigSchema,
  models: z.array(ModelConfigSchema).min(1),
  evaluation: EvaluationSettingsSchema,
  testGeneration: TestGenerationSettingsSchema,
  testCases: z.array(TestCaseSchema).optional(),
  observability: ObservabilityConfigSchema,
  reporting: ReportingConfigSchema,
});

// ---------------------------------------------------------------------------
// Exported schemas (useful for testing / extension)
// ---------------------------------------------------------------------------

export {
  ModelConfigSchema,
  AgentConfigSchema,
  ToolDefinitionSchema,
  ParameterDefSchema,
  TestCaseSchema,
  EvaluationSettingsSchema,
  TestGenerationSettingsSchema,
  ObservabilityConfigSchema,
  ReportingConfigSchema,
  EvalConfigSchema,
};

// ---------------------------------------------------------------------------
// Environment variable interpolation
// ---------------------------------------------------------------------------

/**
 * Recursively replace `${ENV_VAR}` placeholders in string values with
 * the corresponding `process.env` value. Non-string values are returned
 * unchanged; objects and arrays are traversed recursively.
 */
function interpolateEnvVars(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
      const envValue = process.env[varName];
      if (envValue === undefined) {
        return ""; // unset env vars become empty strings
      }
      return envValue;
    });
  }

  if (Array.isArray(value)) {
    return value.map(interpolateEnvVars);
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = interpolateEnvVars(v);
    }
    return result;
  }

  return value;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Load, interpolate, and validate a YAML evaluation config file.
 *
 * @param path - Absolute or relative path to the YAML config file.
 * @returns A fully validated `EvalConfig` object.
 * @throws On file-read errors, YAML parse errors, or Zod validation failures.
 */
export function loadConfig(path: string): EvalConfig {
  // 1. Read raw file
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read config file "${path}": ${message}`);
  }

  // 2. Parse YAML
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse YAML in "${path}": ${message}`);
  }

  // 3. Interpolate env vars
  const interpolated = interpolateEnvVars(parsed);

  // 4. Validate with Zod
  const result = EvalConfigSchema.safeParse(interpolated);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        return `  - Invalid config at '${path}': ${issue.message}`;
      })
      .join("\n");

    throw new Error(`Config validation failed for "${path}":\n${issues}`);
  }

  return result.data as EvalConfig;
}
