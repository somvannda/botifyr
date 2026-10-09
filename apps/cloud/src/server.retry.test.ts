import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

// Don't actually execute the agent: this file only asserts that a failed task is
// re-queued in place (the primitive behind the workspace "Retry" button).
vi.mock("./runner.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, runTask: vi.fn().mockResolvedValue(undefined) };
});

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
    const { token } = signup.json() as { token: string };
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
    return { store, app, token };
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
});
