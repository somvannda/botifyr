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

    const pageTwo = await feed(
      alice.token,
      `?limit=2&cursor=${encodeURIComponent(pageOne.nextCursor ?? "")}`,
    );
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

  it("attaches multiple images to a post", async () => {
    const previous = process.env.BOTIFYR_DOWNLOADS_DIR;
    const dir = join(tmpdir(), `botifyr-feed-${randomUUID()}`);
    process.env.BOTIFYR_DOWNLOADS_DIR = dir;
    const { app, signUp, auth } = await setup();
    try {
      const alice = await signUp("alice-multi@example.com");
      const ids: string[] = [];
      for (const name of ["a.png", "b.png", "c.png"]) {
        const upload = await app.inject({
          method: "POST",
          url: "/v1/uploads",
          headers: auth(alice.token),
          payload: { name, mime: "image/png", data: PNG },
        });
        expect(upload.statusCode).toBe(201);
        ids.push((upload.json() as { id: string }).id);
      }

      const created = await app.inject({
        method: "POST",
        url: "/v1/posts",
        headers: auth(alice.token),
        payload: { body: "album", mediaIds: ids },
      });
      expect(created.statusCode).toBe(201);
      const dto = created.json() as { images?: string[]; mediaIds?: string[] };
      expect(dto.mediaIds?.length).toBe(3);
      expect(dto.images?.length).toBe(3);

      const feed = await app.inject({ method: "GET", url: "/v1/feed", headers: auth(alice.token) });
      const item = (feed.json() as { items: Array<{ body: string; images?: string[] }> }).items.find(
        (entry) => entry.body === "album",
      );
      expect(item?.images?.length).toBe(3);
    } finally {
      await app.close();
      if (previous === undefined) delete process.env.BOTIFYR_DOWNLOADS_DIR;
      else process.env.BOTIFYR_DOWNLOADS_DIR = previous;
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
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

  it("attaches a video and serves it with a video content-type", async () => {
    const previous = process.env.BOTIFYR_DOWNLOADS_DIR;
    const dir = join(tmpdir(), `botifyr-feed-${randomUUID()}`);
    process.env.BOTIFYR_DOWNLOADS_DIR = dir;
    const { app, signUp, auth } = await setup();
    try {
      const alice = await signUp("alice-video@example.com");
      const data = `data:video/mp4;base64,${Buffer.from("fakevideo-bytes").toString("base64")}`;
      const upload = await app.inject({
        method: "POST",
        url: "/v1/uploads",
        headers: auth(alice.token),
        payload: { name: "clip.mp4", mime: "video/mp4", data },
      });
      expect(upload.statusCode).toBe(201);
      const id = (upload.json() as { id: string }).id;

      const created = await app.inject({
        method: "POST",
        url: "/v1/posts",
        headers: auth(alice.token),
        payload: { body: "watch this", mediaIds: [id] },
      });
      const dto = created.json() as { videos?: string[]; images?: string[] };
      expect(dto.videos?.length).toBe(1);
      expect(dto.images?.length ?? 0).toBe(0);

      const media = await app.inject({ method: "GET", url: dto.videos?.[0] as string });
      expect(media.statusCode).toBe(200);
      expect(media.headers["content-type"]).toContain("video/mp4");
    } finally {
      await app.close();
      if (previous === undefined) delete process.env.BOTIFYR_DOWNLOADS_DIR;
      else process.env.BOTIFYR_DOWNLOADS_DIR = previous;
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("emits a mention event for a mentioned @handle (never self)", async () => {
    const { app, signUp, auth } = await setup();
    const alice = await signUp("alice-mention@example.com");
    const bob = await signUp("bob-mention@example.com");
    await app.inject({
      method: "PATCH",
      url: "/v1/profile",
      headers: auth(alice.token),
      payload: { handle: "alicehandle" },
    });
    await app.inject({
      method: "PATCH",
      url: "/v1/profile",
      headers: auth(bob.token),
      payload: { handle: "bobhandle" },
    });

    const seen: string[] = [];
    const unsubscribe = subscribe((event) => {
      if (event.type === "feed.mention") seen.push(`${event.fromUserId}->${event.toUserId}`);
    });
    try {
      await app.inject({
        method: "POST",
        url: "/v1/posts",
        headers: auth(alice.token),
        payload: { body: "hey @bobhandle take a look" },
      });
      await app.inject({
        method: "POST",
        url: "/v1/posts",
        headers: auth(alice.token),
        payload: { body: "talking to myself @alicehandle" },
      });
      expect(seen).toEqual([`${alice.user.id}->${bob.user.id}`]);
    } finally {
      unsubscribe();
      await app.close();
    }
  });

  it("extracts hashtags and serves a tag feed", async () => {
    const { app, store, signUp, auth, createPost } = await setup();
    const alice = await signUp("alice-tag@example.com");
    const bob = await signUp("bob-tag@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);

    const post = (await createPost(alice.token, "hello #LaunchDay and #launchday again")) as unknown as {
      id: string;
      hashtags?: string[];
    };
    expect(post.hashtags).toEqual(["launchday"]);

    const tag = await app.inject({
      method: "GET",
      url: "/v1/tags/launchday/posts",
      headers: auth(bob.token),
    });
    expect(tag.statusCode).toBe(200);
    expect((tag.json() as Array<{ id: string }>).map((entry) => entry.id)).toContain(post.id);

    await app.close();
  });

  it("hides scheduled posts from others until their time", async () => {
    const { app, store, signUp, auth, feed } = await setup();
    const alice = await signUp("alice-sched@example.com");
    const bob = await signUp("bob-sched@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);

    const future = new Date(Date.now() + 3_600_000).toISOString();
    const created = await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: auth(alice.token),
      payload: { body: "later", scheduledAt: future },
    });
    expect(created.statusCode).toBe(201);
    const dto = created.json() as { id: string; scheduledAt?: string };
    expect(dto.scheduledAt).toBe(future);

    // Bob (a friend) doesn't see it; Alice (author) does.
    expect((await feed(bob.token)).items.map((entry) => entry.id)).not.toContain(dto.id);
    expect((await feed(alice.token)).items.map((entry) => entry.id)).toContain(dto.id);

    // Alice's scheduled list shows it.
    const queued = await app.inject({
      method: "GET",
      url: "/v1/posts/scheduled",
      headers: auth(alice.token),
    });
    expect((queued.json() as Array<{ id: string }>).map((entry) => entry.id)).toContain(dto.id);

    // A past time is treated as published now.
    const past = await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: auth(alice.token),
      payload: { body: "already", scheduledAt: new Date(Date.now() - 3_600_000).toISOString() },
    });
    expect((past.json() as { scheduledAt?: string }).scheduledAt).toBeUndefined();

    await app.close();
  });

  it("creates a poll and tallies votes", async () => {
    const { app, store, signUp, auth } = await setup();
    const alice = await signUp("alice-poll@example.com");
    const bob = await signUp("bob-poll@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);

    const created = await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: auth(alice.token),
      payload: { body: "vote!", poll: ["Cats", "Dogs"] },
    });
    expect(created.statusCode).toBe(201);
    const dto = created.json() as {
      id: string;
      poll?: {
        options: Array<{ id: string; label: string; votes: number }>;
        total: number;
        myVote: string | null;
      };
    };
    expect(dto.poll?.options.length).toBe(2);
    const cats = dto.poll?.options.find((option) => option.label === "Cats")?.id as string;

    const vote = await app.inject({
      method: "POST",
      url: `/v1/posts/${dto.id}/vote`,
      headers: auth(bob.token),
      payload: { optionId: cats },
    });
    expect(vote.statusCode).toBe(200);

    const feed = await app.inject({ method: "GET", url: "/v1/feed", headers: auth(bob.token) });
    const item = (
      feed.json() as {
        items: Array<{ id: string; poll?: { total: number; myVote: string | null } }>;
      }
    ).items.find((entry) => entry.id === dto.id);
    expect(item?.poll?.total).toBe(1);
    expect(item?.poll?.myVote).toBe(cats);

    // An unknown option is rejected.
    const bad = await app.inject({
      method: "POST",
      url: `/v1/posts/${dto.id}/vote`,
      headers: auth(bob.token),
      payload: { optionId: "nope" },
    });
    expect(bad.statusCode).toBe(400);

    await app.close();
  });

  it("creates a story that expires after 24 hours", async () => {
    const { app, store, signUp, auth } = await setup();
    const alice = await signUp("alice-story@example.com");
    const bob = await signUp("bob-story@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);

    const created = await app.inject({
      method: "POST",
      url: "/v1/stories",
      headers: auth(alice.token),
      payload: { caption: "hello story" },
    });
    expect(created.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: "/v1/stories", headers: auth(bob.token) });
    expect(list.statusCode).toBe(200);
    expect((list.json() as Array<{ caption: string }>).some((story) => story.caption === "hello story")).toBe(
      true,
    );

    // An expired story is not shown.
    await store.createStory({
      id: "expired-story",
      authorId: alice.user.id,
      caption: "old story",
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const after = await app.inject({ method: "GET", url: "/v1/stories", headers: auth(bob.token) });
    expect((after.json() as Array<{ caption: string }>).some((story) => story.caption === "old story")).toBe(
      false,
    );

    await app.close();
  });

  it("records story views and reactions", async () => {
    const { app, store, signUp, auth } = await setup();
    const alice = await signUp("alice-story2@example.com");
    const bob = await signUp("bob-story2@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);

    await app.inject({
      method: "POST",
      url: "/v1/stories",
      headers: auth(alice.token),
      payload: { caption: "view me" },
    });

    type StoryDto = {
      id: string;
      caption: string;
      viewedByMe: boolean;
      reactions: Record<string, number>;
      myReaction: string | null;
    };
    const list = async (): Promise<StoryDto[]> =>
      (
        await app.inject({ method: "GET", url: "/v1/stories", headers: auth(bob.token) })
      ).json() as StoryDto[];

    const story = (await list()).find((entry) => entry.caption === "view me");
    expect(story).toBeTruthy();
    expect(story?.viewedByMe).toBe(false);
    expect(story?.reactions).toEqual({});
    expect(story?.myReaction).toBeNull();

    const view = await app.inject({
      method: "POST",
      url: `/v1/stories/${story!.id}/view`,
      headers: auth(bob.token),
    });
    expect(view.statusCode).toBe(200);
    expect((await list()).find((entry) => entry.id === story!.id)?.viewedByMe).toBe(true);

    const react = await app.inject({
      method: "POST",
      url: `/v1/stories/${story!.id}/reaction`,
      headers: auth(bob.token),
      payload: { emoji: "❤️" },
    });
    expect(react.statusCode).toBe(200);
    const reacted = (await list()).find((entry) => entry.id === story!.id);
    expect(reacted?.reactions).toEqual({ "❤️": 1 });
    expect(reacted?.myReaction).toBe("❤️");

    // An empty emoji clears the viewer's reaction.
    await app.inject({
      method: "POST",
      url: `/v1/stories/${story!.id}/reaction`,
      headers: auth(bob.token),
      payload: { emoji: "" },
    });
    const cleared = (await list()).find((entry) => entry.id === story!.id);
    expect(cleared?.reactions).toEqual({});
    expect(cleared?.myReaction).toBeNull();

    // Unknown stories are rejected.
    const missing = await app.inject({
      method: "POST",
      url: "/v1/stories/does-not-exist/view",
      headers: auth(bob.token),
    });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });

  it("serves video posts through the reels feed", async () => {
    const previous = process.env.BOTIFYR_DOWNLOADS_DIR;
    const dir = join(tmpdir(), `botifyr-feed-${randomUUID()}`);
    process.env.BOTIFYR_DOWNLOADS_DIR = dir;
    const { app, signUp, auth, createPost } = await setup();
    try {
      const alice = await signUp("alice-reels@example.com");
      await createPost(alice.token, "just text, not a reel");
      const data = `data:video/mp4;base64,${Buffer.from("reel-clip").toString("base64")}`;
      const upload = await app.inject({
        method: "POST",
        url: "/v1/uploads",
        headers: auth(alice.token),
        payload: { name: "reel.mp4", mime: "video/mp4", data },
      });
      const mediaId = (upload.json() as { id: string }).id;
      const video = await app.inject({
        method: "POST",
        url: "/v1/posts",
        headers: auth(alice.token),
        payload: { body: "my reel", mediaIds: [mediaId] },
      });
      const videoId = (video.json() as { id: string }).id;

      const reels = await app.inject({ method: "GET", url: "/v1/reels", headers: auth(alice.token) });
      expect(reels.statusCode).toBe(200);
      const ids = (reels.json() as { items: Array<{ id: string }> }).items.map((entry) => entry.id);
      expect(ids).toContain(videoId);
      expect(ids).toHaveLength(1);
    } finally {
      await app.close();
      if (previous === undefined) delete process.env.BOTIFYR_DOWNLOADS_DIR;
      else process.env.BOTIFYR_DOWNLOADS_DIR = previous;
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("supports save, hide, and author mute", async () => {
    const { app, store, signUp, auth, createPost, feed } = await setup();
    const alice = await signUp("alice-ctrl@example.com");
    const bob = await signUp("bob-ctrl@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);
    const post = await createPost(bob.token, "bob post");

    await app.inject({ method: "PUT", url: `/v1/posts/${post.id}/save`, headers: auth(alice.token) });
    const saved = await app.inject({ method: "GET", url: "/v1/saved", headers: auth(alice.token) });
    expect((saved.json() as Array<{ id: string }>).map((entry) => entry.id)).toContain(post.id);

    // Hide removes it from the feed.
    await app.inject({ method: "PUT", url: `/v1/posts/${post.id}/hide`, headers: auth(alice.token) });
    expect((await feed(alice.token)).items.map((entry) => entry.id)).not.toContain(post.id);

    // Unhide restores it.
    await app.inject({ method: "DELETE", url: `/v1/posts/${post.id}/hide`, headers: auth(alice.token) });
    expect((await feed(alice.token)).items.map((entry) => entry.id)).toContain(post.id);

    // Muting the author removes their posts from the feed.
    await app.inject({
      method: "POST",
      url: `/v1/authors/${bob.user.id}/mute`,
      headers: auth(alice.token),
      payload: { days: 30 },
    });
    expect((await feed(alice.token)).items.map((entry) => entry.id)).not.toContain(post.id);

    await app.close();
  });

  it("groups posts into albums", async () => {
    const { app, signUp, auth } = await setup();
    const alice = await signUp("alice-album@example.com");
    const first = await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: auth(alice.token),
      payload: { body: "photo one", album: "Summer" },
    });
    expect((first.json() as { album?: string }).album).toBe("Summer");
    await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: auth(alice.token),
      payload: { body: "photo two", album: "Summer" },
    });
    await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: auth(alice.token),
      payload: { body: "no album" },
    });

    const albums = await app.inject({ method: "GET", url: "/v1/albums", headers: auth(alice.token) });
    const list = albums.json() as Array<{ name: string; count: number }>;
    expect(list.find((entry) => entry.name === "Summer")?.count).toBe(2);

    const posts = await app.inject({
      method: "GET",
      url: "/v1/albums/Summer/posts",
      headers: auth(alice.token),
    });
    const bodies = (posts.json() as Array<{ body: string }>).map((entry) => entry.body);
    expect(bodies).toContain("photo one");
    expect(bodies).toContain("photo two");
    expect(bodies).not.toContain("no album");

    await app.close();
  });

  it("supports reactions on comments", async () => {
    const { app, store, signUp, auth, createPost } = await setup();
    const alice = await signUp("alice-creact@example.com");
    const bob = await signUp("bob-creact@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);
    const post = await createPost(alice.token, "comment react");
    const comment = (
      await app.inject({
        method: "POST",
        url: `/v1/posts/${post.id}/comments`,
        headers: auth(alice.token),
        payload: { body: "hello" },
      })
    ).json() as { id: string };

    const put = await app.inject({
      method: "PUT",
      url: `/v1/comments/${comment.id}/reaction?reaction=love`,
      headers: auth(bob.token),
      payload: {},
    });
    expect(put.statusCode).toBe(200);

    const listed = await app.inject({
      method: "GET",
      url: `/v1/posts/${post.id}/comments`,
      headers: auth(alice.token),
    });
    const c = (
      listed.json() as Array<{ id: string; reactions?: Record<string, number>; myReaction?: string | null }>
    ).find((entry) => entry.id === comment.id);
    expect(c?.reactions?.love).toBe(1);
    expect(c?.myReaction ?? null).toBeNull();

    const asBob = await app.inject({
      method: "GET",
      url: `/v1/posts/${post.id}/comments`,
      headers: auth(bob.token),
    });
    const cb = (asBob.json() as Array<{ id: string; myReaction?: string | null }>).find(
      (entry) => entry.id === comment.id,
    );
    expect(cb?.myReaction).toBe("love");

    const bad = await app.inject({
      method: "PUT",
      url: `/v1/comments/${comment.id}/reaction?reaction=nope`,
      headers: auth(bob.token),
      payload: {},
    });
    expect(bad.statusCode).toBe(400);

    await app.close();
  });

  it("filters the feed by tab (all/friends/pages)", async () => {
    const { app, store, signUp, auth, createPost } = await setup();
    const alice = await signUp("alice-tabs@example.com");
    const bob = await signUp("bob-tabs@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);
    const page = (
      await app.inject({
        method: "POST",
        url: "/v1/pages",
        headers: auth(alice.token),
        payload: { name: "Tabbers", handle: "tabbers" },
      })
    ).json() as { id: string };

    const friendPost = await createPost(bob.token, "friend post");
    const pagePost = (
      await app.inject({
        method: "POST",
        url: "/v1/posts",
        headers: auth(alice.token),
        payload: { body: "page post", pageId: page.id },
      })
    ).json() as { id: string };
    await app.inject({
      method: "POST",
      url: `/v1/pages/${page.id}/follow`,
      headers: auth(bob.token),
      payload: {},
    });

    const ids = async (url: string) =>
      (
        (await app.inject({ method: "GET", url, headers: auth(bob.token) })).json() as {
          items: Array<{ id: string }>;
        }
      ).items.map((entry) => entry.id);

    expect(await ids("/v1/feed?tab=all")).toEqual(expect.arrayContaining([friendPost.id, pagePost.id]));
    const friends = await ids("/v1/feed?tab=friends");
    expect(friends).toContain(friendPost.id);
    expect(friends).not.toContain(pagePost.id);
    const pages = await ids("/v1/feed?tab=pages");
    expect(pages).toContain(pagePost.id);
    expect(pages).not.toContain(friendPost.id);

    const top = await app.inject({ method: "GET", url: "/v1/feed?sort=top", headers: auth(bob.token) });
    expect(top.statusCode).toBe(200);

    await app.close();
  });

  it("enforces the only_me audience (author-only)", async () => {
    const { app, store, signUp, auth, feed } = await setup();
    const alice = await signUp("alice-aud@example.com");
    const bob = await signUp("bob-aud@example.com");
    await store.createFriendship(alice.user.id, bob.user.id);

    const created = await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: auth(alice.token),
      payload: { body: "secret", audience: "only_me" },
    });
    expect(created.statusCode).toBe(201);
    const dto = created.json() as { id: string; audience?: string };
    expect(dto.audience).toBe("only_me");

    // A friend can't see it; the author can.
    expect((await feed(bob.token)).items.map((entry) => entry.id)).not.toContain(dto.id);
    expect((await feed(alice.token)).items.map((entry) => entry.id)).toContain(dto.id);

    // A friend can't interact with it.
    const like = await app.inject({
      method: "PUT",
      url: `/v1/posts/${dto.id}/like`,
      headers: auth(bob.token),
    });
    expect(like.statusCode).toBe(403);
    const comment = await app.inject({
      method: "POST",
      url: `/v1/posts/${dto.id}/comments`,
      headers: auth(bob.token),
      payload: { body: "hi" },
    });
    expect(comment.statusCode).toBe(403);
    const comments = await app.inject({
      method: "GET",
      url: `/v1/posts/${dto.id}/comments`,
      headers: auth(bob.token),
    });
    expect(comments.json()).toEqual([]);

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

    const listed = await app.inject({
      method: "GET",
      url: `/v1/posts/${post.id}/comments`,
      headers: auth(alice.token),
    });
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
    expect((suggestions.json() as Array<{ id: string }>).map((person) => person.id)).not.toContain(
      bob.user.id,
    );

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
