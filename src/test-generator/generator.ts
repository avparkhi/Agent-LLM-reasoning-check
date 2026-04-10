/**
 * TestCaseGenerator — LLM-powered test case generator.
 *
 * Uses a ModelProvider (the "judge") to analyse an AgentConfig and produce
 * categorised, validated TestCase objects.  The generator is model-agnostic:
 * any provider that implements the ModelProvider interface can be used.
 */

import { readFileSync, writeFileSync } from "node:fs";
import type {
  AgentConfig,
  ModelProvider,
  TestCase,
  TestGenerationSettings,
} from "../core/types.js";
import { deserializeFromYaml, serializeToYaml, TestCaseSchema } from "./models.js";
import { buildGenerationPrompt } from "./templates.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All four canonical test categories. */
const ALL_CATEGORIES = [
  "happy_path",
  "edge_case",
  "multi_turn",
  "error_handling",
] as const;

type TestCategory = (typeof ALL_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// JSON repair helpers
// ---------------------------------------------------------------------------

/**
 * Strip a leading/trailing markdown code fence from LLM output.
 *
 * Many LLMs wrap JSON in ```json … ``` even when instructed not to.
 */
function stripCodeFences(raw: string): string {
  // Remove ```json … ``` or ``` … ``` wrappers
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

/**
 * Remove trailing commas before ] or } — a common LLM JSON mistake.
 */
function removeTrailingCommas(raw: string): string {
  return raw.replace(/,\s*([}\]])/g, "$1");
}

/**
 * Attempt to extract the first JSON array from the string by finding the
 * outermost [ … ] span.  Returns the extracted substring or the original.
 */
function extractJsonArray(raw: string): string {
  const start = raw.indexOf("[");
  if (start === -1) return raw;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
  }

  return raw.slice(start); // malformed — return best effort
}

/**
 * Robustly parse a JSON array from LLM output.
 *
 * Applies several repair steps before giving up:
 *  1. Strip markdown code fences
 *  2. Extract outermost [ … ] array
 *  3. Remove trailing commas
 *  4. Attempt JSON.parse
 */
function parseJsonArray(raw: string): unknown[] {
  let text = raw.trim();
  text = stripCodeFences(text);
  text = extractJsonArray(text);
  text = removeTrailingCommas(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to parse LLM response as JSON: ${msg}\n` +
        `Raw response (first 500 chars):\n${raw.slice(0, 500)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `Expected a JSON array from the LLM but got ${typeof parsed}. ` +
        `Raw response (first 500 chars):\n${raw.slice(0, 500)}`,
    );
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// ID generation helpers
// ---------------------------------------------------------------------------

/**
 * Prefix map from category to short ID segment.
 */
const CATEGORY_PREFIX: Record<TestCategory, string> = {
  happy_path: "happy",
  edge_case: "edge",
  multi_turn: "multi",
  error_handling: "error",
};

/**
 * Generate a unique "tc-{category}-NNN" style ID that does not collide with
 * any IDs already present in `existingIds`.
 */
function generateId(category: TestCategory, existingIds: Set<string>): string {
  const prefix = CATEGORY_PREFIX[category] ?? "tc";
  for (let n = 1; n <= 9999; n++) {
    const candidate = `tc-${prefix}-${String(n).padStart(3, "0")}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }
  // Fallback (practically unreachable)
  return `tc-${prefix}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate a raw object against the TestCaseSchema.
 *
 * Returns the validated TestCase on success, or null plus a warning message
 * on failure (so the generator can skip invalid cases gracefully).
 */
function validateTestCase(
  raw: unknown,
  index: number,
): { ok: true; value: TestCase } | { ok: false; reason: string } {
  const result = TestCaseSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, value: result.data as TestCase };
  }
  const issues = result.error.issues
    .map((i) => `[${i.path.join(".")}] ${i.message}`)
    .join("; ");
  return { ok: false, reason: `Test case at index ${index}: ${issues}` };
}

// ---------------------------------------------------------------------------
// TestCaseGenerator
// ---------------------------------------------------------------------------

export class TestCaseGenerator {
  constructor(private readonly judgeProvider: ModelProvider) {}

  // -------------------------------------------------------------------------
  // generate
  // -------------------------------------------------------------------------

  /**
   * Ask the judge LLM to generate test cases for the given agent.
   *
   * Steps:
   *  1. Build a generation prompt from the agent config.
   *  2. Call judgeProvider.invoke() with the prompt.
   *  3. Parse the JSON response into an array of raw objects.
   *  4. Validate each object with TestCaseSchema; skip invalid ones (with warning).
   *  5. Assign IDs where missing / duplicate.
   *  6. Enforce category coverage — warn if a requested category is absent.
   *  7. Warn if any tool is not covered by at least one test case.
   *  8. Return the validated test cases.
   */
  async generate(
    agentConfig: AgentConfig,
    settings: TestGenerationSettings,
  ): Promise<TestCase[]> {
    const prompt = buildGenerationPrompt(agentConfig, settings);

    // ---- Call the LLM -------------------------------------------------------
    let rawContent: string;
    try {
      const response = await this.judgeProvider.invoke([
        { role: "user", content: prompt },
      ]);
      rawContent = response.content;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`TestCaseGenerator: LLM invocation failed — ${msg}`);
    }

    // ---- Parse the JSON response -------------------------------------------
    let rawArray: unknown[];
    try {
      rawArray = parseJsonArray(rawContent);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`TestCaseGenerator: ${msg}`);
    }

    // ---- Validate each item -------------------------------------------------
    const validatedCases: TestCase[] = [];
    const seenIds = new Set<string>();

    for (let i = 0; i < rawArray.length; i++) {
      const result = validateTestCase(rawArray[i], i);
      if (!result.ok) {
        console.warn(`[TestCaseGenerator] Skipping invalid test case — ${result.reason}`);
        continue;
      }
      validatedCases.push(result.value);
    }

    if (validatedCases.length === 0) {
      throw new Error(
        "TestCaseGenerator: LLM returned no valid test cases. " +
          "Check the judge model and prompt template.",
      );
    }

    // ---- Fix missing / duplicate IDs ----------------------------------------
    for (const tc of validatedCases) {
      if (!tc.id || seenIds.has(tc.id)) {
        tc.id = generateId(tc.category as TestCategory, seenIds);
      }
      seenIds.add(tc.id);
    }

    // ---- Category coverage check -------------------------------------------
    const requestedCategories = settings.categories as string[];
    const presentCategories = new Set(validatedCases.map((tc) => tc.category));

    for (const cat of requestedCategories) {
      if (!presentCategories.has(cat as TestCategory)) {
        console.warn(
          `[TestCaseGenerator] Warning: no test cases generated for category "${cat}". ` +
            "Consider increasing numCases or adjusting the prompt.",
        );
      }
    }

    // ---- Tool coverage check -----------------------------------------------
    const allExpectedTools = new Set(
      validatedCases.flatMap((tc) => tc.expectedToolCalls ?? []),
    );
    const toolNames = agentConfig.tools.map((t) => t.name);

    for (const toolName of toolNames) {
      if (!allExpectedTools.has(toolName)) {
        console.warn(
          `[TestCaseGenerator] Warning: tool "${toolName}" is not referenced in any ` +
            "generated test case's expectedToolCalls.",
        );
      }
    }

    return validatedCases;
  }

  // -------------------------------------------------------------------------
  // mergeWithManual
  // -------------------------------------------------------------------------

  /**
   * Merge generated test cases with manually authored ones.
   *
   * Deduplication is by ID.  Manual cases take precedence: if both lists
   * contain a case with the same ID the manual version is kept.
   *
   * @param generated - LLM-generated test cases.
   * @param manual    - Hand-authored test cases (higher precedence).
   * @returns Merged, deduplicated array (manual cases first).
   */
  async mergeWithManual(
    generated: TestCase[],
    manual: TestCase[],
  ): Promise<TestCase[]> {
    const manualIds = new Set(manual.map((tc) => tc.id));

    // Keep only generated cases whose IDs don't appear in manual
    const uniqueGenerated = generated.filter((tc) => !manualIds.has(tc.id));

    return [...manual, ...uniqueGenerated];
  }

  // -------------------------------------------------------------------------
  // saveToFile
  // -------------------------------------------------------------------------

  /**
   * Serialize test cases to YAML and write to a file.
   *
   * @param cases - Test cases to save.
   * @param path  - Destination file path (will be created / overwritten).
   */
  async saveToFile(cases: TestCase[], path: string): Promise<void> {
    const yaml = serializeToYaml(cases);
    try {
      writeFileSync(path, yaml, "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`TestCaseGenerator: failed to write file "${path}" — ${msg}`);
    }
  }

  // -------------------------------------------------------------------------
  // loadFromFile
  // -------------------------------------------------------------------------

  /**
   * Read a YAML file and return the validated TestCase array.
   *
   * @param path - Path to the YAML file.
   * @returns Validated TestCase array.
   * @throws On file-read errors, invalid YAML, or schema validation failures.
   */
  async loadFromFile(path: string): Promise<TestCase[]> {
    let raw: string;
    try {
      raw = readFileSync(path, "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`TestCaseGenerator: failed to read file "${path}" — ${msg}`);
    }

    return deserializeFromYaml(raw);
  }
}
