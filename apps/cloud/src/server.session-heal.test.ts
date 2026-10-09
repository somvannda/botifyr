import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

/**
 * A bot can outlive its thread (partial store reset, a stray conversation
 * delete, or an interrupted write). The API must recreate the missing session
 * so the client never selects a phantom chat that 404s with "session not found"
 * and blocks every message before it reaches the model.
 */
describe("orphan bot session self-heal", () => {
  it("recreates a bot's missing thread when listing sessions", async () => {
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
      payload: { email: "heal@example.com", password: "password123" },
    });
    const { token, user } = signup.json() as { token: string; user: { id: string } };
    const auth = { authorization: `Bearer ${token}` };

    // GET /v1/bots seeds a default bot whose thread exists.
    const bots = (
      await app.inject({ method: "GET", url: "/v1/bots", headers: auth })
    ).json() as Array<{ id: string; sessionId: string }>;
    const bot = bots[0];

    // Simulate the corruption: the bot survives, its thread is gone.
    await store.deleteSession(user.id, bot.sessionId);
    expect(await store.getSession(bot.sessionId)).toBeNull();

    // Listing sessions heals the gap instead of handing back a phantom id.
    const sessions = (
      await app.inject({ method: "GET", url: "/v1/sessions", headers: auth })
    ).json() as Array<{ id: string }>;
    expect(sessions.some((session) => session.id === bot.sessionId)).toBe(true);

    // The recreated thread is owned by the user, so the session endpoint works.
    const thread = await app.inject({
      method: "GET",
      url: `/v1/sessions/${bot.sessionId}`,
      headers: auth,
    });
    expect(thread.statusCode).toBe(200);

    await app.close();
  });
});
