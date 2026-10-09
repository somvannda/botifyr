# Feed & Discovery — UX Audit

> **Historical record** — ports reflect the run at the time. Canonical local dev is defined in [`AGENTS.md`](../AGENTS.md) §10.

> Agent 3 (Feed & Discovery Manager). Scope: the **main feed timeline** — its
> structure, loading, ordering, pagination, refresh and feed-specific state.
> Composer (Agent 8), Stories (Agent 6), post cards (Agent 4), the page shell
> (Agent 1) and shared tokens (Agent 2) are referenced, not owned here.
>
> Method: source inspection + a **live audit** of the running app (desktop Vite
> host `:1420`, cloud `:8787`) with headless Playwright evidence. Findings marked
> *(verified)* were observed at runtime. Date: **Oct 2026**.

## 1. Architecture (verified in source)

- **Framework:** React 18 + TypeScript, Vite; one shared UI package rendered by
  both hosts (desktop/portal) — `packages/ui`.
- **Feed route/component:** `FeedView` in `packages/ui/src/FeedView.tsx`,
  rendered by `BotifyrApp.tsx` when the `Feed` tab is active. The right column is
  `FeedRail`.
- **Sub-views inside one component:** `PageView`, `GroupView`, `TagView`,
  `AlbumView`, `ReelsView`, the Story viewer — so the timeline subtree unmounts
  while a sub-view is open.
- **API client / endpoints:** `BotifyrClient.listFeed(cursor, limit, { tab, sort })`
  → `{ items: FeedPost[], nextCursor }` (`packages/client/src/index.ts`); server
  `GET /v1/feed` (`apps/cloud/src/server.ts`).
- **Data model:** `FeedPost` (author, body, media, reactions, myReaction, poll,
  original, pageId…).
- **Ordering:** server-side. `sort=recent` → newest-first by `(created_at DESC,
  id DESC)` keyset; `sort=top` → engagement-ranked over 30 days.
- **State/caching:** local React state in `FeedView`; no query cache. Tabs/sort
  persist to `localStorage` (`botifyr.feedTab`, `botifyr.feedSort`).
- **Realtime:** `WebSocket /v1/stream`; the host bumps `refreshKey` on `feed.*`.
- **Tests/build:** `packages/ui/src/FeedView.dom.test.tsx`,
  `apps/cloud/src/server.feed.test.ts` (+ realtime/pagination tests),
  `e2e/*.spec.ts`; gate = `npm run typecheck && npm run lint && npm test`.

## 2. Rendered findings

| # | Finding | Type | Evidence | Status |
| --- | --- | --- | --- | --- |
| 1 | **Timeline order is Stories → Composer → posts** (MediaFacebook-style story tray first) | Confirmed | source (`FeedView` render) + screenshot | **Supersedes FEED-ORDER** |
| 2 | Pagination was a manual **Load more** button only; no end state | Confirmed | source | Fixed (FEED-D1/D2) |
| 3 | No **de-duplication** or stale-response guard on append | Confirmed bug | source | Fixed (FEED-D3) |
| 4 | **Scroll position lost** when returning from Page/Group/Tag/Reels | Confirmed bug | source | Fixed (FEED-D4) |
| 5 | No **manual refresh** entry point | Improvement | source | Fixed (FEED-D5) |
| 6 | New content **replaced the list silently** mid-read | Improvement | source | Fixed (FEED-D6) |
| 7 | Sort control was an **unlabelled toggle** | Improvement | rendered | Fixed (FEED-D7) |
| 8 | No **screen-reader announcement** when a page loads | a11y | source | Fixed (FEED-D11) |
| 9 | Realtime `feed.*` events were **never delivered** (websocket filter) | Backend defect | source | Fixed (DB-1) |
| 10 | Cursor pagination could **skip posts** sharing a timestamp | Backend defect | source | Fixed (DB-2) |
| 11 | `Top` sort returns a single ranked page (no pagination) | Backend limitation | source | Fixed (FEED-D8) |

Non-issues confirmed (not defects): page reload returning to Chat is intentional;
no horizontal overflow at 390/900/1680px; media now reserves space (Agent 4).

## 3. Gap analysis (ranked by impact × frequency × severity)

1. **Timeline order** (Stories/Composer) — structural, every session. The story
   tray is the first row, above the composer, followed by posts.
2. **Pagination integrity** (dupes/skips/stale) — data correctness. *Fixed.*
3. **Scroll continuity** across sub-views — every post/page visit. *Fixed.*
4. **Freshness** (realtime + fallback) — new-content discovery. *Fixed.*
5. **States** (skeletons/empty/error/end/pagination a11y) — reliability. *Fixed.*
6. **`Top`-sort pagination** — power users. *Fixed (FEED-D8, offset cursor).*

## 4. Backend dependencies

- **DB-1** — `canReceive` had no `feed.*` cases, so realtime delivery was dead.
  *Fixed* (`feedEventRecipient` + websocket test). **Follow-up done:** friends'
  *new posts* now reach friends via `feed.post.toUserIds` (stripped before send).
- **DB-2** — `created_at < cursor` skipped equal-timestamp posts. *Fixed* (keyset
  `(createdAt, id)`).
- **FEED-D8** — `Top` ranking had no stable cursor. *Fixed* with an offset cursor
  (`listTrendingPosts(..., offset)` + `feed-top-pagination.test.ts`).

## 5. Coordination

- **Agent 1 (shell/width):** timeline column is a fixed comfortable 620px,
  centered, aligned with composer/Stories; no horizontal overflow. No shell edits
  made here.
- **Agent 4 (post cards):** posts use the shared component; no duplicate card.
- **Agent 6 (Stories):** `StoriesStrip` is reused; only its *position* moved.
- **Agent 8 (composer):** the composer form is unchanged; only its *position*
  moved above Stories.

> Deeper detail and history: [`feed-discovery-plan.md`](feed-discovery-plan.md),
> [`feed-discovery-backlog.md`](feed-discovery-backlog.md),
> [`feed-discovery-progress.md`](feed-discovery-progress.md).
