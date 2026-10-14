# Botifyr — Launch Cut

> Status: **proposal — awaiting owner approval.** Owner: product/eng.
> Written because the repo is "too big to launch": **61 tables, ~150 `/v1`
> routes, an 8,618-line `BotifyrApp.tsx`, 65 docs** — spanning two unrelated
> cost curves. This doc cuts the launch down to **one product** and parks the
> rest. It reuses what exists; it does not rebuild it.

## 1. The reframe (settle the "3 products" question)

There is **one product, one interface to it, and one separate business**:

| "Product" | What it really is | Launch? | Shares engine? |
| --- | --- | --- | --- |
| Bot (agent, skills, hands) | The **engine** — loop, sandboxes, tools, trust ladder | ✅ | core |
| AI workspace / company | A **mode of the same engine** (roles, quests, inbox, budget) | ✅ | yes — same core |
| Chat — with your bot **and** between real friends | **Messaging** — a communication product (DM, group, presence, files) | ✅ | yes — same chat layer |
| The **Feed** + its features (posts, pages, groups, stories, reels) | A **separate consumer media business** | ⛔ defer | only the shared `media` table |

**Decision:** launch the engine + its workspace + **chat** (bot chat *and*
real-friend messaging) as **one product, two skins** (solo "your bot" · team
"your company"). Defer **the Feed and everything built on it** to its own
roadmap ([`social-roadmap.md`](social-roadmap.md)). The two cost curves must
never ship together.

Real people talking to each other is *messaging*, bounded by a friend graph —
not a broadcast/content network. That is why chat stays and the Feed goes.

This is consistent with `docs/product-plan.md` (the control layer *is* the
product) and `docs/roadmap.md` §8 ("small team → sequence, don't parallelize").
It does **not** contradict `AGENTS.md` §7 (one UI): that rule is about the
product's UI, not about forcing a social network into the launch.

## 2. Launch scope — IN vs. OUT (mapped to the repo)

### IN — the agent product (all of this is already built)

| Surface | Routes (`apps/cloud/src/server.ts`) | UI |
| --- | --- | --- |
| Agent sessions & tasks | `/v1/sessions*`, `/v1/tasks*` (cancel/retry/screenshot/audit/usage/downloads/stream/approvals) | `BotifyrApp` chat + task views |
| Hands (browser/computer/code) | `/v1/sessions/:id/computer*`, code/browser sandboxes (`infra/*`) | remote-desktop modal, screen record |
| Skills (learned + declarative) | `/v1/skills`, `/v1/learned-skills*` | Skills surfaces |
| Company / workspace | `/v1/workspaces*` (plan, quests, work, needs, inbox, triggers, hooks, budget, grants, standup, reports, stop, wiki, members, activate/deactivate/run, repos, proposals), `/v1/quests`, `/v1/work` | `CompanyWorkspace.tsx`, HQ tabs |
| Chat — with bots **and** between real friends | `/v1/conversations*` (DM/group, read, typing, reactions), `/v1/dm*`, `/v1/sessions/:id/messages`, `/v1/people*`, `/v1/profile` | chat list, composer, contact panel |
| Friends graph (needed to chat) | `/v1/friends*`, `/v1/friend-requests*`, `/v1/blocks`, `/v1/users/:id/block` | People/Friends panel |
| Media as an agent output | `/v1/media*`, `/v1/uploads*`, `/v1/transcribe`, `/v1/translate`, `/v1/shared`, player + Range | Library/Downloads, player |
| Connections, secrets, node | `/v1/connections*`, `/v1/secrets*`, `/v1/node*`, `/v1/devices*` | Settings, node |
| Billing & keys | `/v1/billing*`, `/v1/api-keys*` | Usage & Billing |
| Realtime (bounded) | `/v1/stream` (websocket), typing/presence for your own sessions | — |

Core tables to keep (~34): `users`, `auth_tokens`, `sessions`, `tasks`,
`audit_events`, `secrets`, `bots`, `workspaces`, `workspace_roles`, `work_items`,
`quests`, `workspace_budget`, `capability_grants`, `company_reports`,
`connections`, `usage_events`, `files`, `learned_skills`, `api_keys`, `media`,
`media_recipes`, `device_keys`, `platform_settings`, `model_pricing`,
`provider_roles`, `invoices`, `wallets`, `ledger`, `notifications`, `contacts`,
`conversations`, `friendships`, `friend_requests`, `blocks`.

### OUT — the Feed and its features (defer, don't delete)

| Surface | Routes | Tables | UI |
| --- | --- | --- | --- |
| Feed | `/v1/feed*`, `/v1/feed/trending`, `/v1/feed/image`, `/v1/tags/:tag/posts` | — | `FeedView.tsx`, `FeedSidebar.tsx`, `feedKit.tsx` |
| Posts & engagement | `/v1/posts*`, `/v1/comments*`, `/v1/reactions`, `/v1/saved`, `/v1/dashboard`, `/v1/memories`, `/v1/birthdays`, `/v1/albums`, `/v1/authors/:id/mute`, reports | `posts`, `post_likes`, `post_comments`, `post_shares`, `post_saves`, `post_hides`, `post_reactions`, `comment_reactions`, `post_media`, `post_drafts`, `post_reports`, `author_mutes`, `post_polls`, `poll_options`, `poll_votes`, `post_hashtags`, `post_views` | inline in `BotifyrApp.tsx` |
| Pages | `/v1/pages*`, `/v1/pages/:id/insights` | `pages`, `page_roles`, `page_bot_roles`, `page_followers` | Pages panel |
| Groups (social) | `/v1/groups*`, `/v1/groups/*/posts`, members, requests, invite | `groups`, `group_members`, `group_join_requests` | Groups panel |
| Stories / Reels | `/v1/stories*`, `/v1/reels` | `stories`, `story_views`, `story_reactions` | `Stories.tsx` |
| Scheduled posts | `/v1/posts/scheduled` | `post_drafts` | composer |

**~27 of 61 tables (~44% of the schema) belong to the deferred Feed product.**
Chat, friends, and the agent core keep the other ~34.

## 3. The wedge — ship one flagship job, not "everything"

A horizontal "browser + desktop + code + social + company" pitch is what makes
it feel unlaunchable. Pick **one** concrete, high-value job you already do
unusually well and lead with it:

> **Primary wedge — media → translate/dub → publish.** You already have hardened
> extractors (YouTube, TikTok, GoodShort/DramaBox/ShortMax via `media.sniff`),
> subtitle tracks, video translation (dub + lip-sync plan in
> [`video-translation.md`](video-translation.md)), and publishing **to external
> platforms** (Telegram/email/social tools — *not* our Feed). For a small
> content team this is a real, demonstrable outcome with a clear buyer.

> **Secondary wedge — "an AI employee" for a 2–10 person team** (the workspace):
> one quest in, outcomes out, behind the decision Inbox. Lead with the *control
> layer* ([`product-plan.md`](product-plan.md)) — not the org chart.

Do **not** lead with: the 3D office, the social feed, 23 roles, or "most
autonomous." Those are the "theater" items `product-plan.md` §4 already
de-prioritized.

## 4. Infrastructure — two cost curves, don't run both

| | Agent product (launch) | Feed product (deferred) |
| --- | --- | --- |
| Dominant cost | **Compute + model tokens** (pay-per-use) | **Egress + storage + CDN + moderation** |
| Realtime | websocket for *your* sessions (bounded) | global feed/DM realtime at scale |
| Storage | modest (task media, DB) | media/video at scale, object storage + CDN |
| Hard part | sandbox isolation, model cost control | **network effects, moderation, legal** |
| Monetization | subscription + credits (billing ships) | ad-driven, slow, winner-take-most |

**Correction to the intuition:** the bot is *not* "small" once you do browser /
desktop computer-use (a VM/sandbox per task is real work), but it **is bounded
and pay-per-use** — unlike social, whose burn scales with the user graph, not
usage. So the agent is the small, controllable infrastructure; social is the
one that needs capital.

Launch topology (already supported): one cloud API + Postgres + sandbox workers.
Do not stand up social infra until the social product is actually picked up.

## 5. Sequence

**Now — Launch cut (this doc).**
1. Add a **`BOTIFYR_SOCIAL=off`** server flag: social routes are not registered
   (or return `404`), and the **Feed tab / social panels are hidden** in the UI.
   This gives a one-product build without ripping out code.
2. Repoint `docs/roadmap.md` Feed items to [`social-roadmap.md`](social-roadmap.md).
3. Make the flagship wedge the **default demo** (seed the media→translate job).
4. Unblock the real-model run — DeepSeek is out of credit (402); fund a provider.

**Then — prove it.**
5. One **realistic end-to-end run** of the wedge on a real model, not just
   `vitest` (`product-plan.md` §8).
6. Real-hands promotion on the launch capabilities only (email/social-publish as
   an *agent tool*, code/deploy) — never the Feed surface.

**Later — separate decision.**
7. Pick up [`social-roadmap.md`](social-roadmap.md) on its own track, brand, and
   budget, only after the agent product has traction/revenue.

## 6. Definition of done (launch)

- A new user can **sign up, give the bot one goal, and get a finished artifact**
  — without hitting a Feed feature, a 3D office, or an org chart.
- The flagship wedge completes end-to-end on a **real model**, with cost visible
  before it's spent.
- **Zero** consequential actions run untrusted (the ladder holds).
- The build ships with `BOTIFYR_SOCIAL=off`; the Feed tab is absent.
- Marketing, docs, and the web site describe **one** product.

## 7. Honest constraints (read before deleting anything)

- **The UI is one 8,618-line file.** Feed, chat, pages, reels and the company HQ
  are rendered *inline* in `BotifyrApp.tsx` alongside the agent surfaces. "Defer
  the Feed" is therefore a **feature-flag + hide**, not a delete. A true split is
  a later, deliberate refactor.
- **Some surfaces are shared.** `media`/`uploads` gated the Feed *and* the
  agent's downloads/player — keep them; only the feed *routes* move out.
  `conversations` powers both real-friend DMs and chat-with-bot — keep it whole.
- **Don't drop tables.** The Feed tables stay in `schema.ts` (idempotent SQL,
  additive); the flag disables routes, not data. Dropping is a migration for a
  later day.
- **`friendships`/`friend_requests`/`blocks` stay live** — they are what makes
  real-friend chat work, and they are not Feed-only. Only the Feed's *content*
  surface (posts/pages/groups/stories/reels) is deferred.

## 8. What "aligned vs. separate" means, concretely

- **Aligned at the engine layer:** one core (`agent-core`), one UI
  (`packages/ui`), one trust model, one billing, one Postgres. ✅
- **Separate at the go-to-market layer:** the agent product and the Feed product
  get separate positioning, docs, roadmaps, pricing, and eventually
  separate infra and possibly separate brands.
- **Never launch both cost curves at once.**
