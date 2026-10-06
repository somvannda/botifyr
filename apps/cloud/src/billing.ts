import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  InvoiceRecord,
  ModelPricingRecord,
  NotificationRecord,
  PlatformSettings,
  UserRecord,
} from "./store/types.js";
import type { Store } from "./store/index.js";

/**
 * Prepaid billing: ChmabaPay (KHQR / ABA PayWay) for settlement, plus the
 * renewal cycle ChmabaPay doesn't provide (invoices, reminders, grace,
 * downgrade), and on-demand token pricing (provider cost × markup).
 */

/* -------------------------------------------------------------------------- */
/* ChmabaPay client                                                           */
/* -------------------------------------------------------------------------- */

export interface ChmabaConfig {
  baseUrl: string;
  apiKey: string;
  store: string;
  /** true = the store value is an external_id (send `merchant=`). */
  useMerchant: boolean;
  webhookSecret: string;
  /** Resend, for email reminders. */
  resendKey?: string;
  mailFrom?: string;
  telegramToken?: string;
}

export function chmabaConfigFromEnv(): ChmabaConfig | null {
  const apiKey = process.env.CHMABA_API_KEY;
  const store = process.env.CHMABA_STORE ?? process.env.CHMABA_MERCHANT;
  if (!apiKey || !store) return null;
  return {
    baseUrl: process.env.CHMABA_BASE_URL ?? "https://pay.chmaba.com",
    apiKey,
    store,
    useMerchant: !process.env.CHMABA_STORE && Boolean(process.env.CHMABA_MERCHANT),
    webhookSecret: process.env.CHMABA_WEBHOOK_SECRET ?? "",
    resendKey: process.env.RESEND_API_KEY,
    mailFrom: process.env.MAIL_FROM,
    telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  };
}

export interface ChmabaPayment {
  id: string;
  status: string;
  qrString?: string;
  checkoutUrl?: string;
  expiresAt?: string;
}

interface ChmabaError {
  detail?: string;
}

async function call(
  cfg: ChmabaConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const response = await fetch(`${cfg.baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & ChmabaError;
  if (!response.ok) {
    throw new Error(data.detail ?? `ChmabaPay request failed (${response.status})`);
  }
  return data;
}

/** Create a KHQR payment; `referenceId` is also the idempotency key. */
export async function createPayment(
  cfg: ChmabaConfig,
  opts: { amountCents: number; referenceId: string; metadata?: Record<string, unknown> },
): Promise<ChmabaPayment> {
  const body: Record<string, unknown> = {
    amount: (opts.amountCents / 100).toFixed(2),
    reference_id: opts.referenceId,
    idempotency_key: opts.referenceId,
    metadata: opts.metadata ?? {},
  };
  if (cfg.useMerchant) body.merchant = cfg.store;
  else body.store = cfg.store;
  const data = (await call(cfg, "/v1/payments", { method: "POST", body })) as Record<string, unknown>;
  return {
    id: String(data.id),
    status: String(data.status ?? "pending"),
    qrString: data.qr_string ? String(data.qr_string) : undefined,
    checkoutUrl: data.checkout_url ? String(data.checkout_url) : undefined,
    expiresAt: data.expires_at ? String(data.expires_at) : undefined,
  };
}

/** Mint a fresh code for an expired/failed payment. */
export async function reissuePayment(cfg: ChmabaConfig, paymentId: string): Promise<ChmabaPayment> {
  const data = (await call(cfg, `/v1/payments/${encodeURIComponent(paymentId)}/reissue`, {
    method: "POST",
    body: {},
  })) as Record<string, unknown>;
  return {
    id: String(data.id),
    status: String(data.status ?? "pending"),
    qrString: data.qr_string ? String(data.qr_string) : undefined,
    checkoutUrl: data.checkout_url ? String(data.checkout_url) : undefined,
    expiresAt: data.expires_at ? String(data.expires_at) : undefined,
  };
}

/** Authoritative status check (webhook miss safety net). */
export async function checkStatus(
  cfg: ChmabaConfig,
  paymentId: string,
): Promise<{ status: string; paid: boolean }> {
  const data = (await call(
    cfg,
    `/v1/transactions/check-status/${encodeURIComponent(paymentId)}?mark_paid=true`,
  )) as Record<string, unknown>;
  const status = String(data.status ?? "UNKNOWN");
  return { status, paid: status === "PAID" || data.transitioned_to_paid === true };
}

/** Verify `X-ChmabaPay-Signature: t=…,v1=…` (HMAC over `{t}.{rawBody}`). */
export function verifyChmabaSignature(raw: Buffer | undefined, header: string, secret: string): boolean {
  if (!raw || !secret) return false;
  const parts: Record<string, string> = {};
  for (const piece of header.split(",")) {
    const [key, value] = piece.split("=");
    if (key && value) parts[key.trim()] = value.trim();
  }
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${raw.toString("utf8")}`)
    .digest("hex");
  const given = Buffer.from(signature, "hex");
  const want = Buffer.from(expected, "hex");
  return given.length === want.length && timingSafeEqual(given, want);
}

/* -------------------------------------------------------------------------- */
/* Pricing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Charge in cents for a run: provider cost (per-model) × (1 + markup%). Uses the
 * model's enabled row, falling back to the most expensive row so we never
 * under-charge, and rounds up.
 */
export function priceFor(
  pricing: ModelPricingRecord[],
  model: string | undefined,
  promptTokens: number,
  completionTokens: number,
  globalMarkupPercent: number,
): number {
  const enabled = pricing.filter((row) => row.enabled);
  if (enabled.length === 0) return 0;
  const row =
    enabled.find((entry) => entry.model === model) ??
    [...enabled].sort(
      (a, b) => b.inputCentsPerM + b.outputCentsPerM - (a.inputCentsPerM + a.outputCentsPerM),
    )[0];
  const markup = row.markupPercent ?? globalMarkupPercent;
  const cost =
    (promptTokens / 1_000_000) * row.inputCentsPerM + (completionTokens / 1_000_000) * row.outputCentsPerM;
  return Math.ceil(cost * (1 + markup / 100));
}

/* -------------------------------------------------------------------------- */
/* Reminder channels                                                          */
/* -------------------------------------------------------------------------- */

async function sendEmail(cfg: ChmabaConfig, to: string, subject: string, html: string): Promise<boolean> {
  if (!cfg.resendKey || !cfg.mailFrom) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.resendKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: cfg.mailFrom, to, subject, html }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function sendTelegram(cfg: ChmabaConfig, chatId: string, text: string): Promise<boolean> {
  if (!cfg.telegramToken || !chatId) return false;
  try {
    const response = await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Send one reminder across the enabled channels and record the outbox row. */
export async function notify(
  store: Store,
  cfg: ChmabaConfig | null,
  user: UserRecord,
  settings: PlatformSettings,
  message: { kind: string; subject: string; body: string; payUrl?: string },
): Promise<void> {
  const channels = settings.reminderChannels;
  const now = new Date().toISOString();
  const record: NotificationRecord = {
    id: randomUUID(),
    userId: user.id,
    kind: message.kind,
    subject: message.subject,
    body: message.body,
    channels: [
      ...(channels.os ? ["os"] : []),
      ...(channels.email ? ["email"] : []),
      ...(channels.telegram ? ["telegram"] : []),
    ],
    sent: {},
    createdAt: now,
    updatedAt: now,
  };
  const html = message.payUrl
    ? `${message.body}<p><a href="${message.payUrl}">Pay now</a></p>`
    : message.body;
  if (cfg && channels.email && user.email) {
    record.sent.email = await sendEmail(cfg, user.email, message.subject, html);
  }
  if (cfg && channels.telegram && user.telegramChatId) {
    record.sent.telegram = await sendTelegram(
      cfg,
      user.telegramChatId,
      `${message.subject}\n\n${message.body}${message.payUrl ? `\n\nPay: ${message.payUrl}` : ""}`,
    );
  }
  // The in-app "os" channel is delivered by the client on next load; mark it here.
  if (channels.os) record.sent.os = true;
  await store.createNotification(record).catch(() => {});
}

/* -------------------------------------------------------------------------- */
/* Renewal cycle                                                              */
/* -------------------------------------------------------------------------- */

const DAY = 24 * 60 * 60 * 1000;

/**
 * One hourly tick: reminders at the configured lead days, grace, downgrade, and
 * a reconciliation net for open invoices. Returns a short summary for logging.
 */
export async function runBillingTick(
  store: Store,
  cfg: ChmabaConfig | null,
  planPriceCents: (plan: UserRecord["plan"], settings: PlatformSettings) => number,
): Promise<{ reminded: number; downgraded: number; settled: number }> {
  const settings = await store.getPlatformSettings();
  const now = Date.now();
  const users = await store.listUsers();
  let reminded = 0;
  let downgraded = 0;

  for (const user of users) {
    if (user.billingMode !== "plan" || user.plan === "free" || !user.periodEnd) continue;
    const end = Date.parse(user.periodEnd);
    const graceUntil = user.graceUntil ? Date.parse(user.graceUntil) : end + settings.graceDays * DAY;

    // Past grace → downgrade to the fallback plan.
    if (now > graceUntil) {
      await store.setUserBilling(user.id, {
        plan: settings.fallbackPlan,
        billingMode: "free",
        subStatus: "expired",
      });
      downgraded += 1;
      continue;
    }

    const daysToEnd = Math.ceil((end - now) / DAY);
    const inGrace = now > end;
    const reminderKey = inGrace
      ? "grace"
      : settings.reminderDays.map(String).find((day) => daysToEnd <= Number(day));
    if (!reminderKey) continue;

    // One open invoice per period; reuse it and remind once per key.
    const open = (await store.listInvoices(user.id, "open")).find((invoice) => invoice.kind === "plan");
    let invoice: InvoiceRecord | undefined = open;
    if (!invoice) {
      const periodEnd = new Date(end + settings.plans.proPeriodDays * DAY).toISOString();
      const amountCents = planPriceCents(user.plan, settings);
      const id = `inv_${randomUUID()}`;
      const created: InvoiceRecord = {
        id,
        userId: user.id,
        kind: "plan",
        plan: user.plan,
        amountCents,
        currency: settings.plans.currency,
        referenceId: id,
        providerStatus: "pending",
        status: "open",
        periodStart: new Date(end).toISOString(),
        periodEnd,
        reminders: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (cfg) {
        try {
          const payment = await createPayment(cfg, {
            amountCents,
            referenceId: id,
            metadata: { userId: user.id, kind: "plan", plan: user.plan },
          });
          created.providerPaymentId = payment.id;
          created.checkoutUrl = payment.checkoutUrl;
          created.qrString = payment.qrString;
          created.expiresAt = payment.expiresAt;
        } catch {
          // Leave it open without a link; the next tick retries.
        }
      }
      await store.createInvoice(created);
      invoice = created;
    }

    if (invoice.reminders[reminderKey]) continue;
    const due = new Date(end).toLocaleDateString();
    await notify(store, cfg, user, settings, {
      kind: `billing.${reminderKey}`,
      subject: `${user.plan} plan renews on ${due}`,
      body: `Your ${user.plan} plan is due on ${due}. Renew to keep going, or you'll drop to ${settings.fallbackPlan} after a ${settings.graceDays}-day grace period.`,
      payUrl: invoice.checkoutUrl,
    });
    invoice.reminders = { ...invoice.reminders, [reminderKey]: true };
    invoice.updatedAt = new Date().toISOString();
    await store.updateInvoice(invoice);
    reminded += 1;
  }

  // Reconciliation net: settle open invoices the webhook may have missed.
  let settled = 0;
  if (cfg) {
    for (const invoice of await store.listOpenInvoices()) {
      if (!invoice.providerPaymentId) continue;
      try {
        const { paid } = await checkStatus(cfg, invoice.providerPaymentId);
        if (paid) {
          await settleInvoice(store, invoice, new Date().toISOString());
          settled += 1;
        }
      } catch {
        // Provider unreachable; try again next tick.
      }
    }
  }

  return { reminded, downgraded, settled };
}

/** Mark an invoice paid and apply its effect (extend the period or credit the wallet). */
export async function settleInvoice(store: Store, invoice: InvoiceRecord, paidAt: string): Promise<void> {
  if (invoice.status === "paid") return;
  invoice.status = "paid";
  invoice.providerStatus = "paid";
  invoice.paidAt = paidAt;
  invoice.updatedAt = paidAt;
  await store.updateInvoice(invoice);

  if (invoice.kind === "topup") {
    await store.addWalletCents(invoice.userId, invoice.amountCents);
    await store.addLedger({
      id: randomUUID(),
      userId: invoice.userId,
      kind: "topup",
      amountCents: invoice.amountCents,
      note: invoice.id,
      createdAt: paidAt,
    });
    return;
  }

  const settings = await store.getPlatformSettings();
  const start = paidAt;
  const endMs = Date.parse(paidAt) + settings.plans.proPeriodDays * DAY;
  await store.setUserBilling(invoice.userId, {
    plan: invoice.plan ?? "pro",
    billingMode: "plan",
    periodStart: start,
    periodEnd: new Date(endMs).toISOString(),
    graceUntil: new Date(endMs + settings.graceDays * DAY).toISOString(),
    subStatus: "active",
  });
}
