import { afterEach, describe, expect, it, vi } from "vitest";
import { CAMXORA_TOOL_NAMES, createCamxoraTools } from "./camxora-tools.js";
import { capabilityForTool } from "./tool-capabilities.js";
import { MemoryStore } from "./store/memory.js";
import { encryptSecret } from "./vault.js";

/** Camxora music tools: gated on a stored API key, approval-gated for spend. */
const vaultKey = Buffer.alloc(32);
const ctx = { workspaceDir: ".", log: () => {} };

async function connect(store: MemoryStore, token: string): Promise<void> {
  const encrypted = encryptSecret(
    vaultKey,
    JSON.stringify({ accessToken: token, refreshToken: null, expiresAt: null }),
  );
  await store.upsertConnection({
    id: "conn-camxora",
    userId: "u1",
    provider: "camxora",
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    tag: encrypted.tag,
    createdAt: new Date().toISOString(),
  });
}

function tool(name: string, store: MemoryStore) {
  const found = createCamxoraTools(store, vaultKey, "u1").find((t) => t.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

describe("camxora music tools", () => {
  afterEach(() => vi.restoreAllMocks());

  it("provides the curated toolset", () => {
    const store = new MemoryStore();
    expect(createCamxoraTools(store, vaultKey, "u1").map((t) => t.name)).toEqual([...CAMXORA_TOOL_NAMES]);
  });

  it("gates generation behind approval", () => {
    const store = new MemoryStore();
    for (const name of ["music.generate", "music.stems", "music.request"]) {
      expect(tool(name, store).requiresApproval).toBe(true);
    }
    expect(tool("music.credits", store).requiresApproval).toBeFalsy();
  });

  it("reports not-connected when no key is stored", async () => {
    const result = await tool("music.credits", new MemoryStore()).run({}, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("isn't connected");
  });

  it("calls the API with the stored key", async () => {
    const store = new MemoryStore();
    await connect(store, "secret-key");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ credits: 42 }), { status: 200 }));

    const result = await tool("music.credits", store).run({}, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("42");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://musicapi.camxora.com/v1/credits");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret-key");
  });

  it("rejects a passthrough path that isn't rooted", async () => {
    const store = new MemoryStore();
    await connect(store, "k");
    const result = await tool("music.get", store).run({ path: "v1/credits" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('must begin with "/"');
  });

  it("batch-generates N songs in one call", async () => {
    const store = new MemoryStore();
    await connect(store, "k");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify({ id: "task-1" }), { status: 200 }));
    const result = await tool("music.generate_batch", store).run({ prompt: "khmer rap", count: 3 }, ctx);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("https://musicapi.camxora.com/v1/music");
    expect(result.output).toContain("task-1");
  });

  it("polls several tasks at once", async () => {
    const store = new MemoryStore();
    await connect(store, "k");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) => new Response(JSON.stringify({ url }), { status: 200 }));
    const result = await tool("music.tasks", store).run({ taskIds: ["a", "b"] }, ctx);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.output).toContain("/v1/task/a");
    expect(result.output).toContain("/v1/task/b");
  });

  it("maps the spend tools to a money capability, leaving reads unmapped", () => {
    expect(capabilityForTool("music.generate")).toBe("music.generate");
    expect(capabilityForTool("music.generate_batch")).toBe("music.generate");
    expect(capabilityForTool("music.batch")).toBe("music.generate");
    expect(capabilityForTool("music.request")).toBe("music.generate");
    expect(capabilityForTool("music.credits")).toBeNull();
    expect(capabilityForTool("music.task")).toBeNull();
  });

  it("runs a batch of calls in one run, reporting per call", async () => {
    const store = new MemoryStore();
    await connect(store, "k");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) => new Response(JSON.stringify({ path: url }), { status: 200 }));
    const result = await tool("music.batch", store).run(
      { calls: [{ path: "/v1/music/extend", body: { clip_id: "a" } }, { path: "bad" }] },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the rooted path hits the API
    expect(result.output).toContain("/v1/music/extend");
    expect(result.output).toContain("skipped");
  });
});
