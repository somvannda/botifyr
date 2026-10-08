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

    // The board is seeded with ONE quest and its roadmap (docs/company-quests.md).
    const work = (
      await app.inject({ method: "GET", url: `/v1/workspaces/${ws.id}/work`, headers: auth })
    ).json() as Array<{ title: string; questId?: string }>;
    expect(work.length).toBeGreaterThan(0);
    expect(work.every((item) => Boolean(item.questId))).toBe(true);

    const quests = (
      await app.inject({ method: "GET", url: `/v1/workspaces/${ws.id}/quests`, headers: auth })
    ).json() as Array<{ id: string; status: string; workItemIds: string[] }>;
    expect(quests).toHaveLength(1);
    expect(quests[0]?.status).toBe("active");
    expect(quests[0]?.workItemIds.length).toBeGreaterThan(0);

    // The company wiki is workspace-scoped (readable by any employee).
    const wiki = (
      await app.inject({ method: "GET", url: `/v1/workspaces/${ws.id}/wiki`, headers: auth })
    ).json() as Array<{ name: string }>;
    expect(wiki.map((file) => file.name)).toContain("BRIEF.md");
    await app.close();
  });

  it("creates a company from a chosen direction with one quest", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws-direction@example.com");

    const created = await app.inject({
      method: "POST",
      url: "/v1/workspaces",
      headers: auth,
      payload: {
        name: "Chmaba",
        source: { kind: "url", value: "https://chmaba.example" },
        directionId: "dir_product",
        mission: "Cloud POS for Cambodia",
        dna: {
          industry: "Cloud POS",
          category: "B2B SaaS",
          summary: "POS for restaurants",
          businessModel: "SaaS",
          targetMarket: ["Cambodia"],
          targetCustomers: ["restaurants"],
          product: { type: "cloud_pos", features: ["POS", "inventory"], gaps: ["payments"] },
          stage: "mvp",
          goal: "Launch the cloud POS MVP",
          priorities: ["product"],
        },
        quest: {
          title: "Launch the cloud POS MVP",
          objective: "A working POS for the first 10 restaurants",
          acceptance: ["POS works", "10 restaurants onboarded"],
          roadmap: [
            { phase: "mvp", title: "Build the POS screen" },
            { phase: "mvp", title: "Add inventory" },
          ],
        },
        members: [{ name: "Sokha", emoji: "🧭", title: "CEO", department: "exec", isChair: true }],
      },
    });
    expect(created.statusCode).toBe(201);
    const ws = created.json() as { id: string; directionId?: string; activeQuestId?: string };
    expect(ws.directionId).toBe("dir_product");
    // The seeded quest is recorded as the active mission (regression: a later
    // stale workspace write used to wipe this).
    expect(ws.activeQuestId).toBeTruthy();

    const quests = (
      await app.inject({ method: "GET", url: `/v1/workspaces/${ws.id}/quests`, headers: auth })
    ).json() as Array<{
      id: string;
      title: string;
      directionId?: string;
      acceptance: string[];
      workItemIds: string[];
    }>;
    expect(quests).toHaveLength(1);
    expect(ws.activeQuestId).toBe(quests[0]?.id);
    expect(quests[0]?.title).toBe("Launch the cloud POS MVP");
    expect(quests[0]?.directionId).toBe("dir_product");
    expect(quests[0]?.acceptance).toContain("POS works");

    const work = (
      await app.inject({ method: "GET", url: `/v1/workspaces/${ws.id}/work`, headers: auth })
    ).json() as Array<{ title: string; questId?: string }>;
    expect(work.map((item) => item.title)).toEqual(["Build the POS screen", "Add inventory"]);
    expect(work.every((item) => item.questId === quests[0]?.id)).toBe(true);
    await app.close();
  });

  it("proposes, activates and completes quests with one active at a time", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws-quests@example.com");
    const ws = (
      await app.inject({
        method: "POST",
        url: "/v1/workspaces",
        headers: auth,
        payload: {
          name: "Quest Co",
          members: [{ name: "Ada", title: "CEO", department: "exec", isChair: true }],
        },
      })
    ).json() as { id: string };

    // Company creation seeds one active quest.
    const initial = (
      await app.inject({ method: "GET", url: `/v1/workspaces/${ws.id}/quests`, headers: auth })
    ).json() as Array<{ id: string; status: string }>;
    expect(initial).toHaveLength(1);
    expect(initial[0]?.status).toBe("active");

    // A new quest is proposed, not activated.
    const proposed = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${ws.id}/quests`,
      headers: auth,
      payload: { title: "Improve onboarding", objective: "Cut time-to-value", acceptance: ["NPS up"] },
    });
    expect(proposed.statusCode).toBe(201);
    const second = proposed.json() as { id: string; status: string };
    expect(second.status).toBe("proposed");

    // A second active quest is refused.
    const conflict = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${ws.id}/quests`,
      headers: auth,
      payload: { title: "Third", objective: "x", activate: true },
    });
    expect(conflict.statusCode).toBe(409);

    // Complete the first, then activate the second.
    const done = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${ws.id}/quests/${initial[0]!.id}/complete`,
      headers: auth,
    });
    expect(done.statusCode).toBe(200);
    expect((done.json() as { status: string }).status).toBe("done");

    const activated = await app.inject({
      method: "PATCH",
      url: `/v1/quests/${second.id}`,
      headers: auth,
      payload: { status: "active", trust: "supervised", budgetTokens: 100000 },
    });
    expect(activated.statusCode).toBe(200);
    const active = activated.json() as { status: string; trust: string; budgetTokens?: number };
    expect(active.status).toBe("active");
    expect(active.trust).toBe("supervised");
    expect(active.budgetTokens).toBe(100000);

    const wsView = (
      await app.inject({ method: "GET", url: `/v1/workspaces/${ws.id}`, headers: auth })
    ).json() as { activeQuestId?: string };
    expect(wsView.activeQuestId).toBe(second.id);
    await app.close();
  });

  it("records and clears a work item outcome", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws-result@example.com");
    const ws = (
      await app.inject({
        method: "POST",
        url: "/v1/workspaces",
        headers: auth,
        payload: {
          name: "Result Co",
          members: [{ name: "Ada", title: "CEO", department: "exec", isChair: true }],
        },
      })
    ).json() as { id: string };

    const created = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${ws.id}/work`,
      headers: auth,
      payload: { title: "Write the spec", result: "spec.md shipped" },
    });
    expect(created.statusCode).toBe(201);
    const item = created.json() as { id: string; result?: string };
    expect(item.result).toBe("spec.md shipped");

    const patched = await app.inject({
      method: "PATCH",
      url: `/v1/work/${item.id}`,
      headers: auth,
      payload: { result: "spec.md v2" },
    });
    expect((patched.json() as { result?: string }).result).toBe("spec.md v2");

    const cleared = await app.inject({
      method: "PATCH",
      url: `/v1/work/${item.id}`,
      headers: auth,
      payload: { result: null },
    });
    expect((cleared.json() as { result?: string }).result).toBeUndefined();
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
    const plan = planned.json() as {
      name: string;
      members: Array<{ isChair?: boolean }>;
      directions: Array<{ id: string; roles: string[] }>;
    };
    expect(plan.name.length).toBeGreaterThan(0);
    expect(plan.members.length).toBeGreaterThan(0);
    expect(plan.members.filter((member) => member.isChair)).toHaveLength(1);
    // The planner offers directions to choose from (docs/company-quests.md).
    expect(plan.directions).toHaveLength(3);
    expect(plan.directions[0]?.roles[0]).toBe("exec.ceo");

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

    // Promote the capability up the trust ladder (docs/product-plan.md §3).
    const promoted = await app.inject({
      method: "PUT",
      url: `/v1/workspaces/${ws.id}/grants`,
      headers: auth,
      payload: { subject: "role:CTO", capability: "deploy.production", granted: true, state: "trusted" },
    });
    expect(promoted.statusCode).toBe(200);
    expect((promoted.json() as { state?: string }).state).toBe("trusted");
    const afterPromote = (
      await app.inject({ method: "GET", url: `/v1/workspaces/${ws.id}/grants`, headers: auth })
    ).json() as Array<{ capability: string; state?: string }>;
    expect(afterPromote.find((entry) => entry.capability === "deploy.production")?.state).toBe("trusted");

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
      payload: { level: "autonomous", timezone: "Asia/Phnom_Penh" },
    });
    expect(activated.statusCode).toBe(200);
    const activatedBody = activated.json() as {
      autonomy: string;
      operatingHours?: { start: number; end: number; timezone?: string };
    };
    expect(activatedBody.autonomy).toBe("autonomous");
    // Defaults to a 9–5 working day in the owner's timezone.
    expect(activatedBody.operatingHours).toEqual({
      start: 9,
      end: 17,
      timezone: "Asia/Phnom_Penh",
    });

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

  it("attaches an existing bot to a company", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws-add@example.com");
    const ws = (
      await app.inject({ method: "POST", url: "/v1/workspaces", headers: auth, payload: { name: "Add Co" } })
    ).json() as { id: string };
    const bot = (
      await app.inject({ method: "POST", url: "/v1/bots", headers: auth, payload: { name: "Solo" } })
    ).json() as { id: string };

    const res = await app.inject({
      method: "POST",
      url: `/v1/workspaces/${ws.id}/members`,
      headers: auth,
      payload: { botId: bot.id, title: "Ops Lead", department: "ops" },
    });
    expect(res.statusCode).toBe(200);
    const roles = (res.json() as { roles: Array<{ botId: string; title: string }> }).roles;
    expect(roles.some((role) => role.botId === bot.id && role.title === "Ops Lead")).toBe(true);

    const bots = (await app.inject({ method: "GET", url: "/v1/bots", headers: auth })).json() as Array<{
      id: string;
      workspace?: string;
    }>;
    expect(bots.find((entry) => entry.id === bot.id)?.workspace).toBe("Add Co");
    await app.close();
  });

  it("promotes a founder bot to CEO when requested", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws-ceo@example.com");
    const founder = (
      await app.inject({ method: "POST", url: "/v1/bots", headers: auth, payload: { name: "Founder" } })
    ).json() as { id: string };

    const ws = (
      await app.inject({
        method: "POST",
        url: "/v1/workspaces",
        headers: auth,
        payload: {
          name: "Founder Co",
          ceoBotId: founder.id,
          members: [
            { name: "Ada", title: "CEO", department: "exec", isChair: true },
            { name: "Dev", title: "CTO", department: "engineering" },
          ],
        },
      })
    ).json() as { id: string; ceoBotId?: string; roles: Array<{ botId: string; isChair?: boolean }> };

    expect(ws.ceoBotId).toBe(founder.id);
    expect(ws.roles.some((role) => role.botId === founder.id && role.isChair === true)).toBe(true);

    const bots = (await app.inject({ method: "GET", url: "/v1/bots", headers: auth })).json() as Array<{
      id: string;
      workspace?: string;
    }>;
    expect(bots.find((entry) => entry.id === founder.id)?.workspace).toBe("Founder Co");
    await app.close();
  });

  it("keeps company names unique per owner", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws-unique@example.com");

    const first = (
      await app.inject({ method: "POST", url: "/v1/workspaces", headers: auth, payload: { name: "Chmaba" } })
    ).json() as { id: string; name: string };
    const second = (
      await app.inject({ method: "POST", url: "/v1/workspaces", headers: auth, payload: { name: "Chmaba" } })
    ).json() as { id: string; name: string };

    expect(first.name).toBe("Chmaba");
    // A second company with the same name is suffixed, not merged.
    expect(second.name).toBe("Chmaba 2");
    expect(second.id).not.toBe(first.id);

    // Another owner may still use the un-suffixed name (scoped per owner).
    const other = await signup("ws-unique2@example.com");
    const otherFirst = (
      await app.inject({ method: "POST", url: "/v1/workspaces", headers: other, payload: { name: "Chmaba" } })
    ).json() as { name: string };
    expect(otherFirst.name).toBe("Chmaba");
    await app.close();
  });

  it("keeps the name unique when renaming a company", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws-rename@example.com");
    await app.inject({ method: "POST", url: "/v1/workspaces", headers: auth, payload: { name: "One" } });
    const two = (
      await app.inject({ method: "POST", url: "/v1/workspaces", headers: auth, payload: { name: "Two" } })
    ).json() as { id: string };

    const renamed = await app.inject({
      method: "PATCH",
      url: `/v1/workspaces/${two.id}`,
      headers: auth,
      payload: { name: "One" },
    });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.json() as { name: string }).name).toBe("One 2");

    // Renaming a company to its own current name is a no-op (not suffixed).
    const same = await app.inject({
      method: "PATCH",
      url: `/v1/workspaces/${two.id}`,
      headers: auth,
      payload: { name: "One 2" },
    });
    expect((same.json() as { name: string }).name).toBe("One 2");
    await app.close();
  });

  it("rejects repo paths outside the allowed roots", async () => {
    const { app, signup } = await boot();
    const auth = await signup("ws-repos@example.com");
    const ws = (
      await app.inject({ method: "POST", url: "/v1/workspaces", headers: auth, payload: { name: "Repo Co" } })
    ).json() as { id: string };

    const bad = await app.inject({
      method: "PATCH",
      url: `/v1/workspaces/${ws.id}`,
      headers: auth,
      payload: { repos: [{ name: "etc", path: "/etc" }] },
    });
    expect(bad.statusCode).toBe(400);

    const good = await app.inject({
      method: "PATCH",
      url: `/v1/workspaces/${ws.id}`,
      headers: auth,
      payload: { repos: [{ name: "app", path: "/repos/app" }] },
    });
    expect(good.statusCode).toBe(200);
    expect((good.json() as { repos: Array<{ path: string }> }).repos[0]?.path).toBe("/repos/app");
    await app.close();
  });
});
