/**
 * Ollama model provider — real implementation.
 *
 * Uses the Ollama REST API (no npm package needed) via fetch().
 * Implements the ModelProvider interface from src/core/types.ts.
 */

import type {
  ModelConfig,
  ModelProvider,
  Message,
  ToolSpec,
  ModelResponse,
  ToolCall,
} from "../core/types.js";

// ---------------------------------------------------------------------------
// Ollama REST API types (subset we need)
// ---------------------------------------------------------------------------

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OllamaResponse {
  model: string;
  message: OllamaMessage;
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

// ---------------------------------------------------------------------------
// Message conversion helpers
// ---------------------------------------------------------------------------

/**
 * Convert our internal Message[] to the Ollama /api/chat message format.
 */
function toOllamaMessages(messages: Message[]): OllamaMessage[] {
  const result: OllamaMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      result.push({ role: "system", content: msg.content });
      continue;
    }

    if (msg.role === "user") {
      // Tool results are sent as "tool" role messages in Ollama
      if (msg.toolResults && msg.toolResults.length > 0) {
        for (const tr of msg.toolResults) {
          result.push({ role: "tool", content: tr.content });
        }
        if (msg.content) {
          result.push({ role: "user", content: msg.content });
        }
      } else {
        result.push({ role: "user", content: msg.content });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const ollamaMsg: OllamaMessage = {
        role: "assistant",
        content: msg.content,
      };

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        ollamaMsg.tool_calls = msg.toolCalls.map((tc) => ({
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        }));
      }

      result.push(ollamaMsg);
    }
  }

  return result;
}

/**
 * Convert our ToolSpec[] to the Ollama tool format.
 */
function toOllamaTools(tools: ToolSpec[]): OllamaTool[] {
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

function classifyError(label: string, err: unknown, elapsedMs: number): never {
  const message = err instanceof Error ? err.message : String(err);
  const msgLower = message.toLowerCase();

  if (
    msgLower.includes("timeout") ||
    msgLower.includes("timed out") ||
    (err instanceof Error && err.name === "AbortError")
  ) {
    throw new Error(`Provider ${label} timed out after ${Math.round(elapsedMs)}ms`);
  }

  if (msgLower.includes("fetch failed") || msgLower.includes("econnrefused") || msgLower.includes("enotfound")) {
    throw new Error(
      `Provider ${label} error: cannot reach Ollama — is it running at the configured endpoint?`,
    );
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
 * @returns A ModelProvider backed by a local Ollama instance.
 */
export async function createProvider(config: ModelConfig): Promise<ModelProvider> {
  const baseUrl =
    (config.params?.["baseUrl"] as string | undefined) ??
    process.env["OLLAMA_BASE_URL"] ??
    "http://localhost:11434";

  const label = config.label ?? config.modelId;

  // Remove trailing slash for consistency
  const endpoint = baseUrl.replace(/\/$/, "");

  return {
    id: `ollama::${config.modelId}`,
    label,
    provider: "ollama",

    async invoke(messages: Message[], tools?: ToolSpec[]): Promise<ModelResponse> {
      const ollamaMessages = toOllamaMessages(messages);
      const ollamaTools = tools && tools.length > 0 ? toOllamaTools(tools) : undefined;

      const requestBody = {
        model: config.modelId,
        messages: ollamaMessages,
        stream: false,
        ...(ollamaTools ? { tools: ollamaTools } : {}),
      };

      const startMs = performance.now();
      let responseData: OllamaResponse;

      try {
        const resp = await fetch(`${endpoint}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        if (resp.status === 401 || resp.status === 403) {
          throw new Error(
            `Provider ${label} auth failed: check Ollama authentication configuration`,
          );
        }

        if (resp.status === 429) {
          throw new Error(`Provider ${label} rate limited — reduce concurrency`);
        }

        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(
            `Provider ${label} error: HTTP ${resp.status} — ${body}`,
          );
        }

        responseData = (await resp.json()) as OllamaResponse;
      } catch (err) {
        // Re-classify errors that aren't already our own
        if (err instanceof Error && err.message.startsWith(`Provider ${label}`)) {
          throw err;
        }
        classifyError(label, err, performance.now() - startMs);
      }

      const latencyMs = performance.now() - startMs;

      const assistantMessage = responseData.message;

      // Extract text content
      const content = assistantMessage.content ?? "";

      // Extract tool calls
      const toolCalls: ToolCall[] = (assistantMessage.tool_calls ?? []).map(
        (tc, idx) => ({
          id: `ollama-tc-${idx}-${Date.now()}`,
          name: tc.function.name,
          arguments: tc.function.arguments,
        }),
      );

      // Estimate token usage — Ollama reports prompt_eval_count / eval_count
      const inputTokens = responseData.prompt_eval_count ?? 0;
      const outputTokens = responseData.eval_count ?? 0;
      const usage = {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      };

      return {
        content,
        toolCalls,
        usage,
        latencyMs,
        raw: responseData,
      };
    },
  };
}
