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
});
