import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

/**
 * Signed share links are recipient-scoped: only the intended friend (or the
 * file's owner, for their own preview) can open them, only friends can be
 * shared with, and a tampered token is refused.
 */
describe("file sharing", () => {
  async function setup() {
    const store = new MemoryStore();
    const app = await buildServer({ store, vaultKey: Buffer.alloc(32), localChannel: createLocalChannel() });
    await app.ready();
    const signup = async (email: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email, password: "password123" },
      });
      return response.json() as { token: string; user: { id: string } };
    };
    const alice = await signup("alice@example.com");
    const bob = await signup("bob@example.com");
    const cara = await signup("cara@example.com");
    await store.upsertMedia({
      id: "t1:song.mp4",
      userId: alice.user.id,
      taskId: "t1",
      name: "song.mp4",
      size: 10,
      mime: "video/mp4",
      location: "server",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return { app, store, alice, bob, cara };
  }

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  it("only shares with friends and only lets the recipient (or owner) open it", async () => {
    const { app, store, alice, bob, cara } = await setup();
    const mediaId = encodeURIComponent("t1:song.mp4");

    // Not friends yet → refused.
    const denied = await app.inject({
      method: "POST",
      url: `/v1/media/${mediaId}/share`,
      headers: auth(alice.token),
      payload: { toUserId: bob.user.id },
    });
    expect(denied.statusCode).toBe(403);

    await store.createFriendship(alice.user.id, bob.user.id);

    const shared = await app.inject({
      method: "POST",
      url: `/v1/media/${mediaId}/share`,
      headers: auth(alice.token),
      payload: { toUserId: bob.user.id },
    });
    expect(shared.statusCode).toBe(200);
    const { token } = shared.json() as { token: string };

    // The owner may reopen their own file for preview → not refused.
    const byOwner = await app.inject({
      method: "GET",
      url: `/v1/shared?share=${encodeURIComponent(token)}`,
      headers: auth(alice.token),
    });
    expect(byOwner.statusCode).not.toBe(403);

    // A stranger (neither recipient nor owner) is refused.
    const byStranger = await app.inject({
      method: "GET",
      url: `/v1/shared?share=${encodeURIComponent(token)}`,
      headers: auth(cara.token),
    });
    expect(byStranger.statusCode).toBe(403);

    // The recipient passes the gate (file is absent from the volume → 404).
    const byRecipient = await app.inject({
      method: "GET",
      url: `/v1/shared?share=${encodeURIComponent(token)}`,
      headers: auth(bob.token),
    });
    expect(byRecipient.statusCode).not.toBe(403);

    // A tampered token is refused.
    const tampered = await app.inject({
      method: "GET",
      url: `/v1/shared?share=${encodeURIComponent(`${token}x`)}`,
      headers: auth(bob.token),
    });
    expect(tampered.statusCode).toBe(403);

    await app.close();
  });
});
