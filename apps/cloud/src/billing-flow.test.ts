import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalChannel } from "@botifyr/channels";
import { notify, runBillingTick, settleInvoice, type ChmabaConfig } from "./billing.js";
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

  it("settles a plan invoice only once (webhook retries are safe)", async () => {
    const store = new MemoryStore();
    await store.createUser(user());
    const inv = invoice();
    await store.createInvoice(inv);
    await settleInvoice(store, inv, new Date().toISOString());
    const first = await store.getUserById("u1");

    // A retried delivery re-reads the (now paid) invoice and must not extend again.
    const again = await store.getInvoice(inv.id);
    expect(again?.status).toBe("paid");
    if (again) await settleInvoice(store, again, new Date(Date.now() + 60_000).toISOString());

    const second = await store.getUserById("u1");
    expect(second?.periodEnd).toBe(first?.periodEnd);
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

describe("reminders", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends email + Telegram and marks the outbox sent", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(String(url));
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    const store = new MemoryStore();
    const settings = await store.getPlatformSettings();
    const cfg: ChmabaConfig = {
      baseUrl: "https://pay.chmaba.com",
      apiKey: "k",
      store: "s",
      useMerchant: false,
      webhookSecret: "w",
      resendKey: "re",
      mailFrom: "billing@botifyr.xyz",
      telegramToken: "tg",
    };
    const recipient = user({ email: "u@example.com", telegramChatId: "4242" });

    await notify(store, cfg, recipient, settings, {
      kind: "billing.d3",
      subject: "Your plan renews soon",
      body: "Due in 3 days.",
      payUrl: "https://pay/x",
    });

    expect(calls.some((url) => url.includes("api.resend.com"))).toBe(true);
    expect(calls.some((url) => url.includes("api.telegram.org"))).toBe(true);
    // Every channel was delivered, so nothing is left pending.
    expect((await store.listPendingNotifications()).length).toBe(0);
  });

  it("skips Telegram when the user has not linked a chat", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(String(url));
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    const store = new MemoryStore();
    const settings = await store.getPlatformSettings();
    const cfg: ChmabaConfig = {
      baseUrl: "https://pay.chmaba.com",
      apiKey: "k",
      store: "s",
      useMerchant: false,
      webhookSecret: "w",
      resendKey: "re",
      mailFrom: "billing@botifyr.xyz",
      telegramToken: "tg",
    };

    await notify(store, cfg, user({ email: "u@example.com" }), settings, {
      kind: "billing.d7",
      subject: "Heads up",
      body: "Due in 7 days.",
    });

    expect(calls.some((url) => url.includes("api.telegram.org"))).toBe(false);
    expect(calls.some((url) => url.includes("api.resend.com"))).toBe(true);
  });
});

describe("ChmabaPay checkout → webhook", () => {
  const saved = {
    key: process.env.CHMABA_API_KEY,
    store: process.env.CHMABA_STORE,
    secret: process.env.CHMABA_WEBHOOK_SECRET,
  };
  afterEach(() => {
    const restore: Record<string, string | undefined> = {
      CHMABA_API_KEY: saved.key,
      CHMABA_STORE: saved.store,
      CHMABA_WEBHOOK_SECRET: saved.secret,
    };
    for (const [key, value] of Object.entries(restore)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
  });

  function configure() {
    process.env.CHMABA_API_KEY = "ck_live_test";
    process.env.CHMABA_STORE = "st_test";
    process.env.CHMABA_WEBHOOK_SECRET = "whsec_test";
  }

  it("creates an invoice, then activates the plan from a signed webhook", async () => {
    configure();
    vi.stubGlobal("fetch", (url: string) => {
      if (String(url).endsWith("/v1/payments")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "pay_1",
              status: "pending",
              qr_string: "QR",
              checkout_url: "https://pay.chmaba.com/pay/pay_1",
              expires_at: new Date(Date.now() + 180_000).toISOString(),
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    const store = new MemoryStore();
    const app = await buildServer({ store, vaultKey: Buffer.alloc(32), localChannel: createLocalChannel() });
    await app.ready();
    const signup = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: "buyer@example.com", password: "password123" },
    });
    const { token } = signup.json() as { token: string };
    const auth = { authorization: `Bearer ${token}` };

    const checkout = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: auth,
      payload: { kind: "plan", plan: "pro" },
    });
    expect(checkout.statusCode).toBe(200);
    expect((checkout.json() as { url?: string }).url).toContain("/pay/");

    const body = JSON.stringify({
      type: "payment.completed",
      data: { payment: { id: "pay_1", status: "paid" } },
    });
    const t = Math.floor(Date.now() / 1000).toString();
    const v1 = createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex");
    const hook = await app.inject({
      method: "POST",
      url: "/v1/billing/chmaba/webhook",
      headers: { "content-type": "application/json", "x-chambapay-signature": `t=${t},v1=${v1}` },
      payload: body,
    });
    expect(hook.statusCode).toBe(204);
    expect(
      ((await app.inject({ method: "GET", url: "/auth/me", headers: auth })).json() as { plan: string }).plan,
    ).toBe("pro");
    await app.close();
  });

  it("rejects a webhook with a bad signature", async () => {
    configure();
    const store = new MemoryStore();
    const app = await buildServer({ store, vaultKey: Buffer.alloc(32), localChannel: createLocalChannel() });
    await app.ready();
    const hook = await app.inject({
      method: "POST",
      url: "/v1/billing/chmaba/webhook",
      headers: { "content-type": "application/json", "x-chambapay-signature": "t=1,v1=deadbeef" },
      payload: JSON.stringify({
        type: "payment.completed",
        data: { payment: { id: "pay_1", status: "paid" } },
      }),
    });
    expect(hook.statusCode).toBe(400);
    await app.close();
  });
});
