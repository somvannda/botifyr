import { afterEach, describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { buildServer } from "./server.js";
import { MemoryStore } from "./store/memory.js";

/** Admin moderation of self-learned extraction recipes. */
describe("admin media recipes", () => {
  const saved = process.env.BOTIFYR_ADMIN_EMAILS;
  afterEach(() => {
    if (saved === undefined) delete process.env.BOTIFYR_ADMIN_EMAILS;
    else process.env.BOTIFYR_ADMIN_EMAILS = saved;
  });

  async function setup(email: string) {
    process.env.BOTIFYR_ADMIN_EMAILS = "admin@example.com";
    const store = new MemoryStore();
    const app = await buildServer({ store, vaultKey: Buffer.alloc(32), localChannel: createLocalChannel() });
    await app.ready();
    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email, password: "password123" },
    });
    const { token } = signup.json() as { token: string };
    return { app, store, auth: { authorization: `Bearer ${token}` } };
  }

  it("creates, lists, approves, and deletes a recipe", async () => {
    const { app, store, auth } = await setup("admin@example.com");

    expect((await app.inject({ method: "GET", url: "/admin/media-recipes", headers: auth })).json()).toEqual(
      [],
    );

    const put = await app.inject({
      method: "PUT",
      url: "/admin/media-recipes/example.com",
      headers: auth,
      payload: { pattern: "https?://[^\\s]+\\.m3u8", status: "approved", note: "from smoke test" },
    });
    expect(put.statusCode).toBe(200);
    const created = put.json() as { domain: string; status: string; pattern: string };
    expect(created.domain).toBe("example.com");
    expect(created.status).toBe("approved");

    // A recipe without a pattern is refused.
    const bad = await app.inject({
      method: "PUT",
      url: "/admin/media-recipes/empty.com",
      headers: auth,
      payload: { pattern: "" },
    });
    expect(bad.statusCode).toBe(400);

    const list = (
      await app.inject({
        method: "GET",
        url: "/admin/media-recipes",
        headers: auth,
      })
    ).json() as unknown[];
    expect(list).toHaveLength(1);

    // The store can look it up by domain (case-insensitive) — used at download time.
    expect((await store.getMediaRecipe("EXAMPLE.COM"))?.status).toBe("approved");

    const removed = await app.inject({
      method: "DELETE",
      url: "/admin/media-recipes/example.com",
      headers: auth,
    });
    expect(removed.statusCode).toBe(204);
    expect(await store.getMediaRecipe("example.com")).toBeNull();
    await app.close();
  });

  it("refuses a non-admin", async () => {
    const { app, auth } = await setup("user@example.com");
    const response = await app.inject({ method: "GET", url: "/admin/media-recipes", headers: auth });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
