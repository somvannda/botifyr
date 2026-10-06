import { afterEach, describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { buildServer } from "./server.js";
import { MemoryStore } from "./store/memory.js";

/** Admin billing: only admins may read/write policy and model pricing. */
describe("admin billing", () => {
  const saved = process.env.BOTIFYR_ADMIN_EMAILS;
  afterEach(() => {
    if (saved === undefined) delete process.env.BOTIFYR_ADMIN_EMAILS;
    else process.env.BOTIFYR_ADMIN_EMAILS = saved;
  });

  async function setup(email: string) {
    process.env.BOTIFYR_ADMIN_EMAILS = "admin@example.com";
    const app = await buildServer({
      store: new MemoryStore(),
      vaultKey: Buffer.alloc(32),
      localChannel: createLocalChannel(),
    });
    await app.ready();
    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email, password: "password123" },
    });
    const { token } = signup.json() as { token: string };
    return { app, auth: { authorization: `Bearer ${token}` } };
  }

  it("lets an admin read and edit settings and model pricing", async () => {
    const { app, auth } = await setup("admin@example.com");

    const before = await app.inject({ method: "GET", url: "/admin/settings", headers: auth });
    expect(before.statusCode).toBe(200);
    expect((before.json() as { freeMonthlyTokens: number }).freeMonthlyTokens).toBe(20000);

    const updated = await app.inject({
      method: "PUT",
      url: "/admin/settings",
      headers: auth,
      payload: { freeMonthlyTokens: 999, graceDays: 3 },
    });
    expect(updated.statusCode).toBe(200);
    const body = updated.json() as { freeMonthlyTokens: number; graceDays: number };
    expect(body.freeMonthlyTokens).toBe(999);
    expect(body.graceDays).toBe(3);

    const put = await app.inject({
      method: "PUT",
      url: "/admin/model-pricing/gpt-x",
      headers: auth,
      payload: { provider: "openai", inputCentsPerM: 100, outputCentsPerM: 200, markupPercent: 20 },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { model: string }).model).toBe("gpt-x");

    const list = await app.inject({ method: "GET", url: "/admin/model-pricing", headers: auth });
    expect(list.json()).toHaveLength(1);

    const removed = await app.inject({ method: "DELETE", url: "/admin/model-pricing/gpt-x", headers: auth });
    expect(removed.statusCode).toBe(204);
    await app.close();
  });

  it("refuses a non-admin", async () => {
    const { app, auth } = await setup("user@example.com");
    const response = await app.inject({ method: "GET", url: "/admin/settings", headers: auth });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
