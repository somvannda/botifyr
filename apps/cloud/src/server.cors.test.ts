import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

/**
 * Regression guard: the desktop app and website call this API cross-origin.
 * A too-narrow CORS policy once allowed only GET/HEAD/POST, so every
 * PUT/PATCH/DELETE (edit bot, delete, admin moderation) failed in the browser
 * with a generic "Failed to fetch". Keep the full verb set allowed.
 */
describe("CORS", () => {
  it("advertises every verb the API uses in the preflight response", async () => {
    const app = await buildServer({
      store: new MemoryStore(),
      vaultKey: Buffer.alloc(32),
      localChannel: createLocalChannel(),
    });
    await app.ready();

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/bots/example",
      headers: {
        origin: "http://localhost:1420",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type,authorization",
      },
    });

    const allow = String(response.headers["access-control-allow-methods"] ?? "");
    for (const verb of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      expect(allow).toContain(verb);
    }
    expect(String(response.headers["access-control-allow-origin"])).toBe("http://localhost:1420");

    await app.close();
  });

  it("refuses an origin that is not allowlisted", async () => {
    const app = await buildServer({
      store: new MemoryStore(),
      vaultKey: Buffer.alloc(32),
      localChannel: createLocalChannel(),
    });
    await app.ready();

    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/bots/example",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "DELETE",
      },
    });

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();

    await app.close();
  });
});
