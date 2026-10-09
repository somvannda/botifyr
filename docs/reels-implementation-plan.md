# Reels — Implementation Plan

> Owner: **Reels Manager**. Date: **Oct 2026**. Companion to the
> [audit](reels-ux-audit.md) and [research](reels-competitive-research.md).

## 1. Goals

Bring the Reels surface to production quality **within the existing
architecture**: one shared UI (`packages/ui`), one client (`@botifyr/client`),
the existing `/v1/reels` endpoint. No new video library, no second UI, no fake
capabilities.

Target experience:
- One reel per screen, immersive, portrait-conscious.
- The in-view reel autoplays **muted**; everything else pauses.
- Clear transport: play/pause, progress + seek, mute, fullscreen.
- Right-side action rail (like, comment, share, save) and a More menu.
- Bottom-left creator + caption + hashtags over a gradient scrim.
- Keyboard navigation and prev/next buttons for desktop/a11y.
- Buffering, playback-error + retry, empty and end states.
- Cursor pagination.
- Respects `prefers-reduced-motion` (no autoplay) and autoplay policy.

## 2. Ownership & coordination

| Area | Owner | This plan's stance |
| --- | --- | --- |
| `ReelsView`, reel player, reel controls/layout | **Reels Manager (me)** | Rewritten here |
| Design tokens, `.feed-*` states, `Avatar`, `AuthorLine` | Design System Manager | **Reuse unchanged** |
| `CommentRow`, like/comment/save/repost semantics | Post Manager | **Reuse the exact methods/component**; no behavioural fork |
| `/v1/reels` ordering, `nextCursor`, pagination | Feed & Discovery Manager | Consume as-is; no server change |
| Metadata produced by publish (`videos`, `body`, `hashtags`, `author`) | Composer Manager | Consume as-is; no format change |
| Tests / E2E | Feed QA & E2E Manager | Add component tests; document E2E path |
| Shared `Icons.tsx` | Design System Manager | **Additive only** (`BookmarkIcon`, `VolumeIcon`, `FullscreenIcon`); no edits to existing icons |

Shared files touched, and why:
- `packages/ui/src/FeedView.tsx` — the Reels view lives here (its established
  home). Changes are scoped to `ReelVideo`/`ReelsView` (+ imports).
- `packages/ui/src/styles.css` — add a `.reel-*` block; existing rules are
  updated (not deleted) for the immersive layout.
- `packages/ui/src/Icons.tsx` — **append** three icons.
- `packages/ui/src/FeedView.dom.test.tsx` — append Reels tests.

Anything owned by another workstream that changes will be called out in the
progress record.

## 3. Component design

```
ReelsView                         (owns data, active index, mute, paging, comments)
├─ header: Back · "Reels" · Mute toggle · Refresh
├─ .reels-scroll (snap, tabIndex=0, onKeyDown)
│   └─ ReelCard (per post)
│       ├─ .reel-stage (position:relative, black, fills height)
│       │   ├─ <video> (custom transport; no native controls)
│       │   ├─ .reel-scrim (top + bottom gradients)
│       │   ├─ .reel-spinner        (buffering)
│       │   ├─ .reel-error + Retry  (playback failure)
│       │   ├─ .reel-tap            (tap-to-toggle; center play glyph when paused)
│       │   ├─ .reel-actions        (right rail: like, comment, share, save, more)
│       │   └─ .reel-info           (bottom-left: avatar, name, caption, hashtags)
│       ├─ .reel-transport          (play/pause · progress range · time · mute · fullscreen)
│   └─ (end) loading-more row
└─ CommentSheet (bottom sheet, reuses CommentRow)
```

### State
- `reels: FeedPost[]`, `loading`, `error`, `nextCursor`, `loadingMore`
- `active: number`, `muted: boolean` (persisted in `localStorage`)
- `commentsFor: FeedPost | null`

### Playback lifecycle
- One `IntersectionObserver` per card reports "I am the active reel"; the parent
  keeps a single `active` index. Only the active card's `<video>` plays.
- Media events (`loadedmetadata`, `timeupdate`, `waiting`, `playing`, `canplay`,
  `pause`, `play`, `ended`, `error`) drive the UI, so controls **never assume**
  playback started.
- `play()` promise rejections are caught; on `NotAllowedError` the player shows
  a play affordance instead of pretending to play.
- `preload`: `auto` for active, `metadata` for ±1, `none` otherwise.
- On unmount: pause + clear src; disconnect the observer.

### Accessibility
- All buttons have `aria-label`s; published counts via text, not colour alone.
- Scroll container is focusable; ArrowUp/Down, J/K, PageUp/PageDown navigate;
  Space toggles; M mutes; Escape closes. Keys are ignored while focus is inside
  an interactive control (buttons/inputs) so Space/Enter still activate them.
- Progress uses `<input type="range">` with `aria-label` + `aria-valuetext`.
- `prefers-reduced-motion: reduce` disables autoplay and non-essential
  transitions.
- ≥44px touch targets for rail buttons on coarse pointers.

## 4. Engagement semantics (reuse, don't fork)
- **Like** → `likePost(id, next)`; optimistic count/reaction, rollback on error.
- **Comment** → `listComments`/`addComment`, rendered with `CommentRow`.
- **Share** → `repost(id)` (the same meaning as `PostCard`'s Share), guarded
  against double submit, with a transient confirmation.
- **Save** → `savePost(id, next)`.
- **More** → menu (Hide / Report / Block) using existing `hidePost`,
  `reportPost`, `blockUser`.
- **Follow** → shown only when the reel is Page-authored (`post.pageId`),
  calling `followPage`/`unfollowPage`; **not** offered for people.
- Counts always mirror backend results; no invented numbers.

## 5. States
| State | Treatment |
| --- | --- |
| Initial load | Reel-shaped skeleton (stage + meta lines), not a single box |
| Buffering | Spinner over the stage, `aria-live="polite"` |
| Playback error | Inline message + **Retry** (reloads the element) |
| Autoplay blocked | Center play button |
| Invalid/expired URL | Same as playback error (browser fires `error`) |
| Empty collection | Existing `feed-empty` "No reels yet" + guidance |
| Load-more failure | Non-destructive inline notice; loaded reels retained |
| Deleted/unavailable | `.reel-missing` "Video unavailable" |
| Unauthorized | Propagated `error` from `listReels` → error + Retry |
| Failed engagement | Rollback + silent (matches `PostCard`) |

## 6. Testing plan
- **Component (vitest + jsdom):** mute toggle persists across reels; keyboard
  navigation changes the active reel; like toggles optimistically and rolls
  back on failure; comment sheet opens and posts a comment; error state shows
  Retry and re-fetches; empty state; missing-video state; reduced-motion disables
  autoplay; cleanup on unmount.
- **E2E (Playwright):** documented as limited — see Blockers (no video fixture).
- **Gate:** `npm run typecheck -w @botifyr/ui`, `npx vitest run packages/ui`,
  `npm run lint`, then `npm test`.

## 7. Risks & blockers
- **No video fixture in the repo** → true autoplay/seek E2E can't run in CI.
  Component tests assert behaviour via mocked media events instead. A small
  fixture MP4 would unblock full E2E.
- **Custom transport** must be carefully keyboard- and pointer-operable; it is
  the highest-risk new surface.
- **jsdom lacks** `IntersectionObserver`, `HTMLMediaElement.play`, fullscreen
  and `matchMedia` — tests mock these.
- Concurrent workstreams edit `FeedView.tsx`/`styles.css`; keep changes scoped
  to the `.reel-*` region and re-verify.

## 8. Definition of done
Audit + research + plan written; R-01…R-07 and R-11 addressed; component tests
added and green; typecheck/lint clean; remaining limitations documented; progress
record updated; completion report delivered.
