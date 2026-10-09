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
- `docs/feed-improvement-plan.md`, `docs/feed-manager-progress.md` (this file).

## Tests & results

- (pending this checkpoint) `npm run typecheck -w @botifyr/ui` → _fill in_.
- Live re-inspection of the running app after changes → _fill in_.
- `vitest` suite → _fill in_.

## Blockers / caveats

- Screenshots unavailable (see Environment).
- No viewport-emulation tool → responsive verified via CSS rules + DOM at the
  current width, not by resizing the browser.
- No live web research session; competitive patterns are from product knowledge
  (documented as such).

## Exact next action

Run `npm run typecheck -w @botifyr/ui`, then reload the live app, open the Feed,
and verify: 5-button action bar, `⋯` menu contents, focus ring, square media grid
with reserved space, skeleton/empty/error states. Update the "Tests & results"
section with actual output.
