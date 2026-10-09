# Chat improvement plan

Scope: the **Chat** section of Botifyr — the shared messaging UI in
[`packages/ui/src/BotifyrApp.tsx`](../packages/ui/src/BotifyrApp.tsx) (thread,
conversation list, composer, contact panel) and its styles in
[`packages/ui/src/styles.css`](../packages/ui/src/styles.css). Both hosts render
this one UI (desktop + web), so every change lands in both.

Status legend: ✅ done · 🚧 in progress · ⬜ not started

---

## A. Executive summary

The Chat section is functionally rich — DMs, groups, reactions, read receipts,
attachments/albums, voice notes, transcription, per-chat translation, search,
and a Telegram-style contact panel all exist. The problems are **presentation,
orientation, and small-screen usability**, not missing plumbing:

- **Messages carried no time context.** There were no per-message timestamps and
  no date separators anywhere in the thread — every leading messenger has both.
- **The mobile layout was unusable.** Below ~820px the conversation list was
  hidden with no control to reopen it, so a user could not switch chats at all.
- **The right panel squeezed the thread** on tablets: a fixed 320px sidebar plus
  a fixed 320px contact panel left the message column ~320–384px wide.

This plan fixes those, verifies them in a real browser, and lays out the
remaining polish. The high-priority items are **implemented and verified**; the
rest is a prioritized backlog.

---

## B. Current-state assessment

**Architecture.** One React UI (`BotifyrApp`) rendered by two thin hosts
(`apps/portal` web bridge, `apps/desktop` Tauri bridge) — enforced by
`packages/ui/src/parity.test.ts`. Styling is a single `styles.css` with theme
tokens (`--bg/--panel/--border/--text/--muted/--hover/--bubble/--accent`).

**Chat surface (all in `BotifyrApp.tsx`):** sidebar + conversation list,
notification centre, message thread (DM/group/bot branches), approval panel,
composer (attach menu, reply bar, mentions, sent-history recall, voice input),
contact panel (info, shared-media grid, group admin), voice-note player, media
lightbox, toasts, model-status banner.

**Data/real-time.** `GET /v1/conversations`, `POST /v1/dm/:userId/messages`,
read receipts, reactions (local), and an SSE stream drive updates. Attachments
ride as `📎 name /shared/<token>` text (see
[`docs/chat-attachments.md`](chat-attachments.md));
[`docs/chat-roadmap.md`](chat-roadmap.md) tracks shipped features.

**Observed experience (baseline, Playwright at 1440/1024/390, zero console
errors).** Desktop was clean; the thread lacked time context; tablet and mobile
degraded as described above.

---

## C. Competitive analysis (messaging patterns)

Patterns are described from the published design guidance and observable
behaviour of these products; only well-established conventions are applied.

| Pattern | Who does it well | Relevance here |
| --- | --- | --- |
| **Per-message time + date separators** | WhatsApp, Telegram, Signal, Apple Messages, Slack | Universal. Cheap, high value. **Adopted.** |
| **Off-canvas / two-pane responsive chat** (list ⇄ thread) | WhatsApp, Telegram, Signal, Messenger | Mobile is one column; the list is a drawer. **Adopted.** |
| **Right panel overlays instead of squeezing** | Slack (channel details drawer), Teams | At medium widths, detail panes overlay. **Adopted.** |
| **Message grouping + sender identity** | Telegram, Slack | Already partly present (author labels, bubbles). |
| **Unread separation / "New messages" divider** | Telegram, Slack, Discord | Recommended (P2). |
| **Day dividers, jump-to-date** | Slack, Discord | Recommended (P2). |
| **Read state + typing indicators** | WhatsApp, Signal, Telegram | Read receipts exist; typing exists for bots, not human DMs. |
| **Composer: attachments, replies, emoji** | All | Present; emoji picker/reactions exist. |

Deliberately **not** copied: heavy gradients/theming, decorative animations, and
per-product gimmicks — this product is a calm, work-oriented messenger.

---

## D. UX/UI gap analysis

Severity: **P0** blocker · **P1** high · **P2** medium · **P3** polish.

| ID | Issue | Evidence | Expected | Severity | Status |
| --- | --- | --- | --- | --- | --- |
| CHAT-01 | No per-message timestamps | Baseline audit: `msgTimestamps: 0` | Each message shows local time | P1 | ✅ done |
| CHAT-02 | No date separators | Baseline audit: `dateSeps: 0` | "Today"/"Yesterday"/date pill between days | P1 | ✅ done |
| CHAT-03 | Mobile: conversation list unreachable | 390px screenshot + DOM: `.sidebar` `display:none`, no control | A drawer opened by a menu button | **P0** | ✅ done |
| CHAT-04 | Host `portal.css` hides the shared sidebar at ≤820px (second UI) | `apps/portal/src/portal.css` `.sidebar{display:none}`; `.portal-open`/`.portal-mobile-only` are dead | Responsive layout owned by the shared UI | **P0** | ✅ done |
| CHAT-05 | Tablet: contact panel squeezes thread | 1024px: thread ~320px with panel open | Panel overlays at ≤1100px | P1 | ✅ done |
| CHAT-06 | Drawer overlay / outside-click / keyboard close / focus | New drawer | Overlay, Esc close; focus returns to trigger | P2 | ✅ done |
| CHAT-07 | Auto-scroll yanked readers to the bottom; no marker for what's new | 40-message fixture: "Latest" button when scrolled up; "New messages" divider at the read boundary | Pin only at the bottom; jump-to-latest; divider | P2 | ✅ done & verified |
| CHAT-08 | Human-DM typing indicator absent | DMs/groups | "X is typing" for human peers | P2 | ✅ done & verified |
| CHAT-09 | Composer emoji picker discoverability | Composer had no emoji entry | Obvious emoji entry | P3 | ✅ done & verified |
| CHAT-10 | Long-name / narrow truncation polish | `.msg-author`/`.contact-name` had no bound | Ellipsis/wrap, no clipping | P3 | ✅ done |
| CHAT-11 | Accessibility audit | Live DOM: 1 unlabeled button (send), no `aria-label` on sidebar | All controls named; contrast/focus verified | P2 | ✅ DOM naming + contrast pass + automated keyboard sweep |
| CHAT-12 | Message grouping/tail polish | Thread | Consecutive-sender grouping | P3 | ✅ done & verified |

---

## E. Proposed experience

- **Thread:** a centered date pill ("Today"/"Yesterday"/`Thu, Oct 8`) whenever the
  calendar day changes; a small tabular time (HH:MM) inside each bubble (right
  aligned for outgoing, left for incoming). Quiet, muted, non-competitive with
  message text.
- **Responsive shell:**
  - ≥1101px: three columns (list · thread · contact panel).
  - 821–1100px: two columns; the contact panel floats over the thread on the right.
  - ≤820px: one column; the conversation list is an off-canvas drawer opened by a
    menu button in the top bar, closed by the scrim, on selection, or on Esc.
- **Visual language:** reuse existing tokens; no new colors; one accent.

---

## F. Prioritized roadmap

**P0 — blockers (done)**
1. CHAT-03 mobile drawer + menu button.
2. CHAT-04 remove the host's conflicting/second sidebar UI.

**P1 — high impact (done)**
3. CHAT-01 per-message timestamps.
4. CHAT-02 date separators.
5. CHAT-05 overlay the contact panel on tablets.

**P2 — important**
6. ✅ CHAT-06 drawer overlay/outside-click/Esc close + focus-return.
7. ✅ CHAT-07 conditional auto-scroll + jump-to-latest + "New messages" divider.
8. ✅ CHAT-08 human-DM typing indicator (server event + client).
9. ✅ CHAT-11 accessibility — DOM naming, dark-theme contrast, and keyboard sweep.

**P3 — polish**
10. ✅ CHAT-12 consecutive-sender grouping; ✅ CHAT-09 composer emoji picker; ✅ CHAT-10 truncation.

---

## G. Implementation backlog

| # | Task | Files | Done-when | Status |
| --- | --- | --- | --- | --- |
| 1 | Add `MenuIcon` | `Icons.tsx` | Icon exported | ✅ |
| 2 | Date/time helpers (`dayKeyOf`, `dayLabelOf`, `clockOf`) | `BotifyrApp.tsx` | Exported + unit-tested | ✅ |
| 3 | Timestamps in all 4 message branches | `BotifyrApp.tsx` | `.msg-time` renders per message | ✅ |
| 4 | Date separators (`Fragment` wrapper) | `BotifyrApp.tsx` | `.date-sep-thread` at day change | ✅ |
| 5 | Mobile drawer state + menu button + scrim + auto-close | `BotifyrApp.tsx` | Selecting a chat closes drawer | ✅ |
| 6 | Responsive CSS (≤820 one column, drawer; ≤1100 panel overlay) | `styles.css` | Verified at 390/1024 | ✅ |
| 7 | Remove host's conflicting sidebar rules | `apps/portal/src/portal.css` | No `display:none` on shared sidebar | ✅ |
| 8 | Unit tests for helpers | `chatTime.test.ts` | 4 tests pass | ✅ |
| 9 | Reusable visual audit | `scripts/chat-audit.mjs` | before/after screenshots + metrics | ✅ |
| 10 | Drawer overlay, outside-click, Esc close, focus-return | `BotifyrApp.tsx`, `styles.css` | Esc/scrim close; focus returns to menu button | ✅ |
| 11 | New-messages divider / jump-to-date | `BotifyrApp.tsx` | Renders + scrolls | ⬜ |
| 12 | Accessibility pass | UI | Automated + manual checks pass | ✅ |
| 13 | Conditional auto-scroll + jump-to-latest + "New messages" divider | `BotifyrApp.tsx`, `styles.css` | Reader isn't yanked; button returns to newest; divider marks the read boundary | ✅ |
| 14 | Human-DM typing indicator | `shared`, `apps/cloud/src/server.ts`, `packages/client`, `BotifyrApp.tsx`, `styles.css` | Peer typing shows then expires; participants-only | ✅ |
| 15 | Consecutive-sender message grouping | `BotifyrApp.tsx`, `styles.css` | Repeated author/avatar hidden; shared corner flattened | ✅ |
| 16 | Composer emoji picker | `BotifyrApp.tsx`, `styles.css` | Emoji button opens a picker that inserts into the composer | ✅ |
| 17 | Typing clears on delivery + truncation polish | `BotifyrApp.tsx`, `styles.css` | Indicator ends when the message lands; long names don't overflow | ✅ |

---

## H. Test strategy

- **Unit/DOM (Vitest + Testing Library):** `chatTime.test.ts` proves day grouping,
  Today/Yesterday labels, HH:MM formatting, and graceful handling of bad input.
  Existing `smoke`, `attachment`, `parity`, `companyWorkspace`, `FeedView` DOM
  suites guard against regressions.
- **Visual + layout (Playwright, `scripts/chat-audit.mjs`):** logs in via a token,
  screenshots list/DM/DM+panel/group at 1440×900, 1024×768, 390×844, opens the
  mobile drawer, and reports DOM metrics (`dateSeps`, `msgTimestamps`, panel
  widths, overflow) plus console errors. Label runs `before`/`after` for diffs.
- **Server (Vitest, `apps/cloud/src/server.typing.test.ts`):** the typing signal
  fans out to the other participant only, and a non-participant gets 404.
- **Keyboard / E2E (Playwright, `e2e/chat.spec.ts`):** proves the mobile drawer
  opens with Enter on the menu button, closes on Escape, and returns focus to the
  trigger; and that the send control has an accessible name. Run with
  `E2E_BASE_URL=http://localhost:1421 E2E_CHAT_TOKEN=<token> npx playwright test`.
- **Manual journeys:** open/switch conversations, send (DM path), scroll history,
  contact panel toggle, empty states.
- **Gates:** `npm run typecheck`, `npm run lint`, `npm test`.

---

## I. Test report (this cycle)

| Check | Command | Result |
| --- | --- | --- |
| UI typecheck | `npm run typecheck -w @botifyr/ui` | ✅ pass |
| Lint (changed files) | `npx eslint …` | ✅ 0 errors (pre-existing warnings only) |
| UI tests | `npx vitest run packages/ui` | ✅ 48/48 pass (incl. `parity`) |
| Visual audit | `CHAT_AUDIT_LABEL=after node scripts/chat-audit.mjs` | ✅ 0 console errors; `dateSeps: 2`, `msgTimestamps: 5` in DM |
| Mobile drawer | Playwright 390×844 | ✅ `display:flex`, width 320, opens; selection closes |
| Full gate | `npm run typecheck && npm run lint && npm test` | ✅ typecheck pass · lint 0 errors · **319/319 tests pass** |
| Accessibility (DOM) | live portal DOM audit | ✅ 0 unlabeled buttons (send labeled), sidebar `aria-label`, 4 landmarks, 0 images missing alt |
| Accessibility (contrast) | live computed-style check | ✅ dark theme: primary 15.9:1, muted preview 5.5:1 — passes WCAG AA |
| Accessibility (keyboard) | `npx playwright test e2e/chat.spec.ts` | ✅ 2/2 pass (drawer Enter/Esc/focus-return; send control named) |
| Scroll behaviour | 40-message DM fixture | ✅ auto-scrolls to bottom on open; `.jump-latest` appears when scrolled up and returns to the newest message |
| New-messages divider | live DM with a past read boundary | ✅ `.new-msg-divider` ("New messages") renders above the first incoming message after the boundary; `firstUnreadIndex` unit-tested (3 cases) |
| Typing indicator | `apps/cloud/src/server.typing.test.ts` | ✅ 2/2 pass (participants-only fan-out) |
| Typing indicator (E2E) | live portal + peer token | ✅ peer POST → "Sam is typing" renders, then auto-expires |
| Sender grouping | live DM (two consecutive peer messages) | ✅ 2nd message gets `.grouped`; author + avatar hidden, corner flattened |
| Composer emoji picker | live portal | ✅ button opens the picker; clicking 🤖 inserts it into the composer and closes |
| Typing clears on delivery | live portal + peer | ✅ indicator shows, then disappears within ~1s of the message arriving (before the 4s expiry) |
| Full gate | `npm run typecheck && npm run lint && npm test` | ✅ typecheck pass · lint 0 errors · **334/334 tests pass** |

**Known limitations / unverified:** the away-message count is wired but not
separately fixture-tested; at ≤1100px the contact panel overlays the thread and
covers the composer's right-hand controls while open (use Hide to dismiss);
model-backed bot replies may fail while the DeepSeek key is out of credit (DM and
group paths are unaffected).

---

## J. Handover

**Changed:** `packages/ui/src/BotifyrApp.tsx` (helpers, timestamps, separators,
drawer, conditional auto-scroll + jump-to-latest, "New messages" divider,
consecutive-sender grouping, composer emoji picker, typing-clear + truncation),
`packages/ui/src/Icons.tsx`
(`MenuIcon`), `packages/ui/src/styles.css` (time/date/jump styles, responsive
rules), `apps/portal/src/portal.css` (removed the
host's conflicting mobile sidebar rules), `packages/shared/src/index.ts` +
`apps/cloud/src/server.ts` + `packages/client/src/index.ts` (typing event/endpoint),
new `packages/ui/src/chatTime.test.ts`, new `apps/cloud/src/server.typing.test.ts`,
new `scripts/chat-audit.mjs`, new `e2e/chat.spec.ts`.

**Next steps:** all planned P0–P3 items are implemented and verified. Remaining
is the ≤1100px panel/composer overlap note and optional future ideas (jump-to-date,
album layout, message search highlighting).

**Environment notes:** the desktop-in-app browser screenshot tool needs a visible
window (unavailable here) — use Playwright; run the portal via the Vite dev
server on `:1421` (the `:4322` container is a stale build); a concurrent Feed
agent may be editing other files in this workspace.
