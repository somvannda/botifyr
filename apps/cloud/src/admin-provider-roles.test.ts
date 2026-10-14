import { afterEach, describe, expect, it } from "vitest";
import type { ProviderRoleConfig } from "@botifyr/shared";
import { createLocalChannel } from "@botifyr/channels";
import { buildServer } from "./server.js";
import { MemoryStore } from "./store/memory.js";

/**
 * P0 of the video-translation pipeline (docs/video-translation.md §6): the
 * admin-managed provider registry per media role. Admin-only; keys live in the
 * vault (`keyRef`), never in this config.
 */
describe("admin provider roles", () => {
  const saved = process.env.BOTIFYR_ADMIN_EMAILS;
  afterEach(() => {
    if (saved === undefined) delete process.env.BOTIFYR_ADMIN_EMAILS;
    else process.env.BOTIFYR_ADMIN_EMAILS = saved;
  });

  async function setup() {
    process.env.BOTIFYR_ADMIN_EMAILS = "admin@example.com";
    const app = await buildServer({
      store: new MemoryStore(),
      vaultKey: Buffer.alloc(32),
      localChannel: createLocalChannel(),
    });
    await app.ready();
    const adminSignup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "admin@example.com", password: "password123" },
    });
    const userSignup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "user@example.com", password: "password123" },
    });
    return {
      app,
      adminAuth: { authorization: `Bearer ${(adminSignup.json() as { token: string }).token}` },
      userAuth: { authorization: `Bearer ${(userSignup.json() as { token: string }).token}` },
    };
  }

  it("lets an admin configure a provider role and read it back", async () => {
    const { app, adminAuth } = await setup();

    const empty = await app.inject({ method: "GET", url: "/admin/provider-roles", headers: adminAuth });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toHaveLength(0);

    const put = await app.inject({
      method: "PUT",
      url: "/admin/provider-roles/tts",
      headers: adminAuth,
      payload: {
        provider: "elevenlabs",
        model: "eleven_multilingual_v2",
        keyRef: "ELEVENLABS_API_KEY",
        enabled: true,
        pricing: { perMinuteCents: 3 },
      },
    });
    expect(put.statusCode).toBe(200);
    const record = put.json() as ProviderRoleConfig;
    expect(record.role).toBe("tts");
    expect(record.provider).toBe("elevenlabs");
    expect(record.enabled).toBe(true);
    expect(record.pricing?.perMinuteCents).toBe(3);
    expect(typeof record.updatedAt).toBe("string");

    const list = await app.inject({ method: "GET", url: "/admin/provider-roles", headers: adminAuth });
    expect(list.json()).toHaveLength(1);
    expect((list.json() as ProviderRoleConfig[])[0].model).toBe("eleven_multilingual_v2");

    await app.close();
  });

  it("rejects an unknown role", async () => {
    const { app, adminAuth } = await setup();
    const res = await app.inject({
      method: "PUT",
      url: "/admin/provider-roles/vision",
      headers: adminAuth,
      payload: { provider: "x" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("forbids non-admins", async () => {
    const { app, userAuth } = await setup();
    const res = await app.inject({ method: "GET", url: "/admin/provider-roles", headers: userAuth });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
