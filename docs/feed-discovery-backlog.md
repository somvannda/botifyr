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

## Open

| ID | Area | Description | Priority | Dependencies | Acceptance criteria | Status |
| --- | --- | --- | --- | --- | --- | --- |
| FEED-D8 | Timeline | Paginate the `Top` (engagement) sort | P3 | backend | `Top` can load beyond one page | Deferred (backend) |
| FEED-D9 | Performance | Virtualize / memoize only if profiling shows a real long-list cost | P3 | profiling | Evidence-backed improvement | Not started |

## Backend dependencies (documented, not implemented here)

| ID | Description | Evidence | Proposed fix |
| --- | --- | --- | --- |
| DB-1 | Realtime `feed.*` events are emitted but **never delivered** — `canReceive` in `apps/cloud/src/server.ts` has no `feed.post/like/comment/share/mention` cases, so the websocket fan-out drops them (`default: return false`) | source: `server.ts` `canReceive` (≈L656) vs. `emit({type:"feed.post"…})` (L4561) and fan-out `if (!canReceive(userId, event)) return` (L6449) | Add `feed.*` cases routing to the author's friends/followers (needs audience resolution) or include explicit recipients at the emit sites |
| DB-2 | Cursor pagination uses `created_at < cursor` (strict), so posts sharing the boundary timestamp can be **skipped** | source: `apps/cloud/src/store/postgres.ts` `listFeedPosts` | Keyset pagination on `(created_at, id)` |

## Cross-workstream notes

| ID | Note | Owner |
| --- | --- | --- |
| X-1 | The concurrent Stories/Reels workstream rewrote `StoryViewer`/`ReelsView` in `FeedView.tsx`; the resulting EXP-1/EXP-2/EXP-3 test breakages have since been fixed by that workstream (repo suite now **390 passed**). **Still open:** one composer typecheck error (`ComposerAttachment` vs. the un-updated `pickImages`/`publish` retry path, ≈L3715) from the in-progress Composer refactor. Not caused by the Feed & Discovery changes. | Stories/Reels/Composer Manager |
