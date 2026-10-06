import { describe, expect, it } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { runBillingTick, settleInvoice } from "./billing.js";
import { buildServer } from "./server.js";
import { MemoryStore } from "./store/memory.js";
import type { InvoiceRecord, UserRecord } from "./store/types.js";

const DAY = 24 * 60 * 60 * 1000;

function user(partial: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "u1",
    email: "u1@example.com",
    passwordHash: "x",
    role: "user",
    plan: "free",
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

function invoice(partial: Partial<InvoiceRecord> = {}): InvoiceRecord {
  const now = new Date().toISOString();
  return {
    id: "inv_1",
    userId: "u1",
    kind: "plan",
    plan: "pro",
    amountCents: 500,
    currency: "USD",
    providerStatus: "pending",
    status: "open",
    reminders: {},
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

describe("settleInvoice", () => {
  it("activates a plan and starts a fresh period", async () => {
    const store = new MemoryStore();
    await store.createUser(user());
    await store.createInvoice(invoice());
    await settleInvoice(store, invoice(), new Date().toISOString());
    const record = await store.getUserById("u1");
    expect(record?.plan).toBe("pro");
    expect(record?.billingMode).toBe("plan");
    expect(record?.subStatus).toBe("active");
    expect(Date.parse(record?.periodEnd ?? "")).toBeGreaterThan(Date.now() + 29 * DAY);
  });

  it("credits the wallet for a top-up", async () => {
    const store = new MemoryStore();
    await store.createUser(user());
    await settleInvoice(store, invoice({ kind: "topup", plan: undefined }), new Date().toISOString());
    expect((await store.getWallet("u1")).balanceCents).toBe(500);
    expect((await store.listLedger("u1"))[0]?.kind).toBe("topup");
  });
});

describe("runBillingTick", () => {
  it("downgrades to the fallback plan once grace has passed", async () => {
    const store = new MemoryStore();
    await store.createUser(
      user({
        plan: "pro",
        billingMode: "plan",
        subStatus: "grace",
        periodEnd: new Date(Date.now() - 10 * DAY).toISOString(),
        graceUntil: new Date(Date.now() - 3 * DAY).toISOString(),
      }),
    );
    const summary = await runBillingTick(store, null, () => 500);
    expect(summary.downgraded).toBe(1);
    expect((await store.getUserById("u1"))?.plan).toBe("free");
  });

  it("reminds within the lead window and records a notification", async () => {
    const store = new MemoryStore();
    await store.createUser(
      user({
        plan: "pro",
        billingMode: "plan",
        subStatus: "active",
        periodEnd: new Date(Date.now() + 3 * DAY).toISOString(),
      }),
    );
    const summary = await runBillingTick(store, null, () => 500);
    expect(summary.reminded).toBe(1);
    expect((await store.listInvoices("u1", "open")).length).toBe(1);
  });
});

describe("hard-stop", () => {
  it("refuses work once the free monthly tokens are spent", async () => {
    const store = new MemoryStore();
    const app = await buildServer({ store, vaultKey: Buffer.alloc(32), localChannel: createLocalChannel() });
    await app.ready();
    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "cap@example.com", password: "password123" },
    });
    const { token, user: account } = signup.json() as { token: string; user: { id: string } };
    const settings = await store.getPlatformSettings();
    await store.addUsage({
      id: "u1",
      userId: account.id,
      taskId: null,
      promptTokens: settings.freeMonthlyTokens + 1,
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
    expect(response.statusCode).toBe(402);
    await app.close();
  });
});
