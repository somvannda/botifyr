# Feed — UX/UI Improvement Plan

> Owner: Feed Manager · Scope: the Feed section only (`packages/ui/src/FeedView.tsx`
> + its styles in `packages/ui/src/styles.css`) · Last updated: Oct 2026.
>
> This plan is grounded in **source inspection** plus a **live runtime inspection**
> of the running dev app (`http://localhost:1420` desktop dev host, backing cloud
> `http://localhost:8787`), using a seeded feed of real API posts. Findings marked
> *(verified)* were observed in the running app; findings marked *(code review)*
> come from reading source. See `docs/feed-manager-progress.md` for raw evidence.

## A. Executive summary

The Feed is a mature, feature-rich surface: text/image/multi-image/video posts,
7-way reactions, threaded comments with reactions, polls, stories, reposts, Pages,
groups, reels, hashtags/mentions, audience controls, save/hide/snooze, and a
discovery rail. Functionally it is well ahead of a typical v1.

The problems are **presentation and interaction-hierarchy**, not missing features:

1. **Every action has equal weight.** Each post shows a flat row of up to eight
   full-width buttons — `Like · Comment · Share · Save · ⋯ · Report · Block`
   (own posts: `… · Save · Delete`). Destructive/rare actions (`Report`, `Block`,
   `Delete`) sit beside the primary ones, so the row is cluttered and mistakes are
   easy. *(verified)*
2. **No visible keyboard focus** on Feed controls — focused buttons compute to
   `outline-style: none`. *(verified)*
3. **Media causes layout shift** — attached images reserve no space until they
   load (`height: 0` → jump), a real CLS cost on image-heavy feeds. *(verified:
   intrinsic 900×600, rendered height 0 before load, then 391px)*
4. **Plain loading/empty/error states** — "Loading the feed…" text, a one-line
   empty message, and an error with no retry. *(code review + verified)*
5. **No Feed-specific responsive rules**; content is a fixed 620px column with no
   breakpoint adjustments. *(code review)*

The work below is deliberately **frontend-only** and preserves all existing API
behavior. Backend-dependent ideas (ranking, copy-link URLs) are listed separately
and are **not** implemented here.

## B. Current-state assessment

- **Entry point:** `FeedView` in `packages/ui/src/FeedView.tsx`, rendered by
  `BotifyrApp.tsx` when the `Feed` tab is active; the rail is `FeedRail`.
- **Views:** main feed (tabs `All/Friends/Pages`, sort `Most recent/Top`), Page
  timeline, Group stream, hashtag view, Reels.
- **Data:** `BotifyrClient.listFeed(cursor, limit, {tab, sort})` → friends/Pages
  feed with `reactions`, `myReaction`, `images[]`, `videos[]`, `poll`, `original`.
- **Actions implemented:** react (7), comment + reply + comment reactions, share
  (repost), save, hide, snooze, unfollow, report, block, delete-own, view page,
  vote, open tag, follow people/Pages, unblock.
- **Styling:** `.feed-*` classes in `styles.css`; dark/light via CSS variables.
- **Tests:** backend `apps/cloud/src/server.feed.test.ts`; UI smoke test
  `packages/ui/src/smoke.dom.test.tsx`; e2e `e2e/portal.spec.ts` (boot only).

## C. Competitive analysis (selected references)

Research date: **Oct 2026**. Because this environment had no saved browser
screenshots, patterns below are stated from established product knowledge; they
are design references, **not** live screenshots captured in this session.

| Product | Pattern studied | User problem solved | Relevance | Adopt / adapt / reject |
| --- | --- | --- | --- | --- |
| **Facebook** | Primary action bar (Like/Comment/Share) + `⋯` overflow for Save/Hide/Snooze/Report; reaction picker on hover/press | Keeps the card scannable; rare/destructive actions are deliberate | **High** — Botifyr is explicitly Facebook-modeled | **Adopt** the action-bar + overflow split |
| **LinkedIn** | "…" menu holds Save/Hide/Report; author header emphasises name + subtitle | Professional, low-clutter reading | High | Adopt (menu) |
| **X / Threads** | Minimal per-post actions; destructive actions inside overflow; "Show more" for long text | Rapid scanning of text-heavy feeds | Medium (Botifyr has long posts) | Adapt (see §E / P2) |
| **Instagram** | Uniform square multi-image grid; media reserves space while loading | Stable layout; attractive galleries | Medium | Adopt (aspect-ratio grid + reserved space) |
| **Reddit** | Clear vote/comment actions, strong hierarchy | — | Low for our model | Reject (vote model differs) |
| **TikTok** | Immersive video | — | Low (Botifyr has Reels) | Reject for the Feed |

## D. Gap analysis (ranked)

| # | Gap | Impact | Frequency | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Flat action row, destructive actions inline | High | Every post | High | High *(verified)* | Low |
| 2 | No visible focus indicator | High (a11y) | Keyboard users | High | High *(verified)* | Low |
| 3 | Media layout shift (no reserved space) | Medium | Image posts | Medium | High *(verified)* | Low |
| 4 | Weak loading/empty/error states | Medium | Cold loads / failures | Medium | High | Low |
| 5 | No responsive tuning | Medium | Small viewports | Medium | Medium *(code review)* | Low |
| 6 | Emoji-only avatars (no `avatarUrl` photo) | Medium | Accounts with photos | Low | Medium *(code review)* | Low |
| 7 | Reaction summary shows one emoji, no breakdown | Low | Engaged posts | Low | Medium | Medium |
| 8 | Very long posts not truncated | Low | Rare | Low | Medium | Medium |

Backend-dependent (documented, **not** implemented):
- Copy-post-link / permalinks (no stable public URL routing).
- Explainability for ranked/suggested content ("Why am I seeing this?").
- Feed-rank tuning (only presentation changed here).

## E. Proposed Feed experience

- **Information hierarchy:** author → content → media → social proof → actions.
- **Post actions:** four primary actions (`Like · Comment · Share · Save`) plus a
  single `⋯` **More options** menu for everything rare/destructive (Hide, Snooze,
  Unfollow, Report, Block) and, for own posts, Delete; for Page posts, View page.
- **Media:** images occupy reserved space before load; multi-image grids use
  uniform square cells; a subtle skeleton covers the gap.
- **States:** shimmer skeletons while loading; a friendly empty state that
  explains what to do (and differs for the Friends tab); an error banner with a
  **Retry** action.
- **A11y:** a single, consistent `:focus-visible` ring across the Feed; the
  overflow button labelled "More options"; menu items use `role="menu"`.
- **Responsive:** reduced padding/tighter action spacing under 720px.

## F. Prioritized roadmap

- **P0** — none outstanding (core flows work in the running app).
- **P1** — action hierarchy/overflow menu; keyboard focus visibility; media
  reserved space; loading/empty/error polish.
- **P2** — responsive tuning; avatar photos (`avatarUrl`); reaction breakdown;
  long-post "show more".
- **P3** — hover reaction summary; animated transitions; copy-link (needs
  routing/backend).

## G. Engineering backlog

| ID | Task | Acceptance criteria | Status |
| --- | --- | --- | --- |
| FEED-1 | Move Report/Block/Delete into a `⋯` More-options menu; keep Like/Comment/Share/Save primary | Every post shows exactly 5 buttons; menu contains Hide/Snooze/Unfollow/Report/Block (and Delete for own, View page for Page posts); no destructive action unlabelled | **Done** |
| FEED-2 | Add `:focus-visible` ring across Feed controls | Tab-focusing any Feed button/input shows a 2px accent outline; mouse click does not | **Done** |
| FEED-3 | Reserve media space / square grid | Image container has non-zero height before load; grid cells are square | **Done** |
| FEED-4 | Skeleton loading, richer empty, error retry | Loading shows 3 skeleton cards; empty explains next step; error has a working Retry | **Done** |
| FEED-5 | Responsive tuning <720px | No horizontal overflow; actions remain readable and on one row | **Done** |
| FEED-6 | Render `avatarUrl` photo with emoji/initial fallback | If author has a photo, it renders; otherwise emoji/initial | Backlog (P2) |
| FEED-7 | Reaction breakdown tooltip | Hover/focus the reaction summary shows per-type counts | Backlog (P2) |
| FEED-8 | Long-post "Show more" clamp | Posts over ~12 lines clamp with a toggle | Backlog (P2) |

## H. Validation strategy

- `npm run typecheck -w @botifyr/ui` and repo lint must pass.
- Re-run the live app (desktop dev host) with the seeded feed and confirm:
  action menu opens/closes and contains the expected items; keyboard focus ring
  appears; images reserve space and the grid is square; loading/empty/error states
  render; no horizontal overflow at a narrow width.
- Existing tests must keep passing (`vitest`), including the UI smoke test.
- Manual functional pass: react, comment, save, hide, report, delete own post.
