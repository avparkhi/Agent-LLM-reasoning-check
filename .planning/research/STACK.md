# Stack Research

> Context: TypeScript CLI tool evaluating AI agents (AWS Strands Agents SDK) across multiple LLM
> providers. Produces Markdown + HTML reports. Integrates OTEL tracing, Langfuse scoring, and
> MLflow experiment tracking. Solo developer. Greenfield. April 2026.

---

## Recommended Stack

| Category | Library | Version | Rationale |
|---|---|---|---|
| **Runtime** | Node.js | 22 LTS | Node 24 became LTS in Oct 2025 but 22 is proven and supported until Apr 2027. Node 24's stable native TS stripping is a distraction — we still compile with tsc/tsup. Pin to `>=22.0.0` in `engines`. |
| **Language** | TypeScript | `^5.8` | 5.8 adds `--erasableSyntaxOnly` (aligns with Node native strip-types), `--noUncheckedSideEffectImports`, and performance improvements. No breaking changes from 5.7. |
| **Dev runner** | tsx | `^4.19` | 25× faster than ts-node (esbuild-powered, ~18ms startup vs ~520ms). ESM-native, no tsconfig ceremony. Used only for `npm run dev` — production runs compiled JS. |
| **Bundler** | tsup | `^8.x` | Wraps esbuild; produces a single ESM executable with shebang in one command. Zero-config `.d.ts` generation. Perfect for a CLI binary. Use `tsc --noEmit` for type-checking separately. |
| **Agent framework** | @strands-agents/sdk | `latest` (preview) | The user's primary framework. TypeScript preview launched Dec 2025. APIs may change; pin to minor. Requires AWS credentials; defaults to Bedrock + Claude. |
| **Anthropic SDK** | @anthropic-ai/sdk | `^0.85` | Official SDK, 0.85 is current (Apr 2026). Used for direct Anthropic API calls and as the LLM-as-judge provider. |
| **OpenAI SDK** | openai | `^6.18` | Official SDK, 6.x series is current. Used for GPT model evaluation and OpenAI-compatible endpoints (including local Ollama). |
| **AWS Bedrock SDK** | @aws-sdk/client-bedrock-runtime | `^3.1026` | AWS SDK v3 modular client. Actively updated (daily releases). Used for Bedrock model invocations (Claude, Titan, Llama via Bedrock). |
| **Ollama SDK** | ollama | `^0.5` | Official Ollama JS client. Simple 3-line usage, streaming support, TypeScript-native. For local model evaluation. |
| **CLI framework** | commander | `^12.1` | 500M weekly downloads, 180 KB with zero dependencies, 18–25ms startup overhead. Excellent TypeScript support. Simple to moderate CLIs need nothing more. |
| **CLI UX — spinner** | ora | `^8.1` | ESM-native, elegant terminal spinner. Standard pairing with chalk. |
| **CLI UX — color** | chalk | `^5.3` | ESM-native (v5+). Terminal string styling. Do NOT use chalk v4 — it's CJS only. |
| **Schema validation** | zod | `^4.3` | Zod 4 is stable (4.3.6 current). 57% smaller bundle than Zod 3. Used for YAML config validation, LLM response parsing, tool schema definitions (Strands SDK uses Zod internally). |
| **YAML parsing** | yaml | `^2.6` | Modern YAML 1.2 compliant parser with full TypeScript typings (min TS 3.9). Supports round-trip editing including comments. More actively maintained than js-yaml (last published ~2 years ago). |
| **OTel — API** | @opentelemetry/api | `^1.9` | Peer dependency; stable public API surface. |
| **OTel — SDK** | @opentelemetry/sdk-node | `^0.57` | Node.js distro SDK. Initialise once at process start before all other imports. |
| **OTel — exporter** | @opentelemetry/exporter-trace-otlp-http | `^0.57` | HTTP/protobuf OTLP exporter. Works with both Langfuse collector and MLflow OTLP endpoint. |
| **OTel — resources** | @opentelemetry/resources | `^1.30` | Resource attributes (service.name, service.version, environment). |
| **OTel — semconv** | @opentelemetry/semantic-conventions | `^1.28` | Standard attribute names for LLM spans (gen_ai.*). |
| **LLM observability** | langfuse | `^3.30` | **Stay on v3 for now.** v4 (Aug 2025) is a full OpenTelemetry rewrite with breaking API changes; v5 (Mar 2026) breaks again (span filter defaults, API namespace changes). v3 is stable, battle-tested, supports scoring and datasets. Migrate to v4/v5 when APIs stabilise. |
| **Experiment tracking** | mlflow-tracing | `^3.x` | Official MLflow TypeScript tracing SDK. Built on OTEL; MLflow 3.6 has auto-tracing for Anthropic and Vercel AI SDK. Exposes runs, experiments, metrics via OTLP `/v1/traces`. Use `mlflow-js` as a companion for REST API access (experiment CRUD, metric logging) if the tracing SDK lacks coverage. |
| **Report templates** | handlebars | `^4.7.8` | Mature, zero-dependency templating. Used to render both Markdown and HTML report layouts from the same data model. No security issues when `noEscape` is not set. |
| **Chart generation** | vega-lite + vega | `^5.x` | Declarative JSON chart spec, Node.js server-side rendering via `vega-node` canvas. Produces self-contained SVG strings embeddable directly in the HTML report — no browser or Puppeteer required. Preferable to Chart.js for static server-side generation. |
| **Concurrency / rate limiting** | p-limit | `^6.x` | Lightweight (ESM-native, 0 deps). Controls concurrent provider API calls to respect rate limits. Use `p-queue` if you need a full queue with pause/resume; p-limit is enough for simple `maxConcurrency` use case. |
| **Testing** | vitest | `^2.1` | Native ESM + TypeScript support with zero config. 4–5× faster than Jest. Vitest 4.0 stable (Dec 2025) adds stable Browser Mode — not needed here but shows project health. API is Jest-compatible. The 2026 default for new TypeScript projects. |
| **Linting** | eslint + typescript-eslint | `^9 + ^8` | ESLint v9 flat config is now the only supported format. `typescript-eslint` v8 provides `tseslint.configs.recommended` for flat config. Use `eslint.config.mjs`. |

---

## Alternatives Considered

### Runtime / Build

| Rejected | Reason |
|---|---|
| **Node.js 24** | Valid LTS choice, but Node 22 has a longer proven track record. The headline feature (stable native TS stripping) is irrelevant — we compile with tsup anyway. Re-evaluate at Node 22 EOL (Apr 2027). |
| **Bun** | Faster runtime but the user's infra is Node-centric (AWS Lambda, Strands SDK). Cross-platform shebang and AWS SDK compatibility is better guaranteed on Node. |
| **tsc as bundler** | `tsc` emits one file per source file; does not bundle. Unsuitable for a distributable CLI binary. |
| **esbuild directly** | tsup wraps esbuild with better defaults (shebang injection, externals from package.json, `.d.ts` output). No reason to drop down to raw esbuild. |
| **ts-node** | 25× slower startup than tsx. Requires `esm: true` loader flag and additional tsconfig options for ESM. Effectively deprecated in favour of tsx for dev workflows. |

### LLM Provider Abstraction

| Rejected | Reason |
|---|---|
| **Vercel AI SDK (`ai`)** | Excellent multi-provider abstraction (v5, Jul 2025) but it adds a layer of indirection between this tool and provider SDKs. The evaluation tool needs raw token counts, latency, and cost data at the provider level — the AI SDK abstracts these away or normalises them. Direct SDKs give full fidelity. |
| **LangChain.js** | Heavy dependency tree, slower release cadence, too much magic for a focused evaluation tool. The user's framework is Strands SDK, not LangChain. |

### CLI Framework

| Rejected | Reason |
|---|---|
| **oclif** | 12 MB, 30+ transitive dependencies, 70–100ms startup overhead, one-file-per-command convention. Overkill for 4 commands. Designed for plugin-based CLIs distributed via Heroku/Salesforce tooling. |
| **yargs** | 850 KB, 7 deps. More powerful than needed. Commander's TypeScript support is equally good with a fraction of the size. |
| **Stricli** (Bloomberg) | Newer, strong TS ergonomics, but tiny community. Commander's ecosystem and documentation is far larger. |

### Schema Validation

| Rejected | Reason |
|---|---|
| **Zod v3** | v4 is stable and 57% smaller. No reason to use v3 for a new project. |
| **Valibot** | Smaller bundle but ecosystem is immature relative to Zod. Zod 4's size improvements close the gap. |
| **Joi / Yup** | Not TypeScript-first. Inferior inference. |

### YAML Parsing

| Rejected | Reason |
|---|---|
| **js-yaml** | Last major publish was ~2 years ago; maintainer is effectively in maintenance mode. The `yaml` package is more actively developed, fully YAML 1.2 compliant, and has better TypeScript typings. |
| **yamljs** | Unmaintained. Do not use. |

### Observability

| Rejected | Reason |
|---|---|
| **Langfuse v4 / v5** | v4 (Aug 2025) requires full OpenTelemetry setup migration and breaks the v3 tracing API entirely. v5 (Mar 2026) breaks again. Wait for dust to settle. Budget one sprint to migrate when v5 is stable for 3+ months. |
| **Braintrust** | Solid LLM eval platform but cloud-only SaaS, no self-hosted option. The project requires self-contained reports with no external dashboard dependency. |
| **Helicone** | Same issue — cloud-only, adds a proxy in the critical path. |
| **OpenLLMetry** | Interesting OTEL-native instrumentation but immature TypeScript SDK; coverage lags Python significantly. |

### Charting

| Rejected | Reason |
|---|---|
| **Chart.js** | Canvas-based; requires a browser or `canvas` native addon for server-side rendering. The `canvas` npm package requires native compilation (node-gyp). Painful on CI. |
| **D3** | Too low-level for this use case. Excellent for bespoke viz, but model comparison bar charts and radar charts need 10 lines of Vega-Lite, not 100 lines of D3. |
| **Puppeteer / headless Chrome** | Common pattern (render HTML, screenshot chart) but heavyweight — ~130 MB Chromium download. Overkill for static reports. |
| **QuickChart.io** | External HTTP API; breaks the "no external dependencies in reports" constraint. |

### Testing

| Rejected | Reason |
|---|---|
| **Jest** | Requires `--experimental-vm-modules` for ESM, making TypeScript + ESM setup non-trivial. Vitest handles it natively. Jest 30 (Jun 2025) improved ESM but Vitest is still the clear choice for new TypeScript/ESM projects. |
| **Mocha / Jasmine** | No native TypeScript, no built-in watch, no coverage. Require significant boilerplate. |

---

## Version Compatibility Notes

### ESM Requirements
`chalk ^5`, `ora ^8`, `p-limit ^6`, `p-queue ^8`, and `yaml ^2` are **ESM-only**. The project `package.json` must have `"type": "module"`. The existing `package.json` already has this. tsup's `format: ['esm']` output is correct.

### Langfuse v3 OTEL Bridge
Langfuse v3 supports an OTEL exporter (`langfuse-langchain` / manual span wrapping). It does NOT require the full v4 OTEL setup. Wire it via its own HTTP exporter alongside the standard OTEL SDK — both can coexist.

### @strands-agents/sdk Preview Status
The TypeScript SDK is in public preview (announced Dec 2025). Do not use it in a library re-exported to consumers. Pin to an exact minor version (e.g., `~0.3.0`) and test every minor bump. AWS has committed to GA in 2026 but no date is public.

### Zod 4 and Strands SDK Compatibility
If `@strands-agents/sdk` uses Zod internally, verify it uses Zod 4. If it pins to Zod 3, you may need both versions installed (they can coexist — their package names differ by major). Check with `npm ls zod` after install.

### Node 22 + tsup + `"type": "module"`
tsup with `format: ['esm']` and `target: 'node22'` is the correct combination. Do NOT set `format: ['cjs']` — this is not a library with dual-format requirements. The CLI binary needs ESM only.

### OpenTelemetry Package Version Parity
The `@opentelemetry/*` packages must be version-locked together. The `sdk-node` (`0.x`) and `api` / `sdk-trace-base` (`1.x`) follow different versioning tracks — this is intentional and documented. The existing `package.json` already has a valid combination.

### TypeScript `erasableSyntaxOnly`
With TS 5.8+, enabling `"erasableSyntaxOnly": true` in `tsconfig.json` prevents use of `enum`, `namespace`, and constructor parameter properties — the constructs that generate runtime code. This is the correct constraint for a Node.js TypeScript project that relies on type stripping semantics. Enable it.

### mlflow-tracing Node.js Minimum
`mlflow-tracing` requires Node.js 14+; the project's Node 22 requirement exceeds this comfortably.

### vitest and @opentelemetry
OTel SDK registers global singletons. In Vitest, isolate tests that initialize the OTel SDK using `isolate: true` in the test config or use a setup/teardown around SDK init to avoid test-to-test contamination.
