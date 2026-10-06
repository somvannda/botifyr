import { describe, expect, it } from "vitest";
import { runAgent } from "./agent.js";
import type { ModelProvider, ModelResponse, ToolDefinition } from "./types.js";

function scriptedProvider(responses: ModelResponse[]): ModelProvider {
  let index = 0;
  return {
    name: "scripted",
    async complete() {
      const response = responses[index] ?? { text: "done", toolCalls: [] };
      index += 1;
      return response;
    },
  };
}

function echoTool(onRun: (args: Record<string, unknown>) => void): ToolDefinition {
  return {
    name: "demo_echo",
    description: "Echo a value back.",
    parameters: { type: "object", properties: { value: { type: "string" } } },
    run: async (args) => {
      onRun(args);
      return { ok: true, output: `echoed ${String(args.value)}` };
    },
  };
}

describe("runAgent", () => {
  it("executes a tool call, then returns the final answer", async () => {
    const provider = scriptedProvider([
      { toolCalls: [{ id: "1", name: "demo_echo", arguments: { value: "hi" } }] },
      { text: "finished", toolCalls: [] },
    ]);
    let seen = "";
    const result = await runAgent({
      goal: "echo hi",
      provider,
      tools: [
        echoTool((args) => {
          seen = String(args.value);
        }),
      ],
      workspaceDir: ".",
      requestApproval: async () => true,
      onStep: () => {},
    });

    expect(seen).toBe("hi");
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("finished");
    expect(result.steps).toBe(1);
  });

  it("stops at the approval gate when denied", async () => {
    const provider = scriptedProvider([{ toolCalls: [{ id: "1", name: "danger_go", arguments: {} }] }]);
    const risky: ToolDefinition = {
      name: "danger_go",
      description: "Risky action.",
      parameters: { type: "object", properties: {} },
      requiresApproval: true,
      run: async () => ({ ok: true, output: "should not run" }),
    };

    const result = await runAgent({
      goal: "do the risky thing",
      provider,
      tools: [risky],
      workspaceDir: ".",
      requestApproval: async () => false,
      onStep: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("Stopped by you");
  });

  it("aggregates token usage across model calls", async () => {
    const provider = scriptedProvider([
      {
        toolCalls: [{ id: "1", name: "demo_echo", arguments: { value: "a" } }],
        usage: { promptTokens: 10, completionTokens: 5 },
      },
      { text: "done", toolCalls: [], usage: { promptTokens: 20, completionTokens: 7 } },
    ]);

    const result = await runAgent({
      goal: "x",
      provider,
      tools: [echoTool(() => {})],
      workspaceDir: ".",
      requestApproval: async () => true,
      onStep: () => {},
    });

    expect(result.usage).toEqual({ promptTokens: 30, completionTokens: 12 });
  });

  it("surfaces a model error as a failed run", async () => {
    const provider: ModelProvider = {
      name: "boom",
      async complete() {
        throw new Error("nope");
      },
    };

    const result = await runAgent({
      goal: "x",
      provider,
      tools: [],
      workspaceDir: ".",
      requestApproval: async () => true,
      onStep: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("Model error");
  });

  it("includes the rolling summary in the system prompt", async () => {
    let system = "";
    const provider: ModelProvider = {
      name: "capture",
      async complete({ messages }) {
        system = messages[0]?.content ?? "";
        return { text: "ok", toolCalls: [] };
      },
    };

    await runAgent({
      goal: "hi",
      summary: "The user is called Sam and prefers blue.",
      provider,
      tools: [],
      workspaceDir: ".",
      requestApproval: async () => true,
      onStep: () => {},
    });

    expect(system).toContain("Sam");
  });

  it("re-directs a refusal and then uses a tool", async () => {
    const provider = scriptedProvider([
      {
        text: "I'm not going to do that. It violates YouTube's Terms of Service and the content is copyrighted.",
        toolCalls: [],
      },
      { toolCalls: [{ id: "1", name: "demo_echo", arguments: { value: "go" } }] },
      { text: "done", toolCalls: [] },
    ]);
    let ran = false;
    const result = await runAgent({
      goal: "download the links",
      provider,
      tools: [echoTool(() => (ran = true))],
      workspaceDir: ".",
      requestApproval: async () => true,
      onStep: () => {},
    });

    expect(ran).toBe(true);
    expect(result.summary).toBe("done");
  });

  it("does not treat a short normal answer as a refusal", async () => {
    const provider = scriptedProvider([{ text: "ok", toolCalls: [] }]);
    const result = await runAgent({
      goal: "say ok",
      provider,
      tools: [echoTool(() => {})],
      workspaceDir: ".",
      requestApproval: async () => true,
      onStep: () => {},
    });
    expect(result.summary).toBe("ok");
  });

  it("auto-approve runs a consequential tool without asking", async () => {
    let asked = false;
    const risky: ToolDefinition = {
      name: "danger_go",
      description: "Risky action.",
      parameters: { type: "object", properties: {} },
      requiresApproval: true,
      run: async () => ({ ok: true, output: "did it" }),
    };
    const provider = scriptedProvider([
      { toolCalls: [{ id: "1", name: "danger_go", arguments: {} }] },
      { text: "done", toolCalls: [] },
    ]);

    const result = await runAgent({
      goal: "go",
      provider,
      tools: [risky],
      workspaceDir: ".",
      autoApprove: true,
      requestApproval: async () => {
        asked = true;
        return false;
      },
      onStep: () => {},
    });

    expect(asked).toBe(false);
    expect(result.ok).toBe(true);
  });

  it("sends the prefill only on the first model call", async () => {
    const seen: string[][] = [];
    const provider: ModelProvider = {
      name: "capture",
      async complete({ messages }) {
        seen.push(messages.map((message) => message.role));
        return messages.length > 3
          ? { text: "done", toolCalls: [] }
          : { toolCalls: [{ id: "1", name: "demo_echo", arguments: { value: "x" } }] };
      },
    };

    await runAgent({
      goal: "go",
      provider,
      tools: [echoTool(() => {})],
      workspaceDir: ".",
      prefill: "On it.",
      requestApproval: async () => true,
      onStep: () => {},
    });

    // First call ends with the assistant prefill; later calls do not.
    expect(seen[0]?.at(-1)).toBe("assistant");
    expect(seen[1]?.at(-1)).not.toBe("assistant");
  });

  it("runs the initial tool call before consulting the model", async () => {
    let ran = 0;
    const provider = scriptedProvider([{ text: "done", toolCalls: [] }]);
    const result = await runAgent({
      goal: "download these links",
      provider,
      tools: [echoTool(() => (ran += 1))],
      workspaceDir: ".",
      initialToolCall: { name: "demo_echo", arguments: { value: "preset" } },
      requestApproval: async () => true,
      onStep: () => {},
    });

    expect(ran).toBe(1);
    expect(result.summary).toBe("done");
  });

  it("signals a stream reset when it discards a refusal", async () => {
    let resets = 0;
    const provider = scriptedProvider([
      { text: "I won't do that. It violates the terms of service.", toolCalls: [] },
      { text: "done", toolCalls: [] },
    ]);
    await runAgent({
      goal: "x",
      provider,
      tools: [echoTool(() => {})],
      workspaceDir: ".",
      onStreamReset: () => (resets += 1),
      requestApproval: async () => true,
      onStep: () => {},
    });
    expect(resets).toBe(1);
  });
});
