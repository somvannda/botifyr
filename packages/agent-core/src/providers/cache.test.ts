import { describe, expect, it } from "vitest";
import { withResponseCache } from "./cache.js";
import type { ModelProvider, ModelResponse } from "../types.js";

function countingProvider(response: ModelResponse): { provider: ModelProvider; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    provider: {
      name: "counting",
      async complete() {
        calls += 1;
        return response;
      },
    },
  };
}

describe("withResponseCache", () => {
  it("serves a repeated request from cache without calling the provider", async () => {
    const { provider, calls } = countingProvider({ text: "hi", toolCalls: [] });
    const cached = withResponseCache(provider, 60);
    const input = { messages: [{ role: "user" as const, content: "hi" }], tools: [] };

    expect((await cached.complete(input)).text).toBe("hi");
    expect((await cached.complete(input)).text).toBe("hi");
    expect(calls()).toBe(1);
  });

  it("does not count tokens on a cache hit", async () => {
    const { provider } = countingProvider({
      text: "hi",
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 5 },
    });
    const cached = withResponseCache(provider, 60);
    const input = { messages: [{ role: "user" as const, content: "hi" }], tools: [] };

    expect((await cached.complete(input)).usage).toEqual({ promptTokens: 10, completionTokens: 5 });
    expect((await cached.complete(input)).usage).toBeUndefined();
  });

  it("does not collide across different inputs", async () => {
    const { provider, calls } = countingProvider({ text: "x", toolCalls: [] });
    const cached = withResponseCache(provider, 60);
    await cached.complete({ messages: [{ role: "user", content: "a" }], tools: [] });
    await cached.complete({ messages: [{ role: "user", content: "b" }], tools: [] });
    expect(calls()).toBe(2);
  });

  it("is a passthrough when ttl is 0", async () => {
    const { provider, calls } = countingProvider({ text: "x", toolCalls: [] });
    const passthrough = withResponseCache(provider, 0);
    await passthrough.complete({ messages: [{ role: "user", content: "a" }], tools: [] });
    await passthrough.complete({ messages: [{ role: "user", content: "a" }], tools: [] });
    expect(calls()).toBe(2);
  });
});
