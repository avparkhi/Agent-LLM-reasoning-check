# Agent LLM Evaluation System

Evaluate AI agents across multiple LLM providers to determine which model performs best. Built for developers using AWS Strands Agents SDK who need data-driven production deployment decisions.

## What It Does

1. **Takes an agent definition** (tools, system prompt) as input via YAML config
2. **Auto-generates test cases** by analyzing the agent's tools and capabilities
3. **Runs the agent against multiple LLMs** (Bedrock, Anthropic, OpenAI, Ollama)
4. **Evaluates each run** using LLM-as-judge + tool accuracy + trajectory analysis
5. **Tracks everything** via OpenTelemetry, Langfuse, and MLflow
6. **Produces reports** with model comparison tables, charts, and recommendations

## Quick Start

```bash
# Install
npm install

# Build
npm run build

# Generate test cases from an agent config
npx agent-eval generate --config examples/configs/eval-config.yaml --output test-cases.yaml

# Run full evaluation
npx agent-eval evaluate --config examples/configs/eval-config.yaml

# Regenerate reports from saved results
npx agent-eval report --results ./reports/results.json --format markdown,html
```

## Configuration

Define your evaluation in YAML:

```yaml
agent:
  name: "my-agent"
  systemPrompt: "You are a helpful assistant..."
  module: "./agents/my-agent"
  tools:
    - name: "search"
      description: "Search the web"
      parameters:
        query:
          type: "string"
          description: "Search query"
          required: true

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

evaluation:
  evaluators:
    - "helpfulness"
    - "coherence"
    - "faithfulness"
    - "toolAccuracy"
    - "trajectory"
    - "conciseness"
  judgeModel:
    provider: "anthropic"
    modelId: "claude-sonnet-4-20250514"
  runsPerTest: 3

testGeneration:
  enabled: true
  numCases: 20
  categories:
    - "happy_path"
    - "edge_case"
    - "multi_turn"
    - "error_handling"

observability:
  otel:
    enabled: true
    endpoint: "http://localhost:4318"
  langfuse:
    enabled: false
  mlflow:
    enabled: false
    trackingUri: "http://localhost:5000"
    experimentName: "agent-eval"

reporting:
  outputDir: "./reports"
  formats:
    - "markdown"
    - "html"
```

## Environment Variables

```bash
# Provider credentials (only needed for providers you use)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
AWS_PROFILE=default
AWS_REGION=us-east-1

# Observability (optional)
LANGFUSE_PUBLIC_KEY=pk-...
LANGFUSE_SECRET_KEY=sk-...
LANGFUSE_HOST=https://cloud.langfuse.com
MLFLOW_TRACKING_URI=http://localhost:5000
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `agent-eval generate --config <path>` | Auto-generate test cases from agent definition |
| `agent-eval evaluate --config <path>` | Run full evaluation pipeline |
| `agent-eval report --results <path>` | Generate reports from saved results |

## Evaluators

| Evaluator | Type | Scale | Description |
|-----------|------|-------|-------------|
| Helpfulness | LLM-as-judge | 1-5 | How helpful is the response |
| Coherence | LLM-as-judge | 1-5 | Logical flow and clarity |
| Faithfulness | LLM-as-judge | 1-5 | Grounded in expected facts |
| Conciseness | LLM-as-judge | 1-3 | Brevity vs completeness |
| Tool Accuracy | Deterministic | 0-5 | Correct tool selections |
| Trajectory | Deterministic | 0-5 | Correct tool call sequence |

Evaluators execute in cost order: deterministic first (free), then LLM-as-judge (uses tokens).

## Reports

**Markdown report** includes:
- Executive summary with best model recommendation
- Model comparison table
- Per-evaluator scoring breakdown with Unicode bar charts
- Cost and latency analysis
- Per-test-case detailed results

**HTML report** adds:
- Color-coded comparison tables
- Embedded SVG bar charts
- Responsive layout
- Fully self-contained (no external dependencies)

## Architecture

```
src/
  index.ts              # CLI (Commander.js)
  core/
    types.ts            # Shared TypeScript interfaces
    config.ts           # Zod-validated YAML config loader
    agent-loader.ts     # Dynamic agent module loading
    model-registry.ts   # Model provider factory (lazy imports)
  providers/
    anthropic.ts        # Anthropic SDK provider
    openai.ts           # OpenAI SDK provider
    bedrock.ts          # AWS Bedrock Converse API
    ollama.ts           # Ollama REST API
  test-generator/
    generator.ts        # LLM-powered test case generation
    templates.ts        # Generation prompt templates
    models.ts           # Test case Zod schemas + YAML serialization
  evaluation/
    engine.ts           # Main evaluation orchestrator
    runner.ts           # Test case execution
    evaluators.ts       # Scoring functions (deterministic + LLM-as-judge)
    metrics.ts          # Aggregation, ranking, best model selection
  observability/
    otel-setup.ts       # OpenTelemetry initialization
    langfuse-tracker.ts # Langfuse OTLP bridge
    mlflow-tracker.ts   # MLflow REST API tracker
    cost-tracker.ts     # Per-model cost tracking
  reporting/
    generator.ts        # Report orchestrator
    markdown-report.ts  # Markdown output
    html-report.ts      # HTML output with SVG charts
```

## Development

```bash
npm run build       # Compile TypeScript
npm run dev         # Run with tsx (no build needed)
npm test            # Run tests
npm run typecheck   # Type-check without emitting
```

## License

Apache-2.0
