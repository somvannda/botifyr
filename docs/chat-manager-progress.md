# Chat Manager — progress checkpoint

Durable state for resuming the Chat improvement assignment. See the full plan
and backlog in [`docs/chat-improvement-plan.md`](chat-improvement-plan.md).

**Last updated:** 2026-10-09 · **Owner:** Chat Manager agent.

## Objective & scope

Improve the Chat section (UX/UI + reliability) of Botifyr: the shared messaging
UI in `packages/ui/src/BotifyrApp.tsx` + `packages/ui/src/styles.css`, rendered
by both hosts. Out of scope: other pages/modules.

## Environment

- Workspace: `G:\Developments\botifyr.xyz` (Windows). Git repo.
- Cloud API: `http://localhost:8787` (docker `botifyr-cloud`). Postgres:
  docker `botifyr-postgres` (host port 54329).
- Portal dev server (HMR): **`http://localhost:1421`** (already running). The
  `:4322` container (`botifyr-web`) is a **stale baked build** — don't use it for
  UI verification.
- Test account: `chatmgr@example.com` / `chatmgr-pass-123` (signups open). The UI
  only offers Google OAuth, so tests inject `localStorage["botifyr.token"]`.
- Screenshots: the in-app browser `screenshot` tool requires a visible desktop
  window (unavailable) → use **Playwright** (`scripts/chat-audit.mjs`).
- ⚠️ A concurrent agent (Feed Manager) is editing other files in this workspace
  (`FeedView.tsx`, `bridge.ts`, `apps/cloud/src/server.ts`, docs). Re-check the
  tree before large edits.

## Files inspected / modified

- Modified: `packages/ui/src/BotifyrApp.tsx`, `packages/ui/src/Icons.tsx`,
  `packages/ui/src/styles.css`, `apps/portal/src/portal.css`.
- Added: `packages/ui/src/chatTime.test.ts`, `scripts/chat-audit.mjs`,
  `e2e/chat.spec.ts`, `docs/chat-improvement-plan.md`, this file.
- Artifacts: `test-results/chat-audit/{before,after}-*.png` + `after-report.json`.
- Test data (DB, test-only): DM "Sam" (peer `friend@example.com`, display name
  "Sam") and group "Launch Squad"; friendships between `chatmgr`, `friend`,
  `ceo@botifyr.test`.

## Confirmed findings

1. No message timestamps / no date separators (baseline metrics).
2. Mobile (≤820px): conversation list hidden, no control to reopen (P0).
3. `apps/portal/src/portal.css` hid the shared `.sidebar` at ≤820px with dead
   `.portal-open` / `.portal-mobile-only` rules (a second UI) — root cause of (2).
4. Tablet (1024px): contact panel squeezed the thread to ~320px.

## Implementation (done)

- `MenuIcon`; date/time helpers `dayKeyOf`/`dayLabelOf`/`clockOf` (exported).
- Per-message `<time class="msg-time">` in all four message branches.
- `.date-sep-thread` separators at calendar-day changes.
- Narrow-screen drawer: `mobileNavOpen` state, top-bar menu button,
  `.mobile-nav-overlay`, close-on-select, close-on-Esc, focus-return to the menu
  button, `.app.mobile-nav-open`. Sidebar `aria-label`; send button labeled.
- CSS: ≤1100px panel overlays; ≤820px single column + off-canvas `.sidebar`.
- Thread scroll: auto-scroll only when pinned to the bottom (no more yanking while
  reading history); a floating **Latest** / "N new messages" button returns to the
  newest message; a **"New messages"** divider sits above the first incoming
  message after the read boundary (`firstUnreadIndex`, unit-tested).
- Human-DM **typing indicator**: `POST /v1/conversations/:id/typing` emits an
  ephemeral `typing` event to the other participants (never persisted); the
  composer pings it (throttled 2.5s) and the thread shows "X is typing", expiring
  after ~4s. New `ServerEvent` variant + `client.sendTyping`.
- Consecutive-sender **message grouping**: same sender within 5 min reads as one
  block — repeated author/avatar hidden and the shared bubble corner flattened.
- **Composer emoji picker** (button + upward popup that inserts into the text);
  typing indicator now **clears the moment a message arrives**; long names/labels
  truncate instead of overflowing.
- Removed the host's conflicting `.sidebar` rules from `portal.css`.

## Verification (executed)

- `npm run typecheck` (all workspaces) → pass.
- `npm run lint` → 0 errors.
- `npm test` (all workspaces) → **342/342 pass** across 59 files (incl. `parity`).
- Emoji picker (live): opens with 24 choices; clicking 🤖 inserts it and closes.
- Typing clears on delivery (live): indicator shows, then disappears within ~1s of
  the peer's message arriving (before the 4s auto-expiry).
- Typing: `apps/cloud/src/server.typing.test.ts` → 2/2 pass (participants-only
  fan-out; non-participant 404). Live E2E: peer POST → "Sam is typing" renders,
  then auto-expires.
- `E2E_BASE_URL=http://localhost:1421 E2E_CHAT_TOKEN=<token> npx playwright test e2e/chat.spec.ts` → **2/2 pass** (keyboard drawer Enter/Esc/focus-return; send control named).
- Accessibility: live DOM 0 unlabeled buttons; dark-theme contrast primary 15.9:1, muted 5.5:1 (WCAG AA).
- Thread scroll (40-message DM fixture): opens at the bottom; scrolling up shows
  `.jump-latest` ("Latest"); clicking returns to the bottom and hides it.
- "New messages" divider: with a past read boundary, `.new-msg-divider` renders
  above the first incoming message after it; `firstUnreadIndex` covered by 3
  unit tests.
- Sender grouping: on the seed DM, the 2nd consecutive "Sam" message gets
  `.grouped` (author + avatar hidden); others do not.
- `CHAT_AUDIT_LABEL=after node scripts/chat-audit.mjs` → 0 console errors;
  desktop DM shows **2 date separators + 5 timestamps**; 390px drawer opens
  (`display:flex`, width 320) and closes on conversation select.
- Visual confirmation: `test-results/chat-audit/after-desktop-dm.png`,
  `after-mobile-nav.png`.

## Remaining / next actions

All planned P0–P3 items are implemented and verified. Optional future ideas:
jump-to-date, album layout, search-result highlighting.

## Known limitations

- Bot replies may fail while the DeepSeek key is out of credit (402); DM/group
  messaging and all UI verification are unaffected.
- The away-message count on the jump button is wired but not separately
  fixture-tested.
- Sender grouping is verified on a seeded fixture; it uses a 5-minute window.
- At ≤1100px the contact panel overlays the thread and covers the composer's
  right-hand controls while open (use Hide to dismiss).

## Exact next action

None required — the assignment's backlog is complete and the gate is green. If
continuing, address the ≤1100px panel/composer overlap or add jump-to-date.
