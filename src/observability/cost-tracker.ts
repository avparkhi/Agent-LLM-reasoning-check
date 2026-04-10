/**
 * Per-model cost tracking.
 *
 * Requirements: OBS-04
 *
 * Maintains an in-memory running total of token usage and inferred USD cost
 * for each model seen during an evaluation run.
 *
 * Pricing is based on published rates (USD per token).
 * Unknown models fall back to a zero-cost entry so accounting never throws.
 */

import type { TokenUsage } from "../core/types.js";

// ---------------------------------------------------------------------------
// Pricing table
// ---------------------------------------------------------------------------

interface PricingEntry {
  /** USD per input token */
  input: number;
  /** USD per output token */
  output: number;
}

// ---------------------------------------------------------------------------
// Accumulator shape
// ---------------------------------------------------------------------------

interface ModelAccumulator {
  totalInput: number;
  totalOutput: number;
  totalCost: number;
}

// ---------------------------------------------------------------------------
// CostTracker
// ---------------------------------------------------------------------------

export class CostTracker {
  /**
   * Pricing table (USD per token).
   * Keys are modelId strings as returned by ModelProvider.id.
   */
  private static readonly PRICING: Record<string, PricingEntry> = {
    "claude-sonnet-4-20250514": {
      input: 3 / 1_000_000,
      output: 15 / 1_000_000,
    },
    "claude-haiku-4-5-20251001": {
      input: 0.8 / 1_000_000,
      output: 4 / 1_000_000,
    },
    "gpt-4o": {
      input: 2.5 / 1_000_000,
      output: 10 / 1_000_000,
    },
    "gpt-4o-mini": {
      input: 0.15 / 1_000_000,
      output: 0.6 / 1_000_000,
    },
  };

  /** Default pricing when the model is not in the table (avoids NaN). */
  private static readonly DEFAULT_PRICING: PricingEntry = {
    input: 0,
    output: 0,
  };

  private readonly accumulators = new Map<string, ModelAccumulator>();

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private getOrCreate(modelId: string): ModelAccumulator {
    let acc = this.accumulators.get(modelId);
    if (!acc) {
      acc = { totalInput: 0, totalOutput: 0, totalCost: 0 };
      this.accumulators.set(modelId, acc);
    }
    return acc;
  }

  private pricing(modelId: string): PricingEntry {
    // Exact match first
    if (CostTracker.PRICING[modelId]) {
      return CostTracker.PRICING[modelId];
    }

    // Partial match — useful when the provider prefixes the model id
    // e.g. "anthropic::claude-sonnet-4-20250514"
    for (const [key, entry] of Object.entries(CostTracker.PRICING)) {
      if (modelId.includes(key)) {
        return entry;
      }
    }

    return CostTracker.DEFAULT_PRICING;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Record token usage for a completed model invocation.
   */
  record(modelId: string, usage: TokenUsage): void {
    const p = this.pricing(modelId);
    const cost = usage.inputTokens * p.input + usage.outputTokens * p.output;

    const acc = this.getOrCreate(modelId);
    acc.totalInput += usage.inputTokens;
    acc.totalOutput += usage.outputTokens;
    acc.totalCost += cost;
  }

  /**
   * Return the total accumulated cost (USD) for the given model.
   * Returns 0 if no usage has been recorded for that model.
   */
  getCost(modelId: string): number {
    return this.accumulators.get(modelId)?.totalCost ?? 0;
  }

  /**
   * Return a full cost summary for the given model.
   */
  getSummary(modelId: string): {
    totalCost: number;
    totalInput: number;
    totalOutput: number;
  } {
    const acc = this.accumulators.get(modelId);
    if (!acc) {
      return { totalCost: 0, totalInput: 0, totalOutput: 0 };
    }
    return {
      totalCost: acc.totalCost,
      totalInput: acc.totalInput,
      totalOutput: acc.totalOutput,
    };
  }

  /**
   * Return summaries for every model that has been recorded.
   */
  getAllSummaries(): Record<
    string,
    { totalCost: number; totalInput: number; totalOutput: number }
  > {
    const result: Record<
      string,
      { totalCost: number; totalInput: number; totalOutput: number }
    > = {};
    for (const [modelId, acc] of this.accumulators) {
      result[modelId] = {
        totalCost: acc.totalCost,
        totalInput: acc.totalInput,
        totalOutput: acc.totalOutput,
      };
    }
    return result;
  }

  /**
   * Return the total cost across ALL models tracked so far.
   */
  getTotalCost(): number {
    let total = 0;
    for (const acc of this.accumulators.values()) {
      total += acc.totalCost;
    }
    return total;
  }

  /**
   * Reset all accumulators (useful between evaluation runs in tests).
   */
  reset(): void {
    this.accumulators.clear();
  }
}
