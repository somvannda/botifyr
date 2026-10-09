# Reels — UX & Reliability Audit

> Owner: **Reels Manager**. Date: **Oct 2026**.
> Method: source inspection of `packages/ui/src/FeedView.tsx` (ReelsView/ReelVideo),
> `packages/ui/src/styles.css`, `packages/client/src/index.ts`,
> `apps/cloud/src/server.ts` (`GET /v1/reels`), plus reading the existing
> `FeedView.dom.test.tsx` coverage. Line numbers reference the pre-change source.
> No live app session was captured for this audit; every issue below is evidenced
> from code. Severity is rated by user impact.

## Where the experience lives

- Entry: Feed top bar **Reels** button → `setReelsOpen(true)` → `ReelsView`
  (`FeedView.tsx:2310`, `:2241`).
- Data: `client.listReels()` → `GET /v1/reels` (`client/src/index.ts:1420`),
  returns video posts in `FeedPage` shape (`items`, `nextCursor`).
- Player: `ReelVideo` (`FeedView.tsx:1502`) — `<video controls loop muted
  playsInline preload="metadata">` inside a scroll-snap list.
- Mute: header button in `ReelsView` (`:1578`).
- Tests: `FeedView.dom.test.tsx:215` covers only the mute toggle.

## Issues

### R-01 — No engagement actions on a reel · Severity: **High**
- **Impact:** a reel is a dead end. Users can watch but cannot like, comment,
  share or save without leaving to find the post in the Feed (and short-form
  video posts may not be scrolled to). Engagement drops.
- **Evidence:** `ReelsView` renders only video + author name/caption
  (`FeedView.tsx:1588-1623`). No `likePost`/`addComment`/`repost`/`savePost` are
  called anywhere in the Reels path.
- **Fix:** action rail (like/comment/share/save) with optimistic updates and
  rollback, reusing `client.likePost`, `listComments`/`addComment`, `repost`,
  `savePost` — the same methods `PostCard` already uses.
- **Dependencies/risks:** reuse `CommentRow`; do not duplicate PostCard logic.
  `share` semantics must match `PostCard` (repost).

### R-02 — Playback failure is silent; no buffering indicator · Severity: **High**
- **Impact:** if a media URL is expired/404 or the network stalls, the user sees
  a black rectangle with native controls and no explanation or recovery. Users
  assume the app is broken.
- **Evidence:** `<video>` has no `onError`/`onWaiting`/`onCanPlay` handlers
  (`FeedView.tsx:1525-1536`); `play().catch(() => {})` swallows rejection
  (`:1511`). Only a *missing* `post.videos[0]` shows "Video unavailable"
  (`:1613`).
- **Fix:** track `waiting`/`stalled`/`error` from media events; show a buffering
  spinner and, on error, an inline "Couldn't play this reel" + **Retry** that
  re-issues `load()`. On autoplay rejection, show a manual play button.
- **Dependencies/risks:** none.

### R-03 — No video-to-video navigation for desktop / keyboard · Severity: **High**
- **Impact:** scroll-snap only helps pointer/touch users. Keyboard users cannot
  move between reels; there is no explicit Next/Prev affordance, so desktop
  users may not realise scrolling advances reels. Accessibility failure.
- **Evidence:** `ReelsView` has a `Back` button and a mute toggle only
  (`FeedView.tsx:1571-1587`); no keydown handler, no nav buttons.
- **Fix:** ArrowUp/Down + J/K + PageUp/PageDown navigation, prev/next buttons,
  and `Escape` to close; focus management for the scroll container.
- **Dependencies/risks:** must not hijack keys while focus is in a form control.

### R-04 — Layout is not immersive; portrait sizing is poor · Severity: **Medium**
- **Impact:** reels render as centred ~360px cards with 16px gaps and a
  `max-height: 620px` video (`styles.css:7598-7626`), so on a wide desktop the
  video is a small tile with gaps rather than a focused viewing surface. On tall
  screens the video can be letterboxed or leave large dead space.
- **Evidence:** `.reels-scroll` uses `padding:16px; gap:16px; align-items:center`
  and `.reel { max-width:360px }`; `.reel-video { max-height:620px }`.
- **Fix:** make each reel fill the available height (`height:100%`,
  `object-fit:contain` on a black stage), keep a sensible max width only for very
  wide viewports, and remove inter-item gaps so snapping is 1-item-per-screen.
- **Dependencies/risks:** visual change; verify on tablet/mobile.

### R-05 — No pagination; `nextCursor` is ignored · Severity: **Medium**
- **Impact:** users only ever see the first 12 reels even when more exist.
  Infinite-scroll discovery is expected in this product category.
- **Evidence:** `load()` calls `client.listReels()` once and never reads
  `page.nextCursor` (`FeedView.tsx:1553-1564`). The endpoint returns
  `nextCursor` (`server.ts:5499`).
- **Fix:** fetch the next page when the active index nears the end; append;
  show a small loading row; handle failure without losing the loaded items.
- **Dependencies/risks:** avoid duplicate in-flight requests.

### R-06 — Multiple/native controls conflict with an overlay; no progress/seek · Severity: **Medium**
- **Impact:** native `controls` occupy the same bottom region where a creator
  caption/action UI would live, and they look inconsistent across browsers. There
  is no persistent progress indication, which users rely on for short clips.
- **Evidence:** `controls` is set (`FeedView.tsx:1530`); no custom transport.
- **Fix:** replace native chrome with a compact, accessible custom bar
  (play/pause, progress `<input type=range>`, time, mute, fullscreen) so the
  overlay rail and caption have room and behaviour is predictable.
- **Dependencies/risks:** a custom control must be keyboard-operable and must not
  claim playback when `play()` failed.

### R-07 — Off-screen videos are not guaranteed to stop; resources linger ·
Severity: **Medium**
- **Impact:** CPU/network/memory contention on long sessions; potentially two
  videos playing if two elements exceed the 0.6 threshold during a fast fling.
- **Evidence:** `ReelVideo` only acts on entries crossing the 0.6 threshold
  (`FeedView.tsx:1505-1519`); it never pauses on unmount and never downgrades
  `preload`.
- **Fix:** single active index owned by `ReelsView`; non-active players
  `pause()` and reset; `preload` is `auto` only for the active reel, `metadata`
  for neighbours, `none` beyond; pause in the unmount cleanup.
- **Dependencies/risks:** none.

### R-08 — Autoplay preference and audio state are not preserved · Severity: **Low**
- **Impact:** if a user unmutes, then navigates away and returns, audio resets to
  muted. Minor friction.
- **Evidence:** `muted` is component state initialised to `true` (`:1551`); no
  persistence.
- **Fix:** keep mute in `ReelsView` (already) and optionally persist the viewer's
  preference in `localStorage` (small, reversible).
- **Dependencies/risks:** privacy-neutral; no server change.

### R-09 — Missing/expired metadata is not handled gracefully · Severity: **Low**
- **Impact:** an author with no name/avatar shows generic fallbacks; empty
  captions are dropped (fine), but there is no explicit "unavailable" treatment
  for a deleted reel beyond a missing video.
- **Evidence:** author fallbacks exist (`authorName`/`authorEmoji`); no per-reel
  "removed" state.
- **Fix:** render author via `Avatar`/`authorName` (existing helpers) in a
  scrim; show hashtags only when present; keep `.reel-missing` for no-media.
- **Dependencies/risks:** none.

### R-10 — Captions / alt text are not supported · Severity: **Low (accessibility, data-blocked)**
- **Impact:** deaf/hard-of-hearing users and screen-reader users get no text for
  the audio, and video has no accessible description.
- **Evidence:** `FeedPost` has no caption-track or alt-text field
  (`client/src/index.ts:115-164`); `ReelVideo` renders a bare `<video>`.
- **Fix:** use the post `body` as a visible text caption (it is the closest
  accessible substitute) and expose it to assistive tech; a real WebVTT track
  needs a backend/media-pipeline field.
- **Dependencies/risks:** **blocked** on media metadata (see plan §Blockers).

### R-11 — Reduced-motion not respected for playback/indicators · Severity: **Low**
- **Impact:** autoplaying motion can discomfort motion-sensitive users.
- **Evidence:** only the skeleton shimmer is disabled under reduced motion
  (`styles.css:8814`); autoplay continues regardless.
- **Fix:** when `prefers-reduced-motion: reduce` is set, **do not autoplay**;
  require an explicit play. Also skip non-essential CSS transitions.
- **Dependencies/risks:** additive; testable via `matchMedia`.

## Priority order

1. **R-01** engagement rail (High, high value)
2. **R-02** buffering + playback error/recovery (High, reliability)
3. **R-03** keyboard + prev/next navigation (High, accessibility)
4. **R-04** immersive sizing (Medium, visible quality)
5. **R-05** pagination (Medium, discovery)
6. **R-06** custom transport/progress (Medium, polish)
7. **R-07** active-only playback + preload budget (Medium, performance)
8. **R-11** reduced-motion autoplay off (Low, a11y)
9. **R-08/R-09** preference + metadata polish (Low)

## Backend-dependent (documented, not faked)

- **Captions / WebVTT tracks** — no field in `FeedPost` or the media pipeline.
- **Sound/audio name** — no audio metadata is exposed; a static "Original audio"
  label is used instead of inventing a track name.
- **Person follow/unfollow** — the reel payload carries no follow state for
  people, and the Feed implements person follow as a *friend request*
  (`POST /v1/friend-requests`), which is out of scope for the immersive viewer.
  **Page follow/unfollow IS offered inline** for Page-authored reels via
  `getPage` (for real state) + `followPage`/`unfollowPage`; the control is
  hidden if the state can't be read, so it never fakes a follow.
- **Copy-link/permalinks** — recorded in `feed-experience-backlog.md` as
  backend-dependent.
