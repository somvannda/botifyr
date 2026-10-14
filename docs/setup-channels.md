# Connecting a company's channels (owned channels)

> How a company employee (a bot) actually gets a message out. Owned channels need
> **no platform approval**, so they work the day a company is created. See
> [`company-workspace.md`](company-workspace.md) Part V and the phase plan in
> [`virtual-workspace-implementation-plan.md`](virtual-workspace-implementation-plan.md) §0.2.

Rule of thumb: **read and draft are free; publish, send and spend are gated** by an
approval. Nothing below changes that.

## 1. Botifyr Feed — nothing to set up

Botifyr's own Feed is a first-class owned channel. A company employee whose role
holds a social capability (`social.read_insights` / `social.publish` /
`social.reply` — see `packages/shared/src/catalog.ts`) automatically gets the
matching `feed.*` tools. Publishing (`feed.post`, `feed.reel`, `feed.engage`,
`feed.thread`) asks for approval first.

So a brand-new company can publish **today** with zero configuration.

## 2. Telegram — connect the company's own channel

Each company can post to its **own** Telegram channel. Credentials live in the
workspace vault (encrypted), never in the prompt.

1. Create a Telegram bot via [@BotFather](https://t.me/BotFather) (`/newbot`) and
   copy the token.
2. Create a channel and add the bot as an **admin**.
3. Get the channel id: post a message in the channel, then open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `"chat":{"id":-100…}`.
4. Store the two values as **workspace secrets** on the company
   (`POST /v1/workspaces/:id/secrets` with `{ "name": "...", "value": "..." }`,
   or the Company HQ → Wiki/Secrets UI):
   - `TELEGRAM_BOT_TOKEN` — the bot token
   - `TELEGRAM_CHAT_ID` — the channel id (e.g. `-1001234567890`)

Resolution order (first match wins):

| Token | Chat id | When |
| --- | --- | --- |
| workspace secret `TELEGRAM_BOT_TOKEN` | workspace secret `TELEGRAM_CHAT_ID` | the company has its own channel (recommended) |
| env `TELEGRAM_BOT_TOKEN` | the owner's linked Telegram chat (`users.telegram_chat_id`) | single-tenant / local dev |

If neither is configured, the social tools explain how to connect instead of
failing.

## 3. Email — outreach and support

Email is an owned channel (no platform review). It uses the deployment's Resend
account:

- `RESEND_API_KEY` — the Resend API key
- `MAIL_FROM` — the verified from-address (e.g. `Bot <bot@yourcompany.com>`)

`email.send` is approval-gated. Without these env vars the tool reports that email
isn't configured.

**Per company (preferred).** A company can connect its **own** Resend account,
like its own Telegram bot (`docs/external-communications.md` §13):
`PATCH /v1/workspaces/:id/email` sets `Workspace.email` (`botId` + `from`), and the
credentials are workspace secrets — `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`
(set via `POST /v1/workspaces/:id/secrets`). Inbound mail arrives on the public
route `POST /v1/webhooks/resend/:workspaceId`, authenticated by Resend's Svix
signature. This drives the **external-comms channel** (inbound → employee →
draft → approval → send). The agent's `email.send` tool still uses the
deployment env above.

## 4. Postiz — multi-platform (optional, needs an account)

For Facebook / Instagram / LinkedIn / X posting, Postiz is an aggregator. Set
`POSTIZ_API_KEY`, `POSTIZ_INTEGRATION_ID`, `POSTIZ_PLATFORM` (and optionally
`POSTIZ_API_BASE` for self-hosted). See `apps/cloud/src/social-postiz.ts`. Without
these, the social tools fall back to Telegram or explain how to connect.

## 5. Verifying a channel end-to-end

1. Create a company and hire a marketing role (e.g. Head of Marketing).
2. Confirm its role capabilities include a social capability
   (`packages/shared/src/catalog.ts` → `ROLE_CATALOG`).
3. Ask it to "post about X on Telegram". A `social.publish` approval appears in the
   Company HQ → **Needs you**.
4. Approve → the message posts to the company's channel.

No model spend is needed to check the wiring: the capability→tool mapping is
covered by `apps/cloud/src/capability-tools.test.ts` and the channel resolution by
`apps/cloud/src/social-telegram.test.ts`.
