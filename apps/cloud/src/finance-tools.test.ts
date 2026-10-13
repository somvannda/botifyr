import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store/memory.js";
import { createFinanceTools } from "./finance-tools.js";

describe("finance.ledger", () => {
  const now = new Date().toISOString();
  const ctx = { workspaceDir: ".", log: () => {} };

  async function seeded() {
    const store = new MemoryStore();
    await store.createBot({
      id: "fin",
      userId: "u1",
      name: "Ada",
      emoji: "📊",
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
    await store.saveWorkspaceBudget({
      workspaceId: "ws1",
      limitTokens: 100_000,
      usedTokens: 12_345,
      updatedAt: now,
    });
    await store.addUsage({
      id: "us1",
      userId: "u1",
      taskId: "t1",
      promptTokens: 1000,
      completionTokens: 500,
      createdAt: now,
    });
    await store.addLedger({
      id: "l1",
      userId: "u1",
      kind: "usage",
      amountCents: -5,
      tokens: 1500,
      model: "deepseek-chat",
      note: "task-1",
      createdAt: now,
    });
    return store;
  }

  const finance = (store: MemoryStore) => createFinanceTools(store, "u1", "fin")[0]!;

  it("reports usage, the workspace budget, the wallet and recent charges", async () => {
    const store = await seeded();
    const result = await finance(store).run({ period: "last_30_days" }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("1,500"); // tokens used
    expect(result.output).toContain("12,345"); // budget used
    expect(result.output).toContain("100,000"); // budget limit
    expect(result.output).toContain("-$0.05"); // a usage debit, shown with a sign
    expect(result.output).toContain("task-1");
  });

  it("defaults the period and still returns numbers", async () => {
    const store = await seeded();
    const result = await finance(store).run({}, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("last_30_days");
    expect(result.output).toContain("Wallet balance");
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
    const result = await createFinanceTools(store, "u1", "solo")[0]!.run({}, ctx);
    expect(result.ok).toBe(false);
  });
});
