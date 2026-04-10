/**
 * Core type definitions for the Agent LLM Evaluation System.
 *
 * All shared TypeScript interfaces used across config loading,
 * agent management, model providers, evaluation, and reporting.
 */

// ---------------------------------------------------------------------------
// Model provider config (from YAML)
// ---------------------------------------------------------------------------

export interface ModelConfig {
  provider: "bedrock" | "anthropic" | "openai" | "ollama";
  modelId: string;
  label?: string;
  params?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Agent config (from YAML)
// ---------------------------------------------------------------------------

export interface AgentConfig {
  name: string;
  description?: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  module?: string;
  exportName?: string;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ParameterDef>;
}

export interface ParameterDef {
  type: string;
  description: string;
  required?: boolean;
  default?: unknown;
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

export interface TestCase {
  id: string;
  name: string;
  category: "happy_path" | "edge_case" | "multi_turn" | "error_handling";
  input: string;
  expectedToolCalls?: string[];
  expectedFacts?: string[];
  multiTurn?: TurnMessage[];
  difficulty: "easy" | "medium" | "hard";
}

export interface TurnMessage {
  role: "user" | "assistant";
  content: string;
}

// ---------------------------------------------------------------------------
// Model provider interface — the core abstraction
// ---------------------------------------------------------------------------

export interface ModelProvider {
  id: string;
  label: string;
  provider: string;
  invoke(messages: Message[], tools?: ToolSpec[]): Promise<ModelResponse>;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
}

export interface ModelResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  latencyMs: number;
  raw?: unknown;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// Evaluation results
// ---------------------------------------------------------------------------

export interface EvalResult {
  testCaseId: string;
  modelId: string;
  runIndex: number;
  response: ModelResponse;
  scores: Record<string, EvaluatorScore>;
  error?: string;
}

export interface EvaluatorScore {
  name: string;
  score: number;
  maxScore: number;
  reasoning?: string;
}

// ---------------------------------------------------------------------------
// Evaluation config (top-level YAML structure)
// ---------------------------------------------------------------------------

export interface EvalConfig {
  agent: AgentConfig;
  models: ModelConfig[];
  evaluation: EvaluationSettings;
  testGeneration: TestGenerationSettings;
  testCases?: TestCase[];
  observability: ObservabilityConfig;
  reporting: ReportingConfig;
}

export interface EvaluationSettings {
  evaluators: string[];
  judgeModel?: ModelConfig;
  runsPerTest: number;
}

export interface TestGenerationSettings {
  enabled: boolean;
  numCases: number;
  categories: string[];
}

export interface ObservabilityConfig {
  otel: { enabled: boolean; endpoint?: string };
  langfuse: { enabled: boolean };
  mlflow: {
    enabled: boolean;
    trackingUri?: string;
    experimentName?: string;
  };
}

export interface ReportingConfig {
  outputDir: string;
  formats: ("markdown" | "html")[];
}

// ---------------------------------------------------------------------------
// Loaded agent (runtime representation)
// ---------------------------------------------------------------------------

export interface LoadedAgent {
  name: string;
  description?: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  createVariant(provider: ModelProvider): AgentVariant;
}

export interface AgentVariant {
  agent: LoadedAgent;
  provider: ModelProvider;
  invoke(messages: Message[]): Promise<ModelResponse>;
}
