# Feed Experience — Unified Backlog & Ownership

> Owner: **Feed Experience Lead**. Statuses: Not started · Ready · In progress ·
> Blocked · Implemented · Testing · Verified · Deferred. "Verified" = evidence
> (passing test, browser check, or build), not just code.
>
> **Integration status (independently verified by the Lead):** the whole tree is
> green — `npm test` → **400 passed / 400** (60 files); `npm run typecheck -w
> @botifyr/ui` → **passed**; ESLint/Prettier clean on this workstream's files.
> This supersedes the specialists' earlier "blocked by concurrent Composer
> typecheck" notes.

## Specialist workstreams (each has its own docs)

| Workstream | Owns | Docs | Status |
| --- | --- | --- | --- |
| Feed & Discovery Manager | Timeline, tabs/sort, pagination, scroll, refresh/states | `feed-discovery-{plan,backlog,progress}.md` | **Verified** (live E2E) |
| Post Manager | `PostCard`, `CommentRow`, media, reactions, comments, menus | `post-improvement-{plan,backlog,progress}.md` | **Verified** |
| Reels Manager | `ReelsView`, playback, comments sheet, pagination | `reels-{competitive-research,ux-audit,implementation-plan}.md`, `agent-progress/reels-manager.md` | **Verified** |
| Stories Manager | Story tray + viewer, seen state, replies | `stories-{competitive-research,ux-audit,implementation-plan}.md`, `agent-progress/stories-manager.md` | **Verified** |
| Pages Manager | `PageView` identity/nav/resilience | `pages-{competitive-research,ux-audit,implementation-plan}.md`, `agent-progress/pages-manager.md` | **Verified** |
| Composer Manager | Composer, media upload/progress, drafts | `composer-{ux-audit,competitive-research,implementation-plan}.md` | **Verified** (composer retry typecheck fixed) |
| Design System Manager | Tokens, light theme, primitives | `design-system-{audit,plan,components,progress}.md` | **Verified** (Feed region) |
| Feed Experience Lead (me) | Coordination, master plan, integration/QA, earlier Feed work (FEED-1…11) | `feed-experience-*.md`, `feed-improvement-plan.md` | **Active** |

## Cross-cutting tasks (Lead-owned status)

| ID | Feature | Description | Priority | Owner | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| EXP-1 | Stories | Grouped viewer: progress, auto-advance, pause/resume, prev/next, keyboard | P1 | Stories Manager | **Verified** | `agent-progress/stories-manager.md`; Feed tests |
| EXP-2 | Stories | Per-creator seen state (persisted) | P2 | Stories Manager | **Verified** | same |
| EXP-3 | Reels | Custom transport, autoplay-muted, active-only playback, mute persistence | P1 | Reels Manager | **Verified** | `agent-progress/reels-manager.md`; 12 tests |
| EXP-4 | Reels | Buffering/error/Retry + missing/empty states | P2 | Reels Manager | **Verified** | same (R-02/R-09) |
| EXP-5 | Composer | Character counter + limit enforcement | P2 | Composer Manager | **Verified** | Feed test |
| EXP-7 | Composer | Draft persistence (`botifyr.feedDraft`) | P3 | Composer Manager | **Verified** | `FEED_DRAFT_KEY` + tests |
| EXP-8 | Pages | CTA rendering (link only when a real URL, else badge) | P3 | Pages Manager | **Verified** | `agent-progress/pages-manager.md` |
| EXP-9 | Stories | Replies via DM + reactions (`story_reactions`) | P3 | Stories Manager | **Verified** | Feed tests (reply + reaction); `story_views`/`story_reactions` |
| FEED-D1…D6 | Feed | Infinite scroll, end state, de-dup, scroll restore, refresh, new-activity banner | P1 | Feed & Discovery | **Verified** | live `scripts/feed-discovery-verify.mjs` |
| POST-1…POST-11 | Posts | Rich text, media component, confirm dialogs, optimistic guards | P1 | Post Manager | **Verified** | `post-improvement-progress.md`, 8 tests |
| R-01…R-09,R-11 | Reels | Action rail, keyboard nav, pagination, reduced motion | P1 | Reels Manager | **Verified** | reels docs |
| DS-1…DS-7 | Design System | Semantic tokens, light-theme AA fix, Feed token adoption | P1 | Design System | **Verified** | `design-system-progress.md`, 21 assertions |

## Open items (not verified / deferred)

| ID | Area | Item | Priority | Owner | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| FEED-D7 | Feed | Explicit labelled sort control (discoverability) | P2 | Feed & Discovery | Open | sort toggle exists; label polish |
| POST-RXN | Posts | Clicking `Like` toggles the hover-opened picker instead of quick-liking | P2 | Post Manager | Open | QA observation; reactions work via picker |
| DB-1 | Backend | `canReceive` drops `feed.*` → realtime freshness broken | P1 | cloud owner | **Documented** | `feed-discovery-progress.md` |
| DB-2 | Backend | `created_at < cursor` pagination can skip equal-timestamp posts | P1 | cloud owner | **Documented** | same |
| STORY-VIEW | Backend | `POST /v1/stories/:id/view` (replace local seen store) | P2 | cloud owner | **Documented** | Stories Manager |
| STORY-RX | Backend | Story reactions | P3 | cloud owner | **Deferred** | no endpoint |
| R-10 | Reels | Captions/VTT | P3 | Reels Manager | **Blocked** | no caption field |
| PAGE-TABS | Backend/Router | Page Photos/Reels/Stories tabs, timeline cursor, deep links | P3 | cloud/router | **Deferred** | no endpoints / no router |
| POST-12/13/14 | Backend | Comment paging, copy-link/permalink, mention routing | P3 | backend | **Deferred** | needs API/router |
| DS-T8…T11 | Design System | Tokenise remaining global literals, shape/spacing, axe | P2/P3 | Design System | **Open** | `design-system-progress.md` |
| QA-VIDEO | QA | Video fixture for Reels/autoplay E2E | P3 | QA | **Blocked** | no MP4 fixture in repo |

## How the Lead verifies integration

1. `npm test` (repo-wide) — currently 400/400.
2. `npm run typecheck -w @botifyr/ui` — currently passed.
3. `npx eslint` / `prettier --check` on changed files.
4. Live/headless evidence: `scripts/feed-screenshots.mjs`,
   `scripts/feed-discovery-verify.mjs`, `scripts/post-audit.mjs`; assets under
   `docs/assets/feed|post|design-system/`.
