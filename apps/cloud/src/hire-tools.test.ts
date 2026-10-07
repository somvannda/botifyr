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
    await store.setBotRole({
      workspaceId: "ws1",
      botId: "ceo",
      title: "CEO",
      department: "exec",
      isChair: true,
      hiredAt: now,
    });
    return store;
  }

  it("gives the hire a name and records the role", async () => {
    const store = await seeded();
    const [tool] = createHireTools(store, "u1", "ceo");
    expect(tool!.requiresApproval).toBe(true);
    const result = await tool!.run({ title: "Head of Growth", name: "Alex Rivera" }, ctx);
    expect(result.ok).toBe(true);
    const role = (await store.listBotRoles("ws1")).find((entry) => entry.title === "Head of Growth")!;
    expect((await store.getBot(role.botId))?.name).toBe("Alex Rivera");
  });

  it("requires a name", async () => {
    const store = await seeded();
    const [tool] = createHireTools(store, "u1", "ceo");
    const result = await tool!.run({ title: "Head of Sales" }, ctx);
    expect(result.ok).toBe(false);
    expect((await store.listBotRoles("ws1")).some((entry) => entry.title === "Head of Sales")).toBe(false);
  });

  it("won't hire a role that already exists", async () => {
    const store = await seeded();
    const [tool] = createHireTools(store, "u1", "ceo");
    await tool!.run({ title: "CTO", name: "A" }, ctx);
    const again = await tool!.run({ title: "cto", name: "B" }, ctx);
    expect(again.ok).toBe(false);
  });
});
