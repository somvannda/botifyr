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

describe("company.report", () => {
  const now = new Date().toISOString();
  const ctx = { workspaceDir: ".", log: () => {} };

  async function seeded() {
    const store = new MemoryStore();
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
    await store.createWorkItem({
      id: "w1",
      workspaceId: "ws1",
      title: "Build the API",
      phase: "mvp",
      status: "todo",
      assigneeBotId: "cto",
      department: "engineering",
      createdAt: now,
      updatedAt: now,
    });
    return store;
  }

  const reportTool = (store: MemoryStore) =>
    createDelegationTools(store, "u1", "cto").find((entry) => entry.name === "company.report")!;

  it("marks an assigned task done and records the outcome", async () => {
    const store = await seeded();
    const result = await reportTool(store).run({ task: "Build the API", result: "api.ts + tests" }, ctx);
    expect(result.ok).toBe(true);
    const item = await store.getWorkItem("w1");
    expect(item?.status).toBe("done");
    expect(item?.result).toBe("api.ts + tests");
  });

  it("requires a result", async () => {
    const store = await seeded();
    expect((await reportTool(store).run({ task: "Build the API" }, ctx)).ok).toBe(false);
    expect((await store.getWorkItem("w1"))?.status).toBe("todo");
  });

  it("reports when no task matches", async () => {
    const store = await seeded();
    expect((await reportTool(store).run({ task: "Deploy to Mars", result: "x" }, ctx)).ok).toBe(false);
  });
});

describe("company.review_department", () => {
  const now = new Date().toISOString();
  const ctx = { workspaceDir: ".", log: () => {} };

  async function seeded() {
    const store = new MemoryStore();
    for (const [id, name] of [
      ["cto", "Dev"],
      ["be", "Kim"],
    ] as const) {
      await store.createBot({
        id,
        userId: "u1",
        name,
        emoji: "💻",
        scheme: 1,
        instructions: "",
        workspace: "Acme",
        sessionId: `s-${id}`,
        createdAt: now,
      });
    }
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
    await store.setBotRole({ workspaceId: "ws1", botId: "cto", title: "CTO", department: "engineering", hiredAt: now });
    await store.setBotRole({
      workspaceId: "ws1",
      botId: "be",
      title: "Backend Engineer",
      department: "engineering",
      hiredAt: now,
    });
    await store.createWorkItem({
      id: "w1",
      workspaceId: "ws1",
      title: "Build the API",
      phase: "mvp",
      status: "todo",
      assigneeBotId: "be",
      department: "engineering",
      createdAt: now,
      updatedAt: now,
    });
    await store.createWorkItem({
      id: "w2",
      workspaceId: "ws1",
      title: "Pick a database",
      phase: "mvp",
      status: "todo",
      department: "engineering",
      createdAt: now,
      updatedAt: now,
    });
    await store.createWorkItem({
      id: "w3",
      workspaceId: "ws1",
      title: "Write the launch post",
      phase: "mvp",
      status: "blocked",
      assigneeBotId: "be",
      department: "marketing",
      createdAt: now,
      updatedAt: now,
    });
    return store;
  }

  const tool = (store: MemoryStore, botId: string) =>
    createDelegationTools(store, "u1", botId).find((entry) => entry.name === "company.review_department")!;

  it("summarises the department for a head — open, unassigned and blocked", async () => {
    const store = await seeded();
    const result = await tool(store, "cto").run({}, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("engineering");
    expect(result.output).toContain("Build the API");
    expect(result.output).toContain("Pick a database");
    expect(result.output).toMatch(/unassigned/i);
    expect(result.output).toContain("company.delegate");
  });

  it("refuses an IC", async () => {
    const store = await seeded();
    const result = await tool(store, "be").run({}, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/head/i);
  });
});

describe("company.board", () => {
  const now = new Date().toISOString();
  const ctx = { workspaceDir: ".", log: () => {} };

  async function seeded() {
    const store = new MemoryStore();
    await store.createBot({
      id: "be",
      userId: "u1",
      name: "Kim",
      emoji: "💻",
      scheme: 1,
      instructions: "",
      workspace: "Acme",
      sessionId: "s-be",
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
      botId: "be",
      title: "Backend Engineer",
      department: "engineering",
      hiredAt: now,
    });
    await store.createWorkItem({
      id: "w1",
      workspaceId: "ws1",
      title: "Build the API",
      phase: "mvp",
      status: "todo",
      assigneeBotId: "be",
      department: "engineering",
      createdAt: now,
      updatedAt: now,
    });
    await store.createWorkItem({
      id: "w2",
      workspaceId: "ws1",
      title: "Old task",
      phase: "mvp",
      status: "done",
      department: "engineering",
      createdAt: now,
      updatedAt: now,
    });
    return store;
  }

  const board = (store: MemoryStore) =>
    createDelegationTools(store, "u1", "be").find((entry) => entry.name === "company.board")!;

  it("lists non-done board items for the employee, marked with their owner", async () => {
    const store = await seeded();
    const result = await board(store).run({}, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Build the API");
    expect(result.output).not.toContain("Old task");
    expect(result.output).toContain("you");
  });
});
