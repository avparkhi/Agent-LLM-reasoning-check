# Roadmap

## Overview
6 phases | 30 requirements | Milestone: v1.0

## Phases

### Phase 1: Foundation — Types, Config & Agent Loading
**Goal:** Establish the shared type system, YAML config schema, and agent-loading layer that every subsequent phase depends on.
**Requirements:** CFG-01, CFG-02, CFG-03, CFG-04, AGT-01, AGT-02, AGT-03
**UI hint:** no
**Success Criteria:**
1. User can write a YAML config file, run validation, and receive clear, specific error messages for any invalid field.
2. User can point the config at a TypeScript agent module and the system loads the agent's tools and system prompt without code changes.
3. User can specify multiple providers (Bedrock, Anthropic, OpenAI, Ollama) with model IDs in the config and the system creates distinct agent variants per provider — even when only some provider SDKs are installed.

---

### Phase 2: Model Providers
**Goal:** Implement the model-provider abstraction with lazy imports so the system can invoke any configured LLM through a single, normalised interface.
**Requirements:** EVL-01, EVL-06, EVL-07
**UI hint:** no
**Success Criteria:**
1. User can invoke an agent against any configured provider and receive a normalised response containing response text, tool calls made, latency, and token usage.
2. User sees a graceful error (with the failed provider logged) when a provider credential is wrong or a timeout occurs — other providers continue running.
3. User can configure per-provider concurrency limits and the system respects them, avoiding rate-limit errors under parallel load.

---

### Phase 3: Test Case Generation
**Goal:** Implement the LLM-powered test generator that analyses an agent definition and produces categorised test cases, plus support for manual YAML test cases.
**Requirements:** TST-01, TST-02, TST-03, TST-04, TST-05
**UI hint:** no
**Success Criteria:**
1. User runs `agent-eval generate` against an agent config and receives test cases covering all four categories: happy_path, edge_case, multi_turn, and error_handling.
2. Every generated test case includes expected tool calls and expected facts that can be used downstream for scoring.
3. User can add manual test cases in YAML and they are merged with generated ones, with no duplicates lost.
4. User can save generated test cases to a YAML file, edit them, and reload them in a subsequent evaluation run without re-running generation.

---

### Phase 4: Evaluation Engine & Evaluators
**Goal:** Implement the full evaluation pipeline — running test cases against every model, collecting results, and scoring them with deterministic, heuristic, and LLM-as-judge evaluators executed in cost order.
**Requirements:** EVL-02, EVL-03, EVL-04, EVL-05
**UI hint:** no
**Success Criteria:**
1. User can configure multiple runs per test case and the system produces per-run and aggregate scores, giving statistical reliability rather than single-shot results.
2. User sees an LLM-as-judge score (1–5) for helpfulness, coherence, faithfulness, and conciseness for each model's response.
3. User sees a tool accuracy score reflecting how closely the model's actual tool selections matched the expected tool calls.
4. User sees a trajectory score reflecting how closely the actual sequence of tool calls matched the expected sequence.
5. Deterministic checks run before heuristic checks, which run before LLM-as-judge — token spend is minimised when early checks detect failure.

---

### Phase 5: Observability
**Goal:** Instrument every evaluation run with OpenTelemetry spans and integrate with Langfuse and MLflow so the user has full traceability and experiment comparison without a custom dashboard.
**Requirements:** OBS-01, OBS-02, OBS-03, OBS-04, OBS-05
**UI hint:** no
**Success Criteria:**
1. User can view OTEL spans in any OTLP-compatible backend, with each span annotated by model ID, test case ID, and score attributes.
2. User can open Langfuse and see evaluation traces with scores attached, enabling per-trace drill-down.
3. User can open MLflow and compare evaluation runs across experiments, with metrics and parameters logged per run.
4. User can see cost per model in the evaluation output, calculated from provider-reported token counts and configurable pricing rates.

---

### Phase 6: Reports & CLI
**Goal:** Deliver the complete CLI surface and report generation — Markdown and HTML reports with charts, model comparison tables, and a clear best-model recommendation, plus progress indicators.
**Requirements:** RPT-01, RPT-02, RPT-03, RPT-04, RPT-05, RPT-06, CLI-01, CLI-02, CLI-03, CLI-04
**UI hint:** no
**Success Criteria:**
1. User runs `agent-eval evaluate` and a Markdown report is created with an executive summary, per-evaluator score breakdown, model comparison table, cost/latency analysis, per-test-case results, and a best-model recommendation with rationale.
2. User opens the HTML report and sees embedded SVG charts for visual model comparison — no internet connection or external server required.
3. User runs `agent-eval report` against saved evaluation results and regenerates reports without re-running any model calls.
4. User sees a live progress indicator during evaluation showing the current model and test case, so long runs feel responsive.
5. User runs `agent-eval generate` and a test-case YAML file is produced — confirming the generate command is independently usable from evaluate and report.
