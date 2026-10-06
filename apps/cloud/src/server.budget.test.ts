import { afterEach, describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

/**
 * The daily token budget is warning-only by default. With
 * BOTIFYR_ENFORCE_BUDGET=1 an over-budget user is refused new work (HTTP 429).
 */
describe("daily budget enforcement", () => {
  const saved = {
    enforce: process.env.BOTIFYR_ENFORCE_BUDGET,
    budget: process.env.BOTIFYR_DAILY_TOKEN_BUDGET,
  };
  afterEach(() => {
    if (saved.enforce === undefined) delete process.env.BOTIFYR_ENFORCE_BUDGET;
    else process.env.BOTIFYR_ENFORCE_BUDGET = saved.enforce;
    if (saved.budget === undefined) delete process.env.BOTIFYR_DAILY_TOKEN_BUDGET;
    else process.env.BOTIFYR_DAILY_TOKEN_BUDGET = saved.budget;
  });

  it("refuses a message with 429 once the budget is spent (enforcement on)", async () => {
    process.env.BOTIFYR_ENFORCE_BUDGET = "1";
    process.env.BOTIFYR_DAILY_TOKEN_BUDGET = "10";
    const store = new MemoryStore();
    const app = await buildServer({ store, vaultKey: Buffer.alloc(32), localChannel: createLocalChannel() });
    await app.ready();

    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "budget@example.com", password: "password123" },
    });
    const { token, user } = signup.json() as { token: string; user: { id: string } };
    await store.addUsage({
      id: "usage-1",
      userId: user.id,
      taskId: null,
      promptTokens: 50,
      completionTokens: 0,
      createdAt: new Date().toISOString(),
    });
    const session = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { authorization: `Bearer ${token}` },
    });
    const { id } = session.json() as { id: string };

    const response = await app.inject({
      method: "POST",
      url: `/v1/sessions/${id}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: { text: "hello" },
    });
    expect(response.statusCode).toBe(429);

    await app.close();
  });
});
