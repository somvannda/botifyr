import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

/**
 * Feed sidebar: profile birthday, dashboard stats, memories, and the
 * birthdays list (docs/feed.md). Uses the zero-setup memory store.
 */
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
  const makeFriends = async (a: { token: string; user: { id: string } }, b: { token: string; user: { id: string } }) => {
    const request = await app.inject({
      method: "POST",
      url: "/v1/friend-requests",
      headers: { authorization: `Bearer ${a.token}` },
      payload: { userId: b.user.id },
    });
    expect(request.statusCode).toBe(200);
    const list = await app.inject({
      method: "GET",
      url: "/v1/friend-requests",
      headers: { authorization: `Bearer ${b.token}` },
    });
    const incoming = (list.json() as Array<{ id: string; direction: string }>).find(
      (entry) => entry.direction === "incoming",
    );
    expect(incoming).toBeTruthy();
    const accepted = await app.inject({
      method: "POST",
      url: `/v1/friend-requests/${incoming!.id}`,
      headers: { authorization: `Bearer ${b.token}` },
      payload: { action: "accept" },
    });
    expect(accepted.statusCode).toBe(200);
  };
  return { app, store, signUp, makeFriends };
}

describe("profile birthday", () => {
  it("stores, validates, and clears a birthday", async () => {
    const { app, signUp } = await setup();
    const { token } = await signUp("birthday@example.com");

    const ok = await app.inject({
      method: "PATCH",
      url: "/v1/profile",
      headers: { authorization: `Bearer ${token}` },
      payload: { birthday: "1990-04-21" },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { birthday?: string }).birthday).toBe("1990-04-21");

    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect((me.json() as { birthday?: string }).birthday).toBe("1990-04-21");

    const bad = await app.inject({
      method: "PATCH",
      url: "/v1/profile",
      headers: { authorization: `Bearer ${token}` },
      payload: { birthday: "21/04/1990" },
    });
    expect(bad.statusCode).toBe(400);

    const cleared = await app.inject({
      method: "PATCH",
      url: "/v1/profile",
      headers: { authorization: `Bearer ${token}` },
      payload: { birthday: null },
    });
    expect((cleared.json() as { birthday?: string }).birthday).toBeUndefined();
    await app.close();
  });
});

describe("feed dashboard", () => {
  it("aggregates posts, reactions, reach, and friends", async () => {
    const { app, signUp, makeFriends } = await setup();
    const alice = await signUp("alice-dash@example.com");
    const bob = await signUp("bob-dash@example.com");
    await makeFriends(alice, bob);

    const created = await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { body: "Hello dashboard" },
    });
    expect(created.statusCode).toBe(201);
    const postId = (created.json() as { id: string }).id;

    // Bob reacts and views the post.
    await app.inject({
      method: "PUT",
      url: `/v1/posts/${postId}/like`,
      headers: { authorization: `Bearer ${bob.token}` },
    });
    await app.inject({
      method: "POST",
      url: `/v1/posts/${postId}/view`,
      headers: { authorization: `Bearer ${bob.token}` },
    });

    const dashboard = await app.inject({
      method: "GET",
      url: "/v1/dashboard",
      headers: { authorization: `Bearer ${alice.token}` },
    });
    expect(dashboard.statusCode).toBe(200);
    const stats = dashboard.json() as {
      posts: number;
      reactions: number;
      reach: number;
      friends: number;
      recent: Array<{ id: string; reach: number }>;
    };
    expect(stats.posts).toBe(1);
    expect(stats.reactions).toBe(1);
    expect(stats.reach).toBe(1);
    expect(stats.friends).toBe(1);
    expect(stats.recent[0]?.id).toBe(postId);
    expect(stats.recent[0]?.reach).toBe(1);
    await app.close();
  });
});

describe("birthdays", () => {
  it("lists a friend's birthday within the next 7 days", async () => {
    const { app, signUp, makeFriends } = await setup();
    const alice = await signUp("alice-bday@example.com");
    const bob = await signUp("bob-bday@example.com");
    await makeFriends(alice, bob);

    const now = new Date();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    await app.inject({
      method: "PATCH",
      url: "/v1/profile",
      headers: { authorization: `Bearer ${bob.token}` },
      payload: { birthday: `1995-${month}-${day}` },
    });

    const list = await app.inject({
      method: "GET",
      url: "/v1/birthdays",
      headers: { authorization: `Bearer ${alice.token}` },
    });
    expect(list.statusCode).toBe(200);
    const entries = list.json() as Array<{ person: { id: string }; daysUntil: number }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.person.id).toBe(bob.user.id);
    expect(entries[0]?.daysUntil).toBe(0);
    await app.close();
  });
});

describe("memories", () => {
  it("groups posts from the same day in a previous year", async () => {
    const { app, store, signUp } = await setup();
    const alice = await signUp("alice-mem@example.com");

    const now = new Date();
    const lastYear = new Date(
      Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate(), 12),
    );
    await store.createPost({
      id: "memory-post",
      authorId: alice.user.id,
      body: "A year ago today",
      createdAt: lastYear.toISOString(),
      updatedAt: lastYear.toISOString(),
    });

    const memories = await app.inject({
      method: "GET",
      url: "/v1/memories",
      headers: { authorization: `Bearer ${alice.token}` },
    });
    expect(memories.statusCode).toBe(200);
    const groups = memories.json() as Array<{ key: string; label: string; posts: Array<{ id: string }> }>;
    expect(groups).toHaveLength(1);
    expect(groups[0]?.posts[0]?.id).toBe("memory-post");
    expect(groups[0]?.label).toContain("1 year");
    await app.close();
  });
});
