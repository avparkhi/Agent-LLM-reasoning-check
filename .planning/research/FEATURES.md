# Features Research

## Table Stakes (Must Have)

These are features users expect from any agent evaluation tool. Missing any of these makes the tool feel incomplete.

| Feature | Complexity | Dependencies |
|---------|-----------|--------------|
| **Multi-model comparison** — Run same tests across multiple LLM providers | Medium | Model provider abstraction |
| **YAML-based config** — Declarative evaluation definitions | Low | Zod schema validation |
| **CLI interface** — Commands for generate, evaluate, report | Low | Commander.js |
| **Basic metrics** — Accuracy, latency, cost per model | Medium | Provider response metadata |
| **Test case management** — Load, save, merge manual + generated cases | Low | YAML parsing |
| **Markdown report** — Human-readable comparison tables and recommendations | Medium | Handlebars templates |
| **Tool call tracking** — Record which tools were called with what params | Low | Agent response parsing |
| **Error handling** — Graceful failure when a provider is down or rate-limited | Medium | Retry logic, p-limit |

## Differentiators (Competitive Advantage)

These features set the tool apart. The user specifically requested most of these.

| Feature | Complexity | Dependencies | Notes |
|---------|-----------|--------------|-------|
| **Auto test case generation** — LLM analyzes agent tools/prompt to create tests | High | Judge LLM, tool introspection | Core value prop. Analyze tool specs, system prompt, generate diverse scenarios |
| **LLM-as-judge evaluation** — Use a judge model to score quality dimensions | High | Anthropic/OpenAI SDK | Helpfulness, coherence, faithfulness, conciseness scoring |
| **Trajectory analysis** — Compare expected vs actual tool call sequences | Medium | Test case schema | Strict matching, unordered matching, partial credit |
| **Tool accuracy evaluators** — Score tool selection and parameter correctness | Medium | Test case expected trajectories | Separate selection accuracy from parameter accuracy |
| **OpenTelemetry tracing** — Full span hierarchy for every evaluation run | Medium | OTEL SDK | Native Strands support; configure exporters |
| **Langfuse integration** — Trace visualization, cost tracking, LLM scoring | Medium | Langfuse SDK, OTEL bridge | Via OTLP exporter to Langfuse endpoint |
| **MLflow integration** — Experiment tracking, model comparison UI | Medium | MLflow REST API | Log metrics/params per model run |
| **HTML report with charts** — Visual comparison (bar charts, radar plots) | High | Vega-Lite SVG generation | Self-contained HTML, no external dependencies |
| **Cost optimization analysis** — Quality-per-dollar rankings, Pareto frontier | Medium | Cost tracker data | Helps find cheaper models that meet quality bar |
| **Multi-turn conversation testing** — Test agent across multi-step dialogs | High | Test case schema, runner | Stateful conversations with context carry-over |

## Anti-Features (Deliberately Excluded)

| Anti-Feature | Why NOT to Build |
|-------------|-----------------|
| **Web dashboard** | Adds deployment complexity; static reports serve a solo developer better |
| **Real-time monitoring** | This is batch evaluation, not production monitoring; use Langfuse/Datadog directly for prod |
| **Agent builder/framework** | Strands SDK already does this; don't reinvent the wheel |
| **CI/CD integration** | Premature — manual CLI is sufficient for v1; can add GitHub Actions later |
| **Custom evaluator plugin system** | Over-engineering; users can add evaluator functions directly in code |
| **Database storage** | JSON files + MLflow are sufficient for a solo developer; no need for Postgres |
| **Authentication/multi-tenancy** | Solo developer tool, no need for auth |
| **Streaming evaluation results** | Batch is fine; evaluation runs are not real-time |

## Feature Dependencies Graph

```
YAML Config ──→ Agent Loader ──→ Test Generator ──→ Evaluation Engine
                     │                                      │
                     ▼                                      ▼
              Model Registry                          Evaluators
                     │                               (LLM-as-judge,
                     ▼                                tool accuracy,
              Provider SDKs                           trajectory)
                                                          │
                                                          ▼
                                              Results Aggregation
                                                    │         │
                                                    ▼         ▼
                                              OTEL/Langfuse  Reports
                                              MLflow         (MD + HTML)
```

## Priority Order for Implementation

1. **Core types + config** (everything depends on this)
2. **Model providers** (needed for any evaluation)
3. **Evaluation engine + basic evaluators** (the core loop)
4. **Test case generator** (unlocks auto-testing)
5. **Observability** (enhances but doesn't block evaluation)
6. **Reports** (can be built against fixture data)
7. **CLI** (wires everything together)

---
*Last updated: 2026-04-10*
