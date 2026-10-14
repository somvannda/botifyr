# Botifyr — Feed (social media) roadmap — DEFERRED

> Status: **deferred — not part of the launch.** Owner: product/eng.
> The Feed is the Facebook-style content product: a timeline of posts with
> likes, comments, shares, saves, Pages, Groups, Stories, Reels, and the
> discovery around them. It is **parked** so it stops inflating the launch
> ([`launch-cut.md`](launch-cut.md) §5). This doc tracks it for the day we pick
> it up — as its own product, brand, and budget.

> **Not deferred: chat.** Real-friend DMs/group chats and chat-with-your-bot
> stay in the launch product. Only the **Feed's content surfaces** go here.

## 1. Why it's deferred (be honest)

The Feed is a **different business** from the agent, on a different cost curve:

| | Agent product (launch) | Feed product |
| --- | --- | --- |
| Dominant cost | compute + model tokens (pay-per-use) | **egress + media/video storage + CDN + moderation** |
| Engine of growth | a job done well, word of mouth | **network effects (winner-take-most)** |
| Hard part | sandbox isolation, model cost | **moderation, trust & safety, legal** |
| Monetization | subscription + credits (ships) | ads / promoted Pages (slow) |
| Realtime | your sessions only | global feed + notification fan-out |

Shipping both at once is what made the repo "too big to launch." The Feed needs
capital and a team that the launch shouldn't carry.

## 2. What already exists (reuse, don't rebuild)

Phase 1 of the Feed is **already implemented** — this is real code, just parked.

| Surface | Routes (`apps/cloud/src/server.ts`) | Tables | UI |
| --- | --- | --- | --- |
| Feed timeline | `/v1/feed`, `/v1/feed/trending`, `/v1/feed/image` | — | `FeedView.tsx`, `FeedSidebar.tsx`, `feedKit.tsx` |
| Posts & engagement | `/v1/posts*`, `/v1/comments*`, `/v1/reactions`, `/v1/saved`, `/v1/dashboard`, `/v1/memories`, `/v1/birthdays`, `/v1/albums`, `/v1/authors/:id/mute`, reports | `posts`, `post_likes`, `post_comments`, `post_shares`, `post_saves`, `post_hides`, `post_reactions`, `comment_reactions`, `post_media`, `post_drafts`, `post_reports`, `author_mutes`, `post_polls`, `poll_options`, `poll_votes`, `post_hashtags`, `post_views` | inline in `BotifyrApp.tsx` |
| Pages | `/v1/pages*`, `/v1/pages/:id/insights`, roles, follow, pin | `pages`, `page_roles`, `page_bot_roles`, `page_followers` | Pages panel |
| Groups (social) | `/v1/groups*`, `/v1/groups/*/posts`, members, join requests, invite, discover | `groups`, `group_members`, `group_join_requests` | Groups panel |
| Stories / Reels | `/v1/stories*`, `/v1/reels` | `stories`, `story_views`, `story_reactions` | `Stories.tsx` |
| Scheduled posts | `/v1/posts/scheduled` | `post_drafts` | composer |

**~27 of 61 tables** — the Feed is roughly **44% of the current schema**.
Background: [`feed.md`](feed.md), [`feed-roadmap`](feed-experience-plan.md),
[`pages-implementation-plan.md`](pages-implementation-plan.md),
[`reels-implementation-plan.md`](reels-implementation-plan.md),
[`stories-implementation-plan.md`](stories-implementation-plan.md).

## 3. Infrastructure it needs (none of this at launch)

- **Object storage + CDN** for images/video (today media sits in the app's
  volume — fine for agent outputs, wrong for a public feed).
- **Feed fan-out / read path** — the timeline must scale with the graph, not
  with requests (fan-out-on-write vs. read, caching, pagination today is
  in-process).
- **Realtime fan-out** — notifications/reactions to many clients (the current
  `/v1/stream` is per-session).
- **Moderation & trust/safety** — reports, mutes, blocks (partial today),
  automated + human review, appeals.
- **Legal** — content policy, copyright (post media), age/minor safety,
  regional takedown.
- **Analytics/ads** — Reach/insights exist; a monetization layer does not.

## 4. When we pick it up — phases

- **F0 — isolate.** Give the Feed its own product boundary (own app or brand,
  own infra/DB or schema namespace). Never co-launch with the agent.
- **F1 — harden what's built.** Feed read/write, posts, reactions, comments,
  media upload, profiles. Move media to object storage + CDN. Add rate limits.
- **F2 — Pages + Groups** at production quality (roles, insights, join flow).
- **F3 — Stories / Reels** (video pipeline, then the AI video-translation
  capability becomes a *publishing* feature here).
- **F4 — distribution & monetization.** Discovery/trending, recommendations,
  promoted content, moderation tooling, ads.
- **Gateway throughout:** moderation + abuse tooling and a content policy exist
  *before* any public distribution.

## 5. The one link to the agent product

Keep exactly one: the agent can **publish to the Feed as a channel** (a
`feed.post` capability, already an agent tool). The agent product should not
depend on the Feed for any core flow; the Feed may, later, depend on the agent
for content generation. That ordering is the point of deferring it.

## 6. What "deferred" means in code today

- Server: register the Feed routes behind **`BOTIFYR_SOCIAL=off`** (absent or
  `404`) — see [`launch-cut.md`](launch-cut.md) §5.
- UI: hide the **Feed tab / social panels**; leave the components in place.
- Data: **keep the tables** (additive, idempotent `schema.ts`); no drop until a
  deliberate migration.
- Docs: this file is the Feed's home; `roadmap.md` points here.
