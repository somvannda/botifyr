import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store/memory.js";
import { createFeedTools } from "./feed-tools.js";

describe("feed tools (Botifyr social surface)", () => {
  const now = new Date().toISOString();
  const ctx = { workspaceDir: ".", log: () => {} };
  const me = "u1";
  const friend = "u2";

  async function seeded() {
    const store = new MemoryStore();
    const user = (id: string, handle: string) => ({
      id,
      email: `${id}@example.test`,
      passwordHash: "x",
      role: "user" as const,
      handle,
      displayName: handle,
      createdAt: now,
    });
    await store.createUser(user(me, "mia"));
    await store.createUser(user(friend, "fred"));
    await store.createFriendship(me, friend);
    await store.createPage({
      id: "page1",
      ownerId: me,
      handle: "acme",
      name: "Acme",
      verified: false,
      createdAt: now,
      updatedAt: now,
    });
    await store.setPageRole({ pageId: "page1", userId: me, role: "admin" });
    await store.createPage({
      id: "page2",
      ownerId: friend,
      handle: "other",
      name: "Other",
      verified: false,
      createdAt: now,
      updatedAt: now,
    });
    await store.createGroup({
      id: "group1",
      ownerId: friend,
      name: "Builders",
      handle: "builders",
      privacy: "public",
      createdAt: now,
      updatedAt: now,
    });
    return store;
  }

  const tools = (store: MemoryStore) => createFeedTools(store, { userId: me, botId: "bot1" });
  const tool = (store: MemoryStore, name: string) => tools(store).find((entry) => entry.name === name)!;

  it("gates publishing/replying/joining/moderating, leaves reads free", () => {
    const store = new MemoryStore();
    expect(tool(store, "feed.read").requiresApproval).toBeFalsy();
    expect(tool(store, "feed.insights").requiresApproval).toBeFalsy();
    for (const name of ["feed.post", "feed.reel", "feed.thread", "feed.engage", "group.post", "group.join", "page.manage", "feed.moderate"]) {
      expect(tool(store, name).requiresApproval, name).toBe(true);
    }
  });

  it("posts to the Feed and reads it back", async () => {
    const store = await seeded();
    const posted = await tool(store, "feed.post").run({ body: "Hello #world @fred" }, ctx);
    expect(posted.ok).toBe(true);
    const read = await tool(store, "feed.read").run({ source: "home" }, ctx);
    expect(read.ok).toBe(true);
    expect(read.output).toContain("Hello #world");
  });

  it("posts as a Page the bot manages, but refuses one it doesn't", async () => {
    const store = await seeded();
    const asPage = await tool(store, "feed.post").run({ body: "Update", page: "acme" }, ctx);
    expect(asPage.ok).toBe(true);
    const refused = await tool(store, "feed.post").run({ body: "Nope", page: "other" }, ctx);
    expect(refused.ok).toBe(false);
    const pagePosts = await store.listPostsByAuthor("page1", 10);
    expect(pagePosts).toHaveLength(1);
  });

  it("requires membership before posting to a Group, then allows it", async () => {
    const store = await seeded();
    const refused = await tool(store, "group.post").run({ group: "builders", body: "Hi" }, ctx);
    expect(refused.ok).toBe(false);
    const joined = await tool(store, "group.join").run({ group: "builders" }, ctx);
    expect(joined.ok).toBe(true);
    const posted = await tool(store, "group.post").run({ group: "builders", body: "Hi team" }, ctx);
    expect(posted.ok).toBe(true);
    expect(await store.listGroupPosts("group1", 10)).toHaveLength(1);
  });

  it("replies to a comment as a thread", async () => {
    const store = await seeded();
    const posted = await tool(store, "feed.post").run({ body: "root" }, ctx);
    const postId = (await store.listPostsByAuthor(me, 1))[0].id;
    expect(posted.ok).toBe(true);
    await store.createPostComment({ id: "c1", postId, authorId: friend, body: "nice", createdAt: now });
    const reply = await tool(store, "feed.thread").run({ commentId: "c1", body: "thanks" }, ctx);
    expect(reply.ok).toBe(true);
    const comments = await store.listPostComments(postId);
    expect(comments.find((comment) => comment.body === "thanks")?.parentId).toBe("c1");
  });

  it("reacts and reposts", async () => {
    const store = await seeded();
    await tool(store, "feed.post").run({ body: "root" }, ctx);
    const postId = (await store.listPostsByAuthor(me, 1))[0].id;
    const reacted = await tool(store, "feed.engage").run({ postId, action: "react", reaction: "love" }, ctx);
    expect(reacted.ok).toBe(true);
    expect((await store.getPostStats(postId, me)).myReaction).toBe("love");
    const reposted = await tool(store, "feed.engage").run({ postId, action: "repost", caption: "sharing" }, ctx);
    expect(reposted.ok).toBe(true);
    const mine = await store.listPostsByAuthor(me, 10);
    expect(mine.some((post) => post.repostOf === postId)).toBe(true);
  });

  it("reports Page insights for a manager", async () => {
    const store = await seeded();
    await tool(store, "feed.post").run({ body: "promo", page: "acme" }, ctx);
    const insights = await tool(store, "feed.insights").run({ page: "acme" }, ctx);
    expect(insights.ok).toBe(true);
    expect(insights.output).toContain("1 posts");
  });

  it("lets an admin set roles but blocks non-managers", async () => {
    const store = await seeded();
    const set = await tool(store, "page.manage").run(
      { page: "acme", action: "setRole", userId: friend, role: "editor" },
      ctx,
    );
    expect(set.ok).toBe(true);
    expect((await store.getPageRole("page1", friend))?.role).toBe("editor");
    const refused = await tool(store, "page.manage").run({ page: "other", action: "setRole", userId: friend, role: "editor" }, ctx);
    expect(refused.ok).toBe(false);
  });

  it("hides a comment only on a Page it moderates", async () => {
    const store = await seeded();
    await tool(store, "feed.post").run({ body: "post", page: "acme" }, ctx);
    const postId = (await store.listPostsByAuthor("page1", 1))[0].id;
    await store.createPostComment({ id: "c1", postId, authorId: friend, body: "spam", createdAt: now });
    const hidden = await tool(store, "feed.moderate").run({ action: "hide", commentId: "c1" }, ctx);
    expect(hidden.ok).toBe(true);
    expect((await store.getPostComment("c1"))?.hidden).toBe(true);
  });

  it("honours a bot's Page role (moderator moderates, editor posts)", async () => {
    const store = await seeded();
    await store.createBot({
      id: "bot1",
      userId: me,
      name: "Helper",
      emoji: "🤖",
      scheme: 0,
      instructions: "",
      sessionId: "s1",
      createdAt: now,
    });
    // Moderator on a Page owned by someone else.
    await store.setPageBotRole({ pageId: "page2", botId: "bot1", role: "moderator" });
    await store.createPost({
      id: "pp",
      authorId: "page2",
      pageId: "page2",
      body: "hello",
      createdAt: now,
      updatedAt: now,
    });
    await store.createPostComment({ id: "c9", postId: "pp", authorId: friend, body: "spam", createdAt: now });
    const hidden = await tool(store, "feed.moderate").run({ action: "hide", commentId: "c9" }, ctx);
    expect(hidden.ok).toBe(true);
    // A moderator still can't post as the Page…
    const refused = await tool(store, "feed.post").run({ body: "nope", page: "other" }, ctx);
    expect(refused.ok).toBe(false);
    // …but an editor can.
    await store.setPageBotRole({ pageId: "page2", botId: "bot1", role: "editor" });
    const posted = await tool(store, "feed.post").run({ body: "update", page: "other" }, ctx);
    expect(posted.ok).toBe(true);
    expect(await store.listPostsByAuthor("page2", 10)).toHaveLength(2);
  });

  it("assigns a bot role via page.manage with botId", async () => {
    const store = await seeded();
    await store.createBot({
      id: "bot1",
      userId: me,
      name: "Helper",
      emoji: "🤖",
      scheme: 0,
      instructions: "",
      sessionId: "s1",
      createdAt: now,
    });
    const set = await tool(store, "page.manage").run(
      { page: "acme", action: "setRole", botId: "bot1", role: "analyst" },
      ctx,
    );
    expect(set.ok).toBe(true);
    expect((await store.getPageBotRole("page1", "bot1"))?.role).toBe("analyst");
  });
});
