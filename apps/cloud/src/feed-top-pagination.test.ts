import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

/**
 * FEED-D8 (docs/feed-discovery-implementation-plan.md): the engagement-ranked
 * "Top" feed is paged with an offset cursor so it can scroll beyond one page,
 * instead of returning a single page with `nextCursor: null`.
 */
describe("feed Top pagination (FEED-D8)", () => {
  it("pages the engagement-ranked feed with an offset cursor", async () => {
    const store = new MemoryStore();
    const app = await buildServer({
      store,
      vaultKey: Buffer.alloc(32),
      localChannel: createLocalChannel(),
    });
    await app.ready();

    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "top-pagination@example.com", password: "password123" },
    });
    const alice = signup.json() as { token: string; user: { id: string } };
    const auth = { authorization: `Bearer ${alice.token}` };

    // Five posts with distinct timestamps, all inside the 30-day window.
    const base = Date.now() - 60 * 60 * 1000;
    for (let i = 0; i < 5; i++) {
      const at = new Date(base + i * 1000).toISOString();
      await store.createPost({
        id: `p${i}`,
        authorId: alice.user.id,
        body: `ranked post ${i}`,
        createdAt: at,
        updatedAt: at,
        audience: "public",
      });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 6; page++) {
      const query = cursor ? `?sort=top&limit=2&cursor=${encodeURIComponent(cursor)}` : "?sort=top&limit=2";
      const response = await app.inject({ method: "GET", url: `/v1/feed${query}`, headers: auth });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { items: Array<{ id: string }>; nextCursor: string | null };
      seen.push(...body.items.map((item) => item.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }

    // Equal engagement → newest-first; every post appears exactly once.
    expect(seen).toEqual(["p4", "p3", "p2", "p1", "p0"]);
    await app.close();
  });
});
