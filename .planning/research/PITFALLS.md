# Pitfalls Research

## Evaluation Pitfalls

### 1. LLM-as-Judge Bias and Inconsistency
**Warning Signs:** Same response gets different scores on repeated evaluations; judge model favors its own family's outputs.
**Prevention Strategy:**
- Use a different model family as judge than what's being evaluated
- Run each evaluation 3+ times and average scores
- Use structured rubrics with integer scales (1-5) and clear criteria per level
- Consider pairwise comparison instead of absolute scoring for quality metrics
**Phase:** Address in Evaluation Engine design (Phase 2-3)

### 2. Non-Deterministic Outputs Making Comparison Unreliable
**Warning Signs:** High variance in scores across runs of the same test case; rankings flip between evaluation sessions.
**Prevention Strategy:**
- Set temperature=0 for evaluation runs (deterministic mode)
- Run multiple trials per test case (configurable `runsPerTest`)
- Report standard deviation alongside mean scores
- Use statistical significance tests before declaring a winner
**Phase:** Address in Evaluation Engine (runner configuration)

### 3. Ignoring Cost/Latency in Favor of Pure Quality
**Warning Signs:** Recommending the most expensive model when a cheaper one scores within 5% on quality.
**Prevention Strategy:**
- Always track cost per 1K invocations and P50/P95 latency
- Include cost-adjusted scoring (quality per dollar)
- Report Pareto frontier: models that aren't dominated on any metric
**Phase:** Address in Metrics aggregation and Report generation

### 4. Evaluation Metrics That Don't Correlate with Real-World Performance
**Warning Signs:** Agent scores 95% on evals but users complain; test cases are too clean/simple.
**Prevention Strategy:**
- Include edge cases and error handling in test generation
- Use multi-turn conversations, not just single-shot queries
- Weight tool accuracy heavily for tool-heavy agents
- Allow manual test cases from production failure modes
**Phase:** Address in Test Generator design

## Provider Pitfalls

### 5. Rate Limiting Across Different Providers
**Warning Signs:** Evaluation fails midway; 429 errors; inconsistent timing data.
**Prevention Strategy:**
- Use `p-limit` for per-provider concurrency control
- Implement exponential backoff with provider-specific retry logic
- Make concurrency configurable per provider in YAML config
- Don't run all providers in parallel — sequential per provider, parallel within
**Phase:** Address in Model Registry / Runner

### 6. Different Tool-Calling Formats Between Models
**Warning Signs:** Agent works with Claude but fails with GPT; tool calls not extracted correctly.
**Prevention Strategy:**
- Normalize tool call responses to a common format in the model provider abstraction
- Test each provider with a known tool-calling scenario during setup
- Document which models support native tool calling vs require prompt-based
**Phase:** Address in Model Provider abstraction (core types)

### 7. Token Counting Inconsistencies
**Warning Signs:** Cost estimates are wildly inaccurate; token counts don't match provider dashboards.
**Prevention Strategy:**
- Use provider-reported token counts from response metadata, not estimates
- Fall back to tiktoken/approximation only when metadata unavailable
- Clearly label estimated vs actual in reports
**Phase:** Address in Cost Tracker

### 8. Credential Management Complexity
**Warning Signs:** Users struggle to configure 4+ providers; env vars conflict.
**Prevention Strategy:**
- Use standard env vars per provider (AWS_PROFILE, OPENAI_API_KEY, ANTHROPIC_API_KEY)
- Provide `.env.example` with all supported variables
- Fail fast with clear error messages when credentials missing for a configured provider
- Don't require credentials for providers not in the evaluation config
**Phase:** Address in project scaffolding and Model Registry

## Architecture Pitfalls

### 9. Over-Engineering the Abstraction Layer
**Warning Signs:** More time spent on framework code than evaluation logic; deep inheritance hierarchies.
**Prevention Strategy:**
- Keep the ModelProvider interface to a single `invoke()` method
- Evaluators are plain functions, not class hierarchies
- No plugin system — direct imports with lazy loading
- Three similar lines of code > premature abstraction
**Phase:** Address throughout — enforce simplicity in code review

### 10. Tight Coupling Between Evaluation and Observability
**Warning Signs:** Evaluation breaks when Langfuse is down; OTEL spans leak into business logic.
**Prevention Strategy:**
- Observability is fire-and-forget — never block evaluation on tracing
- Only import `@opentelemetry/api` (no-op facade) in business logic
- Initialize OTEL SDK once at CLI startup
- Langfuse/MLflow calls happen after results are recorded, not during
**Phase:** Address in Observability layer design

### 11. Report Generation That Doesn't Scale
**Warning Signs:** Reports take forever with 50+ test cases; HTML files are 10MB+.
**Prevention Strategy:**
- Generate reports from serialized JSON results, not live data
- Use SVG charts (Vega-Lite) not canvas-based (Chart.js)
- Paginate detailed results in HTML with collapsible sections
- Keep markdown reports scannable — summary first, details at bottom
**Phase:** Address in Report Generator

## Testing Pitfalls

### 12. Auto-Generated Test Cases That Don't Test Meaningful Scenarios
**Warning Signs:** All generated tests are trivial happy-path; no edge cases; tests don't exercise all tools.
**Prevention Strategy:**
- Analyze tool parameters to generate boundary value test cases
- Require coverage of all declared tools in generated suite
- Generate across explicit categories: happy_path, edge_case, multi_turn, error_handling
- Include negative test cases (what should the agent refuse to do?)
- Allow manual test case override/addition
**Phase:** Address in Test Generator

### 13. Evaluating Tool Selection Without Considering Tool Parameters
**Warning Signs:** Agent picks the right tool but passes wrong arguments; evaluation says "pass."
**Prevention Strategy:**
- Separate tool selection accuracy from tool parameter accuracy
- Include expected parameter patterns in test cases (not just tool names)
- Score partial matches (right tool, wrong params = partial credit)
**Phase:** Address in Evaluators design

---
*Last updated: 2026-04-10*
