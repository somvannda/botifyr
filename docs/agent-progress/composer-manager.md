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
  `removeAttachment`, `setAttachmentAlt`, `insertEmoji`, `publish`, draft effects
  (local + server), preview-URL cleanup, composer JSX, `PostMedia`, `GroupView`.
- `packages/ui/src/styles.css` — additive `.feed-composer-destination`,
  `.feed-draft-hint`, `.feed-upload*`, `.feed-composer-error`,
  `.feed-composer-notice`, `.feed-composer-hint`, `.feed-composer-thumb-kind`,
  `.feed-composer-alts`, `.feed-mood` / `.feed-mood-pop`.
- `packages/ui/src/composer.dom.test.tsx` (new, 14 tests).
- `packages/ui/src/FeedView.dom.test.tsx` — mock the new client methods.
- `packages/client/src/index.ts` — `uploadFileRaw`, `getPostDraft` /
  `savePostDraft` / `deletePostDraft`, `FeedPost.imageAlts`, `createPost.alts`,
  `RequestOptions` widened.
- `apps/cloud/src/server.ts` — `alts` + `imageAlts`, `/v1/uploads/raw`,
  `/v1/posts/draft`, shared `persistUpload`.
- `apps/cloud/src/store/{types,schema,memory,postgres}.ts` — `PostMediaRecord`,
  `PostDraftRecord`, `post_media.alt`, `post_drafts`, draft methods.
- `apps/cloud/src/server.feed.test.ts` — alt-text, raw-upload, draft tests.
- `scripts/composer-verify.mjs` (new) — live checks.

## Architectural decisions

- Keep all composer UI in `FeedView.tsx` + `styles.css` (AGENTS.md §7, one UI /
  two hosts). No new host files.
- **Additive contract changes only** (second pass): `POST /v1/posts` gained
  optional `alts[]`; `POST /v1/uploads/raw` is a new sibling to the base64
  `/v1/uploads` (kept for chat/other callers); `/v1/posts/draft` is new. No
  existing field/route changed shape.
- Client media limits mirror `/v1/uploads/raw`: image 20 MB, video 50 MB
  (`MAX_IMAGE_BYTES` / `MAX_VIDEO_BYTES`), validated before reading. The
  composer uploads **raw bytes** and previews via object URLs (revoked on
  removal/success), so there is no base64 inflation or leaked object URL.
- Draft persistence is **text only**: `localStorage` (`botifyr.feedDraft`) as an
  offline fallback, plus server sync (`/v1/posts/draft`). Media is never
  persisted. Cleared on successful publish / Discard.
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
- [x] W12 Per-image **alt text** (server column + DTO + client + composer + tests).
- [x] W13 **Raw-binary uploads** prefix `/v1/uploads/raw` + composer uses it.
- [x] W14 **Server-synced drafts** `/v1/posts/draft` + composer sync.
- [x] W15 Mood emoji **picker** (was a single-emoji button).
- [x] W16 Byte-accurate upload progress (XHR).
- [x] W17 Newly published posts render through the card (dedupe + tests).
- [x] W18 **Composer horizontal compaction** — destination, audience and schedule
  share one row (delegated by the Feed Experience Lead in
  `docs/feed-page-redesign-report.md`).

Previously "blocked" items are now implemented; see the second-pass notes below.

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

### Second pass — remaining items completed (actual)

- `npx vitest run apps/cloud/src/server.feed.test.ts` → **32 passed**
  (new: alt-text round-trip, raw upload, draft round-trip).
- `npx vitest run packages/ui/src/composer.dom.test.tsx` → **14 passed**
  (new: mood picker, alt text ×2, server draft restore, draft clear on publish).
- **Full gate:** `npm run typecheck` → **clean (all workspaces)**;
  `npm run lint` → **clean (0 errors)**; `npm test` → **452 passed / 452**
  (64 files).
- **Live (cloud rebuilt, `docker compose up -d --build cloud`):**
  `node scripts/composer-verify.mjs` → **10 / 10 checks passed**, now including
  the raw-binary upload path end-to-end (attach image → publish → post appears).
- **Bug found & fixed by live verification:** `uploadFileRaw` sent the real MIME
  (`image/png`) as the request content-type, but the server only parses
  `application/octet-stream` → Fastify 415 and a silent publish failure. The
  client now always sends `application/octet-stream` and carries the real MIME in
  the `mime=` query param. This is why live verification matters — the mocked DOM
  tests could not catch it.

## Outstanding tasks

- None blocking. All four previously-open items are implemented:
  alt text (W12), raw uploads (W13), server drafts (W14), mood picker (W15).
- **Deploy note (resolved):** the composer calls the new `POST /v1/uploads/raw`
  and `/v1/posts/draft` routes. The local cloud was rebuilt and the live
  verification passed; production/other environments need the same rebuild.
- Only open decision: confirm the **server-synced draft** product choice with the
  Lead (implemented on the reasonable default; device-local storage remains the
  offline fallback).

## Dependencies & blockers

- **Concurrent edits:** `FeedView.tsx` was being edited by the Pages Manager
  during this workstream (file grew ~2900→4500 lines). Re-read before editing;
  this workstream's changes are additive and isolated to composer regions.
- **Additive contract changes (built):** `POST /v1/posts` gained `alts[]`;
  `POST /v1/uploads/raw`; `GET/PUT/DELETE /v1/posts/draft`. No existing field or
  route changed shape.

## Handoff notes for other agents

- **Post Manager:** the `createPost` contract gained **optional** `alts[]` only;
  the DTO gained optional `imageAlts[]`. Existing callers are unaffected.
- **Pages Manager:** composer still uses `listMyPages` + `pageId`; it now resets
  `postAs` after a success. If you also edit the composer region, rebase.
- **Feed QA & E2E Manager:** `packages/ui/src/composer.dom.test.tsx` is the base
  for publishing-journey tests; E2E still needs the running stack.
- **Design System Manager:** new classes are additive and use existing tokens
  (`--accent`, `--danger*`, `--panel-2`, `--muted`).

## Exact next action

1. (Done) Full gate green: typecheck clean, lint clean, `npm test` 449/449.
2. (Done) All four open items implemented + tested (W12–W15).
3. (Done) Results recorded above.
4. (Done) Cloud rebuilt; `scripts/composer-verify.mjs` 10/10 against the live
   app with the new raw-upload path.
5. Send the completion report to the Feed Experience Lead; confirm the
   server-synced-draft product decision.
