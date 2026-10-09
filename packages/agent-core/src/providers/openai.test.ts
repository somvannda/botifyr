import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAIProvider } from "./openai.js";

/** Capture request bodies while returning a canned completion. */
function captureFetch(response: unknown): { bodies: Array<Record<string, any>> } {
  const bodies: Array<Record<string, any>> = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return {
      ok: true,
      status: 200,
      json: async () => response,
      text: async () => "",
      body: null,
    } as unknown as Response;
  });
  return { bodies };
}

afterEach(() => vi.unstubAllGlobals());

describe("createOpenAIProvider reasoning echo", () => {
  it("echoes reasoning_content on every assistant turn for DeepSeek thinking mode", async () => {
    const { bodies } = captureFetch({
      choices: [{ message: { content: "hi", reasoning_content: "because" } }],
    });
    const provider = createOpenAIProvider({
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-flash",
      apiKey: "k",
      echoReasoning: true,
    });

    const result = await provider.complete({
      messages: [
        { role: "user", content: "hi" },
        // The prefill / replayed history: no reasoning captured, yet the field
        // must still be present or the API rejects the whole request.
        { role: "assistant", content: "On it." },
        { role: "user", content: "again" },
      ],
      tools: [],
    });

    expect(bodies[0].messages[1]).toMatchObject({
      role: "assistant",
      content: "On it.",
      reasoning_content: "",
    });
    // The provider must surface the reasoning so the loop can echo it back.
    expect(result.reasoningContent).toBe("because");
  });

  it("echoes captured reasoning back on tool-call turns", async () => {
    const { bodies } = captureFetch({ choices: [{ message: { content: "ok" } }] });
    const provider = createOpenAIProvider({
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-flash",
      apiKey: "k",
      echoReasoning: true,
    });
    await provider.complete({
      messages: [
        {
          role: "assistant",
          content: "",
          reasoningContent: "I should act",
          toolCalls: [{ id: "c1", name: "browser_goto", arguments: { url: "https://example.com" } }],
        },
      ],
      tools: [],
    });
    expect(bodies[0].messages[0]).toMatchObject({
      role: "assistant",
      reasoning_content: "I should act",
    });
  });

  it("omits reasoning_content for providers that reject unknown fields", async () => {
    const { bodies } = captureFetch({ choices: [{ message: { content: "hi" } }] });
    const provider = createOpenAIProvider({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "k",
    });
    await provider.complete({ messages: [{ role: "assistant", content: "On it." }], tools: [] });
    expect("reasoning_content" in bodies[0].messages[0]).toBe(false);
  });

  it("downgrades a forced tool choice to auto in thinking mode", async () => {
    const { bodies } = captureFetch({ choices: [{ message: { content: "ok" } }] });
    const provider = createOpenAIProvider({
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-flash",
      apiKey: "k",
      echoReasoning: true,
    });
    await provider.complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "browser.goto", description: "go", parameters: { type: "object" } }],
      toolChoice: "required",
    });
    expect(bodies[0].tool_choice).toBe("auto");
  });

  it("retries with a reasoning placeholder when thinking mode rejects a reasoning-less turn", async () => {
    const bodies: Array<Record<string, any>> = [];
    let calls = 0;
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 400,
          text: async () =>
            '{"error":{"message":"The `reasoning_content` in the thinking mode must be passed back to the API."}}',
          json: async () => ({}),
          body: null,
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
        text: async () => "",
        body: null,
      } as unknown as Response;
    });

    const provider = createOpenAIProvider({
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-flash",
      apiKey: "k",
      echoReasoning: true,
    });
    const result = await provider.complete({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "On it." },
        { role: "user", content: "again" },
      ],
      tools: [],
    });

    expect(result.text).toBe("ok");
    expect(bodies).toHaveLength(2);
    expect(bodies[0].messages[1].reasoning_content).toBe("");
    expect(bodies[1].messages[1].reasoning_content).toBe("(none)");
  });

  it("relaxes a forced tool choice for any thinking endpoint that rejects it", async () => {
    const bodies: Array<Record<string, any>> = [];
    let calls = 0;
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 400,
          text: async () =>
            '{"error":{"message":"Thinking mode does not support this tool_choice","type":"invalid_request_error"}}',
          json: async () => ({}),
          body: null,
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
        text: async () => "",
        body: null,
      } as unknown as Response;
    });

    // echoReasoning is off: a non-deepseek preset pointed at a model that thinks
    // by default, so the guard in effectiveToolChoice never fires.
    const provider = createOpenAIProvider({
      baseUrl: "https://api.example.com/v1",
      model: "some-thinking-model",
      apiKey: "k",
    });
    const result = await provider.complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "browser.goto", description: "go", parameters: { type: "object" } }],
      toolChoice: "required",
    });

    expect(result.text).toBe("ok");
    expect(bodies).toHaveLength(2);
    expect(bodies[0].tool_choice).toBe("required");
    expect(bodies[1].tool_choice).toBe("auto");
  });
});
