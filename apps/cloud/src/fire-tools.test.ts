import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store/memory.js";
import { createFireTools } from "./fire-tools.js";

describe("company.fire", () => {
  const now = new Date().toISOString();
  const ctx = { workspaceDir: ".", log: () => {} };

  async function seeded() {
    const store = new MemoryStore();
    await store.createBot({
      id: "ceo",
      userId: "u1",
      name: "Boss",
      emoji: "🧭",
      scheme: 0,
      instructions: "",
      workspace: "Acme",
      sessionId: "s0",
      createdAt: now,
    });
    await store.createBot({
      id: "cto",
      userId: "u1",
      name: "Dev",
      emoji: "💻",
      scheme: 1,
      instructions: "",
      workspace: "Acme",
      sessionId: "s1",
      createdAt: now,
    });
    await store.createWorkspace({
      id: "ws1",
      ownerId: "u1",
      name: "Acme",
      source: { kind: "idea", value: "" },
      mission: "",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await store.setBotRole({
      workspaceId: "ws1",
      botId: "ceo",
      title: "CEO",
      department: "exec",
      isChair: true,
      hiredAt: now,
    });
    await store.setBotRole({
      workspaceId: "ws1",
      botId: "cto",
      title: "CTO",
      department: "engineering",
      hiredAt: now,
    });
    return store;
  }

  it("fires an employee by role and removes their bot + role", async () => {
    const store = await seeded();
    const [tool] = createFireTools(store, "u1", "ceo");
    expect(tool!.requiresApproval).toBe(true);
    const result = await tool!.run({ role: "CTO" }, ctx);
    expect(result.ok).toBe(true);
    expect(await store.getBot("cto")).toBeNull();
    expect((await store.listBotRoles("ws1")).map((role) => role.title)).toEqual(["CEO"]);
  });

  it("refuses to fire the chair", async () => {
    const store = await seeded();
    const [tool] = createFireTools(store, "u1", "ceo");
    const result = await tool!.run({ role: "CEO" }, ctx);
    expect(result.ok).toBe(false);
    expect(await store.getBot("ceo")).not.toBeNull();
  });

  it("reports the team when nothing matches", async () => {
    const store = await seeded();
    const [tool] = createFireTools(store, "u1", "ceo");
    const result = await tool!.run({ role: "Astronaut" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("CTO");
  });
});
