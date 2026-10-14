# External Communications — design (sales, marketing, support)

> **Status:** design draft — nothing built for this section yet beyond the pieces
> listed in §2. Owner: product/eng. Companion docs:
> [`company-workspace.md`](company-workspace.md) (the org + hands),
> [`virtual-workspace-implementation-plan.md`](virtual-workspace-implementation-plan.md)
> (phases), [`setup-channels.md`](setup-channels.md) (connecting channels).
>
> **Goal:** give the chair/board **one place** to see, run and review **external
> conversations** — who we talk to, on which platform, what the AI said, and what
> needs a human — for a company whose Sales/Support employees answer real
> customers through their own bots.

## 1. The ask (as stated)

- Customers connect their **own** Telegram bot, add it to channels/groups, and
  chat with customers.
- The bot **acts as the hired Sales/Support employee** (its name, its tools).
- Inbound DMs are **reviewed by the chair first**, then — once approved — the bot
  answers **every message from that customer** without re-approving each one.
- The employee **surfaces what needs attention** (important/unusual messages).
- The chair/board gets a **good UI** showing what's going on: **who we've reached,
  who we're in communication with**, and the state of each relationship.

## 2. What already exists (do not rebuild)

| Need | Already in the repo |
| --- | --- |
| Telegram **inbound** (receive DMs) | `packages/channels/src/telegram.ts` — long-polls `getUpdates`, no public URL |
| Inbound → **AI runs → replies in chat** | `apps/cloud/src/channels/service.ts` (`ChannelService`): message → task → `runTask` → "On it…" → result back to the chat |
| Approval **over the chat** | `ChannelService.onEvent` posts the approval and accepts `allow`/`deny` replies |
| Telegram **publish/reply/insights** | `apps/cloud/src/social-telegram.ts` (`SocialClient`), incl. per-workspace token resolution |
| Encrypted per-workspace credentials | workspace secrets (`POST /v1/workspaces/:id/secrets`), read + decrypted in `runner.ts` |
| **CRM activity log** | `apps/cloud/src/crm-tools.ts` → `crm.log_activity` (per-lead `CRM-<lead>.md`) |
| **Ranked "Needs you" inbox** | `apps/cloud/src/inbox.ts` → `GET /v1/workspaces/:id/inbox` → HQ panel |
| Trust ladder (`gated → probation → trusted`) | `capability-ladder.ts` + `capability_grants` |
| Role instructions / who-uses-which-tool | `role-instructions.ts` + capability gating (`runner.ts`) |
| Inbound **webhook** primitive | `apps/cloud/src/triggers.ts` + `POST /v1/workspaces/:id/hooks/:name` |

**So §1's core loop largely works today** — for **one** global bot, answering as a
**generic** agent (not a company employee). The work is *per-customer bots* +
*routing to the employee* + the *workspace UI*.

## 3. The gap

1. **One bot, not per customer.** `channels/index.ts` registers a single adapter
   from `TELEGRAM_BOT_TOKEN`. Companies can't bring their own bot.
2. **No employee identity on inbound.** Inbound chats create a synthetic
   per-chat user with **no company role** — so no role playbook, no role tools
   (`crm.log_activity`, `email.send`, `social.reply`, …). It's a generic agent.
3. **No conversation/contact model.** There's no first-class "we are talking to
   *Acme Corp* on Telegram" entity; chat ids live only in the channels service's
   in-memory map.
4. **No external-communications UI.** The Feed is **internal** social (Botifyr's
   own wall) — deliberately *not* external. There's no inbox, no contact list, no
   campaign view for external channels.
5. **Approval is unscoped.** `ChannelService` keeps one `pending` per conversation
   and "allow" is per task. There's no "**trust this customer's thread**".

## 4. Domain model (new)

All additive; reuse the existing store patterns (JSONB records or small tables).

```
Contact        { id, workspaceId, platform, externalId, name, handle, avatarUrl?,
                 company?, tags[], ownerBotId?, source: "inbound"|"campaign"|"import",
                 firstSeenAt, lastMessageAt, status: "new"|"active"|"won"|"lost"|"archived" }

Conversation   { id, contactId, workspaceId, platform, kind: "dm"|"group"|"channel",
                 externalChatId, assignedBotId, trust: "gated"|"trusted",
                 unread, awaitingHuman, lastMessageAt }

Message        { id, conversationId, direction: "in"|"out", authorKind: "contact"|"bot"|"human",
                 authorId?, body, attachments[], status: "received"|"draft"|"pending_approval"|"sent"|"failed",
                 taskId?, createdAt }
```

- **Contact** is the "who we talk to" spine — the CRM view (§7) is essentially
  contacts + their conversations + `crm.log_activity` history.
- **Conversation.trust** is per **customer**, exactly as asked: approval is on the
  **first** reply (or until the chair trusts it); after that the assigned employee
  answers every message in that thread. (Optionally a `trustUntil`/`maxAutoReplies`.)
- **Attention** is *derived*, not stored raw: see §7.3.

## 5. Approval & trust (per customer)

Chosen model: **B — review first, then auto per customer.**

```
inbound message
  → Conversation exists?  no → create Contact + Conversation (trust: gated)
  → assigned employee drafts a reply
  → conversation.trust === "gated"?
        yes → create Approval (kind: "reply") → surfaces in "Needs you"
              chair:      [ Approve ]  [ Edit & approve ]  [ Deny ]
              optional:   [ Trust this customer ]   ← flips Conversation.trust = trusted
        no  → send immediately, append Message(out), crm.log_activity
```

- The **"Trust this customer"** action is the per-customer approval the chair
  asked for — *not* a global allow-once. Implementation: one boolean on the
  Conversation (no new trust-ladder machinery needed for v1; it can later fold
  into the capability ladder as a `contact:<id>` grant).
- Consequential *tools* the employee uses (e.g. `email.send`, a refund) stay
  approval-gated regardless of conversation trust — the thread trust only covers
  **replying in this conversation**.
- Every outbound message is audited (`AuditEvent`) and written to the CRM.

## 6. Identity & naming (important reality)

- **Display name = the employee.** Set on connect and kept in sync when the
  employee is renamed: Telegram `setMyName` (display name), `setMyDescription`
  (bio), `setMyProfilePhoto` (avatar). The customer sees *"Sokha · Sales"*.
- **`@username` is globally unique** and chosen at @BotFather — it **cannot** be
  guaranteed to match the employee's name. The UI shows the real handle
  (`@acme_sales_bot`) next to the employee's name, and never pretends they match.
- **One bot ⇄ one employee** (decision 1a). If the chair renames or replaces the
  employee, the bot display name follows; the handle does not change.

## 7. UX / information architecture — "External" section

A new top-level **External** area in the company workspace (distinct from the
internal **Feed**). Four views:

### 7.1 Inbox (primary surface)
Classic three-pane, unified across platforms (Telegram first, email next):

```
┌ Filters ────────┐┌ Thread: Acme Corp · Telegram ────┐┌ Contact ───────────────┐
│ ● Needs you (3) ││ [in]  Do you deliver to SR?      ││ Acme Corp              │
│   Unassigned    ││ [out] Sokha drafted: Yes, we do… ││ @acme · Sokha (Sales)  │
│   Unread        ││       ┌ needs your approval ┐   ││ tag: prospect          │
│   All           ││       │ [Approve][Trust][Deny]│  ││ ─────────────────────  │
│ ── Platforms ── ││       └──────────────────────┘  ││ Trust replies: [ off ] │
│   Telegram (12) ││ [in]  Great — what's the price?  ││ Owner: Sokha (Sales)   │
│   Email (4)     ││                                  ││ ── History ──────────  │
│ ── Owners ───── ││ ┌ Draft a reply ──────────────┐ ││ • sent intro (2d)      │
│   Sokha (Sales) ││ │ type…            [Send]     │ ││ • asked pricing (1h)   │
│   …             ││ └─────────────────────────────┘ ││ ── Linked ───────────  │
└─────────────────┘└──────────────────────────────────┘└────────────────────────┘
```

- **Needs you** = conversations with a pending reply approval or an attention
  flag (§7.3). Approving here is the whole review loop.
- The chair can **edit** a draft before approving, or **send their own** message
  (it's attributed as *human*, not bot).
- The contact pane holds the **Trust replies** toggle (per-customer approval),
  owner (which employee handles it), tags, and CRM history.

### 7.2 Contacts / Pipeline (the CRM answer)
A table answering **"who we've reached / who we're in communication with"**:

| Contact | Platform | Last message | Owner | Status | Source | Messages |
| --- | --- | --- | --- | --- | --- | --- |
| Acme Corp | Telegram | 1h ago | Sokha (Sales) | active | inbound | 14 |
| Beta LLC | Email | 3d ago | Dara (Sales) | won | campaign | 6 |

Filters: platform, owner, status, tag, `source` (inbound vs campaign). Row →
opens the conversation. This is the board's "what's going on" view.

### 7.3 Attention — how the employee surfacing works
Two layers, both feeding the same "Needs you" queue:

1. **Rules (deterministic, always on):** first message from a new contact;
   keywords (pricing, refund, complaint, cancel, legal, invoice); a VIP/`won`/
   `lost`-tag contact; unanswered for > N hours; a failed send; a group mention.
2. **The employee's judgement (`company.escalate`):** the Sales/Support agent
   calls `company.escalate` when *it* judges a message important, unclear, or
   beyond its remit — which already creates a human-gated approval.

Both map to new `InboxKind`s (`reply_pending`, `contact_attention`) in
`inbox.ts`, so the existing ranked inbox and HQ panel light up with no new UI
plumbing.

### 7.4 Campaigns (marketing)
Plan → draft → approve → schedule → measure, built on existing pieces:
`company.plan` (strategy), `library.write` (drafts), `design.poster` (visuals),
`feed.post`/`social.publish` (publish), the quest layer for goals. A campaign
view lists target platforms/audiences, the drafts, their approval state, and
results (reusing `social.read_insights`).
> **Honest note:** for Telegram, "campaign" means **posting to channels/groups the
> bot is in** — a bot cannot cold-DM (see §10).

## 8. Data flows

**Inbound (sales/support)**
```
platform (long-poll / webhook)
  → find/create Contact + Conversation        (new)
  → route to Conversation.assignedBotId       (the employee)
  → runTask({ author: employee, session: employee session })   ← so role playbook + tools apply
  → draft reply
  → trust? → send | Approval → chair → send
  → Message(out) stored, crm.log_activity, audit
```

**Outbound (marketing)**
```
campaign → employee drafts → approvals (batch where safe) → schedule/publish
  (Telegram channel/group, email; Feed is internal-only)
```

## 9. Reuse map (what changes)

| Piece | Reuse | Change |
| --- | --- | --- |
| `ChannelService` | ✅ loop, approvals-in-chat | route to the **employee** (author + session) when the adapter is company-scoped |
| `createTelegramChannel` | ✅ poll + send | instantiate **one per workspace bot** |
| Workspace secrets | ✅ `TELEGRAM_BOT_TOKEN` | add a `telegram: { botId }` workspace config + a connect route |
| `Store` | ✅ | add `Contact`/`Conversation`/`Message` records + a way to enumerate workspaces-with-a-bot |
| `inbox.ts` | ✅ ranked inbox | add `reply_pending` / `contact_attention` kinds |
| `crm-tools.ts` | ✅ `crm.log_activity` | write to a `Contact` too, not just a wiki file |
| `role-instructions.ts` | ✅ | already tells Sales/Support to reply + log |
| `approvals.ts` | ✅ | add a `reply` approval kind with `Trust this customer` |
| UI (`packages/ui`) | ✅ panels/tokens | new **External** section (Inbox / Contacts / Campaigns) |

## 10. Platform reality & limits (be honest in the UI)

- A bot **cannot message anyone who hasn't started it**; there is **no cold-DM**.
  So Telegram relationships are **inbound- or group-initiated**, and the CRM's
  "source" must say `inbound`, not "outbound". (Consent-friendly; limits
  prospecting.)
- **Group privacy mode** is on by default — the bot sees only commands/mentions
  unless it's disabled (the chair does that in @BotFather).
- **Channel posting** needs the bot added **as admin**.
- **Managing a human account's DMs** needs MTProto + a phone login — do **not**
  for v1.
- **Display name ≠ @username** (§6).
- Polling is fine for tens of bots; at scale switch to **webhooks** (public URL +
  `X-Telegram-Bot-Api-Secret-Token`), reusing the triggers webhook pattern.

## 11. Phased slices

1. ✅ **Per-workspace bot + route to employee** (SHIPPED): `Workspace.telegram`,
   `listWorkspacesWithTelegram`, `channel-routing.ts`, `ChannelService` scope +
   injectable runner, `createChannels` registering a bot per company, and
   `PATCH /v1/workspaces/:id/telegram` (+ client). An inbound message on a
   company bot now runs **as the employee** (its role, tools, session). Config
   changes take effect on the next cloud start.
2. ✅ **Contact + Conversation records on inbound** (SHIPPED): `Contact` /
   `Conversation` types, memory + postgres stores (with tables), `ChannelService`
   upserting a contact + thread for every inbound company-bot message, and
   `GET /v1/workspaces/:id/contacts` (+ client). `crm.log_activity` still writes a
   wiki file — wiring it onto the Contact is a small follow-up.
3. 🟡 **External Inbox** — **3a (data) SHIPPED**: `Conversation.sessionId`, the
   store reads `listExternalConversations` / `getConversation`, and the routes
   `GET /v1/workspaces/:id/conversations`, `GET /v1/conversations/:id/messages`
   (transcript) and `PATCH /v1/conversations/:id` (the per-customer **trust**
   toggle) + client methods. **3b (UI) pending**: the three-pane inbox with
   approve/edit/deny and the **Trust this customer** control.
4. **Attention kinds** in `inbox.ts` (rules + `company.escalate`) surfaced in HQ.
5. **Contacts/Pipeline view** (the CRM answer).
6. **Campaigns** (marketing) + email as a second platform.
7. **Webhook option** + more platforms (Bluesky/Mastodon/Discord/Slack) per
   `company-workspace.md` Part V ordering.

## 12. Open questions (need a decision)

1. **One bot per employee, or one bot for the company** answering for several
   employees? (Proposed: one bot ⇄ one employee for v1.)
2. **Trust expiry** — should `Trust this customer` expire (e.g. after 30 days, or
   if the contact goes quiet)? (Proposed: no expiry for v1, but a visible toggle.)
3. **Group chats** — is the bot a passive listener (mentions only) or does it
   answer every message? (Proposed: mentions only, v1.)
4. **Email as a platform** — is the first non-Telegram channel IMAP/SMTP (real
   inbound) or outbound-only + manual paste? (Proposed: defer; Telegram proves the
   model.)
