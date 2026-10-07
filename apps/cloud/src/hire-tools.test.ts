import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store/memory.js";
import { createHireTools } from "./hire-tools.js";

describe("company.hire", () => {
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
    return store;
  }

  it("hires an employee with a role", async () => {
    const store = await seeded();
    const [tool] = createHireTools(store, "u1", "ceo");
    expect(tool!.requiresApproval).toBe(true);
    const result = await tool!.run({ title: "Head of Growth", department: "growth" }, ctx);
    expect(result.ok).toBe(true);
    const roles = await store.listBotRoles("ws1");
    expect(roles.some((role) => role.title === "Head of Growth" && role.department === "growth")).toBe(true);
    const bots = await store.listBots("u1");
    expect(bots.some((bot) => bot.workspace === "Acme" && bot.name === "Head of Growth")).toBe(true);
  });

  it("rejects a missing title", async () => {
    const store = await seeded();
    const [tool] = createHireTools(store, "u1", "ceo");
    const result = await tool!.run({}, ctx);
    expect(result.ok).toBe(false);
  });
});
