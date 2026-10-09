import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { runTask } from "./runner.js";
import { buildServer } from "./server.js";

// Don't actually execute the agent: this file only asserts how a failed task is
// re-queued in place and how the board follows it (the workspace "Retry" button).
vi.mock("./runner.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    // Simulate a successful run by default; a run only closes the board item when
    // it actually completes.
    runTask: vi.fn(async (_deps: unknown, task: { status: string }) => {
      task.status = "completed";
    }),
  };
});

/** A workspace with one bot (owning `sessionId`) and one item assigned to it. */
async function seedCompany(store: MemoryStore, userId: string, sessionId: string): Promise<void> {
  const now = new Date().toISOString();
  await store.createWorkspace({
    id: "ws1",
    ownerId: userId,
    name: "Acme",
    source: { kind: "idea", value: "cloud pos" },
    mission: "Sell things",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await store.createBot({
    id: "bot1",
    userId,
    name: "Bea",
    emoji: "🤖",
    scheme: 0,
    instructions: "",
    workspace: "Acme",
    sessionId,
    createdAt: now,
  });
  const session = await store.getSession(sessionId);
  if (!session) throw new Error("session missing");
  session.botId = "bot1";
  await store.updateSession(session);
  await store.createWorkItem({
    id: "wi1",
    workspaceId: "ws1",
    title: "Do the thing",
    phase: "ongoing",
    status: "todo",
    department: "exec",
    assigneeBotId: "bot1",
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * `POST /v1/tasks/:id/retry` re-runs a failed task's own goal in place. Company
 * ("scheduled") runs store their prompt only on the task — never in the session —
 * so the session-level retry can't replay them; this endpoint can.
 */
describe("task retry", () => {
  afterEach(() => {
    delete process.env.BOTIFYR_ENFORCE_BUDGET;
  });

  async function setup() {
    const store = new MemoryStore();
    const app = await buildServer({ store, vaultKey: Buffer.alloc(32), localChannel: createLocalChannel() });
    await app.ready();
    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "retry@example.com", password: "password123" },
    });
    const { token, user } = signup.json() as { token: string; user: { id: string } };
    const session = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { authorization: `Bearer ${token}` },
    });
    const { id: sessionId } = session.json() as { id: string };
    const now = new Date().toISOString();
    await store.createTask({
      id: "task-1",
      sessionId,
      goal: "Review your board tasks and do the next one.",
      status: "failed",
      steps: [],
      error: "model request failed (400): Thinking mode does not support this tool_choice",
      createdAt: now,
      updatedAt: now,
    });
    return { store, app, token, userId: user.id, sessionId };
  }

  it("re-queues a failed task in place and clears the error", async () => {
    const { store, app, token } = await setup();
    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks/task-1/retry",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { task: { id: string; status: string; error?: string } };
    expect(body.task.id).toBe("task-1");
    expect(body.task.error).toBeUndefined();
    expect(body.task.status).not.toBe("failed");

    const stored = await store.getTask("task-1");
    expect(stored?.error).toBeUndefined();
    expect(stored?.status).not.toBe("failed");

    await app.close();
  });

  it("404s for an unknown task", async () => {
    const { app, token } = await setup();
    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks/does-not-exist/retry",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("404s for another user's task", async () => {
    const { app } = await setup();
    const other = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "other@example.com", password: "password123" },
    });
    const { token: otherToken } = other.json() as { token: string };
    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks/task-1/retry",
      headers: { authorization: `Bearer ${otherToken}` },
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("advances the assignee's board item when the retried run completes", async () => {
    const { store, app, token, userId, sessionId } = await setup();
    await seedCompany(store, userId, sessionId);
    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks/task-1/retry",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(response.statusCode).toBe(200);

    // todo → in_progress (when the retry starts) → done (when it finishes).
    await vi.waitFor(async () => {
      const [item] = await store.listWorkItems("ws1");
      expect(item?.status).toBe("done");
    });
    await app.close();
  });

  it("leaves the item in progress when the retried run fails", async () => {
    vi.mocked(runTask).mockImplementationOnce(async (_deps, task) => {
      task.status = "failed";
    });
    const { store, app, token, userId, sessionId } = await setup();
    await seedCompany(store, userId, sessionId);
    const response = await app.inject({
      method: "POST",
      url: "/v1/tasks/task-1/retry",
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(response.statusCode).toBe(200);

    await vi.waitFor(async () => {
      const [item] = await store.listWorkItems("ws1");
      expect(item?.status).toBe("in_progress");
    });
    await app.close();
  });
});
