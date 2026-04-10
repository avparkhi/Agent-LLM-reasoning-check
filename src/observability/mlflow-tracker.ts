/**
 * MLflow integration via REST API.
 *
 * Requirements: OBS-03
 *
 * Uses fetch() for all HTTP calls — no npm package required.
 * All network errors are caught and logged as warnings so the evaluation
 * pipeline is never blocked by MLflow unavailability.
 */

// ---------------------------------------------------------------------------
// MLflow REST API response shapes (minimal — only what we need)
// ---------------------------------------------------------------------------

interface MlflowExperiment {
  experiment_id: string;
  name: string;
}

interface MlflowGetExperimentByNameResponse {
  experiment?: MlflowExperiment;
}

interface MlflowCreateExperimentResponse {
  experiment_id: string;
}

interface MlflowRun {
  info: {
    run_id: string;
  };
}

interface MlflowCreateRunResponse {
  run: MlflowRun;
}

// ---------------------------------------------------------------------------
// MlflowTracker
// ---------------------------------------------------------------------------

export class MlflowTracker {
  constructor(
    private readonly trackingUri: string,
    private readonly experimentName: string,
  ) {}

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private get baseUrl(): string {
    return this.trackingUri.replace(/\/$/, "");
  }

  /**
   * POST or GET to the MLflow REST API.
   * Returns the parsed JSON response, or throws on non-2xx.
   */
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);

    if (!response.ok) {
      const text = await response.text().catch(() => "(no body)");
      throw new Error(`MLflow ${method} ${path} → HTTP ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  // -------------------------------------------------------------------------
  // ensureExperiment
  // -------------------------------------------------------------------------

  /**
   * Look up or create the named experiment.
   * Returns the experiment_id string.
   */
  async ensureExperiment(): Promise<string> {
    try {
      // Try to fetch existing experiment by name
      const encodedName = encodeURIComponent(this.experimentName);
      const data = await this.request<MlflowGetExperimentByNameResponse>(
        "GET",
        `/api/2.0/mlflow/experiments/get-by-name?experiment_name=${encodedName}`,
      );

      if (data.experiment?.experiment_id) {
        return data.experiment.experiment_id;
      }
    } catch (err) {
      // If the experiment doesn't exist, MLflow returns 404 — fall through
      // to creation. Any other error is re-thrown after the creation attempt.
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("404") && !message.includes("RESOURCE_DOES_NOT_EXIST")) {
        throw err;
      }
    }

    // Create the experiment
    const created = await this.request<MlflowCreateExperimentResponse>(
      "POST",
      "/api/2.0/mlflow/experiments/create",
      { name: this.experimentName },
    );
    return created.experiment_id;
  }

  // -------------------------------------------------------------------------
  // startRun
  // -------------------------------------------------------------------------

  /**
   * Create a new run under the experiment and log initial params.
   * Returns the run_id string.
   */
  async startRun(
    modelLabel: string,
    params: Record<string, string>,
  ): Promise<string> {
    const experimentId = await this.ensureExperiment();

    const created = await this.request<MlflowCreateRunResponse>(
      "POST",
      "/api/2.0/mlflow/runs/create",
      {
        experiment_id: experimentId,
        run_name: modelLabel,
        start_time: Date.now(),
      },
    );

    const runId = created.run.info.run_id;

    // Log all params (sequentially to avoid overwhelming the server)
    for (const [key, value] of Object.entries(params)) {
      try {
        await this.request("POST", "/api/2.0/mlflow/runs/log-param", {
          run_id: runId,
          key,
          value,
        });
      } catch (err) {
        console.warn(`[mlflow-tracker] Failed to log param "${key}":`, err);
      }
    }

    return runId;
  }

  // -------------------------------------------------------------------------
  // logMetrics
  // -------------------------------------------------------------------------

  /**
   * Log a batch of numeric metrics against an existing run.
   * Failures per-metric are warned but don't abort the loop.
   */
  async logMetrics(
    runId: string,
    metrics: Record<string, number>,
  ): Promise<void> {
    const timestamp = Date.now();

    for (const [key, value] of Object.entries(metrics)) {
      try {
        await this.request("POST", "/api/2.0/mlflow/runs/log-metric", {
          run_id: runId,
          key,
          value,
          timestamp,
          step: 0,
        });
      } catch (err) {
        console.warn(`[mlflow-tracker] Failed to log metric "${key}":`, err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // endRun
  // -------------------------------------------------------------------------

  /**
   * Mark the run as FINISHED.
   */
  async endRun(runId: string): Promise<void> {
    await this.request("POST", "/api/2.0/mlflow/runs/update", {
      run_id: runId,
      status: "FINISHED",
      end_time: Date.now(),
    });
  }
}

// ---------------------------------------------------------------------------
// Factory with error-guarding for callers that shouldn't fail on MLflow errors
// ---------------------------------------------------------------------------

/**
 * Wraps MlflowTracker method calls so that any connection / HTTP error is
 * caught and logged rather than propagated to the evaluation pipeline.
 */
export function createSafeMlflowTracker(
  trackingUri: string,
  experimentName: string,
): MlflowTracker {
  const tracker = new MlflowTracker(trackingUri, experimentName);

  const guard =
    <Args extends unknown[], R>(
      methodName: string,
      fn: (...args: Args) => Promise<R>,
    ) =>
    async (...args: Args): Promise<R | undefined> => {
      try {
        return await fn.apply(tracker, args);
      } catch (err) {
        console.warn(`[mlflow-tracker] ${methodName} failed (non-fatal):`, err);
        return undefined;
      }
    };

  // Return a proxy that silently swallows connection errors
  return new Proxy(tracker, {
    get(target, prop) {
      const original = (target as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof original === "function" && typeof prop === "string") {
        return guard(prop, original.bind(target) as (...args: unknown[]) => Promise<unknown>);
      }
      return original;
    },
  });
}
