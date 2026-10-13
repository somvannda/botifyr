import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store/memory.js";
import { createCrmTools } from "./crm-tools.js";

describe("crm.log_activity", () => {
  const now = new Date().toISOString();
  const ctx = { workspaceDir: ".", log: () => {} };

  async function seeded() {
    const store = new MemoryStore();
    await store.createBot({
      id: "rep",
      userId: "u1",
      name: "Sam",
      emoji: "💬",
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

  const crm = (store: MemoryStore) => createCrmTools(store, "u1", "rep")[0]!;

  it("logs an interaction to a per-lead file", async () => {
    const store = await seeded();
    const result = await crm(store).run(
      { lead: "Acme Corp", activity: "sent intro email", outcome: "awaiting reply", nextStep: "follow up in 3 days" },
      ctx,
    );
    expect(result.ok).toBe(true);
    const file = (await store.listWorkspaceFiles("ws1")).find((entry) => entry.name === "CRM-acme-corp.md");
    expect(file?.content).toContain("sent intro email");
    expect(file?.content).toContain("follow up in 3 days");
  });

  it("appends to the same lead's history instead of replacing it", async () => {
    const store = await seeded();
    await crm(store).run({ lead: "Acme Corp", activity: "call", outcome: "interested" }, ctx);
    await crm(store).run({ lead: "Acme Corp", activity: "sent proposal", outcome: "awaiting reply" }, ctx);
    const files = (await store.listWorkspaceFiles("ws1")).filter((entry) => entry.name === "CRM-acme-corp.md");
    expect(files).toHaveLength(1);
    expect(files[0]?.content).toContain("call");
    expect(files[0]?.content).toContain("sent proposal");
  });

  it("keeps different leads in different files", async () => {
    const store = await seeded();
    await crm(store).run({ lead: "Acme Corp", activity: "a", outcome: "b" }, ctx);
    await crm(store).run({ lead: "Beta LLC", activity: "a", outcome: "b" }, ctx);
    const names = (await store.listWorkspaceFiles("ws1")).map((entry) => entry.name).sort();
    expect(names).toEqual(["CRM-acme-corp.md", "CRM-beta-llc.md"]);
  });

  it("requires lead, activity and outcome", async () => {
    const store = await seeded();
    expect((await crm(store).run({ lead: "", activity: "a", outcome: "b" }, ctx)).ok).toBe(false);
    expect((await crm(store).run({ lead: "A", activity: "", outcome: "b" }, ctx)).ok).toBe(false);
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
    const result = await createCrmTools(store, "u1", "solo")[0]!.run(
      { lead: "A", activity: "a", outcome: "b" },
      ctx,
    );
    expect(result.ok).toBe(false);
  });
});
