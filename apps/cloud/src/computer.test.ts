import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { buildServer } from "./server.js";
import { MemoryStore } from "./store/memory.js";

/**
 * "Botifyr's computer" routes. These guards don't need a live desktop, so they
 * run without Docker: an empty trace, a refusal to learn with nothing recorded,
 * and a refusal to replay without a started screen.
 */
describe("computer routes", () => {
  async function setup() {
    const store = new MemoryStore();
    const app = await buildServer({ store, vaultKey: Buffer.alloc(32), localChannel: createLocalChannel() });
    await app.ready();
    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "computer@example.com", password: "password123" },
    });
    const { token } = signup.json() as { token: string };
    const auth = { authorization: `Bearer ${token}` };
    const session = await app.inject({ method: "POST", url: "/v1/sessions", headers: auth });
    const { id } = session.json() as { id: string };
    return { app, auth, sessionId: id };
  }

  it("starts with an empty trace and refuses to learn nothing", async () => {
    const { app, auth, sessionId } = await setup();

    const trace = await app.inject({
      method: "GET",
      url: `/v1/sessions/${sessionId}/computer/trace`,
      headers: auth,
    });
    expect(trace.statusCode).toBe(200);
    expect(trace.json()).toEqual({ steps: [] });

    const learn = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/computer/learn`,
      headers: auth,
      payload: {},
    });
    expect(learn.statusCode).toBe(400);

    await app.close();
  });

  it("refuses to replay or record without a started desktop", async () => {
    const { app, auth, sessionId } = await setup();

    const replay = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/computer/replay`,
      headers: auth,
      payload: { name: "anything" },
    });
    expect(replay.statusCode).toBe(409);

    const record = await app.inject({
      method: "POST",
      url: `/v1/sessions/${sessionId}/computer/record`,
      headers: auth,
      payload: { on: true },
    });
    expect(record.statusCode).toBe(409);

    await app.close();
  });

  it("404s for a session that isn't yours", async () => {
    const { app, auth } = await setup();
    const other = await app.inject({
      method: "GET",
      url: "/v1/sessions/does-not-exist/computer/trace",
      headers: auth,
    });
    expect(other.statusCode).toBe(404);
    await app.close();
  });
});
