import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import type { AiKeyConfig } from "@botifyr/shared";
import {
  AI_CONFIG_SECRET,
  clearAiKey,
  loadAiKey,
  saveAiKey,
  validateAiInput,
} from "./ai-keys.js";
import { buildServer } from "./server.js";
import { MemoryStore } from "./store/memory.js";
import { decryptSecret } from "./vault.js";

/**
 * Bring-your-own AI key: encrypted per-user storage, validation, and the
 * `/v1/ai/provider` endpoints. The key must never be returned to a client.
 */
describe("ai keys", () => {
  it("stores, reads back (key-free) and clears a user's config, encrypted at rest", async () => {
    const store = new MemoryStore();
    const vaultKey = Buffer.alloc(32);

    const saved = await saveAiKey(store, vaultKey, "u1", {
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-secret-value",
    });
    expect(saved.provider).toBe("openai");
    expect(saved.model).toBe("gpt-4o-mini");
    expect(saved.enabled).toBe(true);
    expect(saved.hasKey).toBe(true);

    const loaded = await loadAiKey(store, vaultKey, "u1");
    expect(loaded?.hasKey).toBe(true);
    // The key value is never part of the public view.
    expect(JSON.stringify(loaded)).not.toContain("sk-secret-value");

    // …and it is encrypted in the store.
    const record = await store.getSecret("u1", AI_CONFIG_SECRET);
    expect(record).not.toBeNull();
    expect(record?.ciphertext).not.toContain("sk-secret-value");

    await clearAiKey(store, "u1");
    expect(await loadAiKey(store, vaultKey, "u1")).toBeNull();
  });

  it("keeps the existing key when only the model is updated", async () => {
    const store = new MemoryStore();
    const vaultKey = Buffer.alloc(32);
    await saveAiKey(store, vaultKey, "u1", { provider: "groq", model: "llama-3.1-8b-instant", apiKey: "k" });
    const updated = await saveAiKey(store, vaultKey, "u1", { provider: "groq", model: "mixtral-8x7b-32768" });
    expect(updated.model).toBe("mixtral-8x7b-32768");
    expect(updated.hasKey).toBe(true);
  });

  it("device mode keeps the key off the server", async () => {
    const store = new MemoryStore();
    const vaultKey = Buffer.alloc(32);
    const saved = await saveAiKey(store, vaultKey, "u1", {
      provider: "openai",
      model: "gpt-4o-mini",
      mode: "device",
    });
    expect(saved.mode).toBe("device");
    expect(saved.hasKey).toBe(false);
    expect((await loadAiKey(store, vaultKey, "u1"))?.mode).toBe("device");

    // Nothing key-shaped is stored, and device mode doesn't require a key.
    const record = await store.getSecret("u1", AI_CONFIG_SECRET);
    const plain = record ? decryptSecret(vaultKey, record) : "";
    expect(plain).not.toContain("apiKey");
    expect(validateAiInput({ provider: "openai", model: "gpt-4o-mini", mode: "device" }, false)).toBeNull();
  });

  it("validates provider, model, base URL and key requirements", () => {
    expect(validateAiInput({ provider: "openai", model: "gpt-4o", apiKey: "" }, false)).toMatch(/API key/i);
    expect(validateAiInput({ provider: "custom", model: "x", baseUrl: "", apiKey: "k" }, false)).toMatch(/base URL/i);
    expect(validateAiInput({ provider: "custom", model: "x", baseUrl: "ftp://x", apiKey: "k" }, false)).toMatch(
      /http/i,
    );
    expect(validateAiInput({ provider: "ollama", model: "llama3.1" }, false)).toBeNull();
    // Empty model falls back to the preset default.
    expect(validateAiInput({ provider: "openai", model: "", apiKey: "k" }, false)).toBeNull();
    expect(validateAiInput({ provider: "nope", model: "x", apiKey: "k" }, false)).toMatch(/Unknown provider/i);
  });
});

describe("ai provider endpoints", () => {
  async function setup() {
    const app = await buildServer({
      store: new MemoryStore(),
      vaultKey: Buffer.alloc(32),
      localChannel: createLocalChannel(),
    });
    await app.ready();
    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "user@example.com", password: "password123" },
    });
    return {
      app,
      auth: { authorization: `Bearer ${(signup.json() as { token: string }).token}` },
    };
  }

  it("returns null before a key is set, then stores and clears one", async () => {
    const { app, auth } = await setup();

    const empty = await app.inject({ method: "GET", url: "/v1/ai/provider", headers: auth });
    expect(empty.statusCode).toBe(200);
    expect((empty.json() as { config: unknown }).config).toBeNull();

    const invalid = await app.inject({
      method: "PUT",
      url: "/v1/ai/provider",
      headers: auth,
      payload: { provider: "openai", model: "gpt-4o-mini" },
    });
    expect(invalid.statusCode).toBe(400);
    expect((invalid.json() as { error: string }).error).toMatch(/API key/i);

    const saved = await app.inject({
      method: "PUT",
      url: "/v1/ai/provider",
      headers: auth,
      payload: { provider: "openrouter", model: "openai/gpt-4o-mini", apiKey: "sk-or-xyz" },
    });
    expect(saved.statusCode).toBe(200);
    const config = saved.json() as AiKeyConfig;
    expect(config.provider).toBe("openrouter");
    expect(config.hasKey).toBe(true);
    expect(JSON.stringify(config)).not.toContain("sk-or-xyz");

    const removed = await app.inject({ method: "DELETE", url: "/v1/ai/provider", headers: auth });
    expect(removed.statusCode).toBe(204);
    const after = await app.inject({ method: "GET", url: "/v1/ai/provider", headers: auth });
    expect((after.json() as { config: unknown }).config).toBeNull();

    await app.close();
  });

  it("tells the user to start the node when testing device mode offline", async () => {
    const { app, auth } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/ai/provider/test",
      headers: auth,
      payload: { provider: "openai", model: "gpt-4o-mini", mode: "device" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/device|node/i);
    await app.close();
  });
});
