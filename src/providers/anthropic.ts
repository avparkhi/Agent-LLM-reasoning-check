/**
 * Anthropic model provider — real implementation.
 *
 * Uses @anthropic-ai/sdk to invoke the Anthropic Messages API.
 * Implements the ModelProvider interface from src/core/types.ts.
 */

import Anthropic from "@anthropic-ai/sdk";
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
 * Convert our internal Message[] to the Anthropic MessageParam[] format.
 * System messages are handled separately by extracting them from the list.
 */
function toAnthropicMessages(
  messages: Message[],
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // System messages are passed separately to the API — skip here.
      continue;
    }

    if (msg.role === "user" || msg.role === "assistant") {
      const contentParts: Anthropic.ContentBlockParam[] = [];

      // Plain text content
      if (msg.content) {
        contentParts.push({ type: "text", text: msg.content });
      }

      // Tool use blocks (assistant requesting tool calls)
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          contentParts.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
      }

      // Tool result blocks (user returning tool results)
      if (msg.toolResults && msg.toolResults.length > 0) {
        for (const tr of msg.toolResults) {
          contentParts.push({
            type: "tool_result",
            tool_use_id: tr.toolCallId,
            content: tr.content,
          });
        }
      }

      result.push({
        role: msg.role,
        content: contentParts.length === 1 && contentParts[0]?.type === "text"
          ? (contentParts[0] as Anthropic.TextBlockParam).text
          : contentParts,
      });
    }
  }

  return result;
}

/**
 * Extract the system prompt string from the message list, if any.
 */
function extractSystemPrompt(messages: Message[]): string | undefined {
  const systemMsg = messages.find((m) => m.role === "system");
  return systemMsg?.content;
}

/**
 * Convert our ToolSpec[] to Anthropic Tool[] format.
 */
function toAnthropicTools(tools: ToolSpec[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object" as const,
      ...t.inputSchema,
    },
  }));
}

// ---------------------------------------------------------------------------
// Error classification helpers
// ---------------------------------------------------------------------------

function classifyError(label: string, err: unknown): never {
  if (err instanceof Anthropic.AuthenticationError) {
    throw new Error(
      `Provider ${label} auth failed: check ANTHROPIC_API_KEY`,
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    throw new Error(
      `Provider ${label} rate limited — reduce concurrency`,
    );
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    throw new Error(
      `Provider ${label} timed out`,
    );
  }
  // Generic timeout detection via error message
  if (
    err instanceof Error &&
    (err.message.toLowerCase().includes("timeout") ||
      err.message.toLowerCase().includes("timed out"))
  ) {
    throw new Error(`Provider ${label} timed out`);
  }
  // Re-throw as a normalised error
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
 * @returns A ModelProvider backed by the Anthropic API.
 */
export async function createProvider(config: ModelConfig): Promise<ModelProvider> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "Provider anthropic auth failed: check ANTHROPIC_API_KEY",
    );
  }

  const client = new Anthropic({ apiKey });
  const label = config.label ?? config.modelId;
  const maxTokens =
    typeof config.params?.["maxTokens"] === "number"
      ? config.params["maxTokens"]
      : 4096;

  return {
    id: `anthropic::${config.modelId}`,
    label,
    provider: "anthropic",

    async invoke(messages: Message[], tools?: ToolSpec[]): Promise<ModelResponse> {
      const systemPrompt = extractSystemPrompt(messages);
      const anthropicMessages = toAnthropicMessages(messages);
      const anthropicTools = tools && tools.length > 0 ? toAnthropicTools(tools) : undefined;

      const startMs = performance.now();
      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model: config.modelId,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: anthropicMessages,
          ...(anthropicTools ? { tools: anthropicTools } : {}),
        });
      } catch (err) {
        classifyError(label, err);
      }
      const latencyMs = performance.now() - startMs;

      // Extract text content
      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === "text",
      );
      const content = textBlocks.map((b) => b.text).join("\n");

      // Extract tool calls
      const toolCallBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      const toolCalls: ToolCall[] = toolCallBlocks.map((b) => ({
        id: b.id,
        name: b.name,
        arguments: b.input as Record<string, unknown>,
      }));

      // Normalise token usage
      const usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
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
