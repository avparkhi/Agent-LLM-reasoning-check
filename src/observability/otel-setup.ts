/**
 * OpenTelemetry initialization for the Agent LLM Evaluation System.
 *
 * Requirements: OBS-01
 *
 * IMPORTANT: This module must be the ONLY place that imports from
 * @opentelemetry/sdk-* packages. All other modules use @opentelemetry/api only.
 */

import { trace, SpanStatusCode, type Tracer } from "@opentelemetry/api";
import {
  NodeTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { ObservabilityConfig } from "../core/types.js";

// ---------------------------------------------------------------------------
// Module-level provider reference (kept for shutdown)
// ---------------------------------------------------------------------------

let _provider: NodeTracerProvider | null = null;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Initialize the OpenTelemetry tracer provider.
 *
 * 1. Create a Resource with service.name = "agent-eval".
 * 2. Create a NodeTracerProvider.
 * 3. If otel.enabled, attach a BatchSpanProcessor with OTLPTraceExporter
 *    pointing at config.otel.endpoint.
 * 4. Register the provider as the global tracer provider.
 */
export function setupOtel(config: ObservabilityConfig): void {
  try {
    const resource = new Resource({
      [ATTR_SERVICE_NAME]: "agent-eval",
    });

    const provider = new NodeTracerProvider({ resource });

    if (config.otel.enabled && config.otel.endpoint) {
      const exporter = new OTLPTraceExporter({
        url: config.otel.endpoint,
      });
      provider.addSpanProcessor(new BatchSpanProcessor(exporter));
    }

    provider.register();
    _provider = provider;
  } catch (err) {
    console.warn("[otel-setup] Failed to initialize OpenTelemetry:", err);
  }
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

/**
 * Flush pending spans and shut down the tracer provider gracefully.
 */
export async function shutdownOtel(): Promise<void> {
  if (_provider) {
    try {
      await _provider.shutdown();
    } catch (err) {
      console.warn("[otel-setup] Error during OTEL shutdown:", err);
    } finally {
      _provider = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Tracer accessor
// ---------------------------------------------------------------------------

/**
 * Returns the named tracer for this service.
 * Safe to call before setupOtel — will return a no-op tracer in that case.
 */
export function getTracer(): Tracer {
  return trace.getTracer("agent-eval");
}

// ---------------------------------------------------------------------------
// Convenience span wrapper
// ---------------------------------------------------------------------------

/**
 * Creates a span, sets attributes, runs fn, ends span.
 *
 * Attribute keys should follow gen_ai.* semantic conventions where applicable:
 *   gen_ai.system, gen_ai.request.model, gen_ai.response.model,
 *   gen_ai.usage.input_tokens, gen_ai.usage.output_tokens
 *
 * On error the exception is recorded on the span and then re-thrown so the
 * caller is not silently swallowed.
 */
export async function withEvalSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  const span = tracer.startSpan(name);

  // Set all caller-supplied attributes
  for (const [key, value] of Object.entries(attributes)) {
    span.setAttribute(key, value);
  }

  try {
    const result = await fn();
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.recordException(err instanceof Error ? err : new Error(String(err)));
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    span.end();
  }
}

// ---------------------------------------------------------------------------
// Re-export addSpanProcessor so other observability modules can attach their
// own exporters to the shared provider without importing SDK internals.
// ---------------------------------------------------------------------------

/**
 * Add a span processor to the active provider.
 * No-op (with a warning) if setupOtel has not been called yet.
 */
export function addSpanProcessor(
  processor: InstanceType<typeof SimpleSpanProcessor | typeof BatchSpanProcessor>,
): void {
  if (!_provider) {
    console.warn("[otel-setup] addSpanProcessor called before setupOtel — ignoring.");
    return;
  }
  _provider.addSpanProcessor(processor);
}
