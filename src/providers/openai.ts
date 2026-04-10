/**
 * OpenAI model provider — real implementation.
 *
 * Uses the openai npm package to invoke the OpenAI Chat Completions API.
 * Implements the ModelProvider interface from src/core/types.ts.
 */

import OpenAI from "openai";
import type {
  ModelConfig,
  ModelProvider,
  Message,
  ToolSpec,
  ModelResponse,
  ToolCall,
} from "../core/types.js";

// ---------------------------------------------------------------------------
// Message conversion helpers
// ---------------------------------------------------------------------------

/**
 * Convert our internal Message[] to the OpenAI ChatCompletionMessageParam[] format.
 */
function toOpenAIMessages(
  messages: Message[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      result.push({ role: "system", content: msg.content });
      continue;
    }

    if (msg.role === "user") {
      // If the message carries tool results, emit individual tool messages
      if (msg.toolResults && msg.toolResults.length > 0) {
        for (const tr of msg.toolResults) {
          result.push({
            role: "tool",
            tool_call_id: tr.toolCallId,
            content: tr.content,
          });
        }
        // Also include any textual user content if present
        if (msg.content) {
          result.push({ role: "user", content: msg.content });
        }
      } else {
        result.push({ role: "user", content: msg.content });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        content: msg.content || null,
      };

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        assistantMsg.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }

      result.push(assistantMsg);
    }
  }

  return result;
}

/**
 * Convert our ToolSpec[] to the OpenAI ChatCompletionTool[] format.
 */
function toOpenAITools(tools: ToolSpec[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

// ---------------------------------------------------------------------------
// Error classification helpers
// ---------------------------------------------------------------------------

function classifyError(label: string, err: unknown): never {
  if (err instanceof OpenAI.AuthenticationError) {
    throw new Error(`Provider ${label} auth failed: check OPENAI_API_KEY`);
  }
  if (err instanceof OpenAI.RateLimitError) {
    throw new Error(`Provider ${label} rate limited — reduce concurrency`);
  }
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    throw new Error(`Provider ${label} timed out`);
  }
  if (
    err instanceof Error &&
    (err.message.toLowerCase().includes("timeout") ||
      err.message.toLowerCase().includes("timed out"))
  ) {
    throw new Error(`Provider ${label} timed out`);
  }
  const message = err instanceof Error ? err.message : String(err);
  throw new Error(`Provider ${label} error: ${message}`);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Factory function expected by the ModelRegistry.
 *
 * @param config - Model configuration from YAML.
 * @returns A ModelProvider backed by the OpenAI API.
 */
export async function createProvider(config: ModelConfig): Promise<ModelProvider> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error("Provider openai auth failed: check OPENAI_API_KEY");
  }

  const client = new OpenAI({ apiKey });
  const label = config.label ?? config.modelId;

  return {
    id: `openai::${config.modelId}`,
    label,
    provider: "openai",

    async invoke(messages: Message[], tools?: ToolSpec[]): Promise<ModelResponse> {
      const openaiMessages = toOpenAIMessages(messages);
      const openaiTools = tools && tools.length > 0 ? toOpenAITools(tools) : undefined;

      const startMs = performance.now();
      let response: OpenAI.Chat.ChatCompletion;
      try {
        response = await client.chat.completions.create({
          model: config.modelId,
          messages: openaiMessages,
          ...(openaiTools ? { tools: openaiTools } : {}),
          ...(config.params ? { temperature: config.params["temperature"] as number | undefined } : {}),
        });
      } catch (err) {
        classifyError(label, err);
      }
      const latencyMs = performance.now() - startMs;

      const choice = response.choices[0];
      const assistantMessage = choice?.message;

      // Extract text content
      const content = assistantMessage?.content ?? "";

      // Extract tool calls
      const toolCalls: ToolCall[] = (assistantMessage?.tool_calls ?? []).map(
        (tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: (() => {
            try {
              return JSON.parse(tc.function.arguments) as Record<string, unknown>;
            } catch {
              return { _raw: tc.function.arguments };
            }
          })(),
        }),
      );

      // Normalise token usage
      const rawUsage = response.usage;
      const usage = {
        inputTokens: rawUsage?.prompt_tokens ?? 0,
        outputTokens: rawUsage?.completion_tokens ?? 0,
        totalTokens: rawUsage?.total_tokens ?? 0,
      };

      return {
        content,
        toolCalls,
        usage,
        latencyMs,
        raw: response,
      };
    },
  };
}
