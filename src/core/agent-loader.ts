/**
 * Agent loading layer.
 *
 * Dynamically imports an agent module and produces a `LoadedAgent`
 * that can be bound to any `ModelProvider` to create runnable variants.
 */

import { resolve } from "node:path";
import type {
  AgentConfig,
  AgentVariant,
  LoadedAgent,
  Message,
  ModelProvider,
  ModelResponse,
  ToolDefinition,
  ToolSpec,
} from "./types.js";

// ---------------------------------------------------------------------------
// Agent loading
// ---------------------------------------------------------------------------

/**
 * Load an agent from its configuration.
 *
 * If the config contains a `module` path the corresponding TypeScript/JS
 * module is dynamically imported and inspected for tool definitions. When
 * no module is specified the agent is constructed purely from the inline
 * config values (system prompt and tool definitions declared in YAML).
 *
 * @param config - The agent configuration block from the eval config.
 * @returns A `LoadedAgent` ready to be bound to a model provider.
 */
export async function loadAgent(config: AgentConfig): Promise<LoadedAgent> {
  let tools: ToolDefinition[] = [...config.tools];

  // If a module path is specified, dynamically import it and extract tools
  if (config.module) {
    const modulePath = resolve(config.module);
    let mod: Record<string, unknown>;

    try {
      mod = (await import(modulePath)) as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to import agent module "${modulePath}": ${message}`,
      );
    }

    // Try to extract tool definitions from the module
    const moduleTools = extractToolsFromModule(mod, config.exportName);
    if (moduleTools.length > 0) {
      tools = moduleTools;
    }
  }

  const agent: LoadedAgent = {
    name: config.name,
    description: config.description,
    systemPrompt: config.systemPrompt,
    tools,
    createVariant(provider: ModelProvider): AgentVariant {
      return createAgentVariant(agent, provider);
    },
  };

  return agent;
}

// ---------------------------------------------------------------------------
// Tool extraction from module exports
// ---------------------------------------------------------------------------

/**
 * Inspect a dynamically-imported module for tool definitions.
 *
 * Looks for:
 * 1. A named export matching `exportName` (if provided) that contains tools.
 * 2. A `tools` export that is an array of ToolDefinition-shaped objects.
 * 3. Individual exports that look like tool definitions.
 */
function extractToolsFromModule(
  mod: Record<string, unknown>,
  exportName?: string,
): ToolDefinition[] {
  // 1. If a specific export is named, try to use it
  if (exportName && exportName in mod) {
    const exported = mod[exportName];

    // If it's an array, treat each element as a tool definition
    if (Array.isArray(exported)) {
      return exported.filter(isToolDefinition);
    }

    // If it's an object with a `tools` property
    if (
      exported !== null &&
      typeof exported === "object" &&
      "tools" in exported
    ) {
      const obj = exported as Record<string, unknown>;
      if (Array.isArray(obj.tools)) {
        return obj.tools.filter(isToolDefinition);
      }
    }
  }

  // 2. Look for a `tools` export
  if ("tools" in mod && Array.isArray(mod.tools)) {
    return (mod.tools as unknown[]).filter(isToolDefinition);
  }

  // 3. Scan individual exports for tool-shaped objects
  const tools: ToolDefinition[] = [];
  for (const value of Object.values(mod)) {
    if (isToolDefinition(value)) {
      tools.push(value);
    }
  }

  return tools;
}

/**
 * Type guard: check whether an unknown value looks like a ToolDefinition.
 */
function isToolDefinition(value: unknown): value is ToolDefinition {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.name === "string" &&
    typeof obj.description === "string" &&
    obj.parameters !== null &&
    typeof obj.parameters === "object" &&
    !Array.isArray(obj.parameters)
  );
}

// ---------------------------------------------------------------------------
// Agent variant creation
// ---------------------------------------------------------------------------

/**
 * Bind a loaded agent to a specific model provider, producing a
 * callable `AgentVariant`.
 */
function createAgentVariant(
  agent: LoadedAgent,
  provider: ModelProvider,
): AgentVariant {
  const toolSpecs: ToolSpec[] = agent.tools.map(toolDefinitionToSpec);

  return {
    agent,
    provider,
    async invoke(messages: Message[]): Promise<ModelResponse> {
      // Prepend system prompt as the first message
      const fullMessages: Message[] = [
        { role: "system", content: agent.systemPrompt },
        ...messages,
      ];

      return provider.invoke(fullMessages, toolSpecs);
    },
  };
}

/**
 * Convert an internal `ToolDefinition` to the `ToolSpec` format expected
 * by model providers.
 */
function toolDefinitionToSpec(tool: ToolDefinition): ToolSpec {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [paramName, paramDef] of Object.entries(tool.parameters)) {
    const prop: Record<string, unknown> = {
      type: paramDef.type,
      description: paramDef.description,
    };
    if (paramDef.default !== undefined) {
      prop.default = paramDef.default;
    }
    properties[paramName] = prop;

    if (paramDef.required !== false) {
      required.push(paramName);
    }
  }

  return {
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: "object",
      properties,
      required,
    },
  };
}
