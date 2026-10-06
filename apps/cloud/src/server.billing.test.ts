import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { MemoryStore } from "./store/memory.js";
import { buildServer } from "./server.js";

/** The Stripe webhook must verify the real `t=…,v1=…` HMAC, not a shared header. */
describe("stripe webhook", () => {
  const saved = process.env.STRIPE_WEBHOOK_SECRET;
  afterEach(() => {
    if (saved === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = saved;
  });

  it("rejects a bad signature and grants pro on a valid one", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const store = new MemoryStore();
    const app = await buildServer({ store, vaultKey: Buffer.alloc(32), localChannel: createLocalChannel() });
    await app.ready();

    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "pay@example.com", password: "password123" },
    });
    const { user } = signup.json() as { user: { id: string } };

    const body = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { client_reference_id: user.id } },
    });

    const bad = await app.inject({
      method: "POST",
      url: "/v1/billing/webhook",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
      payload: body,
    });
    expect(bad.statusCode).toBe(400);

    const t = Math.floor(Date.now() / 1000).toString();
    const v1 = createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex");
    const good = await app.inject({
      method: "POST",
      url: "/v1/billing/webhook",
      headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${v1}` },
      payload: body,
    });
    expect(good.statusCode).toBe(204);
    expect((await store.getUserById(user.id))?.plan).toBe("pro");

    await app.close();
  });
});
