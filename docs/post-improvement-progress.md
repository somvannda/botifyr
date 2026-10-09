# Post Manager — Progress Checkpoint

> **Historical record** — ports reflect the run at the time. Canonical local dev is defined in [`AGENTS.md`](../AGENTS.md) §10.

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
| Video post renders `<video aria-label>` | n/a | **true** (`aria-label="Video"`, injected feed) |
| Unexpected console errors | [] | [] (1 intentional aborted request) |

## Files changed (this assignment)

- `packages/ui/src/FeedView.tsx` — `renderRichText` + `fullDate`, rewritten
  `PostBody`, new `FeedImage` / `PostMedia` / `ConfirmDialog` / `MentionProfile`,
  upgraded `AuthorLine` (`<time>`) and `CommentRow` (rich text, own-comment
  delete), `PostCard` optimistic guards + feedback + confirmations + menu/picker
  keyboard handling + permalink focus + inline edit + copy-link + mention
  buttons, `FeedView` `focusPostId` + mention-profile state, `viewerId` threaded
  to all call sites, a **Like-click fix** (hover opened the picker, then the
  click toggled it closed — now the click opens/stays open), and a **comment
  preview** (`View all N comments`).
- `packages/ui/src/BotifyrApp.tsx` — reads `#post=<id>` (load + `hashchange`),
  opens the Feed, and passes `focusPostId`.
- `packages/ui/src/styles.css` — new `.feed-*` classes (links, inline tags,
  mentions, broken-media, feedback, reaction-summary button, confirm dialog,
  "view all"/"load more" comments, post focus highlight, edit editor, mention
  mini-profile).
- `packages/client/src/index.ts` — `listCommentsPage` (POST-12), `getPost` +
  `editPost` (POST-13/16), `getPersonByHandle` (POST-14).
- `apps/cloud/src/server.ts` — paginated comments (POST-12), `GET`/`PATCH
  /v1/posts/:id` (POST-13/16), `GET /v1/people/by-handle/:handle` (POST-14).
- `apps/cloud/src/store/{types,memory,postgres}.ts` — `updatePostBody`.
- `apps/cloud/src/server.feed.test.ts` — pagination, edit, and mention tests.
- `packages/ui/src/FeedView.dom.test.tsx` — `describe("Post interactions")`
  (POST-1…POST-16; save rollback, dialog Escape, reply routing, video name,
  focusable summary, timestamp, comment preview, pagination, copy-link, edit,
  permalink highlight, mention profile) plus `describe("Post reuse across
  contexts")` (Group + album).
- `scripts/post-audit.mjs` — new live audit + screenshot harness.
- `docs/post-improvement-plan.md`, `docs/post-improvement-backlog.md`,
  `docs/post-improvement-progress.md`, `docs/assets/post/*.png`.

## Tests & results (actual, after changes)

- `npx vitest run packages/ui/src/FeedView.dom.test.tsx` → **79 passed / 79**
  (`Post interactions` incl. POST-12/13/14/16 + `Post reuse` + others).
- `npx vitest run apps/cloud/src/server.feed.test.ts` → **35 passed / 35**
  (pagination, edit, and mention endpoints).
- `npm test` (repo-wide) → **462 passed / 462** (64 files).
- `npm run typecheck` (repo-wide) → **clean**.
- `npm run lint` → **clean**.
- `npx prettier --check` (all changed files) → **clean**.
- `node scripts/post-audit.mjs` → after-report above (copy-link in the menu,
  `mentionProfileOpened`/`ClosedByEscape`, `ownHasEdit`, video, rollback); no
  unexpected console errors.

## Visual evidence & accessibility

`docs/assets/post/`: `feed-desktop.png`, `card-text.png` (live link + mention +
inline hashtags), `card-image.png`, `card-grid.png`, `card-poll.png`,
`card-long-clamped.png`, `card-long-expanded.png`, `card-menu.png`,
`confirm-delete.png` (the new `role="alertdialog"`), `card-react-error.png`
(rolled-back reaction + inline error), `card-video.png` (native video controls),
`card-mobile.png`.
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
  improvements implemented ✅ (POST-1…POST-16 — incl. comment pagination,
  copy-link/permalink, edit-post, `@mention` profiles) ·
  interactions verified ✅ (unit + live) · reliability/error recovery verified ✅
  (rollback + inline error test) · responsive ✅ (no 390px overflow) ·
  reuse verified ✅ (same card in Feed, Page, Group, album) ·
  accessibility ✅ (menu Escape/focus, labelled input, Lighthouse 0.96; dialog/
  menu semantics) · automated tests ✅ · regressions fixed/documented ✅.

## Blockers / caveats

- **Concurrent edits:** `FeedView.tsx`, `styles.css`, `FeedView.dom.test.tsx`,
  and other files are being modified by other workstreams (Stories, Composer,
  Reels). During this session those edits repeatedly shifted line numbers; all
  steps were re-read before editing. Watch for churn.
- **Repo-wide gate is green** (`typecheck`, `lint`, `test` all clean as of the
  last run, 462/462). It oscillated earlier from other workstreams' in-flight
  edits; re-run after they settle before merging.
- **Live video rendering:** the running `botifyr-cloud` returned an empty
  `videos[]` for an uploaded `.mp4` (likely a stale container — it was rebuilt
  concurrently), so the audit now **injects** a `videos[]` entry into the feed
  response to exercise the UI end-to-end. That verifies the component
  (`videoPosts: 1`, `aria-label="Video"`, `card-video.png`); the **backend
  classification of uploaded videos remains unverified** and should be
  re-checked after a clean cloud rebuild.

## Exact next actions

1. **Integrate** the uncommitted Post work (POST-12…POST-16) via a branch/PR
   (AGENTS §8/§9). Note: fix `scripts/worktree.mjs` first — it fails on Windows
   at `spawnSync npm.cmd EINVAL`.
2. Re-run the full gate after the concurrent workstreams settle
   (`npm run typecheck && npm run lint && npm test`).
3. Cross-boundary: report the shell `ws-tab` contrast to the Design System
   owner; re-verify live video classification after a clean `botifyr-cloud`
   rebuild.
