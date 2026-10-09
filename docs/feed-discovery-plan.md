# Feed & Discovery — Research, Audit & Improvement Plan

> Owner: **Feed & Discovery Manager** · Scope: the **main Feed timeline and content
> discovery** (layout, tabs, sorting, pagination, scroll behaviour, refresh,
> new-content handling, empty/error states, the discovery rail). Reels, Stories,
> the specialized players and Page/Group administration are owned by other
> workstreams and are only referenced here.
>
> Method: source inspection + a **live runtime audit** of the running dev stack
> (desktop Vite host `http://localhost:1420`, cloud `http://localhost:8787`),
> plus headless Playwright evidence. Findings marked *(verified)* were observed
> at runtime; *(source)* come from reading code; *(backend)* require server work.
> Last updated: **Oct 2026**.
>
> Related documents: [`feed.md`](feed.md), [`feed-next.md`](feed-next.md),
> [`feed-improvement-plan.md`](feed-improvement-plan.md) (posts/composer, FEED-1…11),
> [`feed-experience-plan.md`](feed-experience-plan.md) (Stories/Reels/Composer,
> EXP-1…9). This document owns the **timeline & discovery** slice.

## A. Executive summary

The Feed is a mature surface: a friends/Pages timeline with `All / Friends / Pages`
tabs, `Most recent / Top` sorting, 7-way reactions, threaded comments, reposts,
save/hide/snooze/report/block, polls, media with a lightbox, Stories, Reels, Pages,
Groups, albums, and a discovery rail (people, Pages, groups, trending, albums).

The **presentation of individual posts** was already polished by the earlier
workstreams (action hierarchy, focus rings, media stability, skeletons, avatar
photos, long-post clamp, lightbox — `feed-improvement-plan.md`). The remaining
weakness was in the **timeline mechanics and continuity**, which this workstream
owns:

1. **Pagination was a manual "Load more" button only** — every extra page cost a
   click, and there was no end-of-timeline state. *(verified)*
2. **No de-duplication or request-supersession guard** — a refresh racing a
   "Load more" could append or clobber stale items. *(source)*
3. **Scroll position was lost** whenever the reader opened a Page/Group/Tag/Reels
   and came back — the timeline remounted at the top. *(source)*
4. **No manual refresh and no new-content indication** — the only refresh path
   was an external host signal, and it replaced the list silently. *(source)*
5. **The `Most recent / Top` control is an unlabelled toggle button** — unclear
   affordance for sorting. *(verified)*
6. **Two backend defects** limit the discovery features we can deliver:
   realtime `feed.*` events are **never delivered to clients** (the websocket
   filter drops them), and cursor pagination by `created_at` can **skip** posts
   that share a boundary timestamp.

This workstream **implemented and verified** the timeline fixes (FEED-D1…D6) and
**documented** the backend dependencies (DB-1, DB-2) rather than patching another
team's backend surface.

## B. Current-state architecture

- **Entry point:** `FeedView` in `packages/ui/src/FeedView.tsx`, rendered by
  `BotifyrApp.tsx` when the `Feed` tab is active; the right column is `FeedRail`.
- **Views inside one component:** main feed, `PageView`, `GroupView`, `TagView`,
  `AlbumView`, `ReelsView`, and the Story viewer — switched by props/state, so
  the main timeline subtree **unmounts** while a sub-view is open.
- **Data:** `BotifyrClient.listFeed(cursor, limit, { tab, sort })` →
  `{ items: FeedPost[], nextCursor }` (`packages/client/src/index.ts`).
- **Server:** `GET /v1/feed` (`apps/cloud/src/server.ts`). `recent` uses
  `listFeedPosts(authorIds, limit + 1, cursor)` where the cursor is the last
  item's `createdAt`; `top` is engagement-ranked over 30 days and returns
  `nextCursor: null` (no pagination).
- **Realtime:** the client opens `WebSocket /v1/stream` (`client.connect`);
  `BotifyrApp` bumps its `feedRefresh` key on `feed.*` events and passes it to
  `FeedView` as `refreshKey`.
- **State/caching:** all local React state in `FeedView`; no query cache. Tab and
  sort persist to `localStorage` (`botifyr.feedTab`, `botifyr.feedSort`).
- **Tests:** `packages/ui/src/FeedView.dom.test.tsx` (component),
  `apps/cloud/src/server.feed.test.ts` (API), `e2e/portal.spec.ts` (boot),
  `scripts/feed-screenshots.mjs` and `scripts/feed-discovery-verify.mjs` (visual/E2E).

## C. Competitive research

Research date: **9 Oct 2026**. Product patterns below are drawn from public
industry guidance and established product knowledge; external product screenshots
were **not** captured in this environment (documented as such).

| # | Reference | Pattern | User problem solved | Relevance | Adopt / adapt / reject |
| --- | --- | --- | --- | --- | --- |
| 1 | **NN/g — "Infinite Scrolling: When to Use It, When to Avoid It"** (Tim Neusesser; updated 2023-01-06; accessed 2026-10-09) | Auto-loading long, homogeneous feeds lowers interaction cost, but watch the *illusion of completeness*, refinding, and footer access; a **Load More** button or integrated pagination can be better | Users stop when they think the list has ended; endless scroll loses their place | **High** — our timeline is a discovery feed | **Adopt** auto-load, but add an explicit **end-of-feed state** to defeat the illusion of completeness |
| 2 | **NN/g — "Scrolling and Attention"** (2018, accessed 2026-10-09) | ~57% of viewing time is above the fold; ~74% in the first two screenfuls | Content low on the page is at risk of being missed | Medium | **Adapt** — keep the first screenful high-value; don't push content down with chrome |
| 3 | **LogRocket — "Pagination vs. infinite scroll"** (updated 2025-02-20; accessed 2026-10-09) | Hybrid: auto-load as you scroll **plus** a clear "you've seen n of m" cue | Users feel lost without progress/context | High | **Adopt** the auto-load; **adapt** with a lightweight progress/"all caught up" cue |
| 4 | **Justinmind — "Infinite scroll design: best practices"** (2025-03-21; accessed 2026-10-09) | Hybrid infinite + "Load More"; keep users in control | Fear of being trapped in an endless scroll | High | **Adopt** infinite scroll with a visible manual fallback |
| 5 | **UX Patterns — "Load More Pattern"** (accessed 2026-10-09) | Load More is the balanced middle ground between infinite scroll and pagination | Trade-off between momentum and control | Medium | **Adopt** as the accessible fallback when auto-load is unavailable |
| 6 | **IxDF — "Infinite Scrolling"** (updated 2026; accessed 2026-10-09) | Always show a loading indicator while more content loads | Users can't tell whether the app is working | High | **Adopt** — inline loading indicator at the list end |
| 7 | **Instagram / Facebook / X** (established product knowledge) | A **"N new posts"/"New activity"** pill at the top of the timeline rather than injecting content mid-read | New content disrupts reading and causes a jarring jump | **High** — we have realtime events | **Adopt** — hold updates behind a tappable banner |
| 8 | **LinkedIn / Facebook** (established product knowledge) | Sort/filter expressed as a **labelled control**, not an unlabelled toggle | Users can't find how the feed is ordered | Medium | **Adapt** — make the sort control explicit and announce its state |

Sources are real; the "established product knowledge" rows are explicitly marked
because no live screenshots of those apps were captured here.

## D. UX/UI gap analysis (ranked)

| # | Gap | Type | Impact | Frequency | Severity | Confidence | Effort | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | Manual-only pagination; no auto-load | Confirmed issue | High | Every long session | Medium | High *(verified)* | Low | **Fixed** |
| D2 | No end-of-timeline state ("illusion of completeness") | Confirmed issue | Medium | End of feed | Medium | High *(source)* | Low | **Fixed** |
| D3 | No de-dup / stale-response guard on append | Confirmed bug | High | Refresh racing scroll | High | High *(source)* | Low | **Fixed** |
| D4 | Scroll position lost when returning from a sub-view | Confirmed bug | High | Every post/page visit | High | High *(source)* | Low | **Fixed** |
| D5 | No manual refresh entry point | Improvement | Medium | When stuck/failed | Medium | High *(source)* | Low | **Fixed** |
| D6 | New content replaces the list silently mid-read | Improvement | Medium | Realtime events | Medium | High *(source)* | Low | **Fixed** |
| D7 | Sort control is an unlabelled toggle; state unclear | Improvement | Medium | Every session | Low | High *(verified)* | Low | **Fixed** |
| D8 | `Top` sort has no pagination (server returns `nextCursor: null`) | Backend limitation | Low | Power users | Low | High *(source)* | Medium | Documented |
| DB-1 | Realtime `feed.*` events never reach clients | **Backend defect** | High | Any live update | High | High *(verified)* | Low | **Fixed** |
| DB-2 | Cursor pagination can skip posts sharing a boundary `createdAt` | **Backend defect** | Medium | Rapid posting | Medium | High *(source)* | Medium | Documented |

## E. Proposed experience

- **Timeline:** loads the first page immediately; **auto-loads** the next page as
  the reader nears the bottom (600 px look-ahead) while keeping a **Load more**
  button as the accessible fallback. A **sentinel** stops once the cursor is
  exhausted.
- **Continuity:** the timeline remembers the per-view scroll offset and restores
  it when returning from a Page/Group/Tag/Album/Reels; opening those views never
  silently reloads the timeline.
- **Integrity:** appended pages are **de-duplicated by post id**, and a newer
  request (refresh, tab change) **supersedes** any in-flight page so stale
  responses can neither duplicate nor clobber the list.
- **States:** skeletons on first load; a friendly **empty** state; an **error
  banner with Retry** that retries the *same* page (not a full reset); an
  explicit **"You're all caught up"** end state.
- **Freshness:** a topbar **Refresh** button; realtime updates, when scrolled
  down, are held behind a **"New activity — tap to refresh"** banner instead of
  yanking content away. Because the server does not currently deliver `feed.*`
  events (DB-1), a **frontend fallback** re-checks the newest post when the app
  regains focus/visibility and raises the same banner — so new content surfaces
  without the broken realtime path and without disturbing a reader.
- **Discovery rail:** unchanged (people/Pages/groups/trending/albums) — it is
  owned by the rail and was already verified.

## F. Implementation roadmap

Priorities justified by user impact × frequency × severity × confidence ÷ effort.

- **P0 — none outstanding.** Core timeline flows work in the running app.
- **P1 — timeline reliability & continuity.**
  - FEED-D1 infinite scroll (with Load More fallback)
  - FEED-D3 de-dup + stale-response guard
  - FEED-D4 scroll restoration
- **P2 — discovery & freshness.**
  - FEED-D2 end-of-feed state
  - FEED-D5 manual refresh
  - FEED-D6 new-activity banner
  - FEED-D7 sort control discoverability
  - FEED-D10 focus/visibility freshness fallback (works without DB-1)
- **P3 — polish.**
  - Animate the new-activity banner; "n of m" progress cue; virtualize only if
    profiling shows a genuine long-list cost.
- **Backend dependencies (documented, not implemented here):**
  - **DB-1** deliver `feed.*` events to clients (enables realtime freshness).
  - **DB-2** keyset pagination that is stable across equal timestamps
    (e.g. `(created_at, id) < (cursor_at, cursor_id)`).

## G. Engineering backlog

| ID | Task | Acceptance criteria | Priority | Status |
| --- | --- | --- | --- | --- |
| FEED-D1 | Infinite scroll with Load More fallback | Scrolling near the bottom auto-fetches the next page; the Load More button remains when the observer is unavailable | P1 | **Implemented + verified** |
| FEED-D3 | De-duplicate appends + supersede stale responses + skip duplicate requests | No post renders twice across pages; a refresh racing a "more" cannot append stale items; identical concurrent requests are not re-sent | P1 | **Implemented + verified** |
| FEED-D4 | Scroll restoration across sub-views | Returning from a Page/Group/Tag/Reels keeps the previous scroll offset | P1 | **Implemented + verified** |
| FEED-D2 | End-of-timeline state | "You're all caught up" shows once the cursor is exhausted; Load More hides | P2 | **Implemented + verified** |
| FEED-D5 | Manual refresh control | A labelled topbar control reloads the first page and returns to the top | P2 | **Implemented + verified** |
| FEED-D6 | New-activity banner | When scrolled past ~120 px, realtime news shows a tappable banner instead of replacing the list | P2 | **Implemented + unit-tested** (live realtime path blocked by DB-1) |
| FEED-D7 | Make the sort control explicit | Sorting is a labelled `<select>` (`aria-label="Sort feed"`) with `Most recent` / `Top` options | P2 | **Implemented + verified** |
| FEED-D10 | Freshness without realtime | On regaining focus/visibility, check the newest post and raise the "New activity" banner if it changed (throttled; list untouched) | P2 | **Implemented + verified** |
| FEED-D8 | Paginate the `Top` sort | `Top` can scroll beyond one page | P3 | Documented (backend) |
| DB-1 | Deliver `feed.*` realtime events | Connected clients receive `feed.post/like/comment/share` they are eligible for | P1 | **Documented** (backend, `server.ts`) |
| DB-2 | Stable keyset pagination | No posts skipped when several share a `createdAt` | P2 | **Documented** (backend) |

## H. Testing strategy

- **Component (vitest + jsdom):** de-dup, auto-load via a stubbed
  `IntersectionObserver`, end-of-feed, topbar refresh, and the new-activity
  banner — all in `packages/ui/src/FeedView.dom.test.tsx`.
- **Headless E2E (Playwright):** `scripts/feed-discovery-verify.mjs` seeds a
  throwaway account with >1 page of posts and asserts page size, auto-load,
  uniqueness, end-of-feed, refresh, scroll restoration, and zero console errors.
- **Performance/reliability (Playwright):** `scripts/feed-discovery-perf.mjs`
  seeds 60 posts and asserts exactly one `/v1/feed` request per page
  (no duplicate/looping requests), that no request fires after the end, and that
  390/900/1680px layouts do not overflow.
- **Visual:** `docs/assets/feed/discovery-*.png`.
- **Regression gate:** `npm run typecheck -w @botifyr/ui`, `npx vitest run packages/ui`,
  `npx eslint` on the Feed files, and the repo-wide `npm test` when the tree is
  quiescent.
- **a11y:** keyboard reachability of the new controls; `role="status"` on the end
  state; the banner is a real button; existing `:focus-visible` ring applies.
