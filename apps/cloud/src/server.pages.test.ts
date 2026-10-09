import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

interface PageDto {
  id: string;
  handle: string;
  role: string | null;
  followers: number;
}

/**
 * Pages are public, followable entities (docs/feed-next.md). A Page has a unique
 * handle, roles gate posting-as-Page, and following a Page pulls its posts into
 * the follower's feed.
 */
describe("pages", () => {
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
    const createPage = async (token: string, name: string, handle: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/pages",
        headers: auth(token),
        payload: { name, handle },
      });
      expect(response.statusCode).toBe(201);
      return response.json() as PageDto;
    };
    return { app, store, signUp, auth, createPage };
  }

  it("creates a page with a unique handle and gives the owner an admin role", async () => {
    const { app, signUp, auth } = await setup();
    const alice = await signUp("alice-page@example.com");
    const page = await app.inject({
      method: "POST",
      url: "/v1/pages",
      headers: auth(alice.token),
      payload: { name: "Acme Robotics", handle: "acme", category: "Company" },
    });
    expect(page.statusCode).toBe(201);
    const created = page.json() as PageDto;
    expect(created.handle).toBe("acme");
    expect(created.role).toBe("admin");
    expect(created.followers).toBe(0);

    const dup = await app.inject({
      method: "POST",
      url: "/v1/pages",
      headers: auth(alice.token),
      payload: { name: "Other", handle: "acme" },
    });
    expect(dup.statusCode).toBe(409);

    const fetched = await app.inject({ method: "GET", url: "/v1/pages/acme", headers: auth(alice.token) });
    expect(fetched.statusCode).toBe(200);
    expect((fetched.json() as PageDto).id).toBe(created.id);

    await app.close();
  });

  it("lets the owner post as the Page and requires a role to do so", async () => {
    const { app, signUp, auth, createPage } = await setup();
    const alice = await signUp("alice-pagepost@example.com");
    const bob = await signUp("bob-pagepost@example.com");
    const page = await createPage(alice.token, "Widgets", "widgets");

    const post = await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: auth(alice.token),
      payload: { body: "hello from the page", pageId: page.id },
    });
    expect(post.statusCode).toBe(201);
    const dto = post.json() as { author: { id: string; page?: boolean }; pageId?: string };
    expect(dto.author.id).toBe(page.id);
    expect(dto.author.page).toBe(true);
    expect(dto.pageId).toBe(page.id);

    // A non-member can't post as the Page.
    const denied = await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: auth(bob.token),
      payload: { body: "nope", pageId: page.id },
    });
    expect(denied.statusCode).toBe(403);

    // The Page timeline shows the post.
    const timeline = await app.inject({ method: "GET", url: "/v1/pages/widgets/posts", headers: auth(alice.token) });
    expect(timeline.statusCode).toBe(200);
    expect((timeline.json() as Array<{ body: string }>).map((entry) => entry.body)).toContain("hello from the page");

    await app.close();
  });

  it("puts a followed Page's posts into the follower's feed", async () => {
    const { app, signUp, auth, createPage } = await setup();
    const alice = await signUp("alice-follow@example.com");
    const bob = await signUp("bob-follow@example.com");
    const page = await createPage(alice.token, "News", "news");
    await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: auth(alice.token),
      payload: { body: "page update", pageId: page.id },
    });

    const before = await app.inject({ method: "GET", url: "/v1/feed", headers: auth(bob.token) });
    expect((before.json() as { items: Array<{ body: string }> }).items.map((entry) => entry.body)).not.toContain(
      "page update",
    );

    await app.inject({ method: "POST", url: `/v1/pages/${page.id}/follow`, headers: auth(bob.token), payload: {} });
    const after = await app.inject({ method: "GET", url: "/v1/feed", headers: auth(bob.token) });
    expect((after.json() as { items: Array<{ body: string }> }).items.map((entry) => entry.body)).toContain(
      "page update",
    );

    await app.close();
  });

  it("lets an admin grant a role and enforces who may post as the Page", async () => {
    const { app, signUp, auth, createPage } = await setup();
    const alice = await signUp("alice-roles@example.com");
    const bob = await signUp("bob-roles@example.com");
    const page = await createPage(alice.token, "Roles Inc", "rolesinc");

    // Bob can't manage roles.
    const denied = await app.inject({
      method: "PUT",
      url: `/v1/pages/${page.id}/roles`,
      headers: auth(bob.token),
      payload: { userId: bob.user.id, role: "editor" },
    });
    expect(denied.statusCode).toBe(403);

    // The owner (admin) grants Bob editor.
    const granted = await app.inject({
      method: "PUT",
      url: `/v1/pages/${page.id}/roles`,
      headers: auth(alice.token),
      payload: { userId: bob.user.id, role: "editor" },
    });
    expect(granted.statusCode).toBe(200);

    // Bob can now post as the Page.
    const post = await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: auth(bob.token),
      payload: { body: "editor post", pageId: page.id },
    });
    expect(post.statusCode).toBe(201);

    // The roles list (admin only) shows Bob as editor.
    const roles = await app.inject({ method: "GET", url: `/v1/pages/${page.id}/roles`, headers: auth(alice.token) });
    expect(roles.statusCode).toBe(200);
    const list = roles.json() as Array<{ userId: string; role: string }>;
    expect(list.find((entry) => entry.userId === bob.user.id)?.role).toBe("editor");

    await app.close();
  });

  it("exposes page insights to managers only", async () => {
    const { app, signUp, auth, createPage } = await setup();
    const alice = await signUp("alice-insights@example.com");
    const bob = await signUp("bob-insights@example.com");
    const page = await createPage(alice.token, "Insights Inc", "insightsinc");
    await app.inject({
      method: "POST",
      url: "/v1/posts",
      headers: auth(alice.token),
      payload: { body: "hello from the page", pageId: page.id },
    });

    const denied = await app.inject({ method: "GET", url: `/v1/pages/${page.id}/insights`, headers: auth(bob.token) });
    expect(denied.statusCode).toBe(403);

    const ok = await app.inject({ method: "GET", url: `/v1/pages/${page.id}/insights`, headers: auth(alice.token) });
    expect(ok.statusCode).toBe(200);
    const data = ok.json() as { followers: number; posts: number; topPosts: unknown[] };
    expect(data.posts).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(data.topPosts)).toBe(true);

    await app.close();
  });

  it("pins a post to the top of the Page timeline", async () => {
    const { app, signUp, auth, createPage } = await setup();
    const alice = await signUp("alice-pin@example.com");
    const page = await createPage(alice.token, "Pins", "pins");
    const createPagePost = async (pageId: string, body: string) =>
      (
        await app.inject({
          method: "POST",
          url: "/v1/posts",
          headers: auth(alice.token),
          payload: { body, pageId },
        })
      ).json() as { id: string };

    const first = await createPagePost(page.id, "first");
    await createPagePost(page.id, "second");

    const pin = await app.inject({
      method: "POST",
      url: `/v1/pages/${page.id}/pin`,
      headers: auth(alice.token),
      payload: { postId: first.id },
    });
    expect(pin.statusCode).toBe(200);

    const timeline = await app.inject({ method: "GET", url: "/v1/pages/pins/posts", headers: auth(alice.token) });
    expect((timeline.json() as Array<{ id: string }>)[0]?.id).toBe(first.id);

    // A post from a different Page can't be pinned here.
    const other = await createPage(alice.token, "Other Page", "otherpage");
    const otherPost = await createPagePost(other.id, "elsewhere");
    const bad = await app.inject({
      method: "POST",
      url: `/v1/pages/${page.id}/pin`,
      headers: auth(alice.token),
      payload: { postId: otherPost.id },
    });
    expect(bad.statusCode).toBe(400);

    await app.close();
  });

  it("moderates page comments through the community inbox", async () => {
    const { app, signUp, auth, createPage } = await setup();
    const alice = await signUp("alice-inbox@example.com");
    const bob = await signUp("bob-inbox@example.com");
    const page = await createPage(alice.token, "Community", "community");
    const post = (
      await app.inject({
        method: "POST",
        url: "/v1/posts",
        headers: auth(alice.token),
        payload: { body: "page post", pageId: page.id },
      })
    ).json() as { id: string };
    const comment = (
      await app.inject({
        method: "POST",
        url: `/v1/posts/${post.id}/comments`,
        headers: auth(bob.token),
        payload: { body: "nice page" },
      })
    ).json() as { id: string };

    const inbox = await app.inject({ method: "GET", url: `/v1/pages/${page.id}/inbox`, headers: auth(alice.token) });
    expect(inbox.statusCode).toBe(200);
    expect((inbox.json() as Array<{ id: string }>).map((entry) => entry.id)).toContain(comment.id);

    // A non-moderator can't hide.
    const denied = await app.inject({
      method: "POST",
      url: `/v1/comments/${comment.id}/hide`,
      headers: auth(bob.token),
      payload: {},
    });
    expect(denied.statusCode).toBe(403);

    // The owner hides it; it disappears from public reads.
    const hide = await app.inject({
      method: "POST",
      url: `/v1/comments/${comment.id}/hide`,
      headers: auth(alice.token),
      payload: {},
    });
    expect(hide.statusCode).toBe(200);
    const listed = await app.inject({
      method: "GET",
      url: `/v1/posts/${post.id}/comments`,
      headers: auth(alice.token),
    });
    expect((listed.json() as Array<{ id: string }>).map((entry) => entry.id)).not.toContain(comment.id);

    await app.close();
  });
});
