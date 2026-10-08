import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

/** Bot CRUD + group rules (a group holds owned individual bots only). */
describe("bots API", () => {
  async function authed() {
    const app = await buildServer({
      store: new MemoryStore(),
      vaultKey: Buffer.alloc(32),
      localChannel: createLocalChannel(),
    });
    await app.ready();
    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "bots@example.com", password: "password123" },
    });
    const { token } = signup.json() as { token: string };
    return { app, auth: { authorization: `Bearer ${token}` } };
  }

  const create = async (
    app: Awaited<ReturnType<typeof authed>>["app"],
    auth: Record<string, string>,
    payload: Record<string, unknown>,
  ) =>
    (await app.inject({ method: "POST", url: "/v1/bots", headers: auth, payload })).json() as {
      id: string;
      name: string;
      workspace?: string;
      memberIds?: string[];
    };

  it("seeds a default bot on first list", async () => {
    const { app, auth } = await authed();
    const list = await app.inject({ method: "GET", url: "/v1/bots", headers: auth });
    const bots = list.json() as Array<{ name: string }>;
    expect(bots.length).toBeGreaterThanOrEqual(1);
    expect(bots[0].name).toBe("Botifyr");
    await app.close();
  });

  it("creates, renames, and deletes a bot", async () => {
    const { app, auth } = await authed();
    const created = await app.inject({
      method: "POST",
      url: "/v1/bots",
      headers: auth,
      payload: { name: "Alpha" },
    });
    expect(created.statusCode).toBe(201);
    const bot = created.json() as { id: string; name: string };
    expect(bot.name).toBe("Alpha");

    const renamed = await app.inject({
      method: "PUT",
      url: `/v1/bots/${bot.id}`,
      headers: auth,
      payload: { name: "Beta" },
    });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.json() as { name: string }).name).toBe("Beta");

    const blank = await app.inject({
      method: "POST",
      url: "/v1/bots",
      headers: auth,
      payload: { name: "   " },
    });
    expect(blank.statusCode).toBe(400);

    const removed = await app.inject({ method: "DELETE", url: `/v1/bots/${bot.id}`, headers: auth });
    expect(removed.statusCode).toBe(204);

    // Deleting an already-gone bot is idempotent: a stale client must be able
    // to drop the row instead of seeing "bot not found".
    const again = await app.inject({ method: "DELETE", url: `/v1/bots/${bot.id}`, headers: auth });
    expect(again.statusCode).toBe(204);
    await app.close();
  });

  it("keeps only owned individual bots as group members", async () => {
    const { app, auth } = await authed();
    const a = await create(app, auth, { name: "A" });
    const b = await create(app, auth, { name: "B" });
    const group = await create(app, auth, { name: "G", memberIds: [a.id, b.id, "ghost"] });
    expect([...(group.memberIds ?? [])].sort()).toEqual([a.id, b.id].sort());
    await app.close();
  });

  it("stores a company/workspace label and can set or clear it", async () => {
    const { app, auth } = await authed();
    const inCompany = await create(app, auth, { name: "Ada", workspace: "Acme Robotics" });
    expect(inCompany.workspace).toBe("Acme Robotics");

    const personal = await create(app, auth, { name: "Solo" });
    expect(personal.workspace).toBeUndefined();

    const set = await app.inject({
      method: "PUT",
      url: `/v1/bots/${personal.id}`,
      headers: auth,
      payload: { workspace: "Acme Labs" },
    });
    expect((set.json() as { workspace?: string }).workspace).toBe("Acme Labs");

    const cleared = await app.inject({
      method: "PUT",
      url: `/v1/bots/${personal.id}`,
      headers: auth,
      payload: { workspace: "" },
    });
    expect((cleared.json() as { workspace?: string }).workspace).toBeUndefined();
    await app.close();
  });
});
