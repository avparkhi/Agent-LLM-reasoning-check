/**
 * Prompt templates for LLM-based test case generation.
 *
 * `buildGenerationPrompt` composes a detailed instruction prompt from an
 * AgentConfig so the judge LLM can produce well-structured TestCase objects.
 */

import type { AgentConfig, TestGenerationSettings, ToolDefinition } from "../core/types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Render one tool's description and its parameter table into a human-readable
 * block that the LLM can reason about.
 */
function renderTool(tool: ToolDefinition): string {
  const paramLines = Object.entries(tool.parameters).map(([name, def]) => {
    const req = def.required === true ? "required" : "optional";
    const defaultNote =
      def.default !== undefined ? `, default: ${JSON.stringify(def.default)}` : "";
    return `    - ${name} (${def.type}, ${req}${defaultNote}): ${def.description}`;
  });

  const paramBlock =
    paramLines.length > 0 ? paramLines.join("\n") : "    (no parameters)";

  return `  Tool: ${tool.name}\n  Description: ${tool.description}\n  Parameters:\n${paramBlock}`;
}

/**
 * Build the JSON schema snippet embedded in the prompt so the LLM knows the
 * exact output structure required.
 */
function renderOutputSchema(): string {
  return `[
  {
    "id": "tc-happy-001",
    "name": "Short human-readable test name",
    "category": "happy_path",
    "input": "The user message sent to the agent",
    "expectedToolCalls": ["tool_name_1", "tool_name_2"],
    "expectedFacts": ["fact the response must contain"],
    "difficulty": "easy",
    "multiTurn": null
  }
]

Field rules:
- id: unique string, e.g. "tc-happy-001", "tc-edge-002", "tc-multi-001", "tc-error-001"
- name: short descriptive label (≤ 80 chars)
- category: exactly one of "happy_path" | "edge_case" | "multi_turn" | "error_handling"
- input: the user's message string
- expectedToolCalls: array of tool names the agent should invoke (may be empty or omitted if none expected)
- expectedFacts: array of factual assertions the final response should contain (may be omitted)
- difficulty: exactly one of "easy" | "medium" | "hard"
- multiTurn: null for single-turn tests; for multi_turn tests, an array of
  {"role": "user"|"assistant", "content": "..."} messages representing the prior
  conversation context (not including the final user turn captured by "input")`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Construct a full generation prompt for the judge LLM.
 *
 * The prompt:
 *  1. Describes the agent (name, description, system prompt, tools).
 *  2. States how many test cases are needed and which categories to cover.
 *  3. Specifies the exact JSON output schema.
 *  4. Enforces coverage constraints.
 *
 * @param agent    - The agent definition to generate tests for.
 * @param settings - Test generation settings (numCases, categories).
 * @returns A prompt string ready to be sent as a user message.
 */
export function buildGenerationPrompt(
  agent: AgentConfig,
  settings: Pick<TestGenerationSettings, "numCases" | "categories">,
): string {
  const toolsBlock = agent.tools.map(renderTool).join("\n\n");
  const toolNames = agent.tools.map((t) => t.name).join(", ");
  const categories = settings.categories.join(", ");
  const numCases = settings.numCases;

  // Distribute cases roughly evenly across the requested categories
  const perCategory = Math.max(1, Math.floor(numCases / settings.categories.length));

  return `You are a QA engineer creating an automated test suite for an AI agent.

## Agent Under Test

**Name:** ${agent.name}
${agent.description ? `**Description:** ${agent.description.trim()}\n` : ""}
**System Prompt:**
\`\`\`
${agent.systemPrompt.trim()}
\`\`\`

## Available Tools

The agent has access to the following ${agent.tools.length} tool(s):

${toolsBlock}

Available tool names: ${toolNames}

## Task

Generate exactly **${numCases} test cases** spread across these categories: ${categories}.

Aim for roughly **${perCategory} test case(s) per category**. Every requested category
MUST have at least one test case.

### Category definitions
- **happy_path** — normal, well-formed inputs the agent should handle correctly
- **edge_case** — boundary values, unusual but valid inputs (e.g. zero, very large numbers, empty strings)
- **multi_turn** — tests with prior conversation history; set the "multiTurn" field to the
  previous turns and "input" to the final user message
- **error_handling** — inputs that should trigger graceful error handling, refusals, or no tool call

### Coverage requirement
Every tool (${toolNames}) must appear in the "expectedToolCalls" of **at least one** test case.

### Difficulty distribution
Include a mix of "easy", "medium", and "hard" difficulties across the full suite.

### Output format
Return ONLY a valid JSON array — no markdown, no prose, no code fences, no trailing commas.
The array must conform exactly to this schema:

${renderOutputSchema()}

Remember:
- Do NOT wrap the JSON in markdown code fences or backticks.
- Do NOT add any text before or after the JSON array.
- Ensure the JSON is syntactically valid (no trailing commas, properly quoted keys).
- IDs must be unique across all test cases.
- For multi_turn tests the "multiTurn" array represents prior turns; "input" is the new user turn.
- Omit "multiTurn" (or set to null) for non-multi_turn categories.`;
}
