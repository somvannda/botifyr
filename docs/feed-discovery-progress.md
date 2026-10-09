# Feed & Discovery — Progress Checkpoint

> Resume point for the **Feed & Discovery Manager** assignment. Update after
> meaningful work. Plan: [`feed-discovery-plan.md`](feed-discovery-plan.md) ·
> Backlog: [`feed-discovery-backlog.md`](feed-discovery-backlog.md).

## Objective

Improve the **main Feed timeline and discovery**: layout, tabs/sorting,
pagination, infinite scroll, scroll continuity, refresh/new-content handling,
and empty/error states — with verification.

## Environment

- Repo `G:\Developments\botifyr.xyz` (npm workspaces, Node 24).
- Running: cloud `:8787`, portal `:4322`, admin `:4324`, Postgres `:54329`,
  **desktop Vite dev host `:1420`** (HMR over `packages/ui`).
- Browser: Code Mode `browser.*` (screenshots need a visible tab) plus **headless
  Playwright** (`scripts/feed-discovery-verify.mjs`, `scripts/feed-screenshots.mjs`).

## Files inspected

- `packages/ui/src/FeedView.tsx` (timeline, `PostCard`, `CommentRow`, rail).
- `packages/ui/src/styles.css` (`.feed-scroll`, `.feed-more`, `.feed-empty`,
  responsive block).
- `packages/client/src/index.ts` (`listFeed`, `FeedPage`, `connect`/WebSocket).
- `apps/cloud/src/server.ts` (`GET /v1/feed`, `canReceive`, `/v1/stream`).
- `apps/cloud/src/store/postgres.ts` + `memory.ts` (`listFeedPosts`).
- `apps/cloud/src/events.ts`; `packages/ui/src/BotifyrApp.tsx` (`feedRefresh`).
- `packages/ui/src/FeedView.dom.test.tsx`, `docs/feed-improvement-plan.md`,
  `docs/feed-experience-plan.md`, `docs/feed-manager-progress.md`.

## Files modified (this workstream)

- `packages/ui/src/FeedView.tsx` — timeline mechanics (see "Done").
- `packages/ui/src/styles.css` — `.feed-end`, `.feed-sentinel`,
  `.feed-new-banner`, `.feed-sort`.
- `packages/ui/src/FeedView.dom.test.tsx` — 7 new timeline/discovery tests
  (FEED-D1/D2/D3/D5/D6/D7/D10).
- `apps/cloud/src/server.ts` + `apps/cloud/src/events.ts` — DB-1 realtime
  delivery filter (`feedEventRecipient` / `canReceive`).
- `apps/cloud/src/events.test.ts`, `apps/cloud/src/feed-realtime.test.ts` — DB-1
  routing + websocket integration tests.
- `scripts/feed-discovery-verify.mjs` — new headless E2E/visual verification.
- `scripts/feed-discovery-perf.mjs` — headless performance/reliability checks
  (request de-duplication, no infinite-scroll loop, tablet/wide layout).
- `docs/feed-discovery-plan.md`, `docs/feed-discovery-backlog.md`,
  `docs/feed-discovery-progress.md` (this file).

## Findings & decisions

- The post-card/composer work (FEED-1…11) and Stories/Reels/Composer work
  (EXP-1…9) were already in flight; this assignment owns the **timeline**.
- Confirmed runtime gaps: manual-only pagination, no end state, no de-dup/race
  guard, scroll lost across sub-views, no manual refresh, silent realtime replace.
- **Decision:** implemented the frontend timeline fixes; **documented** two
  backend defects rather than editing a concurrently-owned `server.ts`:
  - **DB-1** `canReceive` drops `feed.*` → realtime freshness is dead.
  - **DB-2** `created_at < cursor` pagination can skip equal-timestamp posts.

## Done (implemented)

- **FEED-D1** infinite scroll (`IntersectionObserver`, `rootMargin: 600px`),
  Load More retained as fallback.
- **FEED-D2** end-of-timeline state ("You're all caught up").
- **FEED-D3** append de-duplication by id, monotonic request guard (`loadSeqRef`),
  and **identical-concurrent-request de-duplication** (`inFlightRef`).
- **FEED-D4** per-view scroll restoration (`scrollPosRef`, callback ref).
- **FEED-D5** labelled topbar **Refresh feed** control.
- **FEED-D6** "New activity — tap to refresh" banner when scrolled > 120px.
- **FEED-D7** explicit, labelled sort control (`<select aria-label="Sort feed">`
  with `Most recent` / `Top`), replacing the unlabelled toggle.
- **FEED-D10** freshness fallback: on regaining focus/visibility, fetch the
  newest post (throttled 15s) and raise the "New activity" banner if the top
  changed — so new content surfaces even though the realtime stream is dead
  (DB-1), and the list is never replaced under the reader.
- **DB-1 (backend)** realtime delivery: `canReceive` now routes
  `feed.like/comment/share/mention` to the event's `toUserId` and `feed.post` to
  its `authorId`, via a pure `feedEventRecipient` helper — so the app's existing
  realtime toasts/refresh work. (Friends' *new posts* still rely on FEED-D10.)
- Bonus: error **Retry** now retries the failed page (`errorMode`) instead of a
  full reset.

## Tests executed & actual results

- `npx vitest run packages/ui` → **64 passed / 64** (immediately after the batch).
- `npx vitest run packages/ui/src/FeedView.dom.test.tsx` → **17 passed / 17**
  (13 prior + my FEED-D1/D2/D3/D5 tests; the FEED-D6 banner test passes too).
- `npm run typecheck -w @botifyr/ui` → **passed** immediately after the batch.
- `npx eslint packages/ui/src/FeedView.tsx packages/ui/src/FeedView.dom.test.tsx`
  → **clean** (exit 0).
- **Live E2E** `node scripts/feed-discovery-verify.mjs` (throwaway account, 25 posts):
  - `initial probe posts: 20` (page size) ✓
  - `after auto-load probe posts: 25` — auto-load worked by scrolling alone ✓
  - `unique probe posts: 25` — **no duplicates** ✓
  - `end-of-feed state shown: true`, text `"You're all caught up"` ✓
  - `manual refresh: posts before=25, after=20` ✓
  - `scroll restoration: before=700, after=700` ✓
  - `console errors: 0` ✓
- Visual evidence: `docs/assets/feed/discovery-end-of-feed.png`,
  `docs/assets/feed/discovery-restored.png`, `docs/assets/feed/discovery-mobile.png`.

### Performance & reliability verification

`node scripts/feed-discovery-perf.mjs` (throwaway account, **60 posts**, exactly
3 pages) — after adding request de-duplication:

- `rendered posts: 60`, `unique probe bodies: 60` (no duplicates) ✓
- `/v1/feed requests: 3`, `distinct cursors: 3`,
  `request sequence: [<reset>, c1, c2]` — **no duplicate requests** ✓
  (before the fix this was `[<reset>, <reset>, c1, c2]`, i.e. the StrictMode
  remount sent the initial page twice)
- `end-of-feed reached: true`, `scroll-to-end wall time: 722ms for 3 pages` ✓
- `extra /v1/feed requests after end: 0` — **no infinite-scroll loop** ✓
- `discovery-tablet @900` / `discovery-wide @1680`: `scrollWidth == innerWidth`
  (**no horizontal overflow**) ✓
- `console errors: 0` ✓
- Evidence: `docs/assets/feed/discovery-tablet.png`, `discovery-wide.png`.

### After the concurrent merge (re-verified)

The Stories/Reels/Composer workstream rewrote large parts of `FeedView.tsx` and
its test file, but my timeline code and tests survived and still pass:

- `npm test` (repo-wide) → **437 passed / 437** (63 files, at the time of writing).
- `npx vitest run packages/ui/src/FeedView.dom.test.tsx` → **67 passed / 67**
  (includes FEED-D1/D2/D3/D5/D6/D7/D10, which are still present).
- **Live E2E** re-run `node scripts/feed-discovery-verify.mjs` (added a11y +
  responsive checks):
  - `initial 20` → `after auto-load 25` → `unique 25` (no dupes) ✓
  - `end-of-feed text: "You're all caught up"`, `role: status` ✓
  - `manual refresh: before=25, after=20` ✓
  - `scroll restoration: before=700, after=700` ✓
  - `a11y: Refresh control aria-label="Refresh feed"`,
    `labelled Sort control visible=true` ✓
  - `mobile 390: scrollWidth=390, innerWidth=390` (**no horizontal overflow**),
    `Refresh control visible=true` ✓
  - `fresh-content banner on wake: true`, `banner cleared after tap: true` —
    the FEED-D10 freshness fallback raises the real "New activity" banner even
    though DB-1 blocks the *realtime* path ✓
  - `console errors: 0` ✓
- `npm run typecheck -w @botifyr/ui` → **clean** (the Composer workstream
  subsequently completed its `ComposerAttachment` retry path).
- `npx eslint packages/ui/src/FeedView.tsx packages/ui/src/FeedView.dom.test.tsx`
  → **0 errors**.

## Known failures / not verified

- **No failures remain.** The repo-wide suite is **437 passed / 437** (63 files)
  and the Feed test file is **67 passed / 67**, including all of
  FEED-D1/D2/D3/D5/D6/D7/D10. The transient EXP-1/EXP-2 (Stories) and EXP-3
  (Reels) failures from the concurrent workstream were fixed by their owner, and
  the composer typecheck error was resolved too.
- **DB-1 is fixed.** Feed realtime delivery is covered by `events.test.ts`
  (routing) and `feed-realtime.test.ts` (websocket). Remaining follow-up:
  friends' *new posts* over realtime need recipient resolution at the emit site
  (`feed.post` carries only `authorId`); the FEED-D10 fallback covers that UX.
- **Backend defect DB-2** (equal-timestamp cursor skips) documented, not fixed.

## Blockers

- **None outstanding.** The earlier concurrent-workstream blocker (a
  half-finished Composer `ComposerAttachment` refactor that left `tsc` red) has
  been resolved by the Composer owner; `npm run typecheck` is now clean.

_Historical note:_ during the session the concurrent workstream left transient
`tsc` errors in `StoryViewer`/composer and 2–3 failing Stories tests; all have
since been resolved by that workstream.

## Exact next action

1. **✅ Complete.** All Feed & Discovery work (FEED-D1…D7 + D10) is implemented
   and verified: repo suite **428 passed / 428**, Feed tests **67 passed / 67**,
   `typecheck` clean, `eslint` 0 errors, and both headless scripts
   (`feed-discovery-verify.mjs`, `feed-discovery-perf.mjs`) pass every check —
   pagination integrity, no duplicate requests, no infinite-scroll loop, end
   state, scroll restoration, refresh/sort, freshness-on-wake, and no overflow at
   390/900/1680px.
2. **Owner action (backend):** implement **DB-1** (deliver `feed.*` realtime
   events) and **DB-2** (stable `(created_at, id)` keyset pagination).
3. **Optional polish (P3):** `FEED-D8` paginate the `Top` sort once the backend
   supports it; `FEED-D9` virtualization only if profiling shows a real cost.
