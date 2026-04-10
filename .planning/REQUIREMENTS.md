# Requirements

## v1 Requirements

### Configuration & Setup
- [ ] **CFG-01**: User can define an agent evaluation via a YAML config file specifying agent module, models, evaluators, and reporting options
- [ ] **CFG-02**: User can specify multiple LLM providers (Bedrock, Anthropic, OpenAI, Ollama) with model IDs and parameters in the config
- [ ] **CFG-03**: System validates YAML config against a Zod schema and reports clear errors for invalid configs
- [ ] **CFG-04**: User can provide a `.env` file for provider credentials; system fails fast with clear messages when credentials are missing

### Agent Loading
- [ ] **AGT-01**: System can load an agent definition from a TypeScript module exporting tools and system prompt
- [ ] **AGT-02**: System can create agent variants by injecting different model providers into the same agent definition
- [ ] **AGT-03**: System supports agents with multiple tool-decorated functions

### Test Case Generation
- [ ] **TST-01**: System auto-generates test cases by analyzing an agent's tools (names, descriptions, parameters) and system prompt
- [ ] **TST-02**: Generated test cases span categories: happy_path, edge_case, multi_turn, error_handling
- [ ] **TST-03**: Generated test cases include expected tool calls and expected facts for evaluation
- [ ] **TST-04**: User can add manual test cases via YAML that are merged with auto-generated ones
- [ ] **TST-05**: Generated test cases can be saved to and loaded from YAML files for reuse

### Evaluation Engine
- [ ] **EVL-01**: System runs each test case against each configured model and captures: response text, tool calls, latency, token usage
- [ ] **EVL-02**: System supports configurable number of runs per test case for statistical reliability
- [ ] **EVL-03**: System implements LLM-as-judge evaluation scoring helpfulness, coherence, faithfulness, and conciseness (1-5 scale)
- [ ] **EVL-04**: System implements tool accuracy evaluator comparing expected vs actual tool selections
- [ ] **EVL-05**: System implements trajectory evaluator comparing expected vs actual tool call sequences
- [ ] **EVL-06**: System handles provider errors gracefully (timeouts, rate limits, auth failures) without aborting the full evaluation
- [ ] **EVL-07**: System uses per-provider concurrency limits to avoid rate limiting

### Observability
- [ ] **OBS-01**: System instruments evaluation runs with OpenTelemetry spans including model, test case, and score attributes
- [ ] **OBS-02**: System can export OTEL traces to a configurable OTLP endpoint
- [ ] **OBS-03**: System can send traces to Langfuse via OTLP bridge for visualization and scoring
- [ ] **OBS-04**: System can log evaluation metrics and parameters to MLflow for experiment comparison
- [ ] **OBS-05**: System tracks cost per model using provider-reported token counts and configurable pricing

### Reporting
- [ ] **RPT-01**: System generates a Markdown report with executive summary, model comparison table, and recommendation
- [ ] **RPT-02**: System generates an HTML report with embedded SVG charts for visual comparison
- [ ] **RPT-03**: Reports include per-evaluator score breakdown per model
- [ ] **RPT-04**: Reports include cost and latency analysis (total cost, avg/P95 latency per model)
- [ ] **RPT-05**: Reports include per-test-case results breakdown
- [ ] **RPT-06**: Reports include a clear best-model recommendation with rationale

### CLI
- [ ] **CLI-01**: `agent-eval generate` command generates test cases from an agent config and saves to file
- [ ] **CLI-02**: `agent-eval evaluate` command runs full evaluation pipeline (generate tests, run across models, produce reports)
- [ ] **CLI-03**: `agent-eval report` command generates reports from previously saved evaluation results
- [ ] **CLI-04**: CLI shows progress indicators during evaluation (which model, which test case, spinner)

## v2 Requirements (Deferred)

- [ ] Multi-turn conversation testing with ActorSimulator-style user simulation
- [ ] Pairwise model comparison mode (A/B testing two models directly)
- [ ] CI/CD integration with GitHub Actions workflow
- [ ] Custom evaluator plugin system
- [ ] Evaluation result diffing (compare two evaluation runs)
- [ ] Streaming progress output to a web UI
- [ ] Support for multi-agent orchestration evaluation

## Out of Scope

- **Web dashboard** — static reports serve solo developer; use Langfuse/MLflow UIs for dashboards
- **Real-time monitoring** — batch evaluation only; use Datadog/Langfuse for production monitoring
- **Agent framework** — uses Strands SDK; not building another agent framework
- **Database storage** — JSON files + MLflow sufficient for solo developer
- **Authentication** — no multi-tenancy needed

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| CFG-01 | Phase 1: Foundation — Types, Config & Agent Loading | Not started |
| CFG-02 | Phase 1: Foundation — Types, Config & Agent Loading | Not started |
| CFG-03 | Phase 1: Foundation — Types, Config & Agent Loading | Not started |
| CFG-04 | Phase 1: Foundation — Types, Config & Agent Loading | Not started |
| AGT-01 | Phase 1: Foundation — Types, Config & Agent Loading | Not started |
| AGT-02 | Phase 1: Foundation — Types, Config & Agent Loading | Not started |
| AGT-03 | Phase 1: Foundation — Types, Config & Agent Loading | Not started |
| EVL-01 | Phase 2: Model Providers | Not started |
| EVL-06 | Phase 2: Model Providers | Not started |
| EVL-07 | Phase 2: Model Providers | Not started |
| TST-01 | Phase 3: Test Case Generation | Not started |
| TST-02 | Phase 3: Test Case Generation | Not started |
| TST-03 | Phase 3: Test Case Generation | Not started |
| TST-04 | Phase 3: Test Case Generation | Not started |
| TST-05 | Phase 3: Test Case Generation | Not started |
| EVL-02 | Phase 4: Evaluation Engine & Evaluators | Not started |
| EVL-03 | Phase 4: Evaluation Engine & Evaluators | Not started |
| EVL-04 | Phase 4: Evaluation Engine & Evaluators | Not started |
| EVL-05 | Phase 4: Evaluation Engine & Evaluators | Not started |
| OBS-01 | Phase 5: Observability | Not started |
| OBS-02 | Phase 5: Observability | Not started |
| OBS-03 | Phase 5: Observability | Not started |
| OBS-04 | Phase 5: Observability | Not started |
| OBS-05 | Phase 5: Observability | Not started |
| RPT-01 | Phase 6: Reports & CLI | Not started |
| RPT-02 | Phase 6: Reports & CLI | Not started |
| RPT-03 | Phase 6: Reports & CLI | Not started |
| RPT-04 | Phase 6: Reports & CLI | Not started |
| RPT-05 | Phase 6: Reports & CLI | Not started |
| RPT-06 | Phase 6: Reports & CLI | Not started |
| CLI-01 | Phase 6: Reports & CLI | Not started |
| CLI-02 | Phase 6: Reports & CLI | Not started |
| CLI-03 | Phase 6: Reports & CLI | Not started |
| CLI-04 | Phase 6: Reports & CLI | Not started |

---
*Last updated: 2026-04-10*
