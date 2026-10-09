import { afterEach, describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import type { ServerEvent } from "@botifyr/shared";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";
import { subscribe } from "./events.js";

/**
 * CHAT-08 — the ephemeral typing signal. It is fanned out to the conversation's
 * other participants only and is never persisted.
 */
describe("conversation typing signal", () => {
  const unsubs: Array<() => void> = [];
  afterEach(() => {
    while (unsubs.length > 0) unsubs.pop()?.();
  });

  async function setup() {
    const store = new MemoryStore();
    const app = await buildServer({
      store,
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
    const auth = (token: string) => ({ authorization: `Bearer ${token}` });
    return { app, store, signUp, auth };
  }

  it("fans a typing event out to the other participant only", async () => {
    const { app, store, signUp, auth } = await setup();
    const alice = await signUp("alice-typing@example.com");
    const bob = await signUp("bob-typing@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);

    const dm = await app.inject({
      method: "POST",
      url: `/v1/dm/${bob.user.id}`,
      headers: auth(alice.token),
    });
    expect(dm.statusCode).toBe(200);
    const session = dm.json() as { id: string };

    const events: ServerEvent[] = [];
    unsubs.push(subscribe((event) => events.push(event)));

    const res = await app.inject({
      method: "POST",
      url: `/v1/conversations/${session.id}/typing`,
      headers: auth(alice.token),
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    const typingEvents = events.filter(
      (event): event is Extract<ServerEvent, { type: "typing" }> => event.type === "typing",
    );
    expect(typingEvents).toHaveLength(1);
    expect(typingEvents[0].sessionId).toBe(session.id);
    expect(typingEvents[0].userId).toBe(alice.user.id);
    expect(typingEvents[0].toUserId).toBe(bob.user.id);
  });

  it("rejects typing from a non-participant", async () => {
    const { app, store, signUp, auth } = await setup();
    const alice = await signUp("alice-typing2@example.com");
    const bob = await signUp("bob-typing2@example.com");
    const mallory = await signUp("mallory-typing@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);

    const dm = await app.inject({
      method: "POST",
      url: `/v1/dm/${bob.user.id}`,
      headers: auth(alice.token),
    });
    const session = dm.json() as { id: string };

    const res = await app.inject({
      method: "POST",
      url: `/v1/conversations/${session.id}/typing`,
      headers: auth(mallory.token),
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
