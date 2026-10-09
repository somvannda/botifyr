# Feed Experience Lead (Agent 1) — Progress

> Durable resume point for the Facebook-inspired Feed page redesign.
> Plan: [`docs/feed-page-redesign-plan.md`](../feed-page-redesign-plan.md).

## Objective

Recreate the reference layout with the primary navigation as a **Feed-scoped
bottom menu inside the central feed column**, reusing real app data and
preserving functionality.

## Environment

- Repo `G:\Developments\botifyr.xyz`. Running: cloud `:8787`, portal `:4322`,
  desktop Vite dev `:1420`, Postgres `:54329`.
- Headless verification via `scripts/feed-screenshots.mjs`, `scripts/feed-qa.mjs`.

## Decisions (per user)

- The bottom menu is **Feed-only**, rendered **inside the Feed panel/column**
  (between the left sidebar and the right sidebar) — not a global app nav.
- Menu items are **Feed features only**: **Feed · Reels · Pages · Groups ·
  Marketplace**. (Stories stays at the top of the Feed.)
- The **left sidebar tabs (Chat · Feed · Virtual Workspace) are restored**.

## Files changed (this workstream)

- `packages/ui/src/FeedView.tsx`
  - Added `GroupsView` (lists `client.listGroups` → opens a group).
  - Added `onOpenMarketplace` prop; `groupsOpen` state + early return.
  - Added the Feed bottom menu inside `.feed` (Feed/Reels/Pages/Groups/Marketplace)
    with distinct accessible names (`Feed home`, `Open Reels`, `Open Pages`,
    `Open Groups`, `Open Marketplace`).
- `packages/ui/src/BotifyrApp.tsx`
  - Passes `onOpenMarketplace={() => setShowConnectApps(true)}` to `FeedView`.
  - Removed the earlier placeholder global nav.
- `packages/ui/src/styles.css`
  - `.feed-bottom-nav` (in-flow, inside the feed column), `.bottom-nav-item`,
    `.bottom-nav-badge`, `.feed-list-row`/`.feed-list-*`.
  - Restored the left sidebar tabs (no longer hidden); reverted `.app` height.
- `packages/ui/src/Icons.tsx` — added `HomeIcon` (additive).
- Docs: this file + `docs/feed-page-redesign-plan.md`.

## Test results (actual)

- `npm run typecheck -w @botifyr/ui` → **passed**.
- `npm test` → **436 passed / 436** (62 files).
- `npx vitest run packages/ui/src/FeedView.dom.test.tsx` → **67 passed**.
- Fixed: duplicate accessible names ("Reels"/"Pages") that broke 17 tests →
  distinct `aria-label`s on the bottom-menu items.

## Known issues / blockers

- **Reference screenshot missing** — `ref.png` in temp is a 32×32 placeholder;
  the real image was not found. Pixel-accurate sizing is pending the image.
- **Redundant Reels control**: the Feed topbar still shows a "Reels" button
  alongside the new bottom-menu "Reels". Recommend the Feed & Discovery / Reels
  owner retires the topbar one.
- **Sidebar sections**: only real data used (Who to follow, Pages to follow, Top
  posts, Blocked). No sponsored/birthdays (no data) — omitted, not faked.
- Concurrent multi-agent edits touch the same shared files.

## Next actions

1. Get the reference screenshot → do a spacing/typography/sizing pass.
2. Coordinate removal of the topbar "Reels" button.
3. Hand to Agent 9 for Final Integrated QA once feature agents report complete.

## Polish pass (per user "go")

- **Bottom menu polish:** larger icons (22px), 52px min touch target, 11.5px labels,
  hover background, active accent + indicator.
- **Removed the duplicate topbar "Reels" button**; the Feed menu's Reels now owns
  the accessible name `Reels` (Reels tests still pass — 69/69).
- **Right-rail section headings** now have a subtle separator.
- Deferred to owners (to avoid cross-owner churn): composer horizontal compaction
  (Composer Manager) and story-card sizing (Stories Manager); story cards already
  have uniform size + seen ring.

### Test results after polish

- `npm run typecheck -w @botifyr/ui` → passed.
- `npm test` → **446 passed / 446** (63 files).
- `FeedView.dom.test.tsx` → **69 passed**.
- Note: a transient concurrent `reactToStory` error broke the build mid-run; the
  owning workstream fixed it. No action taken on another owner's in-progress code.

## Final delivery (merged to origin/main)

- **PR #4 — Friend requests** in the Feed sidebar (Accept/Decline, real API).
- **PR #7 — Online contacts** ("Online now", real `listFriends()` presence).
- Sidebar now: Friend requests · Online now · Your Groups · Pages to follow · Your
  Pages · Who to follow · Top posts · Blocked — all real data; no sponsored/
  birthdays (no data, omitted rather than faked).
- **Bottom menu persists across Feed sub-views** via a shared `FeedBottomNav` +
  `.feed-shell` (Reels/Groups/Page/Group/Tag/Album); "Feed" returns home.
- Duplicate topbar **Reels** button removed.

### Verification (actual)

- CI per PR: `Typecheck / Lint / Test` + `Cloud image` → green.
- Local integrated run (primary, commit `051a8bf`): `npm run typecheck` passed;
  `npm run lint` clean; `npm test` → **467 passed / 467** (65 files).

### Handoff

- Agent 9 Final Integrated QA: `docs/agent-progress/feed-qa-handoff.md`.

### Still open

- **Reference screenshot** not supplied → pixel-accurate pass pending.
- Composer horizontal compaction (Agent 8) and story-card sizing (Agent 6)
  delegated per product owner instruction.
- Backend gaps (documented): DB-1 realtime `feed.*`, DB-2 pagination tie-break,
  story-view endpoint, Reels captions, Page tabs/cursor, permalinks.

