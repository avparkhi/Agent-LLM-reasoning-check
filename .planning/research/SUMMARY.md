# Research Summary

## Stack
**TypeScript + Node 20+**, using Commander.js (CLI), Zod (validation), Vitest (testing), Handlebars (templates), Vega-Lite (SVG charts). Provider SDKs: `@anthropic-ai/sdk`, `openai`, `@aws-sdk/client-bedrock-runtime`, `ollama`. Observability: `@opentelemetry/api` + SDK, `langfuse` v3, MLflow via REST API. Use `p-limit` for provider concurrency, `tsup` for bundling.

## Table Stakes
Multi-model comparison, YAML config, CLI commands, basic metrics (accuracy/latency/cost), test case management (manual + generated), Markdown reports, tool call tracking, error handling with retries.

## Differentiators
Auto test case generation from agent definition (the core value prop), LLM-as-judge scoring across quality dimensions, trajectory analysis (tool call sequence matching), OTEL + Langfuse + MLflow integration, HTML reports with embedded SVG charts, cost-per-dollar optimization analysis.

## Architecture
Six layers: Agent Loader, Model Provider Abstraction (factory pattern with lazy imports), Test Generator, Evaluation Engine (strategy pattern for evaluators), Observability (horizontal cross-cut, fire-and-forget), Report Generator. Single handoff type: `EvaluationResult` as serializable JSON. Build order in 8 waves starting from types/schemas.

## Watch Out For
- **LLM-as-judge bias** — use different model family as judge, run 3+ trials, structured rubrics
- **Rate limiting** — per-provider concurrency with `p-limit`, exponential backoff
- **Tool format differences** — normalize tool calls in provider abstraction
- **Over-engineering** — keep ModelProvider to single `invoke()` method, evaluators as plain functions
- **OTEL coupling** — only import `@opentelemetry/api` facade in business logic, initialize SDK at CLI startup
- **Weak test generation** — require all tools covered, generate across categories, include edge cases

## Key Decision
Evaluators should execute in cost order: deterministic checks first (free), heuristic tool/trajectory matching second (cheap), LLM-as-judge last (expensive). This saves tokens when early checks fail.

---
*Synthesized: 2026-04-10*
