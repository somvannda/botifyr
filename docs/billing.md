# Billing — prepaid monthly plans via ChmabaPay

Botifyr bills **prepaid**: a user pays for a period (a month) **up front**, and
we collect the next period *before* it starts. ChmabaPay (`pay.chmaba.com`) is a
**KHQR / ABA PayWay** checkout — it has **no recurring/subscription primitive**,
so we drive the renewal cycle ourselves: issue an invoice, remind, grace, then
downgrade. This is the "adapt a monthly subscription to prepaid" process.

> No real Stripe. The Stripe checkout/webhook code stays optional and unused.

## 1. Plans

| Plan | Price | Period | Monthly model tokens | Notes |
| --- | --- | --- | --- | --- |
| **free** | $0 | n/a | `BOTIFYR_FREE_MONTHLY_TOKENS` (e.g. 20,000) | Default. No card. |
| **pro** | e.g. $5.00 / 30 days | prepaid | effectively unlimited (rate limit only) | Paid via KHQR. |

`plan` is stored on the user; `trial` is renamed to **free** (a migration maps any
existing `trial` → `free`).

## 2. Entities

```
subscription (1 per user)
  userId
  plan:               "free" | "pro"
  currentPeriodStart  isoTimestamp | null
  currentPeriodEnd    isoTimestamp | null      // paid-through date
  graceUntil          isoTimestamp | null      // periodEnd + graceDays
  status:             "active" | "grace" | "expired" | "free"
  updatedAt

invoice (1 per period attempt)
  id                  "inv_<uuid>"
  userId
  plan                "pro"
  amountCents         integer
  currency            "USD"
  referenceId         provider reference (== invoice id)
  providerPaymentId   ChmabaPay payment id (no prefix)
  checkoutUrl         hosted KHQR page
  qrString            raw KHQR payload
  providerStatus      "pending" | "paid" | "expired" | "failed" | "superseded" | "reversed"
  status              "open" | "paid" | "void"   // our view
  periodStart / periodEnd   // the period this invoice pays for
  issuedAt / expiresAt / paidAt
  remindersSent       { d7: bool, d3: bool, d1: bool, grace: bool }
  createdAt / updatedAt
```

## 3. Lifecycle (state machine)

```
free ──subscribe──▶ invoice(open) ──paid──▶ pro/active (periodStart..periodEnd)
                         │                          │
                         │                    periodEnd - 7/3/1d
                         │                          ▼
                         │                   remind + (re)issue invoice
                         │                          │
                         │                  periodEnd reached, unpaid
                         │                          ▼
                         │                    pro/grace (until periodEnd+7d)
                         │                          │
                         │                  grace ended, unpaid
                         │                          ▼
                         └──────────────────────  free/expired
                                                    │
                              a late payment still settles (ChmabaPay) ──▶ back to pro
```

- **Subscribe / renew:** create an `invoice`, call `POST /v1/payments`, show the
  `checkout_url` / QR. On payment → `pro`, `periodStart = now`, `periodEnd = now + 30d`.
- **Advance reminders:** at `periodEnd − 7d`, `−3d`, `−1d` → ensure an open invoice
  for the next period and notify. A KHQR code only lives ~180s, so the reminder
  links to the **hosted checkout URL** (which the payer can (re)open); when the
  code is dead, `POST /v1/payments/{id}/reissue` mints a fresh one.
- **Grace:** from `periodEnd` to `periodEnd + 7d`, the user stays **pro**, with a
  persistent “payment due” banner and reminders at grace start / mid / end.
- **Downgrade:** after grace, set `plan = free`, `status = expired`. Keep the last
  `currentPeriodEnd` so a late payment can restore pro.

## 4. ChmabaPay mapping

Setting: one ChmabaPay **store** = Botifyr's merchant (external_id `botifyr`),
pointed at Botifyr's own ABA PayWay link (`raw_link`, `merchant_account_id`).
Money settles straight into that account; ChmabaPay never holds funds.

| Step | ChmabaPay call |
| --- | --- |
| Create invoice | `POST /v1/payments` `{ amount, reference_id: invoice.id, idempotency_key: invoice.id, store, metadata: { userId, plan } }` → `{ id, status, qr_string, checkout_url, expires_at }` |
| Refresh a dead code | `POST /v1/payments/{id}/reissue` |
| Read one | `GET /v1/payments/{id}` |
| Reconciliation net | `GET /v1/transactions/check-status/{id}` (`mark_paid=true`) |

**Webhook** — register `POST /v1/webhooks` with
`events: ["payment.completed","payment.expired","payment.reversed"]`; the response
returns the signing secret **once** → `CHMABA_WEBHOOK_SECRET`.

- Header `X-ChmabaPay-Signature: t=…,v1=…`; verify **HMAC-SHA256 over
  `{t}.{rawBody}`** (the same raw-body pattern already used for Stripe), reject
  drift > 300s.
- **Dedupe by event id** (stable across retries; up to 8 attempts).
- Branch on `data.payment.status` and `financial`, not the event name:
  - `payment.completed` + status `paid` → mark invoice paid, extend period.
  - `payment.expired` → mark `expired` (invoice stays *open* → reissue later).
  - `payment.reversed` → record refund; if it was the current period, downgrade.
- **Late payments settle:** ChmabaPay promotes an `expired` code to `paid` when it
  eventually settles — so we must accept `payment.completed` for an invoice we
  had marked expired and **restore pro**.

**Env:**
```
CHMABA_BASE_URL=https://pay.chmaba.com
CHMABA_API_KEY=ck_live_...
CHMABA_STORE=st_...            # or CHMABA_MERCHANT=botifyr (external_id)
CHMABA_WEBHOOK_SECRET=whsec_...
BOTIFYR_PRO_PRICE_CENTS=500
BOTIFYR_FREE_MONTHLY_TOKENS=20000
BOTIFYR_BILLING_GRACE_DAYS=7
```

## 5. Scheduler (one hourly tick)

Reuse the existing `setInterval` pattern in `server.ts`:

1. For every `pro` user, compute `daysToEnd`.
2. If `daysToEnd ∈ {7,3,1}` and that reminder isn’t sent → ensure an open invoice
   for the next period, (re)issue if the code is dead, notify, record the flag.
3. If `now > periodEnd` and `now ≤ graceUntil` → `status = grace`, send grace
   reminders, keep pro.
4. If `now > graceUntil` → `plan = free`, `status = expired`.
5. For every open invoice older than a few minutes, run `check-status` as a
   **webhook-miss safety net**; on PAID → settle.

## 6. Free plan + token allowance

- `free` users get `BOTIFYR_FREE_MONTHLY_TOKENS` per calendar month, enforced via
  a **monthly** window over the existing `usage_events` (`usageSince(user, monthStart)`).
  Over the allowance → the existing hard-budget response (HTTP 429) with an
  upgrade CTA (only when `BOTIFYR_ENFORCE_BUDGET=1`; otherwise a warning).
- `pro` users are not limited by the free allowance (per-call `maxTokens` + rate
  limit still apply).

## 7. UI

- Settings → **Usage & Billing**: plan, period end, tokens used (free), and:
  - **free** → “Upgrade to Pro” → `POST /v1/billing/checkout` → open `checkout_url`.
  - **grace/expired** → “Payment due” banner + **Pay now** (the hosted link) + due date.
  - **pro** → period end + “Renew now”.
- A dismissible **banner** when within 7 days of renewal or in grace.
- A **toast/OS notification** when a reminder fires.

## 8. Implementation plan (files)

1. `schema.ts` — `subscriptions` table (or extend `users` with period fields) and
   `invoices`; migrate `trial` → `free`.
2. `store/{types,memory,postgres}.ts` — subscription + invoice CRUD, `usageSince`.
3. `apps/cloud/src/billing.ts` (new) — ChmabaPay client: `createPayment`,
   `reissue`, `checkStatus`, `verifySignature`; and `runBillingTick(store)`.
4. `server.ts` — `GET /v1/billing`, `POST /v1/billing/checkout`,
   `POST /v1/billing/chmaba/webhook` (raw body), scheduler tick, free allowance.
5. `packages/client` — `billing()`, `billingCheckout()`.
6. `packages/ui` — Usage & Billing states, banner, notifications.
7. docs + `.env.example`.

## 9. Edge cases

- **KHQR expiry (~180s):** never trust the QR; keep the hosted `checkout_url`, and
  `reissue` when the code is dead.
- **Idempotency:** `idempotency_key = invoice.id` (in the **body**), so a retried
  create returns the same payment.
- **Webhook missed:** the `check-status` safety net settles it.
- **Refund (`reversed`):** bookkeeping — we don't hold funds; downgrade if it was
  the live period.
- **No sandbox:** point the store at a test ABA link and mint a **0.01** payment
  to validate the signature end-to-end before going live.
- **Reversal after downgrade**, **partial/overpayment**, and **admin comp**
  (grant pro without an invoice) are handled as manual/admin actions.

## 10. Open questions

1. Price per month, and whether to offer multi-month prepay (3/6/12 months at a discount).
2. Reminder **channels**: in-app + OS notification now; email/Telegram later.
3. Grace: full pro during grace, or reduce limits after `periodEnd`?
4. Free allowance size and whether it resets monthly or is a one-time trial grant.
