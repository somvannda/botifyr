# Feed Experience — Master Plan

> Owner: **Feed Experience Lead** · Scope: the whole Feed experience (Main Feed,
> Posts, Reels, Stories, Pages/Groups, Composer, shared components,
> responsive/a11y/perf/reliability, integration).
>
> This is the **master** document. The post/feed detail lives in the already-shipped
> [`feed-improvement-plan.md`](feed-improvement-plan.md) (FEED-1…FEED-11, all
> verified) and the runtime checklist in [`feed-manager-progress.md`](feed-manager-progress.md).
> Last updated: Oct 2026.

## A. Executive summary

The Feed is a mature surface with an unusually complete feature set for its age:
a friends/Pages timeline with tabs and ranking, 7-way reactions, threaded
comments with reactions, reposts, save/hide/snooze/unfollow/report/block, polls,
hashtags/mentions, multi-image and video posts with a lightbox, Pages (timeline,
roles, insights, inbox, pinned/scheduled), Groups, Stories, and Reels.

The **main Feed, Posts, Pages, and Composer are already polished and verified**
(see `feed-improvement-plan.md`: action hierarchy, focus rings, media stability,
skeletons/empty/error, responsive + mobile drawer, avatar photos, long-post
clamp, lightbox, tab persistence — `npm test` 334 passing, Lighthouse a11y 0.97).

The remaining gaps are in the **immersive sub-surfaces**:

1. **Stories** — the viewer is a static image with a close button: no progress
   indicator, no auto-advance, no previous/next, no keyboard control, and the
   tray never shows seen/unseen state. *(verified in source + screenshots)*
2. **Reels** — video renders with native `controls` only: no autoplay as a reel
   scrolls into view, no mute control, no pause of off-screen videos, and the
   loading/empty states are bare text. *(verified in source + screenshots)*
3. **Composer** — no character counter/limit feedback, and no draft persistence.

Outcome: bring Stories and Reels up to the same production quality as the rest of
the Feed, and tidy the Composer, without touching unrelated modules.

## B. Application architecture

- **UI package:** `packages/ui` (`BotifyrApp` hosts; `FeedView.tsx` contains
  `FeedView`, `PostCard`, `CommentRow`, `PageView`, `GroupView`, `TagView`,
  `ReelsView`, `FeedRail`); styles in `packages/ui/src/styles.css`.
- **Client:** `packages/client` (`@botifyr/client`): `listFeed`, `listReels`,
  `listStories`/`createStory`, `listMyPages`, `listPagePosts`, reactions, etc.
- **Cloud:** `apps/cloud/src/server.ts` — `/v1/feed`, `/v1/posts*`, `/v1/stories`,
  `/v1/reels`, `/v1/pages*`, `/v1/groups*`; tests `server.feed|pages|groups.test.ts`.
- **Types:** `packages/shared`, `packages/client` (`Story`, `FeedPost`, `Page`, `Group`).
- **Hosts:** `apps/desktop` (Tauri + Vite dev at :1420) and `apps/portal`
  (webBridge) render the **same** `BotifyrApp` (one UI, two hosts — see `AGENTS.md`).

## C. Feature inventory

| Feature | Status | Route / entry | Main components | Backend | Tests | Limitations / next action |
| --- | --- | --- | --- | --- | --- | --- |
| Main Feed & discovery | Implemented | Feed tab | `FeedView`, `FeedRail` | `/v1/feed`, `/v1/people/suggestions`, `/v1/feed/trending`, `/v1/pages/suggestions` | `server.feed.test.ts`, `FeedView.dom.test.tsx` | Verified; ranking is local math |
| Posts & interactions | Implemented | Feed tab | `PostCard`, `CommentRow` | `/v1/posts*`, reactions, comments, repost, save/hide/mute, report/block | `server.feed.test.ts`, `FeedView.dom.test.tsx` | Verified (FEED-1…FEED-11) |
| Reels | Implemented (basic) | Reels button | `ReelsView` | `/v1/reels` | none | Add autoplay/mute/pause + states |
| Stories | Implemented (basic) | Tray in Feed | story tray + viewer | `/v1/stories` | none | Add progress/auto-advance/nav/seen |
| Pages | Implemented (rich) | via rail / post "View page" | `PageView` | `/v1/pages*`, insights, roles, inbox, pin, schedule | `server.pages.test.ts` | Page CTA rendering deferred |
| Groups | Implemented | rail | `GroupView` | `/v1/groups*` | `server.groups.test.ts` | Verified |
| Composer & publishing | Implemented | top of Feed | composer in `FeedView`, group composer | `/v1/posts`, `/v1/uploads` | `server.feed.test.ts` | Add char counter; drafts deferred |
| Design system | Implemented | shared | `Avatar`, `AuthorLine`, `Icons.tsx`, tokens | — | `parity.test.ts` | Keep consistent |
| Responsive / a11y | Implemented | shell + Feed | shell drawer, Feed wrapping, focus rings | — | `FeedView.dom.test.tsx` | Lighthouse a11y 0.97 |

## D. Competitive research

Research date: **Oct 2026**. No saved screenshots of external products were
captured in this environment; the patterns below are established product
knowledge, **not** live observations.

| Product | Pattern | Problem solved | Fits us? | Adopt/adapt/reject |
| --- | --- | --- | --- | --- |
| **Instagram** | Stories: top progress segments, auto-advance (5s), tap/hold, seen-state ring | Keeps ephemeral content moving and legible | **High** (we have Stories) | **Adopt** |
| **TikTok / Instagram Reels** | Autoplay the in-view video, muted, one-at-a-time, tap to unmute | Immediate playback without user action | **High** (we have Reels) | **Adopt** |
| **X / Threads** | Character counter near publish; clear disabled state | Prevents failed posts | High (Composer) | Adopt |
| **Facebook** | Overflow post actions (already shipped) | Scannable cards | High | Already adopted |
| **LinkedIn** | Author-first hierarchy (shipped) | Professional reading | High | Already adopted |

## E. UX/UI gap analysis (ranked)

| # | Gap | Feature | Impact | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Stories viewer has no progress/auto-advance/nav | Stories | High | High | High *(source)* | Low |
| 2 | Reels don't autoplay or pause off-screen; no mute | Reels | High | High | High *(source)* | Low |
| 3 | Story tray shows no seen/unseen state | Stories | Medium | Medium | High | Low |
| 4 | Composer has no character counter/limit feedback | Composer | Medium | Medium | High | Low |
| 5 | Reels/Stories loading & empty states are bare text | Reels/Stories | Low | Low | High | Low |
| 6 | Composer drafts not persisted | Composer | Low | Low | High | Medium |
| 7 | Page CTA button not rendered | Pages | Low | Low | Medium | Low |

Backend-dependent (documented, not implemented): copy-link/permalinks, ranking
explainability, story reactions/replies.

## F. Target experience

- **Stories:** tap a tile → full-screen viewer with per-story progress segments,
  5s auto-advance, previous/next, keyboard (←/→/Esc), author/age header, close.
  Tiles dim once viewed. Reuses the existing `.story-*` conventions.
- **Reels:** vertical snap feed; the video in view **autoplays muted**, off-screen
  videos pause, a header **mute/unmute** toggle; native controls retained; proper
  loading skeleton and empty/error states.
- **Composer:** live character counter (`n / 4000`), publish disabled past the
  limit, clear disabled state.
- **Consistency:** all sub-surfaces reuse `Avatar`, `AuthorLine`, tokens, the
  `:focus-visible` ring, and the Feed's empty/error conventions.

## G. Implementation roadmap

- **P0:** none outstanding (core flows verified).
- **P1:** Stories viewer (EXP-1); Reels autoplay + mute (EXP-3).
- **P2:** Story seen-state (EXP-2); Composer counter (EXP-5); Reels/Stories
  loading/empty polish (EXP-6).
- **P3:** Composer draft persistence (EXP-7); Page CTA (EXP-8); story reactions (deferred).

## H. Specialist assignments

Because the environment runs one agent sequentially, the specialist roles below
are executed as sequential workstreams (no separate agents were launched).

| Role | Scope | Owned files/components | Status |
| --- | --- | --- | --- |
| Feed & Discovery Manager | Main timeline, tabs, refresh, states | `FeedView` (feed part) | Verified (FEED-1…11) |
| Post Manager | Post card, interactions | `PostCard`, `CommentRow` | Verified |
| Reels Manager | Reel viewer, playback | `ReelsView` | **In progress (EXP-3)** |
| Stories Manager | Tray + viewer | story tray + `StoryViewer` | **In progress (EXP-1/2)** |
| Pages Manager | Page identity/nav | `PageView` | Verified; CTA deferred |
| Composer Manager | Create/publish flow | composer in `FeedView` | **In progress (EXP-5)** |
| Design System Manager | Tokens, primitives, consistency | `styles.css`, `Icons.tsx`, `Avatar` | Verified |
| Feed QA & E2E Manager | Independent verification | `FeedView.dom.test.tsx`, `e2e/`, `scripts/feed-screenshots.mjs` | Active |

## I. Testing strategy

- **Unit/component (vitest + jsdom):** Stories viewer (progress, auto-advance,
  next/prev, Escape), Reels mute toggle, Composer counter.
- **Integration:** `FeedView` renders all sub-surfaces; existing 9 Feed tests stay green.
- **E2E/visual:** headless Playwright (`scripts/feed-screenshots.mjs`) captures
  Feed, menu, lightbox, mobile drawer; extend for a seeded Story.
- **a11y:** `browser.lighthouse` (Feed currently 0.97); manual keyboard checks.
- **Gate:** `npm run typecheck -w @botifyr/ui`, `npm test`, `eslint`, `prettier`.

## J. Risks and blockers

- **No video fixture:** Reels need a real video to fully exercise playback;
  verification of autoplay is limited to code + attribute assertions unless a
  sample MP4 is supplied.
- **Dev-server HMR can go stale** after errors; a file touch/restart clears it.
- **Concurrent edits** by another workstream touch `BotifyrApp.tsx`/`server.ts`;
  keep Feed edits scoped and re-verify after integration.
- **Portal typecheck** has pre-existing unused-var errors unrelated to the Feed.

## K. Completion criteria

A task is complete only with evidence: passing tests, a successful browser
interaction, and/or a captured screenshot. Stories/Reels/Composer work is
complete when their viewer/playback/计数器 behaviour is implemented, covered by
tests, and inspected in the running app (or the limitation is documented).
