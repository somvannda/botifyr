import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

/** Company board: work items CRUD + ownership. */
describe("company board", () => {
  async function boot() {
    const app = await buildServer({
      store: new MemoryStore(),
      vaultKey: Buffer.alloc(32),
      localChannel: createLocalChannel(),
    });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "board@example.com", password: "password123" },
    });
    const { token } = res.json() as { token: string };
    const auth = { authorization: `Bearer ${token}` };
    const workspace = (
      await app.inject({ method: "POST", url: "/v1/workspaces", headers: auth, payload: { name: "Board Co" } })
    ).json() as { id: string };
    return { app, auth, wsId: workspace.id };
  }

  it("creates, lists, updates and deletes a work item", async () => {
    const { app, auth, wsId } = await boot();

    const created = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${wsId}/work`,
      headers: auth,
      payload: { title: "Build the marketing site", phase: "mvp", department: "engineering" },
    });
    expect(created.statusCode).toBe(201);
    const item = created.json() as {
      id: string;
      title: string;
      status: string;
      phase: string;
      department: string;
    };
    expect(item.title).toBe("Build the marketing site");
    expect(item.status).toBe("todo");
    expect(item.phase).toBe("mvp");
    expect(item.department).toBe("engineering");

    const list = (
      await app.inject({ method: "GET", url: `/v1/workspaces/${wsId}/work`, headers: auth })
    ).json() as Array<{ id: string }>;
    expect(list.map((entry) => entry.id)).toContain(item.id);

    const patched = await app.inject({
      method: "PATCH",
      url: `/v1/work/${item.id}`,
      headers: auth,
      payload: { status: "done", assigneeBotId: "bot-1" },
    });
    const body = patched.json() as { status: string; assigneeBotId?: string };
    expect(body.status).toBe("done");
    expect(body.assigneeBotId).toBe("bot-1");

    const blank = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${wsId}/work`,
      headers: auth,
      payload: { title: "  " },
    });
    expect(blank.statusCode).toBe(400);

    const removed = await app.inject({ method: "DELETE", url: `/v1/work/${item.id}`, headers: auth });
    expect(removed.statusCode).toBe(204);
    const after = (
      await app.inject({ method: "GET", url: `/v1/workspaces/${wsId}/work`, headers: auth })
    ).json() as unknown[];
    expect(after).toHaveLength(0);
    await app.close();
  });
});
