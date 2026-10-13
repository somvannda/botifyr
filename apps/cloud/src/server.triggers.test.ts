import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

/** Event triggers: owner CRUD + the hook's guard rails (plan §2.4). */
describe("event triggers", () => {
  async function boot() {
    const app = await buildServer({
      store: new MemoryStore(),
      vaultKey: Buffer.alloc(32),
      localChannel: createLocalChannel(),
    });
    await app.ready();
    const { token } = (
      await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email: "triggers@example.com", password: "password123" },
      })
    ).json() as { token: string };
    const auth = { authorization: `Bearer ${token}` };
    const workspace = (
      await app.inject({
        method: "POST",
        url: "/v1/workspaces",
        headers: auth,
        payload: { name: "Trig Co", members: [{ name: "Sam", title: "Support Agent", department: "support" }] },
      })
    ).json() as { id: string; roles: Array<{ botId: string }> };
    return { app, auth, wsId: workspace.id, botId: workspace.roles[0]!.botId };
  }

  it("saves, lists, fires-safe and deletes a trigger", async () => {
    const { app, auth, wsId, botId } = await boot();

    const saved = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${wsId}/triggers`,
      headers: auth,
      payload: { name: "New Ticket", botId, prompt: "Triage this support ticket." },
    });
    expect(saved.statusCode).toBe(200);
    expect((saved.json() as { name: string }).name).toBe("new-ticket");

    const list = await app.inject({ method: "GET", url: `/v1/workspaces/${wsId}/triggers`, headers: auth });
    expect((list.json() as unknown[]).length).toBe(1);

    // The hook's error paths don't dispatch a run, so they're safe to assert.
    const unknown = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${wsId}/hooks/nope`,
      headers: auth,
      payload: {},
    });
    expect(unknown.statusCode).toBe(404);

    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/workspaces/${wsId}/triggers/new-ticket`,
      headers: auth,
    });
    expect(removed.statusCode).toBe(204);
    expect(
      ((await app.inject({ method: "GET", url: `/v1/workspaces/${wsId}/triggers`, headers: auth })).json() as unknown[]).length,
    ).toBe(0);
  });

  it("rejects a trigger for someone who isn't an employee", async () => {
    const { app, auth, wsId } = await boot();
    const bad = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${wsId}/triggers`,
      headers: auth,
      payload: { name: "x", botId: "not-a-bot", prompt: "do it" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("refuses to fire while the company is paused", async () => {
    const { app, auth, wsId, botId } = await boot();
    await app.inject({
      method: "POST",
      url: `/v1/workspaces/${wsId}/triggers`,
      headers: auth,
      payload: { name: "tickets", botId, prompt: "Triage." },
    });
    await app.inject({ method: "POST", url: `/v1/workspaces/${wsId}/deactivate`, headers: auth });
    const fired = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${wsId}/hooks/tickets`,
      headers: auth,
      payload: {},
    });
    expect(fired.statusCode).toBe(409);
  });
});
