import { createHash } from "node:crypto";
import type { ModelProvider, ModelResponse } from "../types.js";

/**
 * Small in-memory response cache for a provider. Exact-match only: the key is a
 * hash of (provider, messages, tools, maxTokens), so a different conversation
 * never collides. Useful for retries and repeated identical prompts — a cache
 * hit costs zero tokens. Disabled when ttlSeconds <= 0.
 */
export function withResponseCache(provider: ModelProvider, ttlSeconds: number): ModelProvider {
  if (ttlSeconds <= 0) return provider;

  const cache = new Map<string, { value: ModelResponse; expiresAt: number }>();
  const keyFor = (input: { messages: unknown; tools: unknown; maxTokens?: number }): string =>
    createHash("sha256")
      .update(JSON.stringify([provider.name, input.messages, input.tools, input.maxTokens ?? null]))
      .digest("hex");

  const read = (key: string): ModelResponse | null => {
    const hit = cache.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      cache.delete(key);
      return null;
    }
    return hit.value;
  };

  return {
    name: provider.name,
    async complete(input) {
      const key = keyFor(input);
      const cached = read(key);
      // A cache hit spends no tokens, so it must not be counted as usage.
      if (cached) return { ...cached, usage: undefined };
      const value = await provider.complete(input);
      cache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return value;
    },
    async completeStream(input, onDelta) {
      const key = keyFor(input);
      const cached = read(key);
      if (cached) {
        if (cached.text) onDelta(cached.text);
        return { ...cached, usage: undefined };
      }
      const value = provider.completeStream
        ? await provider.completeStream(input, onDelta)
        : await provider.complete(input);
      cache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return value;
    },
  };
}
