import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { buildServer } from "./server.js";
import { MemoryStore } from "./store/memory.js";

/**
 * `/v1/config` reports platform model health so the UI can warn before the next
 * model call fails. Healthy (ok: true) until a failure is observed.
 */
describe("model health in /v1/config", () => {
  it("reports healthy before any model failure", async () => {
    const app = await buildServer({
      store: new MemoryStore(),
      vaultKey: Buffer.alloc(32),
      localChannel: createLocalChannel(),
    });
    await app.ready();
    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "health@example.com", password: "password123" },
    });
    const auth = { authorization: `Bearer ${(signup.json() as { token: string }).token}` };

    const res = await app.inject({ method: "GET", url: "/v1/config", headers: auth });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ai: { ok: boolean } }).ai.ok).toBe(true);

    await app.close();
  });
});
