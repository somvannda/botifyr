import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";
import { subscribe } from "./events.js";

/** A 1x1 transparent PNG as a base64 data URL (valid for the upload guard). */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

interface FeedPostDto {
  id: string;
  author: { id: string; handle?: string };
  body: string;
  mediaId?: string;
  imageUrl?: string;
  likes: number;
  comments: number;
  shares: number;
  likedByMe: boolean;
  sharedByMe: boolean;
  reactions?: Record<string, number>;
  myReaction?: string | null;
}

interface FeedCommentDto {
  id: string;
  author: { id: string };
  body: string;
}

/**
 * The Feed is friends-only: you see your own posts and your friends' posts,
 * strangers see nothing. Likes, comments, and shares are per-viewer.
 */
describe("feed", () => {
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
    const createPost = async (token: string, body: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/posts",
        headers: auth(token),
        payload: { body },
      });
      expect(response.statusCode).toBe(201);
      return response.json() as FeedPostDto;
    };
    const feed = async (token: string, query = "") => {
      const response = await app.inject({ method: "GET", url: `/v1/feed${query}`, headers: auth(token) });
      expect(response.statusCode).toBe(200);
      return response.json() as { items: FeedPostDto[]; nextCursor: string | null };
    };

    return { app, store, signUp, auth, createPost, feed };
  }

  it("shows a post to its author and friends, but not to strangers", async () => {
    const { app, store, signUp, createPost, feed } = await setup();
    const alice = await signUp("alice-feed@example.com");
    const bob = await signUp("bob-feed@example.com");
    const cara = await signUp("cara-feed@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);

    const post = await createPost(alice.token, "hello world");
    expect(post.body).toBe("hello world");

    expect((await feed(alice.token)).items.map((p) => p.id)).toContain(post.id);
    expect((await feed(bob.token)).items.map((p) => p.id)).toContain(post.id);
    expect((await feed(cara.token)).items).toHaveLength(0);

    await app.close();
  });

  it("tracks likes per viewer and counts them for everyone", async () => {
    const { app, store, signUp, auth, createPost, feed } = await setup();
    const alice = await signUp("alice-like@example.com");
    const bob = await signUp("bob-like@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);
    const post = await createPost(alice.token, "like me");

    const liked = await app.inject({
      method: "PUT",
      url: `/v1/posts/${post.id}/like`,
      headers: auth(bob.token),
    });
    expect(liked.statusCode).toBe(200);

    const asBob = (await feed(bob.token)).items.find((p) => p.id === post.id);
    expect(asBob?.likes).toBe(1);
    expect(asBob?.likedByMe).toBe(true);

    const asAlice = (await feed(alice.token)).items.find((p) => p.id === post.id);
    expect(asAlice?.likes).toBe(1);
    expect(asAlice?.likedByMe).toBe(false);

    // Unlike is idempotent.
    await app.inject({ method: "DELETE", url: `/v1/posts/${post.id}/like`, headers: auth(bob.token) });
    expect((await feed(bob.token)).items.find((p) => p.id === post.id)?.likes).toBe(0);

    await app.close();
  });

  it("adds comments and exposes them with their author", async () => {
    const { app, store, signUp, auth, createPost, feed } = await setup();
    const alice = await signUp("alice-comment@example.com");
    const bob = await signUp("bob-comment@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);
    const post = await createPost(alice.token, "comment please");

    const added = await app.inject({
      method: "POST",
      url: `/v1/posts/${post.id}/comments`,
      headers: auth(bob.token),
      payload: { body: "nice one" },
    });
    expect(added.statusCode).toBe(201);

    const listed = await app.inject({
      method: "GET",
      url: `/v1/posts/${post.id}/comments`,
      headers: auth(alice.token),
    });
    expect(listed.statusCode).toBe(200);
    const comments = listed.json() as FeedCommentDto[];
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toBe("nice one");
    expect(comments[0]?.author.id).toBe(bob.user.id);
    expect((await feed(alice.token)).items.find((p) => p.id === post.id)?.comments).toBe(1);

    await app.close();
  });

  it("toggles shares and only lets the author delete a post", async () => {
    const { app, store, signUp, auth, createPost } = await setup();
    const alice = await signUp("alice-share@example.com");
    const bob = await signUp("bob-share@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);
    const post = await createPost(alice.token, "share me");

    const shared = await app.inject({
      method: "PUT",
      url: `/v1/posts/${post.id}/share`,
      headers: auth(bob.token),
    });
    expect(shared.statusCode).toBe(200);

    // Bob is not the author: his delete must not remove Alice's post.
    const bobDelete = await app.inject({
      method: "DELETE",
      url: `/v1/posts/${post.id}`,
      headers: auth(bob.token),
    });
    expect(bobDelete.statusCode).toBe(404);

    const aliceDelete = await app.inject({
      method: "DELETE",
      url: `/v1/posts/${post.id}`,
      headers: auth(alice.token),
    });
    expect(aliceDelete.statusCode).toBe(204);

    await app.close();
  });

  it("pages the feed newest-first with a cursor", async () => {
    const { app, signUp, createPost, feed } = await setup();
    const alice = await signUp("alice-page@example.com");
    const created: string[] = [];
    for (const body of ["first", "second", "third"]) {
      created.push((await createPost(alice.token, body)).id);
      // Space the timestamps so the ISO cursor is unambiguous.
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const pageOne = await feed(alice.token, "?limit=2");
    expect(pageOne.items).toHaveLength(2);
    expect(pageOne.items[0]?.body).toBe("third");
    expect(pageOne.nextCursor).not.toBeNull();

    const pageTwo = await feed(alice.token, `?limit=2&cursor=${encodeURIComponent(pageOne.nextCursor ?? "")}`);
    expect(pageTwo.items).toHaveLength(1);
    expect(pageTwo.items[0]?.body).toBe("first");
    expect(pageTwo.nextCursor).toBeNull();
    expect(created).toHaveLength(3);

    await app.close();
  });

  it("guards a user's wall to the author and friends", async () => {
    const { app, store, signUp, auth, createPost } = await setup();
    const alice = await signUp("alice-wall@example.com");
    const bob = await signUp("bob-wall@example.com");
    const cara = await signUp("cara-wall@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);
    await app.inject({
      method: "PATCH",
      url: "/v1/profile",
      headers: auth(alice.token),
      payload: { handle: "alicewall" },
    });
    await createPost(alice.token, "on my wall");

    const stranger = await app.inject({
      method: "GET",
      url: "/v1/users/alicewall/posts",
      headers: auth(cara.token),
    });
    expect(stranger.statusCode).toBe(403);

    const friend = await app.inject({
      method: "GET",
      url: "/v1/users/alicewall/posts",
      headers: auth(bob.token),
    });
    expect(friend.statusCode).toBe(200);
    expect((friend.json() as FeedPostDto[]).map((p) => p.body)).toContain("on my wall");

    const owner = await app.inject({
      method: "GET",
      url: "/v1/users/alicewall/posts",
      headers: auth(alice.token),
    });
    expect(owner.statusCode).toBe(200);

    await app.close();
  });

  it("rejects an empty post", async () => {
    const { app, signUp, auth } = await setup();
    const alice = await signUp("alice-empty@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: auth(alice.token),
      payload: { body: "   " },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("attaches an image and serves it through a signed URL", async () => {
    const previous = process.env.BOTIFYR_DOWNLOADS_DIR;
    const dir = join(tmpdir(), `botifyr-feed-${randomUUID()}`);
    process.env.BOTIFYR_DOWNLOADS_DIR = dir;
    const { app, signUp, auth } = await setup();
    try {
      const alice = await signUp("alice-image@example.com");
      const upload = await app.inject({
        method: "POST",
        url: "/v1/uploads",
        headers: auth(alice.token),
        payload: { name: "pic.png", mime: "image/png", data: PNG },
      });
      expect(upload.statusCode).toBe(201);
      const media = upload.json() as { id: string };

      const created = await app.inject({
        method: "POST",
        url: "/v1/posts",
        headers: auth(alice.token),
        payload: { body: "", mediaId: media.id },
      });
      expect(created.statusCode).toBe(201);
      expect((created.json() as FeedPostDto).imageUrl).toBeTruthy();

      const feed = await app.inject({ method: "GET", url: "/v1/feed", headers: auth(alice.token) });
      const item = (feed.json() as { items: FeedPostDto[] }).items.find((post) => post.imageUrl);
      expect(item?.imageUrl).toBeTruthy();

      // No auth header: the signed token itself is the capability.
      const image = await app.inject({ method: "GET", url: item?.imageUrl as string });
      expect(image.statusCode).toBe(200);
      expect(image.headers["content-type"]).toContain("image/png");
      expect(image.rawPayload.length).toBeGreaterThan(0);

      const tampered = await app.inject({ method: "GET", url: `${item?.imageUrl}x` });
      expect(tampered.statusCode).toBe(403);
    } finally {
      await app.close();
      if (previous === undefined) delete process.env.BOTIFYR_DOWNLOADS_DIR;
      else process.env.BOTIFYR_DOWNLOADS_DIR = previous;
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("suggests people who are not already friends", async () => {
    const { app, store, signUp, auth } = await setup();
    const alice = await signUp("alice-suggest@example.com");
    const bob = await signUp("bob-suggest@example.com");
    const cara = await signUp("cara-suggest@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);

    const response = await app.inject({
      method: "GET",
      url: "/v1/people/suggestions",
      headers: auth(alice.token),
    });
    expect(response.statusCode).toBe(200);
    const ids = (response.json() as Array<{ id: string }>).map((person) => person.id);
    expect(ids).toContain(cara.user.id);
    expect(ids).not.toContain(alice.user.id);
    expect(ids).not.toContain(bob.user.id);

    await app.close();
  });

  it("emits feed events, but not for self-interactions", async () => {
    const { app, store, signUp, auth, createPost } = await setup();
    const alice = await signUp("alice-notify@example.com");
    const bob = await signUp("bob-notify@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);

    const seen: string[] = [];
    const unsubscribe = subscribe((event) => {
      if (event.type === "feed.post") seen.push(`post:${event.authorId}`);
      else if (event.type === "feed.like" || event.type === "feed.comment" || event.type === "feed.share") {
        seen.push(`${event.type}:${event.fromUserId}->${event.toUserId}`);
      }
    });
    try {
      const post = await createPost(alice.token, "notify me");
      await app.inject({ method: "PUT", url: `/v1/posts/${post.id}/like`, headers: auth(bob.token) });
      await app.inject({
        method: "POST",
        url: `/v1/posts/${post.id}/comments`,
        headers: auth(bob.token),
        payload: { body: "hi" },
      });
      await app.inject({ method: "PUT", url: `/v1/posts/${post.id}/share`, headers: auth(bob.token) });
      // Self-interactions must not notify anyone.
      await app.inject({ method: "PUT", url: `/v1/posts/${post.id}/like`, headers: auth(alice.token) });
      await app.inject({ method: "PUT", url: `/v1/posts/${post.id}/share`, headers: auth(alice.token) });

      expect(seen).toEqual([
        `post:${alice.user.id}`,
        `feed.like:${bob.user.id}->${alice.user.id}`,
        `feed.comment:${bob.user.id}->${alice.user.id}`,
        `feed.share:${bob.user.id}->${alice.user.id}`,
      ]);
    } finally {
      unsubscribe();
      await app.close();
    }
  });

  it("supports multiple reactions, one per viewer", async () => {
    const { app, store, signUp, auth, createPost, feed } = await setup();
    const alice = await signUp("alice-react@example.com");
    const bob = await signUp("bob-react@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);
    const post = await createPost(alice.token, "react to me");

    const love = await app.inject({
      method: "PUT",
      url: `/v1/posts/${post.id}/reaction?reaction=love`,
      headers: auth(bob.token),
      payload: {},
    });
    expect(love.statusCode).toBe(200);

    const asBob = (await feed(bob.token)).items.find((entry) => entry.id === post.id);
    expect(asBob?.likes).toBe(1);
    expect(asBob?.myReaction).toBe("love");
    expect(asBob?.reactions?.love).toBe(1);

    // Switching replaces (still one reaction total).
    await app.inject({
      method: "PUT",
      url: `/v1/posts/${post.id}/reaction?reaction=angry`,
      headers: auth(bob.token),
      payload: {},
    });
    const switched = (await feed(bob.token)).items.find((entry) => entry.id === post.id);
    expect(switched?.likes).toBe(1);
    expect(switched?.myReaction).toBe("angry");
    expect(switched?.reactions?.angry).toBe(1);
    expect(switched?.reactions?.love).toBe(0);

    // Clearing removes it.
    await app.inject({ method: "DELETE", url: `/v1/posts/${post.id}/reaction`, headers: auth(bob.token) });
    const cleared = (await feed(bob.token)).items.find((entry) => entry.id === post.id);
    expect(cleared?.likes).toBe(0);
    expect(cleared?.myReaction).toBeNull();

    // Unknown reactions are rejected.
    const bad = await app.inject({
      method: "PUT",
      url: `/v1/posts/${post.id}/reaction?reaction=strange`,
      headers: auth(bob.token),
      payload: {},
    });
    expect(bad.statusCode).toBe(400);

    await app.close();
  });

  it("creates a repost that links back to the original", async () => {
    const { app, store, signUp, auth, createPost } = await setup();
    const alice = await signUp("alice-repost@example.com");
    const bob = await signUp("bob-repost@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);
    const post = await createPost(alice.token, "original content");

    const repost = await app.inject({
      method: "POST",
      url: `/v1/posts/${post.id}/repost`,
      headers: auth(bob.token),
      payload: { caption: "worth sharing" },
    });
    expect(repost.statusCode).toBe(201);
    const dto = repost.json() as {
      id: string;
      repostOf?: string;
      body: string;
      original?: { id: string; body: string };
    };
    expect(dto.repostOf).toBe(post.id);
    expect(dto.body).toBe("worth sharing");
    expect(dto.original?.id).toBe(post.id);
    expect(dto.original?.body).toBe("original content");

    const feed = await app.inject({ method: "GET", url: "/v1/feed", headers: auth(bob.token) });
    const items = (feed.json() as { items: Array<{ id: string; shares?: number }> }).items;
    expect(items.find((entry) => entry.id === post.id)?.shares).toBe(1);

    await app.close();
  });

  it("supports threaded replies", async () => {
    const { app, store, signUp, auth, createPost } = await setup();
    const alice = await signUp("alice-thread@example.com");
    const bob = await signUp("bob-thread@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);
    const post = await createPost(alice.token, "thread me");

    const top = await app.inject({
      method: "POST",
      url: `/v1/posts/${post.id}/comments`,
      headers: auth(bob.token),
      payload: { body: "top" },
    });
    expect(top.statusCode).toBe(201);
    const topId = (top.json() as { id: string }).id;

    const reply = await app.inject({
      method: "POST",
      url: `/v1/posts/${post.id}/comments`,
      headers: auth(alice.token),
      payload: { body: "reply", parentId: topId },
    });
    expect(reply.statusCode).toBe(201);
    expect((reply.json() as { parentId?: string }).parentId).toBe(topId);

    const listed = await app.inject({ method: "GET", url: `/v1/posts/${post.id}/comments`, headers: auth(alice.token) });
    const comments = listed.json() as Array<{ id: string; parentId?: string }>;
    expect(comments).toHaveLength(2);
    expect(comments.find((entry) => entry.id === topId)?.parentId).toBeUndefined();
    expect(comments.filter((entry) => entry.parentId === topId)).toHaveLength(1);

    // A reply pointing at a comment on another post is rejected.
    const other = await createPost(alice.token, "other post");
    const bad = await app.inject({
      method: "POST",
      url: `/v1/posts/${other.id}/comments`,
      headers: auth(bob.token),
      payload: { body: "x", parentId: topId },
    });
    expect(bad.statusCode).toBe(400);

    await app.close();
  });

  it("ranks recent posts by engagement for your network", async () => {
    const { app, store, signUp, auth, createPost } = await setup();
    const alice = await signUp("alice-trend@example.com");
    const bob = await signUp("bob-trend@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);

    const quiet = await createPost(alice.token, "quiet");
    const popular = await createPost(bob.token, "popular");
    await app.inject({ method: "PUT", url: `/v1/posts/${popular.id}/like`, headers: auth(alice.token) });
    await app.inject({
      method: "POST",
      url: `/v1/posts/${popular.id}/comments`,
      headers: auth(alice.token),
      payload: { body: "nice" },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/feed/trending?limit=5",
      headers: auth(alice.token),
    });
    expect(response.statusCode).toBe(200);
    const items = response.json() as Array<{ id: string }>;
    expect(items[0]?.id).toBe(popular.id);
    expect(items.map((post) => post.id)).toContain(quiet.id);

    await app.close();
  });

  it("hides blocked users' content both ways and stops interactions", async () => {
    const { app, store, signUp, auth, createPost, feed } = await setup();
    const alice = await signUp("alice-block@example.com");
    const bob = await signUp("bob-block@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);
    const bobPost = await createPost(bob.token, "bob post");

    // Before blocking, Alice sees Bob's post.
    expect((await feed(alice.token)).items.map((post) => post.id)).toContain(bobPost.id);

    const blocked = await app.inject({
      method: "POST",
      url: `/v1/users/${bob.user.id}/block`,
      headers: auth(alice.token),
      payload: {},
    });
    expect(blocked.statusCode).toBe(200);
    // Blocking ends the friendship.
    expect(await store.areFriends(alice.user.id, bob.user.id)).toBe(false);

    // Alice no longer sees Bob's post, and Bob is dropped from her suggestions.
    expect((await feed(alice.token)).items.map((post) => post.id)).not.toContain(bobPost.id);
    const suggestions = await app.inject({
      method: "GET",
      url: "/v1/people/suggestions",
      headers: auth(alice.token),
    });
    expect((suggestions.json() as Array<{ id: string }>).map((person) => person.id)).not.toContain(bob.user.id);

    // Bob can't interact with Alice's post.
    const alicePost = await createPost(alice.token, "alice post");
    const like = await app.inject({
      method: "PUT",
      url: `/v1/posts/${alicePost.id}/like`,
      headers: auth(bob.token),
    });
    expect(like.statusCode).toBe(403);

    // Reporting a post is recorded.
    const report = await app.inject({
      method: "POST",
      url: `/v1/posts/${bobPost.id}/report`,
      headers: auth(alice.token),
      payload: { reason: "spam" },
    });
    expect(report.statusCode).toBe(201);
    const reports = await store.listReports(10);
    expect(reports).toHaveLength(1);
    const reportId = reports[0]?.id as string;

    // Non-admins can't resolve reports.
    const forbidden = await app.inject({
      method: "PATCH",
      url: `/admin/reports/${reportId}`,
      headers: auth(alice.token),
      payload: { status: "reviewed" },
    });
    expect(forbidden.statusCode).toBe(403);

    // An admin can, and the status sticks.
    await store.setUserRole(alice.user.id, "admin");
    const resolved = await app.inject({
      method: "PATCH",
      url: `/admin/reports/${reportId}`,
      headers: auth(alice.token),
      payload: { status: "reviewed" },
    });
    expect(resolved.statusCode).toBe(204);
    expect((await store.listReports(10))[0]?.status).toBe("reviewed");

    const badStatus = await app.inject({
      method: "PATCH",
      url: `/admin/reports/${reportId}`,
      headers: auth(alice.token),
      payload: { status: "nonsense" },
    });
    expect(badStatus.statusCode).toBe(400);

    await app.close();
  });
});
