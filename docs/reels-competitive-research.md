# Reels — Competitive & Technical Research

> Owner: **Reels Manager** (Feed Experience Team). Research date: **Oct 2026**.
> Scope: short-form vertical video UX patterns, playback/autoplay policy, and
> accessibility. Complements [`feed-experience-plan.md`](feed-experience-plan.md).

## A. Research method & limitations

I used the web tools available in this environment. **What I actually inspected:**

| Source | Type | Used for |
| --- | --- | --- |
| MDN — *Autoplay guide for media and Web Audio APIs* (fetched, last modified Sep 2026) | Official documentation | Autoplay policy, `play()` promise handling, muted-autoplay, media-event fallbacks |
| Mux — *Build a Stories/Reels UI* (fetched) | Vendor engineering guide | FlatList/paging model, active-item playback, tap/double-tap, overlay layout, preloading |
| University of Maryland — *Instagram and TikTok accessibility* | Accessibility practitioner guidance | Captions/alt-text gaps in Reels |
| Montgomery College — *Disable autoplay multimedia*; BOIA — *Why autoplay is an accessibility no-no* | Accessibility guidance | WCAG implications of autoplay, controls-to-stop requirement |
| POLITO / ACM (2024) — *Am I in Control? How the Design of the TikTok Feed Shapes Agency* | Peer-reviewed study | Autoplay vs. explicit play trade-off; prefetch/infinite-scroll effects on user control; swipe-delay QoE |
| VUB (2025) — *Watch, Scroll, Repeat* | Peer-reviewed study | Interface affordances of the TikTok feed |

**What I did NOT do:** I did not open or log into the TikTok, Instagram, YouTube
Shorts, or Facebook Reels apps/sites, and no screenshots of them were captured.
Patterns attributed to those products below are **established product knowledge,
clearly labelled as such**, not live observations. Where a claim is grounded in a
fetched source, the source is named.

## B. Patterns distilled from fetched sources

### B1. Autoplay policy is a hard constraint (MDN, authoritative)
- Media with an **audio track** is subject to autoplay blocking unless muted, the
  user has interacted with the site, the site is allow-listed, or a Permissions
  Policy grants autoplay. **Muted autoplay is broadly allowed.**
- `play()` returns a promise that **rejects** when blocked (`NotAllowedError`);
  code must handle rejection and show a manual play affordance rather than
  assuming playback started.
- `playsinline` is required for autoplay on iOS Safari.
- Best practice example is literally `<video controls autoplay playsinline muted>`.

### B2. The active-item model (Mux guide)
- A paged vertical list renders **one item per screen**; only the item at
  `currentIndex` plays (`isActive`), everything else is paused.
- `windowSize: 3` — render/prepare **one above and one below** the active item,
  not the whole list.
- Single tap toggles play/pause; double tap likes; overlays carry creator,
  caption, stats and the action rail.
- Preloading is deliberate and bounded ("loads the next videos").
- `onError` is a first-class state, not an afterthought.

### B3. Autoplay is not free — agency & QoE (ACM, VUB)
- The ACM study found replacing **autoplay with explicit playback** increased
  perceived user agency and reduced time distortion, but participants found
  explicit-play disruptive to flow. The practical takeaway is **default to
  muted autoplay for in-view content, always provide an obvious pause/stop, and
  never let audio autoplay.**
- Swipe delay degrades QoE sharply; delay near the end of a session is felt more
  than the same delay early on. Prefetching the *next* item is worthwhile; mass
  prefetching is not.

### B4. Accessibility (UMD, Montgomery College, BOIA)
- WCAG requires any **auto-playing/moving content to have a mechanism to pause,
  stop, or hide it**, and auto-playing **audio** to have an accessible mute.
- Screen readers cannot read captions baked into Reels video; a **text caption
  field tied to the media** is the accessible alternative.
- Do not assume the video plays; do not show a pause control while paused.

## C. Product patterns (established knowledge — not live-observed)

| Product | Pattern (established knowledge) | Why it helps | Fit for us |
| --- | --- | --- | --- |
| **TikTok** | Full-screen vertical feed; edge-to-edge video; right-side vertical action rail (avatar+follow, like, comment, share, sound disc); bottom-left creator + caption + hashtags; tap to pause; swipe up/down | Maximises video area; keeps actions in thumb reach; text stays off the focal point | **Adopt (adapted)** — we keep a header + snap feed rather than a modal overlay |
| **Instagram Reels** | Similar rail; muted autoplay; tap to unmute; scrubber on press-and-hold; "Original audio" row | Predictable audio behaviour; seek without permanent chrome | **Adapt** — permanent mute toggle + a progress bar; sound name only when data exists |
| **YouTube Shorts** | Vertical snap; progress bar at the bottom; pause/play overlay; captions toggle | Simple, legible transport controls on desktop and mobile | **Adopt** — thin progress bar + play/pause |
| **Facebook Reels** | Large Comments/Share/Like counts; comments open as a sheet over the video | Keeps context while engaging | **Adopt** — bottom comment sheet, video keeps playing muted behind it |

## D. Recommendations mapped to this codebase

For each: **pattern → why → fit → how.**

1. **Muted autoplay of the in-view reel, pause off-screen** (TikTok/IG/Shorts;
   MDN policy).
   *Why:* instant, expected motion without surprise audio.
   *Fit:* High — already partially implemented in `ReelsView`/`ReelVideo`.
   *How:* `IntersectionObserver` picks the active reel; only the active `<video>`
   calls `play()`; `play()` rejection is caught and surfaced as a manual play
   button. Keep `muted`, `playsInline`, `loop`.

2. **Right-side action rail: like, comment, share, save, more** (TikTok/IG; Mux
   overlay).
   *Why:* engagement is reachable without leaving the video; counts build social
   proof.
   *Fit:* High — the client already exposes `likePost`, `repost`, `savePost`,
   `listComments`, `addComment`.
   *How:* overlay `<div class="reel-actions">` of icon buttons with optimistic
   state and rollback on failure (same pattern as `PostCard`).

3. **Creator + caption + hashtags, scrimmed, bottom-left** (TikTok/IG).
   *Why:* identity and context without stealing focus.
   *Fit:* High — `author`, `body`, `hashtags` exist on `FeedPost`.
   *How:* `Avatar` + author name + clamped caption + hashtag buttons inside a
   bottom gradient scrim.

4. **Tap video = play/pause; center play affordance when paused** (Mux, Shorts).
   *Why:* the most natural transport control.
   *Fit:* High.
   *How:* custom control layer; a large center button while paused; use the
   media element's own `play`/`pause` events as the source of truth.

5. **Progress bar + time, mute, fullscreen** (Shorts/YouTube).
   *Why:* desktop users expect a seek control and standard transport.
   *Fit:* High — native `<video controls>` conflicts with the overlay rail, so a
   compact custom bar is used (`<input type=range>` for keyboard + pointer).
   *How:* `timeupdate`/`loadedmetadata`/`progress` events drive a `range` input;
   `requestFullscreen()` where available.

6. **Keyboard operation** (accessibility; desktop parity).
   *Why:* pointer-only feeds exclude keyboard users.
   *Fit:* High.
   *How:* ArrowUp/Down (and J/K) navigate, Space toggles active playback, M
   mutes, Escape closes; handlers ignore key events originating in form controls.

7. **Mute/unmute toggle that survives navigation** (TikTok/IG).
   *Why:* an explicit audio choice should persist across reels.
   *Fit:* High.
   *How:* `muted` state lives in `ReelsView`, applied to every player.

8. **Bounded preloading** (Mux `windowSize:3`; ACM swipe-delay QoE).
   *Why:* the next reel should be ready; far-off reels should not burn bandwidth.
   *Fit:* High.
   *How:* set `preload="auto"` for the active reel, `preload="metadata"` for the
   neighbours, `preload="none"` beyond that; load more pages only at the tail.

9. **Comments as a sheet over the video** (Facebook/IG).
   *Why:* engage without losing place.
   *Fit:* High — reuse `CommentRow`, `listComments`, `addComment`.
   *How:* bottom sheet with the reel still mounted; Escape/close returns focus.

10. **No fake sound/audio metadata; no fake follow for people.**
    *Why:* the data model has no audio field, and the API only exposes Page
    follow — inventing either would lie to users.
    *Fit:* N/A.
    *How:* show "Original audio · <creator>" **only** as a static, honest label;
    show a follow control **only** for Page-authored reels via `followPage`.

## E. What we deliberately reject

- **Bypassing autoplay policy.** No unmuted autoplay, ever (MDN + WCAG).
- **A separate Reels UI per host.** AGENTS.md §7 — one UI, two hosts.
- **Unbounded prefetch / render-all.** Wastes mobile bandwidth (ACM QoE).
- **Fake engagement or simulated success.** Rules §10.
- **Playback controls that assume success.** Controls render from media events.
