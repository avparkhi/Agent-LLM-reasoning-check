/**
 * Test case runner.
 *
 * Executes a single TestCase against a single ModelProvider, producing
 * a RunResult that captures the model's response (or error).
 *
 * Supports both single-turn and multi-turn test cases.
 */

import type {
  Message,
  ModelProvider,
  ModelResponse,
  TestCase,
  ToolSpec,
} from "../core/types.js";

// ---------------------------------------------------------------------------
// RunResult
// ---------------------------------------------------------------------------

export interface RunResult {
  testCase: TestCase;
  modelId: string;
  runIndex: number;
  response: ModelResponse;
  error?: string;
}

// ---------------------------------------------------------------------------
// runTestCase
// ---------------------------------------------------------------------------

/**
 * Run a single test case against a model provider.
 *
 * For single-turn cases the conversation is:
 *   system prompt → user input → model response
 *
 * For multi-turn cases, additional turns from testCase.multiTurn are
 * appended sequentially after the initial exchange.
 *
 * @param provider     - The model provider to invoke.
 * @param testCase     - The test case to execute.
 * @param tools        - Tool specs available to the model.
 * @param systemPrompt - System prompt for the model.
 * @param runIndex     - Zero-based index of this run (for repeated runs).
 * @returns A RunResult containing the final model response (or error details).
 */
export async function runTestCase(
  provider: ModelProvider,
  testCase: TestCase,
  tools: ToolSpec[],
  systemPrompt: string,
  runIndex: number = 0,
): Promise<RunResult> {
  // Build the initial message list
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: testCase.input },
  ];

  let finalResponse: ModelResponse;

  try {
    if (!testCase.multiTurn || testCase.multiTurn.length === 0) {
      // -----------------------------------------------------------------------
      // Single-turn: one call, one response
      // -----------------------------------------------------------------------
      finalResponse = await provider.invoke(messages, tools);
    } else {
      // -----------------------------------------------------------------------
      // Multi-turn: replay each turn in sequence
      // -----------------------------------------------------------------------

      // Get the first model response to the initial user input
      let lastResponse = await provider.invoke(messages, tools);

      // Append the assistant's response to the running conversation
      messages.push({ role: "assistant", content: lastResponse.content });

      for (const turn of testCase.multiTurn) {
        if (turn.role === "user") {
          // Append the scripted user message
          messages.push({ role: "user", content: turn.content });
          // Invoke the model again with the updated history
          lastResponse = await provider.invoke(messages, tools);
          // Append the assistant response for the next turn
          messages.push({ role: "assistant", content: lastResponse.content });
        } else {
          // role === "assistant" — scripted assistant turn (inject verbatim)
          messages.push({ role: "assistant", content: turn.content });
          lastResponse = {
            content: turn.content,
            toolCalls: [],
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            latencyMs: 0,
          };
        }
      }

      finalResponse = lastResponse;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Return a zero-value response with the error recorded so that a single
    // failed run does not abort the whole evaluation.
    return {
      testCase,
      modelId: provider.id,
      runIndex,
      response: {
        content: "",
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        latencyMs: 0,
      },
      error: errorMessage,
    };
  }

  return {
    testCase,
    modelId: provider.id,
    runIndex,
    response: finalResponse,
  };
}
