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
| Plan | Price (admin-set) | Period | Included tokens / period |
| --- | --- | --- | --- |
| **free** | $0 | — | `freeMonthlyTokens` (admin-set, monthly) |
| **pro** | `proPriceCents` | `proPeriodDays` | `plans.includedTokens.pro` (default 5,000,000) |
| **business** | `businessPriceCents` | `proPeriodDays` | `plans.includedTokens.business` (default 50,000,000) |

Over the included quota, work continues only via on-demand credits (or the free
fallback) — see §7.

`trial` is renamed to **free** (migration maps existing `trial` → `free`).

### On-demand (charge per token)
- The charge is derived **per model** from an admin-maintained **model-pricing
  table** (§2.1): for each model, the provider cost we pay (`inputCentsPerM`,
  `outputCentsPerM`, per 1M tokens) plus a **markup** (global default **15%**,
  per-model override). User price = `providerCost × (1 + markup%)`.
- Every completed run records tokens **and the model** in `usage_events`. For
  `payg` users we write a **ledger debit**:
  `cost = prompt/1e6·inputCentsPerM + completion/1e6·outputCentsPerM`, then
  `charge = round(cost × (1 + markup/100))` cents.
- A **wallet** holds `balanceCents`. Top-ups are ChmabaPay payments crediting the
  wallet on `payment.completed` (`metadata.kind = "topup"`).
- When `balanceCents ≤ 0`: **block** with a top-up CTA, or fall back to the free
  allowance first — admin choice (`onDemand.onEmpty`).
- The **free allowance** is a token count (`freeMonthlyTokens`); its dollar value
  is priced with the same model table. DeepSeek is cheap, so 20k free tokens cost
  us a fraction of a cent — the markup only matters on paid volume.

## 2. Platform settings (admin-controlled)

One `platform_settings` row (JSON), read by billing + cost controls and edited in
**apps/admin → Billing**. Cached in memory, invalidated on write.

```
plans:            { proPriceCents: 500, businessPriceCents: 1900,
                    proPeriodDays: 30, currency: "USD",
                    includedTokens: { pro: 5000000, business: 50000000 } }
freeMonthlyTokens: 500000
lowBalanceCents:  100              # warn/top-up prompt below this
graceDays:        7
reminderDays:     [7, 3, 1]
reminderChannels: { os: true, email: true, telegram: true }
onDemand:         { enabled: true, markupPercent: 15, minTopUpCents: 100,
                    allowPro: false, onEmpty: "block" | "free" }
fallbackPlan:     "free"
```

- **API:** `GET /admin/settings` and `PUT /admin/settings` (admin-only, audited).
- **Admin UI:** `apps/admin` has a **Billing** tab. The user app reads the
  public subset via `/v1/billing`.

### 2.1 Model pricing (drives on-demand + free-allowance value)

An admin-maintained table (one row per model), separate from the single settings
row. Edit in **apps/admin → Billing → Model pricing**:

```
model_pricing
  model            e.g. "deepseek-chat"
  provider         e.g. "deepseek"
  inputCentsPerM   what we pay the provider, per 1M input tokens
  outputCentsPerM  per 1M output tokens
  markupPercent    optional override of the global 15%
  enabled
  updatedAt
```

> Prices are set from real provider rates (DeepSeek published pricing), then the
> markup (≥15%) is applied on top. Keep a row per model we ship; a run with no
> matching row falls back to the most expensive enabled row (never under-charge).

## 3. Entities

```
platform_settings   (single row)                         # §2
model_pricing       (one row per model)                  # §2.1

subscription (fields on `users`; 1/user)
  userId, billingMode: free|plan|payg
  plan, currentPeriodStart, currentPeriodEnd, graceUntil
  status: active|grace|expired|free

wallet (table `wallets`; 1/user, for payg)
  userId, balanceCents, updatedAt

ledger (append-only money movement)
  id, userId, kind: topup|usage|refund|grant
  amountCents (+credit / −debit), tokens?, model?, note?, createdAt

invoice (1 per period attempt or top-up)
  id "inv_<uuid>", userId, kind: plan|topup
  plan?, amountCents, currency, referenceId, providerPaymentId, checkoutUrl, qrString
  providerStatus: pending|paid|expired|failed|superseded|reversed
  status: open|paid|void
  periodStart?, periodEnd?, issuedAt, expiresAt?, paidAt
  reminders: { d7, d3, d1, grace }
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
- `plan`: per-period included-token cap (`plans.includedTokens.<plan>`, measured
  from `periodStart`); over → renew/top-up CTA, though credits can cover it when
  `onDemand.allowPro`. Per-call `maxTokens` + rate limit still apply.
- `payg`: before a run, if `balanceCents ≤ 0` and `onEmpty = "block"` → 402/429
  with a top-up CTA; otherwise debit after each run and warn near zero.

## 8. Admin & user UI

- **admin (`apps/admin`)**: **Billing** tab (plans, free quota, grace,
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
RESEND_API_KEY=re_...
MAIL_FROM="Botifyr <billing@botifyr.xyz>"
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
7. `apps/admin` — Billing tab.
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
1. On-demand per-token billing: **yes** — prepaid credits; price is **per-model**
   (provider cost + **≥15% markup**), maintained in admin (§2.1).
2. Reminders: **OS notification + email (Resend) + Telegram**; Telegram only for
   users who linked it.
3. Grace: **admin-set** (`graceDays`, default 7).
4. Free allowance: **admin-set** (`freeMonthlyTokens`), monthly reset; low-balance
   threshold also admin-set.
5. Tiers: **free · pro · business** (business = higher price + capacity).

## 13. Still open
1. Default numbers: business price, DeepSeek model cost rows, low-balance default.
2. Resend from-address + verified domain.
3. Do `pro` users also draw on-demand overage (admin toggle `onDemand.allowPro`)?
