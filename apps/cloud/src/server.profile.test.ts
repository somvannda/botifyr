import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

/** A 1x1 transparent PNG, valid for the avatar data-URL guard. */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * Profile updates accept an uploaded photo (`avatarUrl`, a small base64 data
 * URL). It must round-trip on the user, reach other people's search results,
 * and be validated (image data URLs only, bounded size).
 */
describe("profile avatars", () => {
  async function setup() {
    const app = await buildServer({
      store: new MemoryStore(),
      vaultKey: Buffer.alloc(32),
      localChannel: createLocalChannel(),
    });
    await app.ready();
    const signUp = async (email: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email, password: "password123" },
      });
      expect(response.statusCode).toBe(201);
      return response.json() as { token: string; user: { id: string } };
    };
    return { app, signUp };
  }

  it("stores an uploaded avatar and returns it on the user", async () => {
    const { app, signUp } = await setup();
    const { token } = await signUp("avatar@example.com");

    const patched = await app.inject({
      method: "PATCH",
      url: "/v1/profile",
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: "Somvannda", handle: "somvannda", avatarUrl: PNG },
    });
    expect(patched.statusCode).toBe(200);
    const user = patched.json() as { displayName?: string; handle?: string; avatarUrl?: string };
    expect(user.displayName).toBe("Somvannda");
    expect(user.handle).toBe("somvannda");
    expect(user.avatarUrl).toBe(PNG);

    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect((me.json() as { avatarUrl?: string }).avatarUrl).toBe(PNG);

    await app.close();
  });

  it("clears the uploaded avatar when passed null", async () => {
    const { app, signUp } = await setup();
    const { token } = await signUp("clear@example.com");
    await app.inject({
      method: "PATCH",
      url: "/v1/profile",
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarUrl: PNG },
    });
    const cleared = await app.inject({
      method: "PATCH",
      url: "/v1/profile",
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarUrl: null },
    });
    expect((cleared.json() as { avatarUrl?: string }).avatarUrl).toBeUndefined();
    await app.close();
  });

  it("rejects a non-image avatar and an oversized one", async () => {
    const { app, signUp } = await setup();
    const { token } = await signUp("bad@example.com");
    const notAnImage = await app.inject({
      method: "PATCH",
      url: "/v1/profile",
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarUrl: "https://example.com/avatar.png" },
    });
    expect(notAnImage.statusCode).toBe(400);

    const oversized = await app.inject({
      method: "PATCH",
      url: "/v1/profile",
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarUrl: `data:image/png;base64,${"A".repeat(500_001)}` },
    });
    expect(oversized.statusCode).toBe(413);
    await app.close();
  });

  it("exposes an avatar through people search", async () => {
    const { app, signUp } = await setup();
    const alice = await signUp("alice@example.com");
    const bob = await signUp("bob@example.com");
    await app.inject({
      method: "PATCH",
      url: "/v1/profile",
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { handle: "alicehandle", avatarUrl: PNG },
    });
    const results = await app.inject({
      method: "GET",
      url: "/v1/people?q=alicehandle",
      headers: { authorization: `Bearer ${bob.token}` },
    });
    expect(results.statusCode).toBe(200);
    const people = results.json() as Array<{ handle?: string; avatarUrl?: string }>;
    expect(people[0]?.handle).toBe("alicehandle");
    expect(people[0]?.avatarUrl).toBe(PNG);
    await app.close();
  });
});
