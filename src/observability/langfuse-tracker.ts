/**
 * Langfuse integration via OTLP bridge.
 *
 * Requirements: OBS-02
 *
 * Langfuse accepts standard OpenTelemetry traces at:
 *   ${LANGFUSE_HOST}/api/public/otel/v1/traces
 *
 * Authentication is Basic auth: base64(publicKey:secretKey).
 *
 * This module deliberately does NOT import SDK classes — it delegates to
 * otel-setup.addSpanProcessor so that SDK internals stay isolated there.
 */

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import type { ObservabilityConfig } from "../core/types.js";
import { addSpanProcessor } from "./otel-setup.js";

// ---------------------------------------------------------------------------
// Default Langfuse cloud endpoint
// ---------------------------------------------------------------------------

const DEFAULT_LANGFUSE_HOST = "https://cloud.langfuse.com";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Wire up Langfuse as an additional OTLP span processor.
 *
 * Reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY (and optionally
 * LANGFUSE_HOST) from the process environment.
 *
 * Safe to call even when langfuse is disabled — returns immediately.
 * All errors are logged as warnings so the evaluation is never blocked.
 */
export function setupLangfuse(config: ObservabilityConfig): void {
  if (!config.langfuse.enabled) {
    return;
  }

  try {
    const publicKey = process.env["LANGFUSE_PUBLIC_KEY"];
    const secretKey = process.env["LANGFUSE_SECRET_KEY"];
    const host = process.env["LANGFUSE_HOST"] ?? DEFAULT_LANGFUSE_HOST;

    if (!publicKey || !secretKey) {
      console.warn(
        "[langfuse-tracker] langfuse.enabled=true but LANGFUSE_PUBLIC_KEY / " +
          "LANGFUSE_SECRET_KEY env vars are not set — skipping Langfuse setup.",
      );
      return;
    }

    // Build Basic auth header: base64(publicKey:secretKey)
    const credentials = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
    const authHeader = `Basic ${credentials}`;

    const url = `${host.replace(/\/$/, "")}/api/public/otel/v1/traces`;

    const exporter = new OTLPTraceExporter({
      url,
      headers: {
        Authorization: authHeader,
      },
    });

    addSpanProcessor(new BatchSpanProcessor(exporter));

    console.log(`[langfuse-tracker] Langfuse OTLP bridge configured → ${url}`);
  } catch (err) {
    console.warn("[langfuse-tracker] Failed to configure Langfuse — skipping:", err);
  }
}
