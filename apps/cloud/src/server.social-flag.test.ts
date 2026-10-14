import { afterEach, describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

/**
 * The launch cut (docs/launch-cut.md): `BOTIFYR_SOCIAL=off` stops serving the
 * deferred Feed product — but chat, friends and the agent stay up. The flag
 * defaults on so dev/test builds are unchanged.
 */
async function server() {
  const app = await buildServer({
    store: new MemoryStore(),
    vaultKey: Buffer.alloc(32),
    localChannel: createLocalChannel(),
  });
  await app.ready();
  return app;
}

describe("BOTIFYR_SOCIAL kill-switch", () => {
  const saved = process.env.BOTIFYR_SOCIAL;
  afterEach(() => {
    if (saved === undefined) delete process.env.BOTIFYR_SOCIAL;
    else process.env.BOTIFYR_SOCIAL = saved;
  });

  it("serves Feed routes by default (they fail auth, not 404)", async () => {
    delete process.env.BOTIFYR_SOCIAL;
    const app = await server();
    const res = await app.inject({ method: "GET", url: "/v1/feed" });
    expect(res.statusCode).not.toBe(404);
    await app.close();
  });

  it("404s Feed routes and keeps chat + friends when off", async () => {
    process.env.BOTIFYR_SOCIAL = "off";
    const app = await server();

    const feed = [
      "/v1/feed",
      "/v1/posts",
      "/v1/comments/x",
      "/v1/pages",
      "/v1/groups",
      "/v1/stories",
      "/v1/reels",
      "/v1/saved",
      "/v1/dashboard",
      "/v1/memories",
      "/v1/birthdays",
      "/v1/albums",
      "/v1/tags/x/posts",
    ];
    for (const url of feed) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(404);
    }

    // Chat, friends and the agent are untouched by the cut.
    for (const url of ["/v1/conversations", "/v1/friends", "/v1/blocks", "/v1/bots", "/v1/workspaces"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).not.toBe(404);
    }

    await app.close();
  });
});
