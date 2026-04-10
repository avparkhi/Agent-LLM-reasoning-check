/**
 * Model registry — factory for creating model providers.
 *
 * Uses lazy dynamic imports so that provider SDKs (e.g. @aws-sdk/client-bedrock-runtime,
 * @anthropic-ai/sdk) are only loaded when actually needed.
 */

import type { ModelConfig, ModelProvider } from "./types.js";

// ---------------------------------------------------------------------------
// Provider factory type
// ---------------------------------------------------------------------------

/**
 * Each provider module must export a factory function that creates
 * a `ModelProvider` from a `ModelConfig`.
 */
type ProviderFactory = (config: ModelConfig) => Promise<ModelProvider>;

/**
 * Lazy importer: returns a `ProviderFactory` by dynamically importing the
 * corresponding provider module.
 */
type LazyImporter = () => Promise<{ createProvider: ProviderFactory }>;

// ---------------------------------------------------------------------------
// Factory map — lazy dynamic imports per provider
// ---------------------------------------------------------------------------

const PROVIDER_FACTORIES: Record<ModelConfig["provider"], LazyImporter> = {
  bedrock: () => import("../providers/bedrock.js"),
  anthropic: () => import("../providers/anthropic.js"),
  openai: () => import("../providers/openai.js"),
  ollama: () => import("../providers/ollama.js"),
};

// ---------------------------------------------------------------------------
// ModelRegistry
// ---------------------------------------------------------------------------

export class ModelRegistry {
  /** Cache of already-created providers, keyed by a composite id. */
  private providers = new Map<string, ModelProvider>();

  /**
   * Create (or retrieve from cache) a `ModelProvider` for the given config.
   *
   * The provider SDK module is imported lazily on first use so that
   * unused SDKs are never loaded.
   *
   * @param config - Model configuration from YAML.
   * @returns A ready-to-use `ModelProvider`.
   */
  async createProvider(config: ModelConfig): Promise<ModelProvider> {
    const cacheKey = this.buildCacheKey(config);

    // Return cached provider if available
    const cached = this.providers.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Look up the lazy importer
    const lazyImport = PROVIDER_FACTORIES[config.provider];
    if (!lazyImport) {
      throw new Error(
        `Unknown model provider "${config.provider}". ` +
          `Supported providers: ${Object.keys(PROVIDER_FACTORIES).join(", ")}`,
      );
    }

    // Dynamically import the provider module and call its factory
    const mod = await lazyImport();
    const provider = await mod.createProvider(config);

    // Cache for reuse
    this.providers.set(cacheKey, provider);

    return provider;
  }

  /**
   * List all providers that have been created so far.
   */
  listProviders(): ModelProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Clear the provider cache.
   */
  clear(): void {
    this.providers.clear();
  }

  /**
   * Build a deterministic cache key for a model config.
   */
  private buildCacheKey(config: ModelConfig): string {
    return `${config.provider}::${config.modelId}::${config.label ?? "default"}`;
  }
}
