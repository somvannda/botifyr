import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store/memory.js";
import { createPlanTools } from "./plan-tools.js";

describe("company.plan", () => {
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

  it("saves a plan to the company wiki", async () => {
    const store = await seeded();
    const [tool] = createPlanTools(store, "u1", "ceo");
    const result = await tool!.run(
      { goal: "Grow sales", plan: "ICP: cafés. Channels: outbound + social. Metric: 100 merchants." },
      ctx,
    );
    expect(result.ok).toBe(true);
    const files = await store.listWorkspaceFiles("ws1");
    const plan = files.find((file) => file.name === "PLAN.md");
    expect(plan?.content).toContain("Grow sales");
    expect(plan?.content).toContain("outbound");
  });

  it("requires a goal and a plan", async () => {
    const store = await seeded();
    const [tool] = createPlanTools(store, "u1", "ceo");
    const result = await tool!.run({ goal: "", plan: "" }, ctx);
    expect(result.ok).toBe(false);
  });
});
