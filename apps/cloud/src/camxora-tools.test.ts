import { afterEach, describe, expect, it, vi } from "vitest";
import { CAMXORA_TOOL_NAMES, createCamxoraTools } from "./camxora-tools.js";
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
});
