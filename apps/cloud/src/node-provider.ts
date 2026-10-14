import type { ModelProvider, ModelResponse } from "@botifyr/agent-core";
import { invokeNode } from "./nodes.js";

export interface DeviceModelConfig {
  /** The provider preset id (informational; the node treats it as OpenAI-compatible). */
  provider: string;
  model: string;
  /** Resolved OpenAI-compatible base URL. */
  baseUrl: string;
}

/**
 * A provider whose model calls run on the user's own machine (the local node), so
 * the API key never leaves the device ("device" mode — docs/ai-keys-hybrid.md).
 *
 * The cloud sends the messages/tools and the provider/model/base URL; the node
 * supplies the key from its own environment. It implements `complete` only, so
 * device-mode runs are non-streaming.
 */
export function createNodeProvider(userId: string, config: DeviceModelConfig): ModelProvider {
  return {
    name: `device:${config.model || config.provider}`,
    async complete({ messages, tools, maxTokens, toolChoice }): Promise<ModelResponse> {
      const result = await invokeNode(
        userId,
        "model.complete",
        { messages, tools, maxTokens, toolChoice, ...config },
        180_000,
      );
      if (!result.ok) throw new Error(result.output || "device model call failed");
      return JSON.parse(result.output) as ModelResponse;
    },
  };
}
