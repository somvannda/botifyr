import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store/memory.js";
import { createQuestTools } from "./quest-tools.js";

describe("company.propose", () => {
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

  it("proposes a quest with its roadmap as work items", async () => {
    const store = await seeded();
    const [tool] = createQuestTools(store, "u1", "ceo");
    expect(tool!.requiresApproval).toBe(false);

    const result = await tool!.run(
      { title: "Launch the MVP", objective: "Ship a working MVP", acceptance: ["works"] },
      ctx,
    );
    expect(result.ok).toBe(true);

    const quests = await store.listQuests("ws1");
    expect(quests).toHaveLength(1);
    expect(quests[0]?.status).toBe("proposed");
    expect(quests[0]?.title).toBe("Launch the MVP");
    expect(quests[0]?.acceptance).toContain("works");
    expect((await store.listWorkItems("ws1")).length).toBeGreaterThan(0);
  });

  it("requires a title and objective", async () => {
    const store = await seeded();
    const [tool] = createQuestTools(store, "u1", "ceo");
    expect((await tool!.run({ title: "x" }, ctx)).ok).toBe(false);
    expect((await tool!.run({ title: "", objective: "y" }, ctx)).ok).toBe(false);
  });

  it("won't propose while a quest is active", async () => {
    const store = await seeded();
    const [tool] = createQuestTools(store, "u1", "ceo");
    await tool!.run({ title: "A", objective: "a" }, ctx);
    const proposed = (await store.listQuests("ws1"))[0]!;
    await store.updateQuest({ ...proposed, status: "active" });

    const blocked = await tool!.run({ title: "B", objective: "b" }, ctx);
    expect(blocked.ok).toBe(false);
  });
});
