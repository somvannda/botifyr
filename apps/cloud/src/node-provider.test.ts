import { describe, expect, it, vi } from "vitest";

const { invokeNode, invokeNodeStream } = vi.hoisted(() => ({
  invokeNode: vi.fn(),
  invokeNodeStream: vi.fn(),
}));
vi.mock("./nodes.js", () => ({ invokeNode, invokeNodeStream }));

import { createNodeProvider } from "./node-provider.js";

/** Device mode: the model call runs on the local node, key stays on the device. */
describe("node provider", () => {
  it("round-trips a completion through the node", async () => {
    invokeNode.mockResolvedValueOnce({ ok: true, output: JSON.stringify({ text: "hi", toolCalls: [] }) });
    const provider = createNodeProvider("u1", {
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    });
    const res = await provider.complete({ messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(res.text).toBe("hi");
    expect(invokeNode).toHaveBeenCalledWith(
      "u1",
      "model.complete",
      expect.objectContaining({ model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" }),
      180_000,
    );
  });

  it("forwards streamed deltas via completeStream", async () => {
    invokeNodeStream.mockImplementationOnce(
      async (
        _user: string,
        _action: string,
        _args: unknown,
        onDelta: ((text: string) => void) | undefined,
      ) => {
        onDelta?.("he");
        onDelta?.("llo");
        return { ok: true, output: JSON.stringify({ text: "hello", toolCalls: [] }) };
      },
    );
    const provider = createNodeProvider("u1", { provider: "openai", model: "m", baseUrl: "https://x" });
    const seen: string[] = [];
    const res = await provider.completeStream?.({ messages: [], tools: [] }, (d) => seen.push(d));
    expect(seen).toEqual(["he", "llo"]);
    expect(res?.text).toBe("hello");
    expect(invokeNodeStream).toHaveBeenCalledWith(
      "u1",
      "model.complete",
      expect.objectContaining({ stream: true }),
      expect.any(Function),
      180_000,
    );
  });

  it("surfaces a node failure as an error", async () => {
    invokeNode.mockResolvedValueOnce({ ok: false, output: "device mode: set BOTIFYR_AI_KEY" });
    const provider = createNodeProvider("u1", { provider: "openai", model: "m", baseUrl: "https://x" });
    await expect(provider.complete({ messages: [], tools: [] })).rejects.toThrow(/BOTIFYR_AI_KEY/);
  });
});
