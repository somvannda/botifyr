import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store/memory.js";
import { createFileTools } from "./files-tools.js";

describe("library tools (company workspace-aware)", () => {
  const now = new Date().toISOString();
  const ctx = { workspaceDir: ".", log: () => {} };

  async function seeded() {
    const store = new MemoryStore();
    await store.createBot({
      id: "chair",
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
    // The chair writes the plan to the shared wiki.
    await store.upsertFile({
      id: "f1",
      botId: "chair",
      userId: "u1",
      workspaceId: "ws1",
      name: "PLAN.md",
      content: "# Plan",
      createdAt: now,
      updatedAt: now,
    });
    return store;
  }

  it("lets an employee read a teammate's wiki file", async () => {
    const store = await seeded();
    const tools = createFileTools(store, "cto", "u1");
    const listed = await tools.find((tool) => tool.name === "library.list")!.run({}, ctx);
    expect(listed.ok).toBe(true);
    expect(listed.output).toContain("PLAN.md");

    const plan = await tools.find((tool) => tool.name === "library.read")!.run({ name: "PLAN.md" }, ctx);
    expect(plan.ok).toBe(true);
    expect(plan.output).toBe("# Plan");
  });

  it("writes company files to the shared wiki", async () => {
    const store = await seeded();
    const write = createFileTools(store, "cto", "u1").find((tool) => tool.name === "library.write")!;
    await write.run({ name: "NOTES.md", content: "hello" }, ctx);
    const wiki = await store.listWorkspaceFiles("ws1");
    expect(wiki.find((file) => file.name === "NOTES.md")?.content).toBe("hello");
  });
});
