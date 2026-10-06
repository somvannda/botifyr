# Billing — plans, on-demand credits, and admin settings (ChmabaPay)

Botifyr bills **prepaid**. Two models, both settled through **ChmabaPay**
(`pay.chmaba.com`, KHQR / ABA PayWay — **no recurring primitive**, but late
payments still settle, which suits prepaid). Everything numeric is
**admin-configurable** so pricing and policy can change without a deploy.

> No real Stripe. The Stripe checkout/webhook code stays optional and unused.
> The Stripe **raw-body HMAC verifier** is reused for ChmabaPay (same
> `t=…,v1=…` signature scheme).

## 1. Two billing models

| Model | Who | How it works |
| --- | --- | --- |
| **Plan** (prepaid subscription) | free / pro / business | Pay for a period (30 days) up front; renew before it ends. |
| **On-demand** (prepaid credits) | `payg` | Top up a **credit balance**; each model run **debits tokens × rate**. No period, no expiry of balance. |

A user has a `billingMode`: `free` | `plan` | `payg`. Admins can switch it, and
`pro` users may *also* draw on-demand credits once the plan’s included quota is
spent (admin toggle).

### Plans
| Plan | Price (admin-set) | Period | Included tokens |
| --- | --- | --- | --- |
| **free** | $0 | — | `freeMonthlyTokens` (admin-set) |
| **pro** | `proPriceCents` | `proPeriodDays` | effectively unlimited (rate-limit only) |
| **business** | `businessPriceCents` | `proPeriodDays` | unlimited + more capacity (optional) |

`trial` is renamed to **free** (migration maps existing `trial` → `free`).

### On-demand (charge per token)
- Every completed run records tokens in `usage_events` (already exists). For
  `payg` users we also write a **ledger debit**: `tokens / 1,000,000 × pricePer1MTokens`
  in cents (rate is admin-set, e.g. $0.50 / 1M tokens).
- A **wallet** holds `balanceCents`. Top-ups are ChmabaPay payments that credit
  the wallet on `payment.completed` (same webhook, different `metadata.kind`).
- When `balanceCents ≤ 0`: **block** with an upgrade/top-up CTA, or fall back to
  the free allowance first — an admin choice (`onDemand.onEmpty`).

## 2. Platform settings (admin-controlled)

One `platform_settings` row (JSON), read by billing + cost controls and edited in
**apps/admin → Settings**. Cached in memory, invalidated on write.

```
plans:            { proPriceCents, businessPriceCents, proPeriodDays, currency }
freeMonthlyTokens: 20000
graceDays:        7
reminderDays:     [7, 3, 1]
reminderChannels: { os: true, email: true, telegram: true }
onDemand:         { enabled: true, pricePerMTokensCents: 50, minTopUpCents: 100,
                    allowPro: false, onEmpty: "block" | "free" }
fallbackPlan:     "free"
```

- **API:** `GET /admin/settings` and `PUT /admin/settings` (admin-only, audited).
- **Client/admin UI:** `apps/admin` gains a **Settings** tab (plans, free quota,
  grace, reminder days/channels, on-demand). The user app reads the public subset
  via `/v1/billing`.

## 3. Entities

```
platform_settings   (single row)                         # §2

subscription (1/user)
  userId, billingMode: free|plan|payg
  plan, currentPeriodStart, currentPeriodEnd, graceUntil
  status: active|grace|expired|free

wallet (1/user, for payg)
  userId, balanceCents, updatedAt

ledger (append-only money movement)
  id, userId, kind: topup|usage|refund|grant
  amountCents (+credit / −debit), tokens?, invoiceId?, note?, createdAt

invoice (1 per period attempt or top-up)
  id "inv_<uuid>", userId, kind: plan|topup
  plan?, amountCents, currency, referenceId, providerPaymentId, checkoutUrl, qrString
  providerStatus: pending|paid|expired|failed|superseded|reversed
  status: open|paid|void
  periodStart?, periodEnd?, issuedAt, expiresAt?, paidAt
  remindersSent: { d7, d3, d1, grace }
```

## 4. Lifecycle

```
free ──subscribe──▶ invoice(open) ──paid──▶ plan/active (periodStart..+periodDays)
                                             │  periodEnd −{7,3,1}d: remind + (re)issue
                                             ▼
                             periodEnd, unpaid → plan + GRACE (graceDays)
                                             ▼
                             grace ended, unpaid → free (keep periodEnd)

payg ──topup──▶ wallet += amount ──usage──▶ wallet −= tokens×rate
                                             ▼
                             balance ≤ 0 → onEmpty: block, or fall back to free
                             late/extra top-up any time → back in business
```

**ChmabaPay mapping** (one store = Botifyr’s merchant, `external_id: "botifyr"`):
| Step | Call |
| --- | --- |
| Create invoice (plan or top-up) | `POST /v1/payments { amount, reference_id: invoice.id, idempotency_key: invoice.id, store, metadata: { userId, kind, plan? } }` → `{ id, qr_string, checkout_url, expires_at }` |
| Refresh dead code (~180s life) | `POST /v1/payments/{id}/reissue` |
| Reconciliation net | `GET /v1/transactions/check-status/{id}` (`mark_paid=true`) |
| Register webhook | `POST /v1/webhooks { url, events: ["payment.completed","payment.expired","payment.reversed"] }` → secret shown once |

**Webhook** `POST /v1/billing/chmaba/webhook`: verify `X-ChmabaPay-Signature`
(HMAC over `{t}.{rawBody}`, drift ≤ 300s), **dedupe by event id**, branch on
`data.payment.status`: `paid`/`completed` → settle (extend period **or** credit
wallet), `expired` → mark expired (reissue later), `reversed` → refund ledger +
downgrade if it was the live period.

## 5. Reminders — three channels

Fired by the hourly scheduler at `reminderDays` before `periodEnd`, during grace,
and when a wallet is low (`onDemand`).

| Channel | How |
| --- | --- |
| **OS notification** | In-app `pushToast` → `bridge.notify` (already built) for users with the app open. |
| **Email** | A mail adapter (`MAIL_*` env: SMTP URL or provider key + from-address). Templated: plan, amount, **due date**, **Pay link**. |
| **Telegram** | Reuse the existing bot token; send to the user’s linked Telegram chat when present. |

Delivery is recorded in a small `notifications` outbox so a failed send retries
and each reminder fires once. Channels are toggled in `reminderChannels`.

## 6. Scheduler (hourly tick, in `server.ts`)

1. Plan users: if `daysToEnd ∈ reminderDays` and that flag is unset → ensure an
   open invoice for the next period, (re)issue if the code died, notify, set flag.
2. `now > periodEnd` and `≤ graceUntil` → `status = grace`, send grace reminders, keep plan.
3. `now > graceUntil` → `billingMode = free` (per `fallbackPlan`), `status = expired`.
4. Open invoices older than a few minutes → `check-status` safety net → settle.
5. `payg`: notify when `balanceCents` crosses low thresholds (admin-set).

## 7. Enforcement (cost controls)

- `free`: monthly window over `usage_events` (`usageSince(user, monthStart)`) vs
  `freeMonthlyTokens`; over → 429 when `BOTIFYR_ENFORCE_BUDGET=1`, else warn + CTA.
- `plan`: no token cap (per-call `maxTokens` + rate limit still apply).
- `payg`: before a run, if `balanceCents ≤ 0` and `onEmpty = "block"` → 402/429
  with a top-up CTA; otherwise debit after each run and warn near zero.

## 8. Admin & user UI

- **admin (`apps/admin`)**: **Settings** tab (plans, free quota, grace,
  reminder days/channels, on-demand rate/min/onEmpty) + per-user view to set plan,
  grant comp credits, or switch `billingMode`.
- **user (shared UI)**: Usage & Billing shows plan/credits, period end, tokens
  used, and CTAs — **Upgrade**, **Top up**, **Pay now** (hosted link), **Renew**.
  Dismissible banner within the reminder window / grace / low balance.

## 9. Env

```
CHMABA_BASE_URL=https://pay.chmaba.com
CHMABA_API_KEY=ck_live_...
CHMABA_STORE=st_...            # or CHMABA_MERCHANT=botifyr (external_id)
CHMABA_WEBHOOK_SECRET=whsec_...
MAIL_FROM="Botifyr <billing@botifyr.xyz>"
SMTP_URL=smtp://user:pass@host:587      # or RESEND_API_KEY=...
TELEGRAM_BOT_TOKEN=...
```
Numeric policy (prices, quotas, grace, reminders, rates) lives in
`platform_settings`, **not** env.

## 10. Implementation plan

1. `schema.ts` — `platform_settings`, `invoices`, `wallet`, `ledger`,
   `notifications`; migrate `trial` → `free`; seed default settings.
2. `store/{types,memory,postgres}.ts` — CRUD for the above + `usageSince`.
3. `apps/cloud/src/billing.ts` (new) — ChmabaPay client (`createPayment`,
   `reissue`, `checkStatus`, `verifySignature`), reminder senders (email/Telegram),
   `runBillingTick(store, settings)`.
4. `server.ts` — `/v1/billing`, `/v1/billing/checkout` (plan|topup),
   `/v1/billing/chmaba/webhook` (raw body), `GET/PUT /admin/settings`, scheduler.
5. `packages/{shared,client}` — types + `billing()`, `billingCheckout(kind)`,
   `adminSettings()` / `adminSaveSettings()`.
6. `packages/ui` — Usage & Billing states + banner + notifying via existing toasts.
7. `apps/admin` — Settings tab.
8. docs + `.env.example`.

## 11. Edge cases
- QR dies in ~180s → keep the hosted link, `reissue` when dead.
- `idempotency_key = invoice.id` (in the **body**) so a retried create is safe.
- Missed webhook → `check-status` net settles it.
- Late payment settles after expiry → accept `payment.completed` and restore/credit.
- Refund (`reversed`) → refund ledger; downgrade only if it was the live period.
- No sandbox → validate with a **0.01** payment against a test ABA link first.
- Admin comp (grant plan/credits) writes a `grant` ledger entry, no invoice.

## 12. Decisions (answered)
1. On-demand per-token billing: **yes** — prepaid credit wallet, rate set in admin.
2. Reminders: **OS notification + email + Telegram**.
3. Grace behaviour: **admin-set** (`graceDays` = 7 default).
4. Free allowance: **admin-set** (`freeMonthlyTokens`), monthly reset.

## 13. Still open
1. Default numbers: pro price, `pricePerMTokensCents`, `freeMonthlyTokens`, low-balance threshold.
2. Email provider (SMTP vs Resend/SendGrid) + from-address/domain.
3. Telegram: only users who linked Telegram, or a fallback chat?
4. Do `pro` users also draw on-demand overage (admin toggle `onDemand.allowPro`)?
5. Business tier — needed now or keep free/pro?
