# Composer Manager — Progress & Context Recovery

> Owner: **Composer Manager** (Feed Experience Team, reports to Feed Experience
> Lead). Update after each batch. Companion docs:
> `docs/composer-competitive-research.md`, `docs/composer-ux-audit.md`,
> `docs/composer-implementation-plan.md`.

## Current status

**Implemented, unit-tested, and the full-repo gate is green.**
`npm run typecheck` clean (all workspaces) · `npm run lint` clean · `npm test`
**413 passed / 413** (61 files). The composer is the one inside `FeedView`
(`packages/ui/src/FeedView.tsx`); a second, simpler group composer lives in
`GroupView` in the same file.

## Problem statement

The composer works for the happy path but had reliability/UX gaps: a client
video limit above the server limit, no upload progress, publish errors mixed
with feed-load errors, a destination that silently persisted across posts, a
past schedule that silently posted now, no draft persistence across reload, and
several accessibility gaps. See the audit for the ranked list.

## Files inspected

- `packages/ui/src/FeedView.tsx` — `FeedView` composer, `GroupView`,
  `PostCard`, `StoryViewer`, `ReelsView`, `PageView`, `FeedRail`.
- `packages/ui/src/styles.css` — `.feed-composer*`, `.feed-error*`,
  `.feed-post-btn`, focus-visible, responsive blocks.
- `packages/ui/src/FeedView.dom.test.tsx` — existing mock `BotifyrClient` +
  tests (52 at last run).
- `packages/client/src/index.ts` — `FeedPost` DTO, `createPost`, `uploadFile`,
  `createPage`, `listMyPages`, `createStory`, `listScheduled`.
- `apps/cloud/src/server.ts` — `/v1/posts` (`MAX_POST_BODY=4000`, media cap 4,
  audience, schedule drop-if-past, Page/group permission), `/v1/uploads`
  (base64 JSON, bodyLimit 25 MB, decoded cap 15 MB).
- `apps/cloud/src/server.feed.test.ts`, `server.pages.test.ts`.
- `e2e/portal.spec.ts`, `e2e/chat.spec.ts`, `playwright.config.ts`,
  `scripts/feed-screenshots.mjs`, `vitest.config.ts`.
- `docs/feed-manager-progress.md`, `docs/feed-experience-progress.md`,
  `docs/feed-experience-backlog.md`, `docs/agent-progress/pages-manager.md`.

## Files changed (this workstream)

- `docs/composer-competitive-research.md` (new)
- `docs/composer-ux-audit.md` (new)
- `docs/composer-implementation-plan.md` (new)
- `docs/agent-progress/composer-manager.md` (this file, new)
- `packages/ui/src/FeedView.tsx` — composer constants, state, `pickImages`,
  `removeAttachment`, `publish`, draft effect, composer JSX, `GroupView`.
- `packages/ui/src/styles.css` — additive `.feed-composer-destination`,
  `.feed-draft-hint`, `.feed-upload*`, `.feed-composer-error`,
  `.feed-composer-notice`, `.feed-composer-hint`, `.feed-composer-thumb-kind`.
- `packages/ui/src/composer.dom.test.tsx` (new, 8 tests).

## Architectural decisions

- Keep all composer UI in `FeedView.tsx` + `styles.css` (AGENTS.md §7, one UI /
  two hosts). No new host files.
- **Do not change the post/upload API contract.** The base64 `/v1/uploads`
  endpoint is a known limitation; resumable/multipart uploads are documented as
  a server dependency, not built.
- Client media limits mirror the server: image 12 MB, video 15 MB
  (`MAX_IMAGE_BYTES` / `MAX_VIDEO_BYTES`), validated before reading the file.
- Draft persistence is **text only** (`botifyr.feedDraft`). Media data-URLs are
  never persisted (quota + privacy). Cleared on successful publish.
- Composer errors are a separate channel from timeline-load errors so the
  feed's Retry button is never mistaken for a publish retry.
- Reuse existing design tokens/icons; no new primitives (Design System Manager).

## Work items — status

- [x] W1 Correct media limits (image 12 MB / video 15 MB, pre-read).
- [x] W2 Upload progress + publish lifecycle (`role="progressbar"`).
- [x] W3 Separate `composerError` from timeline `error`.
- [x] W4 Destination/audience summary + reset after publish.
- [x] W5 Reject past schedule (no silent "post now").
- [x] W6 Text-only draft persistence + Discard.
- [x] W7 A11y: textarea label, listbox mentions + Escape, per-file remove
  labels, Video badge, `aria-busy`.
- [x] W8 Retry only missing uploads (stable attachment id → media id map).
- [x] W9 GroupView error + counter + label.
- [x] W10 Full-repo gate (`npm run typecheck && npm run lint && npm test`).
- [x] W11 Live verification + screenshots (`scripts/composer-verify.mjs`).
- Blocked: alt text (server field), resumable uploads (endpoint).

## Tests executed (actual)

- `npm run typecheck -w @botifyr/ui` → **passed** (tsc --noEmit, no errors).
- `npx vitest run packages/ui/src/composer.dom.test.tsx` → **8 passed / 8**.
- `npx vitest run packages/ui` → **130 passed / 130** (12 files).
- `npx eslint packages/ui/src/FeedView.tsx packages/ui/src/composer.dom.test.tsx`
  → **0 errors** (2 unused-var warnings fixed).
- `npx prettier --check` on all changed code + docs → **clean**.
- **Full gate:** `npm run typecheck` → **clean (all workspaces)**;
  `npm run lint` → **clean (0 errors)**; `npm test` → **413 passed / 413**
  (61 files). The earlier `@botifyr/portal` unused-var failure in the
  concurrently-edited `BotifyrApp.tsx` is no longer present.
- **Live (running stack :1420 / :8787):** `node scripts/composer-verify.mjs`
  → **10 / 10 checks passed**: accessible text label, counter `19 / 4000`,
  destination summary, media preview thumbnail, past-schedule refusal, success
  notice only after server response, published post appears in the feed,
  destination + text reset after publish. Screenshots:
  `docs/assets/composer/composer-desktop.png`, `composer-mobile.png`.

## Outstanding tasks

- None blocking. Optional/backlog only: per-image alt text and resumable /
  non-base64 uploads both need a server contract change (see Handoff).

## Dependencies & blockers

- **Concurrent edits:** `FeedView.tsx` was being edited by the Pages Manager
  during this workstream (file grew ~2900→4500 lines). Re-read before editing;
  this workstream's changes are additive and isolated to composer regions.
- **Server dependencies (documented, not built):** per-image alt text; a
  non-base64 / resumable upload path.
- **Product decision (Feed Experience Lead):** whether text drafts should also
  be server-synced (currently device-local `localStorage`).

## Handoff notes for other agents

- **Post Manager:** the `createPost` contract was **not** changed; only the
  client-side call site/reset logic. No DTO edits.
- **Pages Manager:** composer still uses `listMyPages` + `pageId`; it now resets
  `postAs` after a success. If you also edit the composer region, rebase.
- **Feed QA & E2E Manager:** `packages/ui/src/composer.dom.test.tsx` is the base
  for publishing-journey tests; E2E still needs the running stack.
- **Design System Manager:** new classes are additive and use existing tokens
  (`--accent`, `--danger*`, `--panel-2`, `--muted`).

## Exact next action

1. (Done) Full gate green: typecheck clean, lint clean, `npm test` 413/413.
2. (Done) Live verification green (10/10) + screenshots captured.
3. (Done) Results recorded above.
4. Send the completion report to the Feed Experience Lead. The only open items
   are the two server-contract questions (alt text, resumable uploads) and the
   draft-sync product decision.
