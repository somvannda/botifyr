import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer, decodeFeedCursor, encodeFeedCursor } from "./server.js";

/**
 * DB-2 (docs/feed-discovery-plan.md): cursor pagination must be stable when
 * several posts share a `createdAt`. The old `created_at < cursor` cursor skipped
 * the posts that shared the boundary timestamp; the keyset `(createdAt, id)`
 * cursor fixes it.
 */
describe("feed pagination stability (DB-2)", () => {
  it("never skips posts that share a createdAt", async () => {
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
      payload: { email: "pagination@example.com", password: "password123" },
    });
    const alice = signup.json() as { token: string; user: { id: string } };
    const auth = { authorization: `Bearer ${alice.token}` };

    // Five posts with an identical timestamp — the exact case the old cursor
    // would drop at a page boundary.
    const createdAt = "2026-01-01T00:00:00.000Z";
    for (const id of ["p1", "p2", "p3", "p4", "p5"]) {
      await store.createPost({
        id,
        authorId: alice.user.id,
        body: `body ${id}`,
        createdAt,
        updatedAt: createdAt,
        audience: "public",
      });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 6; page++) {
      const query = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : "?limit=2";
      const response = await app.inject({ method: "GET", url: `/v1/feed${query}`, headers: auth });
      const body = response.json() as { items: Array<{ id: string }>; nextCursor: string | null };
      seen.push(...body.items.map((item) => item.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }

    // Newest-first by (createdAt DESC, id DESC); every post appears exactly once.
    expect(seen).toEqual(["p5", "p4", "p3", "p2", "p1"]);
    await app.close();
  });

  it("round-trips the keyset cursor and degrades a legacy one", () => {
    const cursor = encodeFeedCursor({ createdAt: "2026-01-01T00:00:00.000Z", id: "abc" });
    expect(cursor).toBe("2026-01-01T00:00:00.000Z|abc");
    expect(decodeFeedCursor(cursor)).toEqual({ createdAt: "2026-01-01T00:00:00.000Z", id: "abc" });
    expect(decodeFeedCursor("2026-01-01T00:00:00.000Z")).toEqual({
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "",
    });
  });
});
