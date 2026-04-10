/**
 * AWS Bedrock model provider — stub.
 *
 * This module will be implemented in Phase 2. For now it satisfies the
 * ModelProvider contract so that the model-registry can import it without
 * errors during config validation and test runs.
 */

import type { ModelConfig, ModelProvider } from "../core/types.js";

/**
 * Factory function expected by the ModelRegistry.
 *
 * @param config - Model configuration from YAML.
 * @returns A ModelProvider backed by AWS Bedrock.
 */
export async function createProvider(config: ModelConfig): Promise<ModelProvider> {
  const label = config.label ?? config.modelId;

  return {
    id: `bedrock::${config.modelId}`,
    label,
    provider: "bedrock",

    async invoke(): Promise<never> {
      throw new Error(
        `Bedrock provider "${label}" is not yet implemented — coming in Phase 2`,
      );
    },
  };
}
