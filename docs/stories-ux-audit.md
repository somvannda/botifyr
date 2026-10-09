# Stories — UX & Reliability Audit

> Owner: **Stories Manager** (Feed Experience Team). Date: **Oct 2026**.
> Method: source inspection of `packages/ui/src/FeedView.tsx` (pre-change
> `StoryViewer` ~1848–1951), `packages/ui/src/styles.css` (`.story-*`), the
> `Story` DTO in `packages/client/src/index.ts`, and the `GET/POST /v1/stories`
> routes in `apps/cloud/src/server.ts`. Evidence is from code; no live session was
> captured. Line numbers reference the **pre-change** source. Severity is rated by
> user impact.
> Companion docs: [`stories-competitive-research.md`](stories-competitive-research.md),
> [`stories-implementation-plan.md`](stories-implementation-plan.md).

## Where the experience lives

- **Tray + viewer:** `FeedView.tsx` — `stories-strip` + `StoryViewer`.
- **Data:** `client.listStories()` → `GET /v1/stories`
  (`server.ts:5441`) → `store.listActiveStories([userId, ...friendIds], now, 50)`.
  Returns a **flat, newest-first** list with `id, author, caption, imageUrl?,
  createdAt, expiresAt`.
- **Create:** `client.createStory({ mediaId })` → `POST /v1/stories`
  (`server.ts:5419`); 24 h expiry, image or text, max 200-char caption.
- **Styles:** `.stories-strip`, `.story-tile`, `.story-avatar`, `.story-viewer`,
  `.story-progress`, `.story-nav` in `styles.css`.
- **Tests:** `FeedView.dom.test.tsx` — EXP-1 (open/navigate) and EXP-2 (seen).

## What already worked (keep)

- Backed by a real API with real 24 h expiry and friends-only visibility.
- Progress segments, timed auto-advance, prev/next, and `←/→/Esc` keyboard.
- Expired stories are filtered **server-side**; the viewer guards a missing item.
- Timers are cleared on unmount (no leak on the happy path).

---

## Issues

### ST-01 — Tray shows one tile per story, not per creator · Severity: **High**
- **Impact:** A creator with five stories clutters the tray with five near-identical
  tiles; the tray order no longer reads as "who has new content". Multi-story
  creators are effectively invisible.
- **Evidence:** the tray maps `stories.map(...)` directly
  (`FeedView.tsx:2334` pre-change); the viewer's segments were `stories.map(...)`
  over the same flat list (`:1899`).
- **Fix:** group by `author.id`; one tile per creator; segments cover the active
  creator's collection.
- **Dependencies:** none.
- **Regression risk:** progress-segment count semantics change (now per creator);
  the EXP-1 test had to be updated to match the corrected behaviour.

### ST-02 — "Seen" state is session-only and marked before viewing · Severity: **High**
- **Impact:** Every reload resets "viewed"; and the tile is dimmed the instant it is
  *clicked*, even if the viewer is immediately closed or the story fails to load.
  The dim is therefore a lie.
- **Evidence:** `seenStories` is component state initialised to `{}`
  (`FeedView.tsx:2015`) and set in the tile `onClick` (`:2341`). Nothing persists;
  no view API exists (`server.ts` has only `POST/GET /v1/stories`).
- **Fix (done):** a story is marked seen when it becomes **active** in the viewer;
  the id list persists in `localStorage` and is aggregated per creator. The server
  now records the view via `POST /v1/stories/:id/view` and returns `viewedByMe`,
  which seeds the local store across devices.
- **Dependencies:** none. `POST /v1/stories/:id/view` implemented (store
  `story_views`, server route, `client.viewStory`).
- **Regression risk:** stale ids accumulate; cap the stored list.

### ST-03 — No pause / press-and-hold · Severity: **High**
- **Impact:** Users cannot stop to read a caption or look at a photo; the story
  races past. There is no way to hold a frame.
- **Evidence:** the only interaction is `onClick={advance}` on the viewer
  (`FeedView.tsx:1896`) plus the auto-advance timer (`:1876`). No pointer/keyboard
  pause path exists.
- **Fix:** press-and-hold pauses (release resumes); `Space` toggles; the progress
  fill freezes and continues from where it stopped.
- **Dependencies:** none.
- **Regression risk:** a held press must not also trigger advance (click
  suppression); resuming must not restart the segment.

### ST-04 — Clicking anywhere advances; no back region on the media · Severity: **Medium**
- **Impact:** Tapping the left side to go back instead advances; on touch devices
  this is disorienting and makes "previous" nearly unusable (only the small arrow
  button works).
- **Evidence:** the viewer container has `onClick={advance}` (`FeedView.tsx:1896`);
  there is no left tap zone.
- **Fix:** left-third tap = previous, remainder = next; keep the visible arrow
  buttons as the accessible controls.
- **Dependencies:** none.
- **Regression risk:** overlay z-index ordering vs. header/close.

### ST-05 — Broken media leaves no recovery · Severity: **High**
- **Impact:** An expired signed URL or a deleted blob renders a broken image with
  no explanation and no way forward except waiting for the timer.
- **Evidence:** `<img src={...} />` has no `onError` (`FeedView.tsx:1917`).
- **Fix:** error state with Retry (reload) and Next.
- **Dependencies:** none.
- **Regression risk:** ensure the error chrome sits above the tap zones.

### ST-06 — No loading / empty / error states in the tray · Severity: **Medium**
- **Impact:** `listStories()` is fired and failures are swallowed
  (`FeedView.tsx:2116-2120` pre-change). A slow or failed request shows only the
  "Your story" tile, indistinguishable from "no stories".
- **Evidence:** the fetch `.catch(() => {})`; no loading flag.
- **Fix:** skeleton tiles while loading; a Retry tile on error; a quiet empty
  label when there are genuinely none.
- **Dependencies:** none.

### ST-07 — Tray "Your story" only uploads; own stories are unreachable · Severity: **Medium**
- **Impact:** The tile always opens a file picker even when you already have
  active stories, so you cannot view your own story from the tray. Your own story
  also appears as a second, separate tile, duplicating "you".
- **Evidence:** `<button onClick={() => storyRef.current?.click()}>` with a
  hard-coded `＋` (`FeedView.tsx:2317`); own stories come back inside the flat
  list and render like anyone else's.
- **Fix:** own tile opens your story when present (first unseen), with a small
  `+` overlay to add; exclude self from the "others" list.
- **Dependencies:** none.

### ST-08 — Backgrounding a tab keeps counting down · Severity: **Medium**
- **Impact:** Switching away can silently consume stories the user never saw;
  returning lands on a later story or a closed viewer.
- **Evidence:** only a `setTimeout` runs (`FeedView.tsx:1876`); no
  `visibilitychange` handling.
- **Fix:** pause on `document.hidden`, resume on return.

### ST-09 — No focus management in the dialog · Severity: **Medium**
- **Impact:** Keyboard/screen-reader users keep focus on the tray behind the
  `aria-modal` dialog; `Esc` closes but focus is not moved in or restored.
- **Evidence:** `<div role="dialog" aria-modal="true">` with no focus logic
  (`FeedView.tsx:1891`).
- **Fix:** focus the close button on open; restore the opener on close.

### ST-10 — Viewed/unseen relies on opacity alone · Severity: **Medium**
- **Impact:** Low-vision and screen-reader users cannot tell new from viewed;
  the accessible name is just the creator (e.g. "Alice").
- **Evidence:** `.story-avatar.seen { opacity: 0.65 }` (`styles.css:8592`); the
  tile `<button>` has no `aria-label`.
- **Fix:** include "new story"/"viewed" in the accessible name; keep the visual
  ring.

### ST-11 — Replies/reactions are absent despite FR-13 · Severity: **Medium**
- **Impact:** The spec says "viewers can react and reply (reply opens a DM)"
  (`feed-next.md:327`). Neither exists.
- **Evidence:** `StoryViewer` renders no reply/reaction UI. The backend has no
  story-reaction route (EXP-9, deferred), but the **DM channel does exist**
  (`client.openDm`, `client.sendDm`; `server.ts:3557,3756`).
- **Fix (done):** a reply bar sends through the DM channel; quick reactions use
  the new `POST /v1/stories/:id/reaction` route (`story_reactions` store) with
  optimistic UI and refetch-on-failure.
- **Dependencies:** DM API (present) and the new story-reaction route (implemented).

### ST-12 — No client-side expiry guard / removed-story handling · Severity: **Low**
- **Impact:** A story that expires while the app is open stays in the tray until
  the next fetch; if the list changes shape the index-based viewer can briefly
  point at the wrong item.
- **Evidence:** the viewer indexes `stories[storyIndex]` (`FeedView.tsx:1861`)
  and expiry is only enforced server-side.
- **Fix:** filter expired items at grouping time; identify the open story by
  `author.id`+`story.id` and close if it disappears.

### ST-13 — Media falls short of immersive · Severity: **Low**
- **Impact:** `max-width: 520px` on large screens presents a small card rather
  than an immersive story; captions are clamped at 520px and can overlap controls.
- **Evidence:** `.story-viewer img { max-width: min(520px, 90vw) }`,
  `.story-caption { bottom: 28px }` (`styles.css:7562,7575`).
- **Fix:** allow up to `min(560px, 92vw)` / `82vh`, centre the caption above the
  reply bar, add a text-shadow.

### ST-14 — No reduced-motion handling for progression · Severity: **Low**
- **Impact:** Motion-sensitive users still see the fill animate.
- **Evidence:** — actually a `prefers-reduced-motion` rule already disables the
  fill (`styles.css:8693`); timing still advances, which is acceptable.
- **Status:** **Already adequate**; retained.

---

## Ranked priority

| Priority | Issue | Severity |
| --- | --- | --- |
| 1 | ST-03 pause / hold | High |
| 2 | ST-01 group by creator | High |
| 3 | ST-02 durable, honest seen state | High |
| 4 | ST-05 media error recovery | High |
| 5 | ST-04 tap regions | Medium |
| 6 | ST-08 backgrounding pause | Medium |
| 7 | ST-06 tray states | Medium |
| 8 | ST-07 own-story tile | Medium |
| 9 | ST-09 focus management | Medium |
| 10 | ST-10 accessible seen labels | Medium |
| 11 | ST-11 replies via DM | Medium |
| 12 | ST-12 client expiry guard | Low |
| 13 | ST-13 immersive sizing | Low |
