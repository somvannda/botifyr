import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store/memory.js";
import { createDelegationTools } from "./delegation-tools.js";

describe("company.delegate", () => {
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
      botId: "cto",
      title: "CTO",
      department: "engineering",
      hiredAt: now,
    });
    return store;
  }

  it("assigns a task to the matching role", async () => {
    const store = await seeded();
    const [tool] = createDelegationTools(store, "u1", "ceo");
    const result = await tool!.run({ role: "CTO", task: "Build the API" }, ctx);
    expect(result.ok).toBe(true);
    const items = await store.listWorkItems("ws1");
    expect(items).toHaveLength(1);
    expect(items[0]?.assigneeBotId).toBe("cto");
    expect(items[0]?.title).toBe("Build the API");
  });

  it("reports the team when no role matches", async () => {
    const store = await seeded();
    const [tool] = createDelegationTools(store, "u1", "ceo");
    const result = await tool!.run({ role: "Astronaut", task: "Fly" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("CTO");
  });

  it("does not stack the same task twice on the board", async () => {
    const store = await seeded();
    const [tool] = createDelegationTools(store, "u1", "ceo");
    await tool!.run({ role: "CTO", task: "Build the API" }, ctx);
    await tool!.run({ role: "CTO", task: "build the api" }, ctx);
    const items = await store.listWorkItems("ws1");
    expect(items).toHaveLength(1);
  });
});
