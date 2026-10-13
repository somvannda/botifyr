import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store/memory.js";
import { createDecisionTools } from "./decision-tools.js";

describe("company.decide", () => {
  const now = new Date().toISOString();
  const ctx = { workspaceDir: ".", log: () => {} };

  async function seeded() {
    const store = new MemoryStore();
    await store.createBot({
      id: "ceo",
      userId: "u1",
      name: "Maya",
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

  const decisions = async (store: MemoryStore) =>
    (await store.listWorkspaceFiles("ws1")).find((file) => file.name === "DECISIONS.md");

  it("records a decision (what, why, who) in the company wiki", async () => {
    const store = await seeded();
    const [tool] = createDecisionTools(store, "u1", "ceo");
    const result = await tool!.run(
      { decision: "Switch to a product-led motion", reasoning: "Trials convert better than demos", owner: "CEO" },
      ctx,
    );
    expect(result.ok).toBe(true);
    const file = await decisions(store);
    expect(file?.content).toContain("Switch to a product-led motion");
    expect(file?.content).toContain("Trials convert better");
    expect(file?.content).toContain("**Owner:** CEO");
  });

  it("appends to the log instead of replacing it", async () => {
    const store = await seeded();
    const [tool] = createDecisionTools(store, "u1", "ceo");
    await tool!.run({ decision: "First", reasoning: "one" }, ctx);
    await tool!.run({ decision: "Second", reasoning: "two" }, ctx);
    const file = await decisions(store);
    expect(file?.content).toContain("First");
    expect(file?.content).toContain("Second");
    expect(file?.content.startsWith("# Company Decisions")).toBe(true);
  });

  it("requires a decision and a reasoning", async () => {
    const store = await seeded();
    const [tool] = createDecisionTools(store, "u1", "ceo");
    expect((await tool!.run({ decision: "", reasoning: "" }, ctx)).ok).toBe(false);
    expect((await tool!.run({ decision: "x", reasoning: "" }, ctx)).ok).toBe(false);
  });

  it("refuses when the bot has no company", async () => {
    const store = new MemoryStore();
    await store.createBot({
      id: "solo",
      userId: "u1",
      name: "Solo",
      emoji: "🤖",
      scheme: 0,
      instructions: "",
      sessionId: "s1",
      createdAt: now,
    });
    const [tool] = createDecisionTools(store, "u1", "solo");
    const result = await tool!.run({ decision: "x", reasoning: "y" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/company/i);
  });
});
