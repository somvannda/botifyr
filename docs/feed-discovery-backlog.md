# Feed & Discovery — Backlog

> Owner: **Feed & Discovery Manager**. Statuses: Not started · Ready · In progress ·
> Implemented · Testing · Verified · Documented · Deferred.
>
> "Verified" requires evidence (a passing test, a live interaction, or a captured
> screenshot) — not merely code. Last updated: **Oct 2026**.
> Plan: [`feed-discovery-plan.md`](feed-discovery-plan.md).

## Shipped (verified in the running app)

| ID | Area | Description | Priority | Evidence |
| --- | --- | --- | --- | --- |
| FEED-D1 | Timeline | Auto-load the next page near the bottom (IntersectionObserver, 600px look-ahead); keep Load More as fallback | P1 | `scripts/feed-discovery-verify.mjs`: 20 → 25 posts by scrolling alone |
| FEED-D2 | Timeline | End-of-timeline state ("You're all caught up") | P2 | verify script: `end-of-feed text: "You're all caught up"`; `FeedView.dom.test.tsx` |
| FEED-D3 | Timeline | De-duplicate appended posts by id + supersede stale responses + skip identical concurrent requests | P1 | verify script: 25 posts, 25 unique; perf script: 60 posts → exactly 3 `/v1/feed` calls (`[reset, c1, c2]`); `FeedView.dom.test.tsx` de-dup test |
| FEED-D4 | Timeline | Restore scroll offset when returning from Page/Group/Tag/Album/Reels | P1 | verify script: `scroll restoration: before=700, after=700` |
| FEED-D5 | Timeline | Topbar Refresh control (labelled) reloads the first page and returns to top | P2 | `FeedView.dom.test.tsx`; verify script: `refresh: before=25, after=20` |
| FEED-D6 | Timeline | Hold realtime updates behind a "New activity" banner when scrolled | P2 | `FeedView.dom.test.tsx` banner test; **live-verified** via the FEED-D10 fallback |
| FEED-D7 | Timeline | Explicit, labelled sort control (`<select aria-label="Sort feed">`) instead of an unlabelled toggle | P2 | `FeedView.dom.test.tsx`; verify script: `labelled Sort control visible=true` |
| FEED-D10 | Timeline | Freshness fallback: on focus/visibility, check the newest post and raise the banner if it changed (throttled; list untouched) | P2 | `FeedView.dom.test.tsx`; verify script: `fresh-content banner on wake: true`, `banner cleared after tap: true`; `discovery-new-activity.png` |
| FEED-D11 | Timeline | Polite live region announces "N more posts loaded" after infinite-scroll pagination | P2 | `FeedView.dom.test.tsx` (FEED-D11); verify script: `pagination live-region: "5 more posts loaded"` |

## Open

| ID | Area | Description | Priority | Dependencies | Acceptance criteria | Status |
| --- | --- | --- | --- | --- | --- | --- |
| FEED-D8 | Timeline | Paginate the `Top` (engagement) sort | P3 | backend | `Top` can load beyond one page | Deferred (backend) |
| FEED-D9 | Performance | Virtualize / memoize only if profiling shows a real long-list cost | P3 | profiling | Evidence-backed improvement | Not started |

## Backend dependencies

| ID | Description | Status | Evidence / remaining work |
| --- | --- | --- | --- |
| DB-1 | Realtime `feed.*` events were emitted but never delivered — `canReceive` in `apps/cloud/src/server.ts` had no `feed.*` cases, so the websocket fan-out dropped them | **Fixed + verified** | `feedEventRecipient` in `apps/cloud/src/events.ts` + `canReceive` routing; `apps/cloud/src/feed-realtime.test.ts` (websocket) and `events.test.ts`. Follow-up: friends' *new posts* still need recipient resolution at the emit site (`feed.post` carries only `authorId`) |
| DB-2 | Cursor pagination used `created_at < cursor` (strict), so posts sharing the boundary timestamp could be **skipped** | **Fixed + verified** | `encodeFeedCursor`/`decodeFeedCursor` (`server.ts`) + keyset `listFeedPosts` (`(created_at, id)`, postgres + memory); `apps/cloud/src/feed-pagination.test.ts` |

## Cross-workstream notes

| ID | Note | Owner |
| --- | --- | --- |
| X-1 | The concurrent Stories/Reels/Composer workstream repeatedly rewrote `FeedView.tsx` and `server.ts` during this work. All of its transient breakages (EXP-1/2/3 tests, composer typecheck error) have since been resolved by its owner; the Feed & Discovery changes were preserved throughout. | Stories/Reels/Composer Manager |
