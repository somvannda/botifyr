import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

/**
 * Auth issues a short-lived access token plus a long-lived refresh token. The
 * refresh token must never authenticate normal API calls, and each exchange
 * retires the used refresh token so a leaked one is only good for one use.
 */
describe("auth refresh tokens", () => {
  async function signUp() {
    const app = await buildServer({
      store: new MemoryStore(),
      vaultKey: Buffer.alloc(32),
      localChannel: createLocalChannel(),
    });
    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "refresh@example.com", password: "password123" },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { token: string; refreshToken: string; expiresAt: string };
    return { app, body };
  }

  it("issues both an access and a refresh token", async () => {
    const { app, body } = await signUp();
    expect(body.token).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.expiresAt).toBeTruthy();
    expect(body.token).not.toBe(body.refreshToken);
    await app.close();
  });

  it("rotates the refresh token and retires the old one", async () => {
    const { app, body } = await signUp();

    const refreshed = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: body.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    const next = refreshed.json() as { token: string; refreshToken: string };
    expect(next.token).not.toBe(body.token);
    expect(next.refreshToken).not.toBe(body.refreshToken);

    // Reusing the retired refresh token must fail.
    const reuse = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: body.refreshToken },
    });
    expect(reuse.statusCode).toBe(401);

    // The freshly issued access token works.
    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${next.token}` },
    });
    expect(me.statusCode).toBe(200);

    await app.close();
  });

  it("rejects a refresh token used as an access token", async () => {
    const { app, body } = await signUp();
    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${body.refreshToken}` },
    });
    expect(me.statusCode).toBe(401);
    await app.close();
  });

  it("rejects an unknown or missing refresh token", async () => {
    const { app } = await signUp();
    const missing = await app.inject({ method: "POST", url: "/auth/refresh", payload: {} });
    expect(missing.statusCode).toBe(400);
    const unknown = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: "not-a-real-token" },
    });
    expect(unknown.statusCode).toBe(401);
    await app.close();
  });
});
