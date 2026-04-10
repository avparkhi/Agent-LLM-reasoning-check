# Agent LLM Evaluation System

> **"Which LLM should I use for this agent?"** -- answered with data, not guesswork.

A TypeScript CLI tool that evaluates AI agents across multiple LLM providers (Claude, GPT, Llama, Mistral, etc.) and tells you which model performs best -- backed by automated test cases, multi-dimensional scoring, and comprehensive reports.

Built for developers who create tool-heavy agents with [AWS Strands Agents SDK](https://strandsagents.com/) and need to make data-driven production deployment decisions.

---

## The Problem

You build an agent with 5 tools and a system prompt. Now you need to decide: Claude Sonnet? GPT-4o? Llama 3.1? Each model handles tool calling differently, costs different amounts, and has different latency profiles. Testing manually across 4 models with 20 scenarios is tedious and unreliable.

## The Solution

```
 YAML Config                Auto-Generated              Multi-Model              Comparison
 (agent + models)    --->    Test Cases          --->    Evaluation      --->     Report
                             (LLM-powered)               (6 evaluators)          (MD + HTML)
```

1. **Define once** -- point at your agent's tools and list the models to compare
2. **Generate tests** -- LLM analyzes your tools and creates diverse test scenarios automatically
3. **Evaluate** -- runs every test against every model with deterministic + LLM-as-judge scoring
4. **Get answers** -- a report tells you which model wins, why, and at what cost

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/avparkhi/agent-llm-reasoning-check.git
cd agent-llm-reasoning-check
npm install

# Set your API keys
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.

# Build
npm run build

# Run a full evaluation
npx agent-eval evaluate --config examples/configs/eval-config.yaml
```

### What You Get

After evaluation completes, you'll find in `./reports/`:

**`report.md`** -- Markdown with model rankings:
```
## Model Comparison

| Model           | Overall | Helpfulness | Tool Accuracy | Latency (ms) | Cost ($) |
|-----------------|---------|-------------|---------------|--------------|----------|
| Claude Sonnet   | 87.3    | 4.5/5       | 5.0/5         | 1,230        | $0.042   |
| GPT-4o          | 82.1    | 4.2/5       | 4.5/5         | 980          | $0.038   |
| Llama 3.1 70B   | 71.4    | 3.8/5       | 3.0/5         | 2,100        | $0.000   |

## Recommendation
Claude Sonnet is the best model for this agent, scoring highest on helpfulness
(4.5/5) and tool accuracy (5.0/5). While GPT-4o is 20% faster and 10% cheaper,
Claude Sonnet's superior tool selection justifies the cost difference for
production use.
```

**`report.html`** -- Self-contained HTML with color-coded tables and SVG bar charts (no internet needed).

---

## Configuration

Define your evaluation in a single YAML file:

```yaml
# What agent to evaluate
agent:
  name: "research-assistant"
  systemPrompt: "You are a research assistant. Use tools to find and summarize information."
  module: "./agents/research-agent"    # TypeScript module exporting tools
  tools:
    - name: "web_search"
      description: "Search the web for information"
      parameters:
        query: { type: "string", description: "Search query", required: true }
    - name: "summarize"
      description: "Summarize a block of text"
      parameters:
        text: { type: "string", description: "Text to summarize", required: true }

# Which models to compare
models:
  - provider: "anthropic"
    modelId: "claude-sonnet-4-20250514"
    label: "Claude Sonnet"
  - provider: "openai"
    modelId: "gpt-4o"
    label: "GPT-4o"
  - provider: "bedrock"
    modelId: "anthropic.claude-sonnet-4-20250514-v1:0"
    label: "Claude Sonnet (Bedrock)"
  - provider: "ollama"
    modelId: "llama3.1:70b"
    label: "Llama 3.1 70B"

# How to evaluate
evaluation:
  evaluators: ["helpfulness", "coherence", "faithfulness", "toolAccuracy", "trajectory", "conciseness"]
  judgeModel:
    provider: "anthropic"
    modelId: "claude-sonnet-4-20250514"
  runsPerTest: 3                       # Run each test 3x for statistical reliability

# Auto-generate test cases (or provide your own)
testGeneration:
  enabled: true
  numCases: 20
  categories: ["happy_path", "edge_case", "multi_turn", "error_handling"]

# Optional: manual test cases merged with generated ones
testCases:
  - id: "manual-001"
    name: "basic search"
    category: "happy_path"
    input: "Find the latest news about quantum computing"
    expectedToolCalls: ["web_search"]
    expectedFacts: ["quantum", "computing"]
    difficulty: "easy"

# Observability (all optional)
observability:
  otel:
    enabled: true
    endpoint: "http://localhost:4318"
  langfuse:
    enabled: false
  mlflow:
    enabled: false
    trackingUri: "http://localhost:5000"
    experimentName: "research-agent-eval"

# Report output
reporting:
  outputDir: "./reports"
  formats: ["markdown", "html"]
```

---

## CLI Commands

### `agent-eval generate` -- Generate Test Cases

```bash
npx agent-eval generate --config eval-config.yaml --output test-cases.yaml --num-cases 30
```

Analyzes your agent's tools, parameters, and system prompt, then uses an LLM to generate diverse test scenarios. Generated tests span 4 categories:

| Category | What It Tests |
|----------|--------------|
| `happy_path` | Normal usage -- does the agent handle standard requests? |
| `edge_case` | Boundary conditions -- unusual inputs, large numbers, empty strings |
| `multi_turn` | Conversation flow -- does context carry over across turns? |
| `error_handling` | Failures -- what happens with invalid inputs or missing data? |

### `agent-eval evaluate` -- Run Full Evaluation

```bash
npx agent-eval evaluate --config eval-config.yaml
```

Runs the complete pipeline:
1. Generates (or loads) test cases
2. Creates agent variants for each model
3. Runs every test case against every model (with configurable concurrency)
4. Scores each response with 6 evaluators
5. Aggregates metrics and ranks models
6. Generates reports
7. Saves results to `results.json` for later re-analysis

### `agent-eval report` -- Regenerate Reports

```bash
npx agent-eval report --results ./reports/results.json --format markdown,html
```

Regenerate reports from previously saved results without re-running any model calls.

---

## Evaluators

The system uses two types of evaluators, executed in cost order (cheap first):

### Deterministic Evaluators (Free)

| Evaluator | Scale | How It Works |
|-----------|-------|-------------|
| **Tool Accuracy** | 0-5 | Set intersection: expected vs actual tool calls |
| **Trajectory** | 0-5 | Position-by-position sequence comparison of tool call order |

### LLM-as-Judge Evaluators (Uses Tokens)

| Evaluator | Scale | What It Scores |
|-----------|-------|---------------|
| **Helpfulness** | 1-5 | Does the response actually help the user? |
| **Coherence** | 1-5 | Is the response logically structured and clear? |
| **Faithfulness** | 1-5 | Does the response contain expected facts? (skipped if none defined) |
| **Conciseness** | 1-3 | Is the response appropriately brief vs comprehensive? |

Each LLM-as-judge evaluator sends a structured rubric prompt to the judge model and parses a numeric score with reasoning.

---

## Supported Providers

| Provider | SDK | Auth | Notes |
|----------|-----|------|-------|
| **Anthropic** | `@anthropic-ai/sdk` | `ANTHROPIC_API_KEY` | Direct API access to Claude models |
| **OpenAI** | `openai` | `OPENAI_API_KEY` | GPT-4o, GPT-4o-mini, etc. |
| **AWS Bedrock** | `@aws-sdk/client-bedrock-runtime` | `AWS_PROFILE` / `AWS_REGION` | Claude, Llama, Titan via Bedrock Converse API |
| **Ollama** | REST API (fetch) | None | Local models -- free, no API key needed |

Only install the SDKs you need. Providers are lazily imported -- if you only evaluate Anthropic and OpenAI, you don't need the AWS SDK installed.

---

## Observability

### OpenTelemetry
Every evaluation run produces OTEL spans with `gen_ai.*` semantic convention attributes. Export to any OTLP-compatible backend (Jaeger, Grafana Tempo, Datadog, etc.).

### Langfuse
Traces are sent to Langfuse via OTLP bridge. View per-trace drill-downs with scores attached. Set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`.

### MLflow
Evaluation metrics are logged as MLflow runs. Compare models visually in the MLflow UI. Each model gets its own run with parameters and metrics.

### Cost Tracking
Built-in per-token pricing for major models. Reports include total cost, cost per 1K invocations, and cost-adjusted quality scores.

---

## Architecture

```
src/
  index.ts                  # CLI entry point (Commander.js)
  core/
    types.ts                # Shared TypeScript interfaces (50+ types)
    config.ts               # Zod-validated YAML config loader with ${ENV_VAR} interpolation
    agent-loader.ts         # Dynamic agent module loading
    model-registry.ts       # Model provider factory with lazy imports
  providers/
    anthropic.ts            # Anthropic Messages API
    openai.ts               # OpenAI Chat Completions API
    bedrock.ts              # AWS Bedrock Converse API
    ollama.ts               # Ollama REST API (no SDK dependency)
  test-generator/
    generator.ts            # LLM-powered test case generation + YAML save/load
    templates.ts            # Structured generation prompts
    models.ts               # Zod schemas for test case validation
  evaluation/
    engine.ts               # Multi-model evaluation orchestrator with concurrency control
    runner.ts               # Single test case execution (single + multi-turn)
    evaluators.ts           # 6 evaluator functions (deterministic + LLM-as-judge)
    metrics.ts              # Score aggregation, ranking, weighted composite scoring
  observability/
    otel-setup.ts           # OpenTelemetry TracerProvider + OTLP exporter
    langfuse-tracker.ts     # Langfuse OTLP bridge with Basic auth
    mlflow-tracker.ts       # MLflow REST API client (fetch-based, no npm dep)
    cost-tracker.ts         # Per-model token cost accumulator
  reporting/
    generator.ts            # Report orchestrator (writes files to disk)
    markdown-report.ts      # 7-section Markdown with Unicode bar charts
    html-report.ts          # Self-contained HTML with inline CSS + SVG charts
```

---

## Environment Variables

```bash
# Provider credentials (only set what you use)
ANTHROPIC_API_KEY=sk-ant-...          # Required for Anthropic provider
OPENAI_API_KEY=sk-...                 # Required for OpenAI provider
AWS_PROFILE=default                   # Required for Bedrock provider
AWS_REGION=us-east-1                  # Required for Bedrock provider
OLLAMA_BASE_URL=http://localhost:11434 # Optional, defaults shown

# Observability (all optional)
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com
MLFLOW_TRACKING_URI=http://localhost:5000
```

---

## Development

```bash
npm install             # Install dependencies
npm run build           # Compile TypeScript to dist/
npm run dev             # Run with tsx (no build step)
npm test                # Run 24 unit tests with Vitest
npm run typecheck       # Type-check without emitting
```

### Tech Stack

| Category | Library | Why |
|----------|---------|-----|
| Runtime | Node.js 20+ | LTS, stable ESM support |
| Language | TypeScript 5.7+ | Strict mode, full type safety |
| CLI | Commander.js 12 | Lightweight, zero deps |
| Validation | Zod 3 | Runtime schema validation + TypeScript inference |
| YAML | yaml 2.6 | YAML 1.2 compliant, TypeScript typings |
| Testing | Vitest 2.1 | Native ESM, 4-5x faster than Jest |
| OTEL | @opentelemetry/* | Industry-standard distributed tracing |
| Terminal | chalk 5 + ora 8 | ESM-native coloring and spinners |

---

## License

Apache-2.0
