# Feed Experience — Progress Checkpoint (Lead)

> **Historical record** — ports reflect the run at the time. Canonical local dev is defined in [`AGENTS.md`](../AGENTS.md) §10.

> Resume point for the **Feed Experience Lead** assignment. Update after each
> meaningful batch. Plan: `feed-experience-plan.md` · Backlog:
> `feed-experience-backlog.md`. Last verified: Oct 2026.

## Objective

Coordinate the specialised Feed workstreams, keep the shared files coherent,
independently verify integration, and report. The Feed experience spans Main
Feed/timeline, Posts, Reels, Stories, Pages/Groups, Composer, shared design
system, responsive/a11y/perf, and integration testing.

## Multi-agent context (important)

This repo is worked on by **several agents in parallel**, each owning a
specialist doc set under `docs/` and `docs/agent-progress/`:

- **Feed & Discovery Manager** — timeline (`feed-discovery-*.md`).
- **Post Manager** — post components (`post-improvement-*.md`).
- **Reels Manager** — `ReelsView` (`reels-*.md`, `agent-progress/reels-manager.md`).
- **Stories Manager** — story tray/viewer (`stories-*.md`, `agent-progress/stories-manager.md`).
- **Pages Manager** — `PageView` (`pages-*.md`, `agent-progress/pages-manager.md`).
- **Composer Manager** — composer (`composer-*.md`).
- **Design System Manager** — tokens (`design-system-*.md`).
- **Chat Manager** — separate workstream (`chat-*.md`).
- **Feed Experience Lead (this role)** — coordination + earlier FEED-1…FEED-11
  post/feed work (`feed-improvement-plan.md`, `feed-manager-progress.md`).

Shared, heavily-contended files: `packages/ui/src/FeedView.tsx`,
`packages/ui/src/styles.css`, `packages/ui/src/FeedView.dom.test.tsx`.

## Integration status (Lead-verified)

- `npm test` (repo-wide) → **437 passed / 437** (63 files).
- `npm run typecheck` (all workspaces) → **passed**.
- `npx vitest run packages/ui/src/FeedView.dom.test.tsx` → **66 passed**.
- `npx playwright test e2e/stories.spec.ts` → **2 passed** (desktop + mobile).
- **Independent live QA** (`scripts/feed-qa.mjs`) → **12/12 journeys passed, 0
  console errors** (see `docs/feed-experience-qa-report.md`).
- ESLint/Prettier clean on Feed files.
- This **supersedes** the specialists' earlier "blocked by concurrent Composer
  typecheck" notes — that transient error is resolved.

## Delivered (by the team)

Timeline (infinite scroll, end state, de-dup, scroll restore, refresh,
new-activity banner); Posts (rich text links/mentions, media component, confirm
dialogs, optimistic guards); Reels (custom transport, autoplay-muted, pagination,
keyboard, comments sheet, mute persistence); Stories (grouped viewer,
pause/resume, seen store, DM replies); Pages (resilience, tabs, CTA link/badge,
follow states); Composer (attachments + upload progress + drafts + counter);
Design System (semantic tokens, light-theme AA fix, Feed token adoption).
FEED-1…FEED-11 (post/feed/lightbox/responsive) verified earlier.

## Remaining / open / blocked

- **Backend (documented, not fixed):** DB-1 realtime `feed.*` events dropped by
  `canReceive`; DB-2 equal-timestamp pagination skip; story-view endpoint; story
  reactions; Reels captions (no field); Page Photos/Reels/Stories tabs + timeline
  cursor; copy-link/permalink (no router).
- **Frontend open:** FEED-D7 (labelled sort control); DS-T8…T11 (token long tail);
  a11y axe pass.
- **QA gap:** no video fixture → Reels autoplay/seek E2E limited.
- **Pre-existing:** `@botifyr/portal` typecheck red from unused vars in
  `BotifyrApp.tsx` (not Feed-caused).

## Files changed by the Lead (this line of work)

- `packages/ui/src/FeedView.tsx` — FEED-1…11 (action hierarchy/menu, skeletons,
  empty/error, long-post clamp, lightbox, avatar photos, reaction tooltip, tab
  persistence, mobile-nav wiring); composer counter (`MAX_POST_CHARS`).
- `packages/ui/src/styles.css` — corresponding `feed-*` styles.
- `packages/ui/src/BotifyrApp.tsx` — Feed mobile-nav wiring (`onOpenNav`, drawer
  close on tab switch).
- `packages/ui/src/FeedView.dom.test.tsx`, `scripts/feed-screenshots.mjs`,
  `docs/feed-experience-*.md`, `docs/feed-improvement-plan.md`,
  `docs/feed-manager-progress.md`, `docs/assets/feed/*.png`.

## Critical caveat

**Nothing is committed.** All work (from every workstream) is uncommitted in the
working tree, so git records no per-agent attribution. A future integration
should `git add` per owner and run the full gate.

## Exact next action

1. Keep the shared files quiescent and re-run the full gate after the last
   workstream stops.
2. Route the documented backend defects (DB-1/DB-2, story-view, captions) to the
   cloud owner.
3. Optionally split the Feed work into a branch/worktree and commit per owner for
   clean attribution.
