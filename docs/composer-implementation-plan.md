# Content Composer — Implementation Plan

> Owner: **Composer Manager** (Feed Experience Team). Inputs:
> `docs/composer-ux-audit.md`, `docs/composer-competitive-research.md`.
> Status legend: **Done** · Planned · Blocked (server) · Backlog.

## Constraints (from AGENTS.md / architecture)

- **One UI, two hosts** — all composer UI stays in `packages/ui/src/FeedView.tsx`
  and `styles.css`. No host-specific copies.
- **No invented APIs** — only use `client.uploadFile`, `client.createPost`,
  `client.createPage`, `client.listMyPages` (already present).
- **Small, surgical edits** to shared files; no unrelated refactoring.
- Reuse design-system tokens/components and existing icons; do not duplicate
  `PostCard`/`Avatar`/`PageView`.

## Work items

### W1 — Correct media limits (P0, C1) · Done
- Add module constants `MAX_IMAGE_BYTES = 12 MB`, `MAX_VIDEO_BYTES = 15 MB`
  (mirrors `server.ts` `buffer.length > 15 MB`).
- Validate **before** `FileReader.readAsDataURL` so an over-limit file never
  enters memory or the network.
- Genuine error copy via the composer error channel (W3).
- *Regression risk:* a previously "allowed" 15–25 MB video now rejected earlier
  — intended, and previously failed server-side anyway.
- *Test:* `composer.dom.test.tsx` rejects a 16 MB video without calling the API.

### W2 — Explicit upload/publish lifecycle (P0/P1, C2/F2) · Done
- Add `upload: { done: number; total: number } | null`.
- `publish()` sets `upload = {0, total}` before the media loop, increments after
  each `uploadFile`, clears in `finally`.
- Render a `role="progressbar"` bar inside the composer while uploading.
- Submit label: `Uploading n/total…` → `Publishing…` / `Schedule` / `Post`.
- Submit disabled while `posting`.
- *Test:* progressbar appears during a deferred `uploadFile` promise.

### W3 — Separate composer errors from feed-load errors (P1, C3) · Done
- New `composerError` state rendered **inside** the composer (`role="alert"`).
- Feed `error` remains only for the timeline (its Retry still reloads the feed).
- Attach-validation and publish failures set `composerError`.
- *Test:* a rejected `createPost` shows the message in the composer and keeps
  the draft + attachments.

### W4 — Destination/audience safety (P1, A2/D2) · Done
- Add a concise destination summary in the action row ("Posting as **You** ·
  Friends" / "… as **Page** · Public").
- On success reset `postAs` → `""`, `audience` → `"friends"`, and the rest
  (draft/media/schedule/album/poll) as before.
- *Test:* after a successful Page post, `postAs` select returns to "You".

### W5 — Scheduled-time validation (P1, D3) · Done
- Before submit: if `scheduledAt` parsed ≤ now → `composerError =
  "Pick a future time to schedule, or clear the schedule to post now."` and
  abort (no request).
- *Test:* past schedule does not call `createPost`.

### W6 — Text-only draft persistence (P2, E2) · Done
- Key `botifyr.feedDraft`; lazily init `draft` from it; persist on change
  (remove when empty); clear on successful publish.
- Show a "Draft restored" hint with **Discard** while a restored draft is
  present and untouched-since-restore.
- Media is **not** persisted (size/quota/privacy). Documented.
- *Test:* a pre-seeded draft renders and Discard clears it + storage.

### W7 — Accessibility fixes (P1/P2, B1/B2/B3/C4/F5) · Done
- `aria-label="Post text"` + `aria-describedby` to counter/error ids.
- File-attachment remove label uses the file name; add a "Video" badge.
- Mention menu gets `role="listbox"`/`role="option"` and Escape-to-dismiss.
- Submit gets `aria-busy`.

### W8 — Retry only missing uploads (P2, E3) · Done
- Keep uploaded `mediaIds` aligned by attachment index in a ref; on retry,
  skip indexes already uploaded and only send the rest.
- Cleared when attachments change or on success.

### W9 — Group composer parity (P2, E4) · Done (minimal)
- Add error handling (no more `catch {}`), a character counter, and an
  `aria-label` on the textarea in `GroupView`. No media/destination there
  (groups are text streams).

### W12 — Per-image alt text (second pass) · Done
- `post_media.alt` column (+ idempotent `ALTER TABLE … ADD COLUMN IF NOT
  EXISTS`), `PostMediaRecord`, `POST /v1/posts` accepts `alts[]` (index-aligned
  with `[mediaId, …mediaIds]`), feed DTO returns `imageAlts` parallel to
  `images`.
- Client `FeedPost.imageAlts` + `createPost({ alts })`; composer renders one alt
  input per attachment; post images/lightbox use the stored alt.
- Tested: server round-trip; UI sends alt + renders alt.

### W13 — Raw-binary uploads (second pass) · Done
- New `POST /v1/uploads/raw?name=&mime=` (content-type `application/octet-stream`,
  limit 50 MB) with a shared `persistUpload` helper; base64 `/v1/uploads`
  unchanged for other callers.
- Client `uploadFileRaw({ name, mime, blob })`; composer streams raw bytes and
  raises the caps to image 20 MB / video 50 MB; previews use object URLs with
  proper revocation.

### W14 — Server-synced drafts (second pass) · Done
- `post_drafts` table + `GET/PUT/DELETE /v1/posts/draft`; client
  `getPostDraft`/`savePostDraft`/`deletePostDraft`; composer adopts a server
  draft on mount when the local draft is empty, debounce-saves on change, and
  clears on publish/discard. `localStorage` stays as the offline fallback.

### W15 — Mood emoji picker (second pass) · Done
- The "Mood" button opens a `role="listbox"` picker (reuses `.emoji-pop` /
  `.emoji-choice`) and inserts the chosen emoji at the caret.

### W16 — Byte-accurate upload progress (third pass) · Done
- `uploadFileRaw(input, onProgress?)` reports bytes via XHR (fetch has no upload
  progress event); the fetch path is unchanged when no callback is passed.
- The composer aggregates bytes across attachments and shows a percentage
  (`role="progressbar"` `aria-valuenow` 0–100) with the file count alongside.
- No CSS change: reuses the existing `.feed-upload*` classes.

### W17 — Published posts render through the card (fourth pass) · Done
- `prependUnique(list, post)` replaces every bare `[post, ...prev]` insertion
  (feed publish, group publish, repost, permalink fetch), so a realtime refresh
  racing a local insert can't render two cards for the same post.
- Tests assert a newly published post renders as a full `PostCard` (feed + group)
  and is not duplicated; the E2E publish test checks the action bar.

### W18 — Composer horizontal compaction (fourth pass) · Done
- The **Post as** and **Audience + schedule** rows are merged into a single
  horizontal row (`.feed-composer-as` with a `.feed-composer-divider`), reducing
  the composer from four stacked rows to three. Delegated by the Feed Experience
  Lead (`docs/feed-page-redesign-report.md`).

### Backlog
- Collapsed composer state (further than compaction); `listScheduled` management
  UI (Post Manager).

## Coordinate-don't-duplicate

| Area | Owner | Boundary |
| --- | --- | --- |
| Post rendering, DTO contract | Post Manager | Composer calls `createPost`; never renders posts. |
| Page roles/destinations | Pages Manager | Composer only lists `listMyPages` and passes `pageId`. |
| Reels/Story creation | Reels/Stories Managers | Not built here. |
| Buttons/icons/tokens | Design System Manager | Reuse existing; style additions are additive. |
| Feed refresh after publish | Feed & Discovery Manager | Composer prepends via existing `setPosts`. |
| E2E publishing journey | Feed QA & E2E Manager | New unit/DOM tests provided as a base. |

## Verification plan

1. `npm run typecheck -w @botifyr/ui`
2. `npx vitest run packages/ui` (new composer tests)
3. `npx eslint` on changed files; `prettier --check` on changed files
4. Full `npm test` at the end of the session.
5. Optional live pass: `node scripts/feed-screenshots.mjs` if the dev stack is up
   (capture `composer-*` states).
