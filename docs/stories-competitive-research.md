# Stories — Competitive Research

> Owner: **Stories Manager** (Feed Experience Team). Date: **Oct 2026**.
> Companion docs: [`stories-ux-audit.md`](stories-ux-audit.md),
> [`stories-implementation-plan.md`](stories-implementation-plan.md).

## Method & honesty note

This document is based on **established, widely-documented product behaviour**
of Instagram Stories, Facebook Stories, Snapchat Stories and WhatsApp Status, and
on the product brief in [`feed-next.md`](feed-next.md) §FR-13. No live session was
captured in this environment: Instagram/Facebook/Snapchat Stories are behind a
login and are not reproducible headlessly here, so no screenshot of an external
app is claimed. Where a pattern is adopted, the implementation note refers to
**this** codebase's real capabilities.

Patterns are grouped as **tray**, **viewer**, **progression**, **interaction**,
**availability**, **reliability**, and **accessibility**.

---

## 1. Story tray

### 1.1 Group by creator, not by item
- **What:** Each creator gets exactly one ring/tile. Their multiple stories play
  back-to-back inside the viewer.
- **Why:** A tray of 30 raw story items is unreadable and unclickable; creators
  are the unit users scan for.
- **Fits us?** Strongly. Our API returns a flat, newest-first list
  (`GET /v1/stories`), so grouping must happen client-side.
- **How:** `groupStories()` in `FeedView.tsx` folds the flat list into
  `{ author, stories[] }`, ordering creators by first appearance (most recent)
  and each creator's stories oldest→newest.

### 1.2 Unseen vs viewed ring
- **What:** Unseen = gradient/coloured ring; viewed = flat, dimmed ring.
- **Why:** Tells the user at a glance where new content is, without opening each.
- **Fits us?** Yes.
- **How:** The tile is "unseen" if **any** of the creator's stories is unviewed.
  We also carry the state in the accessible label (`"Alice — new story"` /
  `"Alice — viewed"`) so it is not colour-only. Viewing is remembered in
  `localStorage` (`botifyr.seenStories`) because the API has no view route.

### 1.3 Your own story + add affordance
- **What:** Your own tile is first; a `+` badge starts a new story; tapping the
  tile opens your story when you have one.
- **Why:** Creation is one tap from the tray; viewing your own story is possible.
- **Fits us?** Yes — creation is supported (`uploadFile` + `createStory`).
- **How:** `StoriesStrip` renders an own tile that opens the viewer when you have
  an active story and opens the file picker otherwise; a small `+` overlay starts
  a new one. We never show a control that implies unsupported functionality.

### 1.4 Loading / empty / error states
- **What:** Skeleton rings while loading; a quiet empty state; a retry on failure.
- **Why:** The tray sits above the feed and must never look broken.
- **Fits us?** Yes.
- **How:** `storiesLoading` → pulsing skeleton tiles; `storyError` → a "Retry"
  tile calling `loadStories()`; both empty → "No stories yet".

---

## 2. Full-screen viewer

- **Immersive, letterboxed media** that adapts to the viewport (`object-fit:
  contain`, `max-width: min(560px, 92vw)`), with a **creator header**
  (avatar + name + age), **segmented progress**, a **close** button, and
  **prev/next** controls. — Adopted directly.
- **Header stays above taps:** overlay chrome uses a higher `z-index` than the
  tap zones so interaction never falls through to navigation.
- **Readable over any media:** captions are centred with a text-shadow; controls
  sit on translucent pills.
- **Fits us?** Yes; portrait media is not stretched because we constrain rather
  than fill.

## 3. Progression

- **Segmented bars** — one segment per story in the **active creator's**
  collection; completed = filled, active = animating fill.
- **Timed auto-advance** — Instagram uses ~5 s per image. We use 5 s for images
  and 4 s for shorter text-only stories (`storyDuration()`).
- **Advance to next creator** at the end of a collection, then **exit** after the
  last creator.
- **Pause freezes progress; resume continues** (never restarts).
- **Fits us?** Yes. Implemented with a `setTimeout`-driven timer plus a CSS fill
  whose `animation-delay`/`animation-play-state` mirror the accumulated elapsed
  time, so resuming continues instead of restarting.

## 4. Interaction

- **Tap regions:** left third = previous, remainder = next (Instagram/Facebook).
- **Press-and-hold to pause**, release to resume; a held press must not also
  advance.
- **Keyboard:** `←`/`→` navigate, `Esc` closes, `Space` toggles pause.
- **Replies:** FR-13 specifies "reply opens a DM". We reuse the existing DM
  channel (`openDm` + `sendDm`) rather than inventing a story-message API.
- **Reactions:** no backend exists for story reactions (EXP-9). We deliberately
  render **no** reaction buttons rather than a decorative dead control.

## 5. Expiration & availability

- **What:** Stories self-destruct after 24 h; expired/removed items disappear.
- **Fits us?** The server filters by `expires_at`; the client additionally drops
  items whose `expiresAt` has passed at grouping time, and closes the viewer if
  the active story vanishes (e.g. after a refresh).

## 6. Reliability

- **Unavailable media** must not spin forever — show a recoverable error with
  Retry/Next.
- **Backgrounding the tab** must pause, not consume the story unseen.
- **Timers/listeners must be cleaned up** so nothing fires after close.
- **Fits us?** Yes: `onError` error state, `visibilitychange` pause, and
  effect-cleanup for the timer/keyboard/visibility listeners.

## 7. Accessibility & reduced motion

- Dialog with `aria-modal`, focus moved to close (and restored on exit),
  accessible names on every control, text-based viewed/unseen state, and a
  `prefers-reduced-motion` rule that disables the fill animation (timing still
  advances) — all adopted.
- **Not adopted:** Instagram's exhaustive gesture vocabulary (swipe to next
  creator, swipe-down to dismiss, emoji tap-backs) — either backend-dependent or
  a larger interaction surface than this iteration justifies.

---

## Adopt / adapt / reject summary

| Pattern | Adopt / adapt / reject | Where |
| --- | --- | --- |
| Group tray by creator | **Adopt** | `groupStories`, tray tiles |
| Unseen/viewed ring + label | **Adopt** | `seenStories`, `.story-avatar.seen` |
| Own story + `+` | **Adopt** | own tile in `StoriesStrip` |
| Skeleton / empty / retry tray | **Adopt** | `storiesLoading`, `storyError` |
| Segmented per-collection progress | **Adopt** | `StoryViewer` progress |
| 5 s image / 4 s text timing | **Adapt** | `storyDuration` |
| Hold-to-pause + Space | **Adopt** | pointer / key handlers |
| Tap left/right regions | **Adopt** | `.story-tap` zones |
| Reply → DM | **Adopt** (existing API) | `replyToStory` |
| Emoji reactions | **Adopt** | `story_reactions` + reaction bar |
| Swipe-down dismiss / gestures | **Defer** | interaction surface |
| 24 h expiry | **Adopt** | server + client `groupStories` filter |
