import { describe, expect, it } from "vitest";
import type { ServerEvent } from "@botifyr/shared";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

/**
 * DB-1 (docs/feed-discovery-plan.md): feed realtime events must actually reach
 * their intended websocket recipient. The existing feed test only asserts that
 * events are *emitted* (it subscribes in-process); this exercises the real
 * `/v1/stream` fan-out filter (`canReceive`).
 */
describe("feed realtime delivery (DB-1)", () => {
  it("delivers interactions to the recipient and own posts to the author", async () => {
    const store = new MemoryStore();
    const app = await buildServer({
      store,
      vaultKey: Buffer.alloc(32),
      localChannel: createLocalChannel(),
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const signUp = async (email: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email, password: "password123" },
      });
      expect(response.statusCode).toBe(201);
      return response.json() as { token: string; user: { id: string } };
    };
    const alice = await signUp("alice-rt@example.com");
    const bob = await signUp("bob-rt@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);

    const open = (token: string) =>
      new Promise<{ events: ServerEvent[]; close: () => void }>((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/stream?token=${encodeURIComponent(token)}`);
        const events: ServerEvent[] = [];
        socket.addEventListener("message", (event) => {
          try {
            events.push(JSON.parse(String((event as MessageEvent).data)) as ServerEvent);
          } catch {
            // ignore malformed frames
          }
        });
        socket.addEventListener("open", () => resolve({ events, close: () => socket.close() }));
        socket.addEventListener("error", (error) => reject(error));
      });

    const aliceStream = await open(alice.token);
    const bobStream = await open(bob.token);
    try {
      // Let both server-side subscriptions attach before emitting.
      await new Promise((resolve) => setTimeout(resolve, 60));

      const postResponse = await app.inject({
        method: "POST",
        url: "/v1/posts",
        headers: { authorization: `Bearer ${alice.token}` },
        payload: { body: "realtime hello" },
      });
      const post = postResponse.json() as { id: string };
      await app.inject({
        method: "PUT",
        url: `/v1/posts/${post.id}/like`,
        headers: { authorization: `Bearer ${bob.token}` },
      });
      await new Promise((resolve) => setTimeout(resolve, 150));

      const types = (events: ServerEvent[]) => events.map((event) => event.type);
      // The author's stream sees their own new post and the incoming like.
      expect(types(aliceStream.events)).toContain("feed.post");
      expect(types(aliceStream.events)).toContain("feed.like");
      // A friend must not receive someone else's interaction notification.
      expect(types(bobStream.events)).not.toContain("feed.like");
    } finally {
      aliceStream.close();
      bobStream.close();
      await app.close();
    }
  });
});
