# Post Manager — Progress Checkpoint

> Resume point for the Post UX/UI assignment. Update after meaningful work.

## Assignment scope

Own the **reusable individual post component** and its interactions
(`PostCard`, `CommentRow`, post media, reactions, comments, share/save,
contextual menus) across all Feed contexts. Deliverables: audit, competitive
research, plan, backlog, implementation, tests, visual evidence, handover. See
`docs/post-improvement-plan.md` and `docs/post-improvement-backlog.md`.

## Environment

- Repo: `G:\Developments\botifyr.xyz` (npm workspaces; Node 20+).
- Running: `botifyr-cloud` `:8787`, `botifyr-web` `:4322`, `botifyr-admin`
  `:4324`, `botifyr-postgres` `:54329`, **desktop Vite dev host `:1420`**
  (HMR over `packages/ui`; no Docker rebuild for UI edits).
- Headless verification: Playwright chromium via `scripts/post-audit.mjs`
  (creates its own throwaway accounts/posts, writes `docs/assets/post/`).
- Code Mode browser tools available; headless Playwright used for screenshots.

## Ownership boundaries (not touched)

Main feed ordering/filters, Reels, Stories viewer/tray, Pages identity/nav,
Composer, global tokens/primitives. Only post-level components + `.feed-*`
styles were changed.

## Baseline audit (before) → after

`node scripts/post-audit.mjs`, seeded feed (throwaway accounts only):

| Check | Before | After |
| --- | --- | --- |
| Action buttons on card | 5 (`Like/Comment/Share/Save/⋯`) | 5 (unchanged) |
| Links rendered in `.feed-body` | **0** | **1** (anchor, target `_blank`) |
| Menu closes on Escape | **false** | **true** |
| Delete shows a confirmation dialog | **false** | **true** |
| Post survives first Delete click | **false** | **true** |
| Horizontal overflow at 390px | false | false |
| Failed reaction rolls back + inline error | (silent) | **true** ("Couldn't update your reaction…") |
| Video post renders `<video aria-label>` | n/a | **0 (backend gap — see caveat)** |
| Unexpected console errors | [] | [] (1 intentional aborted request) |

## Files changed (this assignment)

- `packages/ui/src/FeedView.tsx` — `renderRichText` + `fullDate`, rewritten
  `PostBody`, new `FeedImage` / `PostMedia` / `ConfirmDialog`, upgraded
  `AuthorLine` (`<time>`) and `CommentRow` (rich text, own-comment delete),
  `PostCard` optimistic guards + feedback + confirmations + menu/picker keyboard
  handling, `viewerId` threaded to all 5 call sites, and a **Like-click fix**
  (hover opened the picker, then the click toggled it closed — now the click
  opens/stays open).
- `packages/ui/src/styles.css` — new `.feed-*` classes (links, inline tags,
  mentions, broken-media, feedback, reaction-summary button, confirm dialog).
- `packages/ui/src/FeedView.dom.test.tsx` — new `describe("Post interactions")`
  with 14 tests (POST-1…POST-11; includes save rollback, dialog Escape safety,
  reply routing, video name, focusable summary, semantic timestamp).
- `scripts/post-audit.mjs` — new live audit + screenshot harness.
- `docs/post-improvement-plan.md`, `docs/post-improvement-backlog.md`,
  `docs/post-improvement-progress.md`, `docs/assets/post/*.png`.

## Tests & results (actual, after changes)

Post-scope tests are green; the repo-wide gate is currently **red from other
workstreams' in-flight edits** (see caveats).

- `npx vitest run packages/ui/src/FeedView.dom.test.tsx -t "Post interactions"`
  → **14 passed / 14**.
- `npx vitest run packages/ui` → Post suites pass; the `Pages experience` suite
  is currently failing (7 tests) from the Pages workstream.
- `npm test` (repo-wide) → **422 passed / 429**; the 7 failures are all
  `Pages experience` (not Post).
- `npm run typecheck -w @botifyr/ui` → currently red **only** in
  `BotifyrApp.tsx` (a concurrent edit passes an `onOpenMarketplace` prop that
  `FeedView`'s type doesn't yet declare); no `FeedView.tsx` errors.
- `npx eslint` (changed source) → **0 errors**.
- `npx prettier --check` (test file, styles, audit script) → **clean**
  (`FeedView.tsx` is momentarily unformatted from a concurrent edit).
- `node scripts/post-audit.mjs` → after-report above; screenshots refreshed.
- Earlier full-green run this session: `npm test` **417/417**,
  `typecheck -w @botifyr/ui` passed, `eslint` 0 errors.

## Visual evidence & accessibility

`docs/assets/post/`: `feed-desktop.png`, `card-text.png` (live link + mention +
inline hashtags), `card-image.png`, `card-grid.png`, `card-poll.png`,
`card-long-clamped.png`, `card-long-expanded.png`, `card-menu.png`,
`confirm-delete.png` (the new `role="alertdialog"`), `card-react-error.png`
(rolled-back reaction + inline error), `card-video.png` (captured once, when the
dev cloud briefly classified an `.mp4`), `card-mobile.png`.
Before/after values are in the table above.

**Lighthouse (live Feed with seeded posts):** Accessibility **0.96**
(Best Practices 1.0). `link-in-text-block` was flagged on the new `.feed-link`
(colour-only), fixed by underlining links (`text-decoration: underline` +
offset); the audit then passed that rule. Remaining failures are **not Post
scope**:
- `color-contrast` — the app-shell sidebar `button.ws-tab.active`
  (white on `--accent`, ~3.1:1). Owner: Design System / shell, not Post.
- `meta-description` / `robots.txt` — document-level.

## Definition-of-done mapping

- Audit ✅ · research ✅ · gaps identified ✅ · prioritized plan ✅ ·
  high-priority feasible improvements implemented ✅ (POST-1…POST-11) ·
  interactions verified ✅ (unit + live) · reliability/error recovery verified ✅
  (rollback + inline error test) · responsive ✅ (no 390px overflow) ·
  accessibility ✅ (menu Escape/focus, labelled input, computed a11y via
  Lighthouse previously 0.9x; new dialog/menu semantics) · automated tests ✅ ·
  regressions fixed/documented ✅.

## Blockers / caveats

- **Concurrent edits:** `FeedView.tsx`, `styles.css`, `FeedView.dom.test.tsx`,
  and other files are being modified by other workstreams (Stories, Composer,
  Reels). During this session those edits repeatedly shifted line numbers; all
  steps were re-read before editing. Watch for churn.
- **Repo-wide `npm run typecheck` is red** from **another workstream's** unused
  composer declarations (`upload`, `setUpload`, `composerError`, `notice`,
  `removeAttachment` around lines 3625–3756) — **not** Post code. `@botifyr/ui`
  typechecks clean. Do not "fix" the composer without coordinating with its
  owner; it is expected to be cleaned up by that workstream.
- **Live video rendering not verified (backend/container):** an uploaded
  `.mp4` came back with an empty `videos[]` from the running `botifyr-cloud`
  (`videoPosts: 0`), even though `feedPostOf` in source splits `videos` by
  extension. The cloud container was being **rebuilt concurrently** (`server.ts`
  modified after the container start), so it is likely stale. The UI path is
  covered by a unit test (`<video aria-label>`); re-verify live after the cloud
  settles.

## Exact next actions

1. After the concurrent workstreams settle, re-run the full gate
   (`npm run typecheck && npm run lint && npm test`) — it is currently red from
   the Pages suite and a `BotifyrApp.tsx` prop mismatch, **not** Post code.
2. Re-run `node scripts/post-audit.mjs` after `botifyr-cloud` is rebuilt to
   confirm `videoPosts ≥ 1` (live video rendering is the one unverified item).
3. Deferred (backend): POST-12 comment paging, POST-13 copy-link/permalink,
   POST-14 mention profile routing (and edit-post — no API).
4. Cross-boundary: report the shell `ws-tab` contrast to the Design System
   owner.
