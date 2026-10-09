import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

/**
 * Groups are communities with their own post stream: creating a group makes the
 * owner an admin member, posting to a group requires membership, and a group feed
 * returns its posts.
 */
describe("groups", () => {
  async function setup() {
    const store = new MemoryStore();
    const app = await buildServer({ store, vaultKey: Buffer.alloc(32), localChannel: createLocalChannel() });
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

  it("creates a group, gates posting on membership, and serves a group feed", async () => {
    const { app, signUp, auth } = await setup();
    const alice = await signUp("alice-group@example.com");
    const bob = await signUp("bob-group@example.com");

    const created = await app.inject({
      method: "POST",
      url: "/v1/groups",
      headers: auth(alice.token),
      payload: { name: "Bird Watchers" },
    });
    expect(created.statusCode).toBe(201);
    const group = created.json() as { id: string; handle: string; members: number; joined: boolean };
    expect(group.handle).toBe("birdwatchers");
    expect(group.members).toBe(1);
    expect(group.joined).toBe(true);

    // A non-member can't post to the group.
    const denied = await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: auth(bob.token),
      payload: { body: "hi group", groupId: group.id },
    });
    expect(denied.statusCode).toBe(403);

    // Bob joins, then can post.
    const join = await app.inject({
      method: "POST",
      url: `/v1/groups/${group.id}/join`,
      headers: auth(bob.token),
      payload: {},
    });
    expect(join.statusCode).toBe(200);
    const post = await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: auth(bob.token),
      payload: { body: "hi group", groupId: group.id },
    });
    expect(post.statusCode).toBe(201);

    const feed = await app.inject({
      method: "GET",
      url: `/v1/groups/${group.handle}/posts`,
      headers: auth(alice.token),
    });
    expect(feed.statusCode).toBe(200);
    expect((feed.json() as Array<{ body: string }>).map((entry) => entry.body)).toContain("hi group");

    const mine = await app.inject({ method: "GET", url: "/v1/groups", headers: auth(bob.token) });
    expect((mine.json() as Array<{ id: string }>).map((entry) => entry.id)).toContain(group.id);

    await app.close();
  });
});
