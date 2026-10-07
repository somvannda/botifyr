import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

/** Company workspaces: entity, employee roles, and ownership scoping. */
describe("workspaces API", () => {
  async function boot() {
    const app = await buildServer({
      store: new MemoryStore(),
      vaultKey: Buffer.alloc(32),
      localChannel: createLocalChannel(),
    });
    await app.ready();
    const signup = async (email: string) => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/signup",
        payload: { email, password: "password123" },
      });
      const { token } = res.json() as { token: string };
      return { authorization: `Bearer ${token}` };
    };
    return { app, signup };
  }

  it("creates a company with employee bots and roles", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws1@example.com");

    const created = await app.inject({
      method: "POST",
      url: "/v1/workspaces",
      headers: auth,
      payload: {
        name: "Acme Robotics",
        source: { kind: "url", value: "https://acme.example" },
        mission: "Build robots",
        members: [
          { name: "Ada", emoji: "🛠️", title: "CTO", department: "engineering", isChair: true },
          { name: "Grace", title: "Head of Growth", department: "growth" },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const ws = created.json() as {
      id: string;
      name: string;
      source: { kind: string; value: string };
      ceoBotId?: string;
      roles: Array<{ title: string; department: string }>;
    };
    expect(ws.name).toBe("Acme Robotics");
    expect(ws.source).toEqual({ kind: "url", value: "https://acme.example" });
    expect(ws.roles.map((role) => role.title).sort()).toEqual(["CTO", "Head of Growth"]);
    expect(ws.ceoBotId).toBeDefined();

    // Employee bots carry the company name as their sidebar label.
    const bots = (await app.inject({ method: "GET", url: "/v1/bots", headers: auth })).json() as Array<{
      name: string;
      workspace?: string;
    }>;
    expect(bots.find((bot) => bot.name === "Ada")?.workspace).toBe("Acme Robotics");

    const list = (await app.inject({ method: "GET", url: "/v1/workspaces", headers: auth })).json() as Array<{
      id: string;
    }>;
    expect(list.map((entry) => entry.id)).toContain(ws.id);

    // The company wiki is seeded on the chair bot.
    const files = (
      await app.inject({ method: "GET", url: `/v1/bots/${ws.ceoBotId}/files`, headers: auth })
    ).json() as Array<{ name: string }>;
    expect(files.map((file) => file.name)).toEqual(
      expect.arrayContaining(["BRIEF.md", "OKRS.md", "BACKLOG.md"]),
    );

    // The board is seeded with first work items.
    const work = (
      await app.inject({ method: "GET", url: `/v1/workspaces/${ws.id}/work`, headers: auth })
    ).json() as Array<{ title: string; phase: string }>;
    expect(work.length).toBeGreaterThan(0);
    expect(work.some((item) => item.title === "Build the marketing website")).toBe(true);

    // The company wiki is workspace-scoped (readable by any employee).
    const wiki = (
      await app.inject({ method: "GET", url: `/v1/workspaces/${ws.id}/wiki`, headers: auth })
    ).json() as Array<{ name: string }>;
    expect(wiki.map((file) => file.name)).toContain("BRIEF.md");
    await app.close();
  });

  it("attaches existing bots and rejects a blank name", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws2@example.com");

    const bot = (
      await app.inject({ method: "POST", url: "/v1/bots", headers: auth, payload: { name: "Solo" } })
    ).json() as { id: string };

    const created = await app.inject({
      method: "POST",
      url: "/v1/workspaces",
      headers: auth,
      payload: {
        name: "Acme Labs",
        memberships: [{ botId: bot.id, title: "Finance", department: "finance" }],
      },
    });
    expect(created.statusCode).toBe(201);
    const ws = created.json() as { roles: Array<{ botId: string; title: string }> };
    expect(ws.roles.some((role) => role.botId === bot.id && role.title === "Finance")).toBe(true);

    // The attached bot is labelled with the company (so it groups + can delegate).
    const bots = (await app.inject({ method: "GET", url: "/v1/bots", headers: auth })).json() as Array<{
      id: string;
      workspace?: string;
    }>;
    expect(bots.find((entry) => entry.id === bot.id)?.workspace).toBe("Acme Labs");

    const blank = await app.inject({
      method: "POST",
      url: "/v1/workspaces",
      headers: auth,
      payload: { name: "   " },
    });
    expect(blank.statusCode).toBe(400);
    await app.close();
  });

  it("renames, pauses, and deletes a workspace", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws3@example.com");
    const ws = (
      await app.inject({ method: "POST", url: "/v1/workspaces", headers: auth, payload: { name: "Alpha" } })
    ).json() as { id: string };

    const patched = await app.inject({
      method: "PATCH",
      url: `/v1/workspaces/${ws.id}`,
      headers: auth,
      payload: { name: "Beta", status: "paused" },
    });
    expect(patched.statusCode).toBe(200);
    const body = patched.json() as { name: string; status: string };
    expect(body.name).toBe("Beta");
    expect(body.status).toBe("paused");

    const removed = await app.inject({ method: "DELETE", url: `/v1/workspaces/${ws.id}`, headers: auth });
    expect(removed.statusCode).toBe(204);
    const gone = await app.inject({ method: "GET", url: `/v1/workspaces/${ws.id}`, headers: auth });
    expect(gone.statusCode).toBe(404);
    await app.close();
  });

  it("keeps employee labels in sync when a company is renamed", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws-rename@example.com");
    const created = await app.inject({
      method: "POST",
      url: "/v1/workspaces",
      headers: auth,
      payload: { name: "Old Co", members: [{ name: "Ada", title: "CTO", isChair: true }] },
    });
    const ws = created.json() as { id: string };

    const patched = await app.inject({
      method: "PATCH",
      url: `/v1/workspaces/${ws.id}`,
      headers: auth,
      payload: { name: "New Co" },
    });
    expect(patched.statusCode).toBe(200);

    const bots = (await app.inject({ method: "GET", url: "/v1/bots", headers: auth })).json() as Array<{
      name: string;
      workspace?: string;
    }>;
    expect(bots.find((bot) => bot.name === "Ada")?.workspace).toBe("New Co");
    await app.close();
  });

  it("keeps workspaces scoped to their owner", async () => {
    const { app, signup } = await boot();
    const owner = await signup("ws-owner@example.com");
    const other = await signup("ws-other@example.com");
    const ws = (
      await app.inject({
        method: "POST",
        url: "/v1/workspaces",
        headers: owner,
        payload: { name: "Secret Co" },
      })
    ).json() as { id: string };

    const found = await app.inject({ method: "GET", url: `/v1/workspaces/${ws.id}`, headers: other });
    expect(found.statusCode).toBe(404);
    const list = (
      await app.inject({ method: "GET", url: "/v1/workspaces", headers: other })
    ).json() as unknown[];
    expect(list).toHaveLength(0);
    await app.close();
  });

  it("plans an org chart from a website or idea", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws-plan@example.com");

    const planned = await app.inject({
      method: "POST",
      url: "/v1/workspaces/plan",
      headers: auth,
      payload: { source: { kind: "idea", value: "a subscription box for house plants" } },
    });
    expect(planned.statusCode).toBe(200);
    const plan = planned.json() as { name: string; members: Array<{ isChair?: boolean }> };
    expect(plan.name.length).toBeGreaterThan(0);
    expect(plan.members.length).toBeGreaterThan(0);
    expect(plan.members.filter((member) => member.isChair)).toHaveLength(1);

    const blank = await app.inject({
      method: "POST",
      url: "/v1/workspaces/plan",
      headers: auth,
      payload: { source: { value: "" } },
    });
    expect(blank.statusCode).toBe(400);
    await app.close();
  });

  it("stores a per-workspace budget", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws-budget@example.com");
    const ws = (
      await app.inject({ method: "POST", url: "/v1/workspaces", headers: auth, payload: { name: "Budget Co" } })
    ).json() as { id: string };

    const before = (
      await app.inject({ method: "GET", url: `/v1/workspaces/${ws.id}/budget`, headers: auth })
    ).json() as { limitTokens: number };
    expect(before.limitTokens).toBe(0);

    const set = await app.inject({
      method: "PATCH",
      url: `/v1/workspaces/${ws.id}/budget`,
      headers: auth,
      payload: { limitTokens: 500000 },
    });
    expect((set.json() as { limitTokens: number }).limitTokens).toBe(500000);

    const after = (
      await app.inject({ method: "GET", url: `/v1/workspaces/${ws.id}/budget`, headers: auth })
    ).json() as { limitTokens: number };
    expect(after.limitTokens).toBe(500000);
    await app.close();
  });

  it("sets and lists capability grants", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws-grant@example.com");
    const ws = (
      await app.inject({ method: "POST", url: "/v1/workspaces", headers: auth, payload: { name: "Grant Co" } })
    ).json() as { id: string };

    const empty = (
      await app.inject({ method: "GET", url: `/v1/workspaces/${ws.id}/grants`, headers: auth })
    ).json() as unknown[];
    expect(empty).toHaveLength(0);

    const set = await app.inject({
      method: "PUT",
      url: `/v1/workspaces/${ws.id}/grants`,
      headers: auth,
      payload: { subject: "role:CTO", capability: "deploy.production", granted: true },
    });
    expect(set.statusCode).toBe(200);

    const list = (
      await app.inject({ method: "GET", url: `/v1/workspaces/${ws.id}/grants`, headers: auth })
    ).json() as Array<{ capability: string; granted: boolean }>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ capability: "deploy.production", granted: true });

    const bad = await app.inject({
      method: "PUT",
      url: `/v1/workspaces/${ws.id}/grants`,
      headers: auth,
      payload: { subject: "role:CTO" },
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it("records a standup report", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws-standup@example.com");
    const ws = (
      await app.inject({ method: "POST", url: "/v1/workspaces", headers: auth, payload: { name: "Standup Co" } })
    ).json() as { id: string };

    const report = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${ws.id}/standup`,
      headers: auth,
    });
    expect(report.statusCode).toBe(201);
    expect((report.json() as { summary: string }).summary).toContain("Standup");

    const list = (
      await app.inject({ method: "GET", url: `/v1/workspaces/${ws.id}/reports`, headers: auth })
    ).json() as Array<{ kind: string }>;
    expect(list.some((entry) => entry.kind === "standup")).toBe(true);
    await app.close();
  });

  it("stops a company's running tasks (none running → 0)", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws-stop@example.com");
    const ws = (
      await app.inject({ method: "POST", url: "/v1/workspaces", headers: auth, payload: { name: "Stop Co" } })
    ).json() as { id: string };
    const res = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${ws.id}/stop`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { stopped: number }).stopped).toBe(0);
    await app.close();
  });

  it("activates and deactivates a company", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws-autonomy@example.com");
    const ws = (
      await app.inject({
        method: "POST",
        url: "/v1/workspaces",
        headers: auth,
        payload: {
          name: "Auto Co",
          members: [
            { name: "Ada", title: "CEO", department: "exec", isChair: true },
            { name: "Dev", title: "CTO", department: "engineering" },
          ],
        },
      })
    ).json() as { id: string; ceoBotId: string };

    const activated = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${ws.id}/activate`,
      headers: auth,
      payload: { level: "autonomous" },
    });
    expect(activated.statusCode).toBe(200);
    expect((activated.json() as { autonomy: string }).autonomy).toBe("autonomous");

    const bots = (
      await app.inject({ method: "GET", url: "/v1/bots", headers: auth })
    ).json() as Array<{ id: string; schedule?: unknown; autoApprove?: boolean }>;
    const ada = bots.find((bot) => bot.id === ws.ceoBotId)!;
    expect(ada.schedule).toBeDefined();
    expect(ada.autoApprove).toBe(true);

    const deactivated = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${ws.id}/deactivate`,
      headers: auth,
    });
    expect((deactivated.json() as { autonomy: string }).autonomy).toBe("manual");
    const after = (
      await app.inject({ method: "GET", url: "/v1/bots", headers: auth })
    ).json() as Array<{ id: string; schedule?: unknown; autoApprove?: boolean }>;
    const ada2 = after.find((bot) => bot.id === ws.ceoBotId)!;
    expect(ada2.schedule).toBeUndefined();
    expect(ada2.autoApprove).toBeFalsy();
    await app.close();
  });

  it("stores company secrets (separate from personal)", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws-secret@example.com");
    const ws = (
      await app.inject({ method: "POST", url: "/v1/workspaces", headers: auth, payload: { name: "Secret Co" } })
    ).json() as { id: string };

    const created = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${ws.id}/secrets`,
      headers: auth,
      payload: { name: "STRIPE_KEY", value: "sk_test_123" },
    });
    expect(created.statusCode).toBe(201);

    const company = (
      await app.inject({ method: "GET", url: `/v1/workspaces/${ws.id}/secrets`, headers: auth })
    ).json() as Array<{ name: string }>;
    expect(company.map((secret) => secret.name)).toContain("STRIPE_KEY");

    const personal = (await app.inject({ method: "GET", url: "/v1/secrets", headers: auth })).json() as Array<{
      name: string;
    }>;
    expect(personal.map((secret) => secret.name)).not.toContain("STRIPE_KEY");
    await app.close();
  });
});
