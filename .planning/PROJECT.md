# Agent LLM Evaluation System

## What This Is

A TypeScript CLI tool that evaluates AI agents across multiple LLM providers to determine which model performs best for each agent. Built for a solo developer who creates many tool-heavy agents using AWS Strands Agents SDK and needs to make data-driven production deployment decisions.

## Core Value

**Answer the question: "Which LLM should I use for this agent?"** — backed by automated test cases, multi-dimensional scoring, and comprehensive reports.

## Context

The developer builds agents frequently and faces a recurring problem: choosing the right LLM for each agent. Different models excel at different tasks — some are better at tool selection, others at reasoning, others at cost efficiency. Currently there's no standardized way to test an agent across Claude, GPT, Llama, Mistral, etc. and compare results objectively.

## Who It's For

- Solo developer building production agents with AWS Strands Agents SDK
- Primary use case: production deployment decisions (which model to ship with)
- Secondary: evaluating new models as they release

## What It Does

1. **Takes an agent definition** (tools, system prompt, model config) as input
2. **Auto-generates test cases** by analyzing the agent's tools, parameters, and system prompt
3. **Runs the agent against multiple LLMs** (Bedrock, Anthropic, OpenAI, Ollama, etc.)
4. **Evaluates each run** using LLM-as-judge, tool accuracy matching, trajectory analysis
5. **Tracks everything** via OpenTelemetry, Langfuse, and MLflow
6. **Produces a report** with model comparison tables, recommendations, cost analysis

## Technical Context

- **Language:** TypeScript (Node.js 20+)
- **Agent Framework:** AWS Strands Agents SDK (model-agnostic, supports tool-decorated functions)
- **Observability:** OpenTelemetry (tracing), Langfuse (LLM scoring), MLflow (experiment comparison)
- **Agent Types:** Primarily tool-heavy agents with multiple API/tool calls
- **Evaluation Approach:** LLM-as-judge + heuristic evaluators (tool accuracy, trajectory matching)
- **Output:** Markdown + HTML reports with model comparison and recommendations

## Constraints

- Must work without requiring all provider SDKs installed (lazy imports)
- Agent definitions specified via YAML config (not code changes per evaluation)
- Reports must be self-contained (no external dashboard required)
- Must handle provider rate limits gracefully

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] CLI with commands: generate-tests, evaluate, report, compare
- [ ] YAML-based agent evaluation config
- [ ] Multi-model provider support (Bedrock, Anthropic, OpenAI, Ollama)
- [ ] LLM-powered test case auto-generation from agent definition
- [ ] Evaluation engine with LLM-as-judge scoring
- [ ] Tool accuracy and trajectory evaluators
- [ ] OpenTelemetry tracing integration
- [ ] Langfuse integration for trace visualization and scoring
- [ ] MLflow integration for experiment tracking and model comparison
- [ ] Markdown report generation with model comparison tables
- [ ] HTML report generation with embedded charts
- [ ] Cost and latency tracking per model
- [ ] Support for manual test case addition via YAML

### Out of Scope

- Web UI / dashboard — reports are static files
- Real-time monitoring — this is batch evaluation
- Agent building / framework — uses Strands SDK directly
- CI/CD integration — manual CLI invocation for now

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript over Python | User preference, existing Node.js ecosystem | Confirmed |
| Strands Agents SDK | User's primary agent framework, model-agnostic | Confirmed |
| YAML config | Declarative, version-controllable, no code per eval | Confirmed |
| LLM-as-judge evaluation | Scales better than human evaluation, research-backed | Confirmed |
| Multiple observability backends | OTEL for tracing, Langfuse for LLM scoring, MLflow for comparison | Confirmed |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-10 after initialization*
