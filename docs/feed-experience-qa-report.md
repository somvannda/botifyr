# Feed Experience — Independent QA Report

> Owner: **Feed Experience Lead / QA** (independent of the implementing
> workstreams). Method: headless Playwright against the running app.
> Harness: `scripts/feed-qa.mjs`. Date: Oct 2026.

## Environment

- App: desktop Vite dev host `http://localhost:1420`; cloud `http://localhost:8787`.
- Browser: Chromium (headless), fresh context per run, throwaway account.
- Data: the harness signs up two accounts, friends them, and seeds a text post,
  a poll, an image post, and a story. No production data touched.

## Method

`node scripts/feed-qa.mjs` performs real interactions (not source inspection) and
records pass/fail per journey, capturing console/page errors plus a mobile
screenshot (`docs/assets/feed/qa-mobile.png`).

## Results (actual — latest run)

| # | Journey | Result | Notes |
| --- | --- | --- | --- |
| 1 | Feed loads posts | ✅ | `.feed-post` present |
| 2 | Action bar = 4 primary + `⋯` More options | ✅ | `Like,Comment,Share,Save` + icon menu |
| 3 | More-options control present | ✅ | |
| 4 | Overflow menu opens | ✅ | |
| 5 | Overflow menu closes on `Escape` | ✅ | |
| 6 | Reacting sets Love | ✅ | picker opens on hover; `❤️Love`, `aria-pressed=true` |
| 7 | Comment submits | ✅ | typed + Enter → comment appears |
| 8 | Poll vote renders percentages | ✅ | |
| 9 | Image lightbox opens | ✅ | |
| 10 | Lightbox closes on `Escape` | ✅ | |
| 11 | Story viewer opens | ✅ | |
| 12 | Reels view opens | ✅ | |
| 13 | Reels mute control present | ✅ | |
| 14 | Mobile nav drawer opens (390px) | ✅ | `.app.mobile-nav-open` |
| 15 | No horizontal overflow at 390px | ✅ | `scrollWidth=390` |
| 16 | No console/page errors | ✅ | 0 errors |

**Overall: `QA_PASS` — 16/16, 0 failures, 0 console errors.**

## Automated test gate (independent run)

| Command | Result |
| --- | --- |
| `npm test` (repo-wide) | **400 passed / 400** (60 files) |
| `npm run typecheck -w @botifyr/ui` | **passed** |
| `npx vitest run packages/ui/src/FeedView.dom.test.tsx` | **52 passed** |
| `npx eslint` (Feed files) | 0 errors |
| `npx prettier --check` (Feed files) | clean |

## Visual evidence

- `docs/assets/feed/`: `desktop-1440.png`, `tablet-900.png`, `mobile-390.png`,
  `mobile-nav.png`, `menu-open.png`, `long-post.png`, `lightbox.png`,
  `story-viewer.png`, `qa-mobile.png`
- Specialist evidence: `docs/assets/post/*`, `docs/assets/design-system/*`.

## UX observations (non-blocking; routed to owners)

- **Reaction affordance (Post Manager).** The reaction picker opens on
  `onMouseEnter` of the `Like` button, and the button's `onClick` only *toggles*
  the picker. On a mouse, a click therefore closes the just-hovered picker and
  does **not** quick-like. X/Facebook treat a plain click as "Like". Recommend:
  clicking `Like` should apply `like` (or be a no-op while the picker is open),
  keeping the picker for choosing other reactions. Reactions themselves work.
- No other defects found.

## Cross-feature integration

Verified: Feed ↔ Reels ↔ mobile drawer navigation, reactions, comments, poll,
lightbox, and Story viewer all function in one session with no console errors.

## Unverified / limitations (transparent)

- **Reels playback (autoplay/seek/fullscreen) E2E** — no video fixture in the
  repo; media behaviour is covered by jsdom event tests only.
- **Story progression timing** — covered by the Stories Manager's fake-timer
  tests; the harness verifies open/close only.
- **Story reactions, Page Photos/Reels/Stories tabs, copy-link/permalink** — no
  backend/router; documented, not testable.
- **Realtime new-activity banner** — backend never delivers `feed.*` events
  (DB-1), so only the component path is covered.
- **axe / light-theme sweep** — pending (Design System DS-T11).

## Defects found by QA

None blocking. The reaction-click nuance above is a minor UX recommendation, not
a broken control (reactions function correctly via the picker).

## Handover

The Feed experience is **integration-verified and green**: 400/400 tests, clean
UI typecheck, and **16/16 live QA journeys**. Remaining work is backend (DB-1,
DB-2, story views, Reels captions, Page tabs, permalinks), low-priority polish
(FEED-D7 sort label, DS long tail, axe pass, the reaction-click nuance), and
committing the uncommitted tree per owner.
