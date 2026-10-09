# Content Composer — UX & Reliability Audit

> **Historical record** — ports reflect the run at the time. Canonical local dev is defined in [`AGENTS.md`](../AGENTS.md) §10.

> Owner: **Composer Manager** (Feed Experience Team). Companion docs:
> `docs/composer-competitive-research.md`, `docs/composer-implementation-plan.md`,
> `docs/agent-progress/composer-manager.md`.
>
> Evidence is from reading the current source (`packages/ui/src/FeedView.tsx`,
> `packages/ui/src/styles.css`, `packages/client/src/index.ts`,
> `apps/cloud/src/server.ts`). Runtime checks are marked where actually run.

## What the composer is today

There are **two** composed surfaces in `FeedView.tsx`:

- **Main composer** — `FeedView`, inline `<form className="feed-composer">`
  (`FeedView.tsx:2458`). Text, mentions (`@name`), up to 4 image/video
  attachments (base64 data URLs), "Post as" (You / a Page / new Page), audience
  (`public | friends | only_me`), `datetime-local` schedule, optional album name,
  optional poll (2–4 options), emoji-append button, live character counter.
  Publish = sequential `client.uploadFile` per attachment, then `createPost`
  (`FeedView.tsx:2249`).
- **Group composer** — `GroupView`, inline form (`FeedView.tsx:1798`). Plain
  text only, posts `{ body, groupId }`. No counter, media, audience, error UI.

Backend (authoritative):

- `POST /v1/posts` — requires text or ≥1 image; `MAX_POST_BODY = 4000`
  (`server.ts:4204,4478`); truncates media list to 4; audience defaults to
  `friends`; past `scheduledAt` is **silently dropped** (posts now); Page posts
  need editor/admin; group posts need membership.
- `POST /v1/uploads` — base64 JSON, `bodyLimit 25 MB`, rejects decoded
  `buffer.length > 15 MB` (`server.ts:5738–5751`).
- Polls: labels trimmed to 80 chars, 2–4 kept, `<2` ⇒ **no poll**.

---

## A. Entry & layout

| # | Issue | Severity | Impact | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| A1 | Composer is inline in the Feed only; no dedicated "create" entry from a Page or profile (Group has its own simpler one). | Low | Users manage Pages from the Feed composer's "Post as"; acceptable. | `FeedView.tsx:2458`, `1798`; `PageView` has no composer. | Keep; document. Page/Group reuse is a later option. |
| A2 | Destination ("Post as") and Audience are two separate rows below the media, with no summary; when "Post as" is a Page the audience row still shows. | Medium | Users can't see at a glance *where* the post goes; a Page post can be accidentally sent with "Friends" audience. | `FeedView.tsx:2517–2570`. | Add a one-line destination summary in the action bar; reset after publish (see D2). |
| A3 | Composer stays expanded at all times (no collapsed "What's on your mind?" affordance). | Low | Uses vertical space at the top of the feed. | Screenshot `docs/assets/feed/desktop-1440.png`. | Not changed — the feed is content-light; collapsed state is optional. |

## B. Text editing

| # | Issue | Severity | Impact | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| B1 | Textarea has only a placeholder, no `aria-label`. | Low (a11y) | Screen readers fall back to the placeholder, which is weak. | `FeedView.tsx:2461–2468`. | Add `aria-label="Post text"` + `aria-describedby` for the counter/errors. |
| B2 | Counter is fine (live, `aria-live`) but appears only when text exists; no `aria-describedby` link to the field. | Low | Counter not announced as related to the field. | `FeedView.tsx:2615–2622`. | Wire `aria-describedby`. |
| B3 | Mention menu is plain buttons with no `role="listbox"`/keyboard nav; Escape doesn't dismiss. | Low | Keyboard users can't drive the suggestions. | `FeedView.tsx:2470–2487`. | Add listbox roles + Escape handling. |
| B4 | Text is preserved on validation/publish failure (good). | — | — | `draft` isn't cleared on error (`FeedView.tsx:2272` only on success). | Keep; add regression test. |

## C. Media selection

| # | Issue | Severity | Impact | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| C1 | **Client video limit (25 MB) exceeds the server limit (15 MB).** A 15–25 MB video is accepted, fully read, base64-encoded, uploaded, then rejected 413. | **High (P0)** | Wasted time/data; feels broken. | `FeedView.tsx:2070` (`(isVideo ? 25 : 12) * 1024 * 1024`) vs `server.ts:5749`. | Single shared limit: image 12 MB, video 15 MB, checked before reading the file. |
| C2 | No upload progress; large files show only "Saving…". | High | Users retry → duplicates or lost work. | `FeedView.tsx:2257–2260,2630`. | Add `uploading (n/total)` progress bar. |
| C3 | Validation errors for files are pushed into the **feed-load** `error` state, whose Retry reloads the feed. | High | Confusing: the retry action doesn't retry the failed thing; a publish error can wipe/replace feed-load errors. | `FeedView.tsx:2067–2071,2643–2650`. | Separate `composerError` for attach/publish; keep `error` for the timeline only. |
| C4 | Remove button is labelled "Remove image" even for video; thumbnails have no type indicator. | Low (a11y) | Screen-reader users hear the wrong thing. | `FeedView.tsx:2497–2504`. | Label `Remove <file name>`; add a "Video" badge. |
| C5 | Data URLs kept in React state; a 12 MB image is a ~16 MB string held in memory. | Medium | Memory spikes on mobile; unavoidable with the base64 endpoint, but should be bounded. | `FeedView.tsx:2074–2083`. | Keep (architecture), bound by C1 limits; document the endpoint limitation. |
| C6 | Duplicate files can be added; 4-image cap silently drops extras. | Low | Silent drop is mildly surprising. | `FeedView.tsx:2078`. | Show "up to 4 attachments" feedback. |

## D. Publishing

| # | Issue | Severity | Impact | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| D1 | Duplicate submit is guarded by `posting`. | — | Good. | `FeedView.tsx:2252`. | Keep; test. |
| D2 | **`postAs` and `audience` are not reset after a successful post.** The next post silently repeats the Page and audience. | **High** | Accidental cross-posting to a Page / wrong audience. | `FeedView.tsx:2271–2277` resets draft/media/schedule/album/poll but not `postAs`/`audience`. | Reset to `""` / `"friends"` after success. |
| D3 | **Past `scheduledAt` silently publishes now while the button says "Schedule".** | High | User believes it's queued; it's live immediately. | UI `FeedView.tsx:2563–2569`; server `server.ts:4510–4513`. | Validate future on submit; inline error. |
| D4 | No success confirmation distinct from the post appearing at the top. | Medium | On a busy feed the new post can be off-screen. | `FeedView.tsx:2271`. | Add a transient "Post published / Scheduled for …" status (`role="status"`). |
| D5 | Poll with <2 non-blank options is silently ignored. | Low | User thinks a poll was attached. | UI `FeedView.tsx:2269`; server `server.ts:4554–4560`. | Inline hint: "add at least 2 options". |
| D6 | "Mood" button just appends a single `😀`. | Low | Label over-promises; not a picker. | `FeedView.tsx:2601–2607`. | Leave (harmless) or rename — backlogged to avoid scope creep into the emoji picker. |

## E. Content recovery

| # | Issue | Severity | Impact | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| E1 | Draft survives in-app sub-navigation (Reels/Page/Group return paths) because state lives in `FeedView`. | — | Good. | `FeedView.tsx:1992–1999`. | Keep. |
| E2 | Draft is **lost on tab switch / reload** (no persistence). | Medium | Content loss is the #1 composer complaint. | `draft` is component state only. | Persist **text only** to `localStorage`, clear on send, offer Discard. |
| E3 | Failed upload/publish keeps content (good) but gives no retry of just the failed step. | Medium | User must re-tap Post and re-upload everything (already-uploaded media is re-uploaded). | `FeedView.tsx:2256–2270`. | Track uploaded media ids across retries so only missing files upload. |
| E4 | Group composer swallows errors entirely (`catch {}`). | Medium | A failed group post looks like nothing happened. | `FeedView.tsx:1756–1758`. | Add error text to the group composer. |

## F. Accessibility

| # | Issue | Severity | Impact | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| F1 | No `aria-label` on the composer textarea. | Low | See B1. | `FeedView.tsx:2461`. | Add. |
| F2 | Upload progress not exposed (none exists). | High | See C2. | — | `role="progressbar"` with values once added. |
| F3 | "Remove image" mislabels video (C4). | Low | See C4. | `FeedView.tsx:2501`. | Fix label. |
| F4 | Existing focus-visible ring, labelled selects, `role="alert"` error are good. | — | Verified previously (`docs/feed-manager-progress.md`). | `.feed *:focus-visible` (`styles.css:8803`). | Keep. |
| F5 | Submit button has no `aria-busy`. | Low | Busy state not announced. | `FeedView.tsx:2623`. | Add `aria-busy`. |

---

## Severity roll-up

- **P0 / High:** C1 (limit mismatch), C2 (no progress), C3 (error conflation),
  D2 (stale destination), D3 (silent schedule→now), F2.
- **Medium:** A2, C5, D4, D5, E2, E3, E4.
- **Low:** A1, A3, B1–B3, C4, C6, D6, F1, F3, F5.

## Ownership / dependencies

- Composer layout, text, media, publish lifecycle, draft → **Composer Manager**
  (`FeedView.tsx` composer regions only).
- Buttons/inputs/tokens/icons/progress styling → **Design System Manager**
  (reuse existing `--accent`, `.feed-composer-*`, `Icons.tsx`; no new primitives
  without request).
- `PostRecord`/`Post` DTO shape, `createPost` contract → **Post Manager**. This
  audit does **not** change the contract.
- `pageId`/role rules → **Pages Manager**. No Page-logic duplication.
- Reels/Stories create requirements → Reels/Stories Managers (out of scope).
- Publishing journeys / regression specs → **Feed QA & E2E Manager**.
- Alt text (P7) and any resumable/multipart upload → **server dependency**,
  needs the Feed Experience Lead to schedule a contract change.

## Known non-issues (checked, left alone)

- `capture`/`accept` on the file input is correct (`image/*,video/*`).
- No temporary object-URL leaks: the composer uses data URLs, not
  `URL.createObjectURL`. Nothing to revoke.
- `GroupView` membership is enforced server-side; UI only shows the composer to
  joined members.
