/**
 * AWS Bedrock model provider — real implementation.
 *
 * Uses @aws-sdk/client-bedrock-runtime ConverseCommand to invoke models
 * through the Bedrock Converse API.
 * Implements the ModelProvider interface from src/core/types.ts.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type ContentBlock,
  type SystemContentBlock,
  type Message as BedrockMessage,
} from "@aws-sdk/client-bedrock-runtime";
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
 * Convert our internal Message[] to the Bedrock Converse message format.
 * System messages are extracted separately.
 */
function toBedrockMessages(messages: Message[]): BedrockMessage[] {
  const result: BedrockMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // System messages are passed separately — skip here.
      continue;
    }

    const contentBlocks: ContentBlock[] = [];

    // Plain text content
    if (msg.content) {
      contentBlocks.push({ text: msg.content });
    }

    // Tool use blocks (assistant requesting tool calls)
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        contentBlocks.push({
          toolUse: {
            toolUseId: tc.id,
            name: tc.name,
            input: tc.arguments,
          },
        });
      }
    }

    // Tool result blocks (user returning tool results)
    if (msg.toolResults && msg.toolResults.length > 0) {
      for (const tr of msg.toolResults) {
        contentBlocks.push({
          toolResult: {
            toolUseId: tr.toolCallId,
            content: [{ text: tr.content }],
          },
        });
      }
    }

    if (contentBlocks.length === 0) {
      // Bedrock requires non-empty content
      contentBlocks.push({ text: "" });
    }

    result.push({
      role: msg.role as "user" | "assistant",
      content: contentBlocks,
    });
  }

  return result;
}

/**
 * Extract the system prompt string from the message list, if any.
 */
function extractSystemBlocks(messages: Message[]): SystemContentBlock[] | undefined {
  const systemMsg = messages.find((m) => m.role === "system");
  if (!systemMsg?.content) return undefined;
  return [{ text: systemMsg.content }];
}

/**
 * Convert our ToolSpec[] to the Bedrock ToolConfiguration format.
 */
function toBedrockToolConfig(tools: ToolSpec[]): ConverseCommandInput["toolConfig"] {
  if (!tools || tools.length === 0) return undefined;

  return {
    tools: tools.map((t) => ({
      toolSpec: {
        name: t.name,
        description: t.description,
        inputSchema: {
          json: t.inputSchema,
        },
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Error classification helpers
// ---------------------------------------------------------------------------

function classifyError(label: string, err: unknown, startMs: number): never {
  const elapsed = Math.round(performance.now() - startMs);
  const message = err instanceof Error ? err.message : String(err);
  const msgLower = message.toLowerCase();

  if (
    msgLower.includes("not authorized") ||
    msgLower.includes("unauthorized") ||
    msgLower.includes("accessdenied") ||
    msgLower.includes("no credentials") ||
    (err instanceof Error && err.name === "CredentialsProviderError")
  ) {
    throw new Error(
      `Provider ${label} auth failed: check AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION`,
    );
  }

  if (
    msgLower.includes("throttling") ||
    msgLower.includes("too many requests") ||
    msgLower.includes("rate limit")
  ) {
    throw new Error(`Provider ${label} rate limited — reduce concurrency`);
  }

  if (
    msgLower.includes("timeout") ||
    msgLower.includes("timed out") ||
    (err instanceof Error && err.name === "TimeoutError")
  ) {
    throw new Error(`Provider ${label} timed out after ${elapsed}ms`);
  }

  throw new Error(`Provider ${label} error: ${message}`);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Factory function expected by the ModelRegistry.
 *
 * @param config - Model configuration from YAML.
 * @returns A ModelProvider backed by AWS Bedrock.
 */
export async function createProvider(config: ModelConfig): Promise<ModelProvider> {
  const region = process.env["AWS_REGION"] ?? process.env["AWS_DEFAULT_REGION"] ?? "us-east-1";

  const client = new BedrockRuntimeClient({ region });
  const label = config.label ?? config.modelId;

  return {
    id: `bedrock::${config.modelId}`,
    label,
    provider: "bedrock",

    async invoke(messages: Message[], tools?: ToolSpec[]): Promise<ModelResponse> {
      const bedrockMessages = toBedrockMessages(messages);
      const systemBlocks = extractSystemBlocks(messages);
      const toolConfig = tools && tools.length > 0 ? toBedrockToolConfig(tools) : undefined;

      const input: ConverseCommandInput = {
        modelId: config.modelId,
        messages: bedrockMessages,
        ...(systemBlocks ? { system: systemBlocks } : {}),
        ...(toolConfig ? { toolConfig } : {}),
      };

      const startMs = performance.now();
      let response: Awaited<ReturnType<typeof client.send>>;
      try {
        response = await client.send(new ConverseCommand(input));
      } catch (err) {
        classifyError(label, err, startMs);
      }
      const latencyMs = performance.now() - startMs;

      // Extract response message
      const outputMessage = response.output?.message;
      const content = outputMessage?.content ?? [];

      // Extract text content
      const textContent = content
        .filter((b): b is { text: string } => "text" in b && typeof (b as { text?: unknown }).text === "string")
        .map((b) => b.text)
        .join("\n");

      // Extract tool calls
      const toolCalls: ToolCall[] = content
        .filter(
          (b): b is { toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } } =>
            "toolUse" in b && b.toolUse != null,
        )
        .map((b) => ({
          id: b.toolUse.toolUseId,
          name: b.toolUse.name,
          arguments: (b.toolUse.input ?? {}) as Record<string, unknown>,
        }));

      // Normalise token usage
      const rawUsage = response.usage;
      const usage = {
        inputTokens: rawUsage?.inputTokens ?? 0,
        outputTokens: rawUsage?.outputTokens ?? 0,
        totalTokens: rawUsage?.totalTokens ?? 0,
      };

      return {
        content: textContent,
        toolCalls,
        usage,
        latencyMs,
        raw: response,
      };
    },
  };
}
