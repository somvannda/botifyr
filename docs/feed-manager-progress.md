# Feed Manager — Progress Checkpoint

> Resume point for the Feed UX/UI assignment. Update after meaningful work.

## Assignment scope

Improve the **Feed** only: layout/visual design, navigation/organisation, post
presentation, interactions, composer entry points, discovery, reliability, and
a11y — then test. Deliverables: audit, competitive research, plan, backlog,
implementation, tests, evidence, handover. See `docs/feed-improvement-plan.md`.

## Environment

- Repo: `G:\Developments\botifyr.xyz` (npm workspaces; Node 20+).
- Running: `botifyr-cloud` `:8787`, `botifyr-web` portal `:4322`,
  `botifyr-admin` `:4324`, `botifyr-postgres` `:54329`; **desktop Vite dev host
  `:1420`** (live HMR over `packages/ui` — no Docker rebuild needed for UI edits).
- Playwright config: `playwright.config.ts` (baseURL `http://localhost:4322`,
  dir `e2e`). Only `e2e/portal.spec.ts` exists (boot check).
- Browser automation available via Code Mode: tabs, navigate, snapshot,
  screenshot, click, fill, evaluate, find, wait, network.list, console,
  lighthouse. **`browser.screenshot` failed** with "Screenshot needs a visible
  tab" even after `tabs.focus` — treat screenshots as unavailable unless the
  desktop window can be foregrounded.

## Files inspected

- `packages/ui/src/FeedView.tsx` (all ~2,171 lines).
- `packages/ui/src/styles.css` (Feed block ~6912–8151, plus tokens).
- `packages/ui/src/Icons.tsx`, `packages/ui/src/bridge.ts`.
- `packages/client/src/index.ts` (`FeedPost`, `FeedComment`, `listFeed`, …).
- `apps/cloud/src/server.ts` (feed routes, `personOf`/`feedAuthorOf`/`pageAuthorOf`).
- `apps/cloud/src/server.feed.test.ts`, `e2e/portal.spec.ts`.
- `docs/feed.md`, `docs/feed-next.md`, `docs/development.md`, `AGENTS.md`.

## Test data (local dev DB, throwaway accounts only)

Seeded via a temp script (`%TEMP%\opencode\seed-feed.mjs`): users Alice/Bob/Cara
(mutually friends), 6 posts (short, long+hashtags, 1-image, 3-image grid, poll,
emoji), reactions, a threaded reply, a poll vote. Viewer token injected into
`localStorage["botifyr.token"]`. **Do not touch** the real user `kongsomvannda`.

## Confirmed issues (runtime-verified)

- **Flat action row** — `Like · Comment · Share · Save · ⋯ · Report · Block`
  (own: `… · Save · Delete`); one row; destructive actions inline.
- **No focus indicator** — focused `.feed-action` → `outline-style: none`,
  `box-shadow: none`.
- **Media layout shift** — images `height: 0` before load (intrinsic 900×600),
  then 391px; grid cells ~193×128.
- Overflow `⋯` menu previously held only Hide/Snooze/Unfollow; Report/Block/Delete
  were separate top-level buttons.
- No horizontal overflow at 1460px; content fixed at 620px; no Feed `@media`.
- Feed sometimes reverted to Chat between tool calls — **unverified** possible
  state-persistence bug (may be harness/reconnect).

## Files changed

- `packages/ui/src/FeedView.tsx` — action bar + More-options menu; skeletons;
  empty/error states (see FEED-1/3/4).
- `packages/ui/src/styles.css` — menu, focus-visible, media reservation,
  skeleton/empty/error, responsive.
- `packages/ui/src/FeedView.dom.test.tsx` — new focused tests for FEED-1.
- `docs/feed-improvement-plan.md`, `docs/feed-manager-progress.md` (this file).

## Tests & results (actual)

- `npm run typecheck -w @botifyr/ui` → **passed** (tsc --noEmit, no errors).
- `npx vitest run packages/ui` → **40 passed / 40** (8 files).
- New `packages/ui/src/FeedView.dom.test.tsx` (3 tests) → **3 passed**:
  4 primary actions + 1 More button; destructive actions only inside the menu;
  Delete-in-menu for own posts.
- `npx eslint packages/ui/src/FeedView.tsx packages/ui/src/FeedView.dom.test.tsx`
  → **clean**.
- **Live verification (running app, desktop dev host :1420, seeded feed):**
  - Action bar = exactly 5 controls on one row
    (`Love`, `Comment`, `Share`, `Save`, `More options`).
  - `⋯` menu = `Hide this post`, `Snooze <author> for 30 days`,
    `Unfollow <author>`, `Report post`, `Block <author>` (5 items).
  - Keyboard focus ring confirmed: focused control `matches(':focus-visible')`
    → `true`, computed `outline: 2px solid rgb(109, 139, 255)`.
  - Media reserves space: single image `min-height: 160px`; grid cells square
    (`aspect-ratio: 1 / 1`, 193×193).
  - Hiding via the menu removed the post (6 → 5) and closed the menu.
  - No horizontal overflow at 1460px.

### Full-repo gate (actual)

- `npm test` → **314 passed / 314** (56 files).
- `npm run lint` → **0 errors**, 52 warnings (pre-existing, in
  `BotifyrApp.tsx`/`CompanyWorkspace.tsx` — unrelated to Feed).
- `npm run typecheck` → `@botifyr/ui` and all other packages **pass**; the
  `@botifyr/portal` workspace fails with **52 pre-existing `TS6133`
  (unused-variable) errors, all in `packages/ui/src/BotifyrApp.tsx`** — a file
  with unrelated uncommitted changes that this task did not touch. **No Feed
  file (`FeedView.tsx`/`styles.css`) produces a type error.** Verified with
  `npm run typecheck -w @botifyr/portal | Select-String "FeedView|styles.css"`
  → no matches.

### P2 batch (second pass)

- **FEED-7** reaction breakdown: the reaction summary now carries a `title`
  listing per-type counts (`reactionBreakdown`).
- **FEED-8** long-post clamp: `PostBody` clamps bodies over ~520 chars / >6
  newlines to 12 lines behind a **See more / See less** toggle.
- New test covers the clamp (`FeedView.dom.test.tsx`).
- `npm run typecheck -w @botifyr/ui` → **passed**; `npx vitest run packages/ui`
  → **44 passed / 44**.

## Blockers / caveats

- Screenshots unavailable (see Environment).
- No viewport-emulation tool → responsive verified via CSS rules + DOM at the
  current width, not by resizing the browser.
- No live web research session; competitive patterns are from product knowledge
  (documented as such).

## Exact next action

Run the full repo gate once: `npm run typecheck && npm run lint && npm test`.
Then optionally attempt screenshots (foreground the desktop window) and pick up
the P2 backlog (FEED-6/7/8).

## Final Handover

**Completed (verified):**
- FEED-1 action hierarchy + More-options menu — implemented, DOM-tested, and
  confirmed in the running app.
- FEED-2 keyboard focus ring — implemented and confirmed via real Tab focus.
- FEED-3 reserved media space + square grid — implemented and confirmed live.
- FEED-4 skeletons / empty state / error Retry — implemented (skeletons, empty
  copy, and Retry are in code + covered by types; auto-verified structurally).
- FEED-5 responsive `<720px` rules — implemented (verified via CSS + DOM at the
  current width; no viewport-emulation tool available).

**Partially completed / not verified:**
- Screenshots of before/after — blocked ("Screenshot needs a visible tab").
- Narrow-viewport rendering — not exercised in a real resized browser.
- Full-repo gate (`typecheck && lint && test` across all workspaces) — pending.

**Known limitations:**
- Backend-dependent ideas (copy-link/permalinks, ranking explainability) are
  documented, not implemented.
- P2 items (avatar photos, reaction breakdown, long-post clamp) are backlogged.

**Exact commands that passed:**
- `npm run typecheck -w @botifyr/ui`
- `npx vitest run packages/ui`
- `npx eslint packages/ui/src/FeedView.tsx packages/ui/src/FeedView.dom.test.tsx`
