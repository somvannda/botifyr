# Feed Page Redesign — Plan (Agent 1)

> Owner: **Agent 1 — Feed Experience Lead**. Reference: Facebook-style social
> feed, with one deliberate change: primary navigation moves to a **bottom bar
> inside the Feed column**. Reuses the existing React/TypeScript app; real data
> only. Ast month: Oct 2026.

## A. Architecture (verified)

- **Framework:** React 19 + TypeScript; Vite dev host `apps/desktop` (`:1420`),
  hosted by `BotifyrApp` in `packages/ui`. One UI, two hosts (`AGENTS.md` §7).
- **Shell:** `.app` grid = `320px sidebar | 1fr main` (+ optional `.bot-panel`
  right rail via `with-panel`). Sidebar holds the workspace tabs
  (Chat · Feed · Virtual/Startup Workspace) + chat list. `.main` is the central
  column; the Feed renders there, the right rail aligns beside it.
- **Feed:** `packages/ui/src/FeedView.tsx` — `FeedView` (timeline), `PostCard`,
  `CommentRow`, `ReelsView`, `PageView`, `GroupView`, `TagView`, `AlbumView`,
  `FeedRail` (right sidebar), stories tray + viewer, composer.
- **Client/server:** `@botifyr/client` → cloud `:8787` (`/v1/feed`, `/v1/reels`,
  `/v1/stories`, `/v1/pages*`, `/v1/groups*`, `/v1/save`). Real data only.

## B. Layout decisions

- **Central column:** feed centered, comfortable width; posts cap so they never
  get excessively wide (`max-width` on `.feed-scroll > *`).
- **Order:** Composer → Stories → Posts (unchanged, already correct).
- **Right sidebar:** the existing `FeedRail` ("Discover": Pages to follow, Who to
  follow, Top posts, Blocked). Bodies left-aligned with the feed; collapses/hides
  when narrow (existing `with-panel` behaviour).
- **Bottom menu (this redesign):** a **Feed-only** navigation bar rendered
  *inside the central feed column* (`.feed-bottom-nav` inside `.feed`), so it sits
  **between the left sidebar and the right sidebar** and disappears when you leave
  Feed. Items are **Feed features only**:

  | Item | Destination (real) |
  | --- | --- |
  | Feed | home timeline (`setTab("all")`) |
  | Reels | `ReelsView` (`setReelsOpen(true)`) |
  | Pages | Feed Pages filter (`setTab("pages")`) — the existing Pages tab |
  | Groups | new `GroupsView` list (`client.listGroups`) → opens `GroupView` |
  | Marketplace | host surface (`onOpenMarketplace` → `setShowConnectApps`) |

- **Left sidebar tabs restored:** Chat · Feed · Virtual Workspace remain (the
  bottom menu is additive and Feed-scoped, not a replacement of workspace tabs).

## C. Component ownership / contracts

Executed as sequential workstreams (single agent environment); boundaries:

| Agent | Owns | Notes |
| --- | --- | --- |
| **1 Feed Lead (me)** | Shell/page layout, Feed bottom menu, Groups list view, integration, visual consistency | `.feed-bottom-nav`, `GroupsView`, `BotifyrApp` wiring |
| 2 Design System | tokens, light theme, primitives | uses `--radius-*`; no raw literals |
| 3 Feed & Discovery | timeline, tabs, pagination, states | `feed-bottom-nav` "Pages"/"Feed" set its `tab` |
| 4 Post | `PostCard`, `CommentRow` | unchanged |
| 5 Reels | `ReelsView` | entered via bottom menu "Reels" |
| 6 Stories | tray + viewer | Stories stays at the top of the Feed (per user) |
| 7 Pages | `PageView` | "Pages" bottom item uses the Feed Pages filter |
| 8 Composer | composer | unchanged; above Stories |
| 9 QA | independent verification | Feed QA harness `scripts/feed-qa.mjs` |

**Contract:** the bottom menu lives inside `FeedView` (not the app shell) so it can
drive Feed sub-views; the host passes only `onOpenMarketplace`. No new API.

## D. Responsive

- **Desktop:** feed + right rail; bottom menu spans the feed column only.
- **Tablet:** rail hides (existing `with-panel` rule); feed takes the width; menu
  unchanged.
- **Mobile:** shell shows the off-canvas drawer; the Feed topbar keeps its ☰
  drawer toggle; bottom menu stays inside the feed column, above the safe area.
- No horizontal overflow; menu does not cover content (it is in-flow, not fixed).

## E. Roadmap / status

- ✅ Bottom menu (Feed · Reels · Pages · Groups · Marketplace) inside the Feed
  column; distinct accessible names (no duplicate "Reels"/"Pages").
- ✅ `GroupsView` list view.
- ✅ Restored left sidebar tabs; fixed the design-system radius guard.
- ✅ `npm test` 436/436; `@botifyr/ui` typecheck clean.
- ⏳ Reference-screenshot pixel pass — **blocked**: the supplied screenshot is not
  in the workspace/temp (`ref.png` is a 32×32 placeholder). Need the image.
- ⏳ Final integrated QA (Agent 9) once feature agents settle.
- ⏳ Sidebar sections (Sponsored/Friend requests/Birthdays/Contacts): only real
  data used (suggestions/Pages/Top posts); birthdays/sponsored omitted (none).

## F. Risks / blockers

- **Missing reference image** → exact dimensions/spacing can't be matched.
- **Concurrent multi-agent edits** to `FeedView.tsx`/`BotifyrApp.tsx`/`styles.css`.
- **Duplicate "Reels" control**: the Feed topbar still has a Reels button; the
  bottom menu also has one. Recommend retiring the topbar one (Feed & Discovery /
  Reels owner) to avoid redundancy — not done here to avoid cross-owner churn.
- Backend gaps (documented): realtime `feed.*` (DB-1), pagination tie-break (DB-2).

## G. Test / verification

- `npm run typecheck -w @botifyr/ui` → passed.
- `npm test` → **436 passed / 436**.
- Visual: `scripts/feed-screenshots.mjs` (desktop/tablet/mobile).

## H. Agent status ledger (Phase 5.3)

| # | Agent | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Feed Experience Lead (me) | **Implemented / Delivering** | bottom menu, layout, docs |
| 2 | Design System Manager | **Completed** (Feed region) | `design-system-progress.md` |
| 3 | Feed & Discovery Manager | **Completed** | `feed-discovery-progress.md` |
| 4 | Post Manager | **Completed** | `post-improvement-progress.md` |
| 5 | Reels Manager | **Completed** | `agent-progress/reels-manager.md` |
| 6 | Stories Manager | **Implementing** (extraction to `Stories.tsx`) | `agent-progress/stories-manager.md` |
| 7 | Pages Manager | **Completed** | `agent-progress/pages-manager.md` |
| 8 | Composer Manager | **Completed** | `composer-implementation-plan.md` |
| 9 | Feed QA & E2E Manager | **Ready** for Final Integrated QA | `docs/agent-progress/feed-qa-handoff.md` |

## I. Integration status

- `npm test` → **452 passed / 452** (64 files); `@botifyr/ui` typecheck clean.
- Feed menu renders in the home feed **and** in Feed sub-views (Reels/Groups/
  Page/Group/Tag/Album) via the shared `FeedBottomNav` + `.feed-shell`.
- Note: the shared tree is multi-author; transient typecheck breaks from the
  Stories extraction occurred and were fixed by the owning workstream.

