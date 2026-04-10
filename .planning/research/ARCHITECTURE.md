# Architecture Research — Agent LLM Evaluation System

*Research date: 2026-04-10*

---

## 1. Component Boundaries

### How Evaluation Systems Are Typically Structured

Mature evaluation frameworks (DeepEval, Strands Evals, LangSmith) converge on the same six-layer separation. Each layer has one job and depends only on layers below it.

```
┌─────────────────────────────────────────────────────┐
│                    CLI Interface                     │  ← User entry point
├─────────────────────────────────────────────────────┤
│                  Report Generator                    │  ← Consumes results
├─────────────────────────────────────────────────────┤
│               Evaluation Engine                      │  ← Orchestrates runs
├──────────────────────┬──────────────────────────────┤
│   Test Generator     │   Model Provider Abstraction  │  ← Parallel concerns
├──────────────────────┴──────────────────────────────┤
│              Agent Loader / Config                   │  ← Foundation
├─────────────────────────────────────────────────────┤
│           Observability (OTEL cross-cut)             │  ← Horizontal concern
└─────────────────────────────────────────────────────┘
```

### Module Responsibilities

#### Agent Loader / Config (`src/core/`)
- Reads YAML agent definition files and validates them against a Zod schema
- Produces a normalized `AgentConfig` object: `{ id, systemPrompt, tools[], modelDefaults, metadata }`
- Responsible for resolving tool implementations from the Strands SDK registry
- Does NOT run agents — pure loading and validation
- This is the **single source of truth** that every other module receives

#### Model Provider Abstraction (`src/core/providers/`)
- Defines a `ModelProvider` interface: `complete(messages, tools, options) → AgentResponse`
- Concrete implementations for each backend: `BedrockProvider`, `AnthropicProvider`, `OpenAIProvider`, `OllamaProvider`
- A `ProviderFactory` maps provider names from config to lazily-imported implementations (avoids requiring all SDKs)
- Handles provider-specific retry logic, rate limiting, and credential resolution
- Does NOT evaluate — it only executes model calls and returns structured responses

#### Test Case Generator (`src/test-generator/`)
- Accepts an `AgentConfig` and calls an LLM to generate test cases
- Analyzes tool names, descriptions, parameters, and system prompt to infer realistic inputs
- Outputs an array of `TestCase` objects: `{ id, input, expectedTools?, expectedOutputContains?, metadata }`
- Test cases are serialized to YAML so developers can inspect, edit, and version them
- Manual YAML test cases and generated ones are merged before the evaluation run

#### Evaluation Engine (`src/evaluation/`)
- The orchestrator: given `AgentConfig + TestCases + ProviderList`, runs all combinations
- For each `(testCase, provider)` pair: invokes the agent, captures the full trajectory (tool calls, inputs, outputs, token counts, latency), then passes the result to each registered `Evaluator`
- Evaluators are plugged in via Strategy pattern (see Section 3)
- Produces `EvaluationResult[]`: one record per `(testCase, provider)` combination
- Handles concurrency limits and per-provider rate-limit back-off

#### Observability Instrumentation (`src/observability/`)
- Initializes the OTEL SDK once at process start (NodeSDK with OTLP HTTP exporter)
- Exposes a thin `Tracer` wrapper that other modules call to create spans
- Publishes completed `EvaluationResult` records to Langfuse (scores) and MLflow (metrics/runs)
- All three backends (OTEL, Langfuse, MLflow) are optional — the system degrades gracefully if env vars are absent
- Does NOT contain business logic — it is a pure side-effect sink

#### Report Generator (`src/reporting/`)
- Consumes `EvaluationResult[]` and renders Markdown + HTML
- Uses Handlebars templates for structure; embeds chart data as inline JSON for the HTML version
- Produces: model comparison table, per-metric breakdown, cost/latency analysis, recommended model with rationale
- Completely stateless — the same results array always produces the same report
- No dependency on observability backends

#### CLI Interface (`src/index.ts` + Commander)
- Four commands: `generate-tests`, `evaluate`, `report`, `compare`
- Each command loads config, instantiates the relevant module, runs it, writes output
- Thin shell — delegates immediately to domain modules
- Handles `--config`, `--output`, `--providers`, `--models` flags

---

## 2. Data Flow

```
YAML Config File
       │
       ▼
 AgentLoader.load()
       │ AgentConfig { id, systemPrompt, tools[], ... }
       ▼
 TestGenerator.generate(agentConfig)
       │ TestCase[] (auto-generated + manually authored, merged)
       ├──── written to: eval-config/test-cases/<agent-id>.yaml
       ▼
 EvaluationEngine.run(agentConfig, testCases, providers[])
       │
       ├── for each (testCase × provider):
       │      ProviderFactory.get(provider).complete(...)
       │                │ raw AgentResponse { content, toolCalls[], tokens, latencyMs }
       │                ▼
       │         Trajectory captured
       │                ▼
       │         Evaluators run in parallel:
       │           - ToolAccuracyEvaluator → score 0–1
       │           - TrajectoryEvaluator   → score 0–1
       │           - LLMJudgeEvaluator     → score 0–1 (+ reasoning)
       │           - CostEvaluator         → cost in USD
       │                ▼
       │         EvaluationResult {
       │           testCaseId, provider, model,
       │           scores: { toolAccuracy, trajectory, quality, cost },
       │           rawOutput, toolCallLog, latencyMs, tokenUsage
       │         }
       │
       ├──── side-effects (async, non-blocking):
       │       ObservabilityService.record(result)
       │         ├── OTEL span committed
       │         ├── Langfuse score posted
       │         └── MLflow run metric logged
       │
       ▼
 EvaluationResult[]   (in-memory; also written to results/<run-id>.json)
       │
       ▼
 ReportGenerator.render(results)
       │
       ├── reports/<run-id>/report.md
       └── reports/<run-id>/report.html
```

### Key invariant: results are plain data

`EvaluationResult` is a serializable POJO with no methods and no references to provider objects. This means the report generator can be run independently against a saved JSON file — `agent-eval report --results results/run-123.json` — without re-running any agents.

---

## 3. Key Patterns

### Factory Pattern — Model Providers

The core problem: you don't want to `npm install` all provider SDKs just to run with one. The solution is dynamic import with a registry:

```typescript
// src/core/providers/factory.ts
const PROVIDER_REGISTRY: Record<string, () => Promise<ModelProvider>> = {
  bedrock:   () => import('./bedrock.js').then(m => new m.BedrockProvider()),
  anthropic: () => import('./anthropic.js').then(m => new m.AnthropicProvider()),
  openai:    () => import('./openai.js').then(m => new m.OpenAIProvider()),
  ollama:    () => import('./ollama.js').then(m => new m.OllamaProvider()),
};

export async function getProvider(name: string): Promise<ModelProvider> {
  const loader = PROVIDER_REGISTRY[name];
  if (!loader) throw new Error(`Unknown provider: ${name}`);
  return loader();
}
```

The `ModelProvider` interface is the only thing the evaluation engine imports from `src/core/providers/`. Concrete classes live behind dynamic imports and are never referenced directly.

**Provider interface:**
```typescript
interface ModelProvider {
  name: string;
  complete(request: AgentRequest): Promise<AgentResponse>;
  estimateCost(tokens: TokenUsage): number;
}
```

### Strategy Pattern — Evaluators

Each evaluation dimension is a separate `Evaluator` implementation. The engine calls all registered evaluators and collects their scores:

```typescript
interface Evaluator {
  name: string;
  evaluate(result: RawAgentResult, testCase: TestCase): Promise<EvaluatorScore>;
}

// Concrete implementations:
// - ToolAccuracyEvaluator: compares actual tool calls vs expected tools
// - TrajectoryEvaluator: compares full tool call sequence (exact/in-order/any-order)
// - LLMJudgeEvaluator: sends output to a judge LLM with a scoring rubric
// - CostEvaluator: deterministic, calculates USD from token counts
// - LatencyEvaluator: deterministic, checks against thresholds
```

New evaluators are added by implementing the interface — the engine needs no changes. The set of evaluators to run is configured in the YAML config, defaulting to all built-in ones.

**Trajectory scoring** (per Strands Evals research): three modes — `exact` (order matters, all must match), `in-order` (subsequence match), `any-order` (set match). For tool-heavy agents, `in-order` is typically most useful.

### LLM-as-Judge Integration

The `LLMJudgeEvaluator` is the most powerful evaluator and also the most expensive. Key design decisions:

1. **Separate judge model**: The judge uses a different (often stronger) model than the one being evaluated. Configured via `judge.provider` and `judge.model` in the YAML.

2. **Structured scoring prompt**: The judge receives a rubric with the agent's task, the ideal behavior, the actual output, and tool call log. It returns a JSON score `{ score: 0-10, reasoning: string, pass: boolean }`.

3. **Runs after heuristic evaluators**: The pipeline runs cheap deterministic checks first (tool accuracy, cost) and only invokes the judge LLM when needed, or always for a configured subset of test cases.

4. **Uses the same `ModelProvider` abstraction**: `LLMJudgeEvaluator` calls `getProvider(judgeConfig.provider)` — no special casing. The judge is just another model call.

**Pipeline layering** (from research — industry consensus):
- Layer 1: Deterministic checks (format, tool presence, latency threshold) — free
- Layer 2: Heuristic scoring (trajectory match, tool parameter correctness) — cheap
- Layer 3: LLM-as-judge (quality, reasoning, helpfulness) — costly, run selectively

### OTEL Without Coupling — Thin Tracer Wrapper

The key insight from OpenTelemetry GenAI Semantic Conventions: define a facade that business logic calls, and have the facade emit OTEL spans with `gen_ai.*` attributes. If OTEL is not configured, the facade is a no-op.

```typescript
// src/observability/tracer.ts
import { trace, context, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('agent-eval', '0.1.0');

export function withEvalSpan<T>(
  name: string,
  attrs: Record<string, string | number>,
  fn: () => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    span.setAttributes(attrs);
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

The evaluation engine calls `withEvalSpan('agent.invoke', { 'gen_ai.system': provider, 'gen_ai.request.model': model }, ...)`. It never imports `@opentelemetry/sdk-node` — only `@opentelemetry/api`, which is a zero-overhead no-op if no SDK is initialized.

The SDK is initialized once in `src/observability/setup.ts`, which is called by the CLI before any commands run. Other modules never touch SDK initialization.

**Langfuse integration**: Langfuse v3 SDK acts as a thin OTEL layer — configure it via `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASEURL`. Scores (the judge's numeric output) are posted via `langfuse.score()` after evaluation, not during the span.

**MLflow integration**: MLflow's TypeScript support (as of late 2025) allows logging metrics via REST API calls. Post `run_id`, metric names (`tool_accuracy`, `quality_score`, `cost_usd`, `latency_p50`) and the winning model recommendation as a tag. This is fire-and-forget — failures are logged but do not abort evaluation.

---

## 4. Build Order

Dependencies determine the build sequence. A module can only be built when everything it imports is stable.

### Wave 1 — Foundation (no dependencies)
1. **`src/core/types.ts`** — All shared interfaces: `AgentConfig`, `TestCase`, `AgentRequest`, `AgentResponse`, `EvaluationResult`, `EvaluatorScore`. No logic, just types and Zod schemas.
2. **`src/core/agent-loader.ts`** — Reads and validates YAML. Only depends on `types.ts` and the `yaml` package.
3. **`src/observability/tracer.ts`** — The no-op-safe OTEL facade. Only depends on `@opentelemetry/api`.

### Wave 2 — Provider Layer (depends on Wave 1)
4. **`src/core/providers/interface.ts`** — `ModelProvider` interface only.
5. **`src/core/providers/bedrock.ts`** — First concrete provider (Bedrock, since it is the Strands default).
6. **`src/core/providers/anthropic.ts`**, **`openai.ts`**, **`ollama.ts`** — Remaining providers.
7. **`src/core/providers/factory.ts`** — Dynamic import registry.

### Wave 3 — Evaluators (depends on Wave 1)
8. **`src/evaluation/evaluator.interface.ts`** — `Evaluator` interface.
9. **`src/evaluation/evaluators/tool-accuracy.ts`** — Deterministic, easiest to test.
10. **`src/evaluation/evaluators/trajectory.ts`** — Deterministic, requires trajectory matching logic.
11. **`src/evaluation/evaluators/cost.ts`** — Deterministic, token × price-per-token.
12. **`src/evaluation/evaluators/llm-judge.ts`** — Depends on provider factory (Wave 2).

### Wave 4 — Test Generator (depends on Wave 1 + Wave 2)
13. **`src/test-generator/generator.ts`** — Uses provider factory to call an LLM. Reads `AgentConfig`, emits `TestCase[]`.
14. **`src/test-generator/merger.ts`** — Merges generated cases with manually-authored YAML files.

### Wave 5 — Evaluation Engine (depends on Waves 1–4)
15. **`src/evaluation/engine.ts`** — Orchestrates all of the above. This is the largest single module.

### Wave 6 — Observability Sinks (depends on Wave 1 + Wave 5 types)
16. **`src/observability/langfuse-reporter.ts`** — Posts scores after each evaluation result.
17. **`src/observability/mlflow-reporter.ts`** — Posts metrics to MLflow REST API.
18. **`src/observability/setup.ts`** — Initializes OTEL NodeSDK. Called once at CLI startup.

### Wave 7 — Report Generator (depends on Wave 1 only — reads plain EvaluationResult[])
19. **`src/reporting/markdown.ts`** — Markdown renderer via Handlebars templates.
20. **`src/reporting/html.ts`** — HTML renderer with embedded chart data.

### Wave 8 — CLI (depends on everything)
21. **`src/index.ts`** — Commander entry point, wires all modules together.

### Build order rationale

- Start with types because every module imports them — unstable types cause cascading churn
- Build providers before evaluators because `LLMJudgeEvaluator` depends on `ProviderFactory`
- Build evaluators before the engine because the engine is just a loop over evaluators
- Build the report generator independently so it can be developed and tested against fixture data without running real agents
- Build the CLI last — it is integration glue, not logic, and benefits from all modules being stable first

---

## 5. YAML Config Schema (Reference)

This is the shape of the agent evaluation YAML that the Agent Loader will validate:

```yaml
# eval-config/<agent-id>.yaml
agent:
  id: my-research-agent
  systemPrompt: "You are a research assistant..."
  tools:
    - name: web_search
      description: "Search the web"
      # parameters inferred from Strands tool registration or declared here
  defaults:
    maxIterations: 10
    temperature: 0

evaluation:
  providers:
    - name: bedrock
      models: [us.anthropic.claude-sonnet-4-5, us.amazon.nova-pro-v1]
    - name: anthropic
      models: [claude-opus-4-5]
    - name: openai
      models: [gpt-4o]
  evaluators:
    - toolAccuracy
    - trajectory
    - llmJudge
    - cost
    - latency
  judge:
    provider: anthropic
    model: claude-opus-4-5
  concurrency: 3  # parallel provider calls per test case
  retries: 2

testCases:
  generate: true              # auto-generate from agent definition
  manualFiles:                # also load these
    - test-cases/my-agent-manual.yaml
  count: 10                   # how many to auto-generate

output:
  resultsDir: ./results
  reportsDir: ./reports
  formats: [markdown, html]

observability:
  otel:
    enabled: true
    endpoint: http://localhost:4318
  langfuse:
    enabled: true             # reads LANGFUSE_* env vars
  mlflow:
    enabled: false
    trackingUri: http://localhost:5000
```

---

## 6. Key Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| LLM-as-judge is itself an LLM call — cost doubles for each test case | Make judge optional per test case; run deterministic evaluators first; allow sampling (judge only 20% of cases) |
| Provider rate limits halt evaluation mid-run | Per-provider semaphore + exponential back-off + checkpoint results to JSON so run can resume |
| Strands TypeScript SDK is experimental (breaking changes expected) | Isolate Strands-specific code behind `AgentLoader` and `AgentRunner` — rest of system never imports Strands directly |
| OTEL SDK initialization is global state | Initialize once in CLI setup before any modules load; other modules only import `@opentelemetry/api` (zero-dep facade) |
| Generated test cases may be low quality | Review step built into `generate-tests` command: writes YAML, exits, developer edits before `evaluate` runs |
| Report generator gets complex | Keep it stateless and template-driven; acceptance test by running against fixture JSON — no LLM needed |

---

## Sources

- [Evaluation-Driven Development of LLM Agents: A Process Model and Reference Architecture](https://arxiv.org/html/2411.13768v3)
- [LLM Agent Evaluation: Assessing Tool Use, Task Completion, Agentic Reasoning — Confident AI](https://www.confident-ai.com/blog/llm-agent-evaluation-complete-guide)
- [Evaluating AI agents: Real-world lessons from Amazon](https://aws.amazon.com/blogs/machine-learning/evaluating-ai-agents-real-world-lessons-from-building-agentic-systems-at-amazon/)
- [LLM-as-a-Judge — Langfuse](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge)
- [LLM Evaluation Pipeline that Catches Failures — DEV Community](https://dev.to/pockit_tools/llm-evaluation-and-testing-how-to-build-an-eval-pipeline-that-actually-catches-failures-before-5e3n)
- [Strands Agents SDK TypeScript Quickstart](https://strandsagents.com/latest/documentation/docs/user-guide/quickstart/typescript/)
- [Strands Agents SDK — Technical Deep Dive and Observability](https://aws.amazon.com/blogs/machine-learning/strands-agents-sdk-a-technical-deep-dive-into-agent-architectures-and-observability/)
- [Strands Evals — Evaluators Overview](https://strandsagents.com/latest/documentation/docs/user-guide/evals-sdk/evaluators/)
- [Strands Evals — Trajectory Evaluator](https://strandsagents.com/latest/documentation/docs/user-guide/evals-sdk/evaluators/trajectory_evaluator/)
- [Evaluating AI agents for production: Strands Evals guide](https://aws.amazon.com/blogs/machine-learning/evaluating-ai-agents-for-production-a-practical-guide-to-strands-evals/)
- [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OpenTelemetry GenAI Agent Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/)
- [openllmetry — Open-source OTel observability for LLMs](https://github.com/traceloop/openllmetry)
- [MLflow LLM Tracing and Agent Observability](https://mlflow.org/docs/latest/genai/tracing/)
- [AI Observability for TypeScript LLM Stack — MLflow](https://mlflow.org/blog/typescript-enhancement)
- [DeepEval System Architecture](https://deepwiki.com/confident-ai/deepeval/1.3-system-architecture)
- [Langfuse External Evaluation Pipeline Cookbook](https://langfuse.com/guides/cookbook/example_external_evaluation_pipelines)
- [A Methodical Approach to Agent Evaluation — Google Cloud](https://cloud.google.com/blog/topics/developers-practitioners/a-methodical-approach-to-agent-evaluation)
- [Demystifying Evals for AI Agents — Anthropic Engineering](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Galileo Agent Evaluation Framework 2026](https://galileo.ai/blog/agent-evaluation-framework-metrics-rubrics-benchmarks)
