/**
 * Zod schemas and YAML serialization helpers for test cases.
 *
 * Re-exports the canonical TestCaseSchema from core/config so there is a
 * single source of truth, then adds:
 *  - TestSuiteSchema (array of test cases)
 *  - serializeToYaml / deserializeFromYaml round-trip helpers
 */

import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import { z } from "zod";
import type { TestCase } from "../core/types.js";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const TurnMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

/**
 * Validates a single TestCase object.
 * Matches the TestCase interface in core/types.ts exactly.
 */
export const TestCaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(["happy_path", "edge_case", "multi_turn", "error_handling"]),
  input: z.string(),
  expectedToolCalls: z.array(z.string()).optional(),
  expectedFacts: z.array(z.string()).optional(),
  multiTurn: z.array(TurnMessageSchema).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]),
});

/**
 * Validates an array of test cases (a complete test suite).
 */
export const TestSuiteSchema = z.array(TestCaseSchema);

// Inferred types (convenience)
export type ValidatedTestCase = z.infer<typeof TestCaseSchema>;
export type ValidatedTestSuite = z.infer<typeof TestSuiteSchema>;

// ---------------------------------------------------------------------------
// YAML serialization helpers
// ---------------------------------------------------------------------------

/**
 * Serialize an array of test cases to a YAML string.
 *
 * @param cases - Test cases to serialize.
 * @returns YAML-formatted string.
 */
export function serializeToYaml(cases: TestCase[]): string {
  return stringifyYaml(cases, { indent: 2 });
}

/**
 * Deserialize a YAML string into an array of validated TestCase objects.
 *
 * @param raw - Raw YAML content.
 * @returns Validated TestCase array.
 * @throws If the YAML is invalid or the content fails schema validation.
 */
export function deserializeFromYaml(raw: string): TestCase[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse YAML: ${msg}`);
  }

  const result = TestSuiteSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - [${i.path.join(".")}] ${i.message}`)
      .join("\n");
    throw new Error(`Test suite validation failed:\n${issues}`);
  }

  return result.data as TestCase[];
}
