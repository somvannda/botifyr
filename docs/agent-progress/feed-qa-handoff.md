# Feed QA — Handoff to Agent 9 (Final Integrated QA)

> **Historical record** — ports reflect the run at the time. Canonical local dev is defined in [`AGENTS.md`](../../AGENTS.md) §10.

> From: **Agent 1 — Feed Experience Lead**. To: **Agent 9 — Feed QA & E2E
> Manager**. Status: **ready**. Date: Oct 2026.

## What to verify

Run the **Final Integrated QA** on the redesigned Feed once the feature
workstreams report complete (Stories extraction is the last in flight).

### Journeys (desktop + mobile)
1. Open Feed; confirm **Composer → Stories → Posts** order.
2. The **Feed bottom menu** renders inside the central column, **between the left
   sidebar and the right sidebar**, and only on Feed.
3. Menu items work: **Feed** (home), **Reels** (opens Reels), **Pages** (Feed
   Pages filter), **Groups** (opens the Groups list), **Marketplace** (opens the
   Marketplace).
4. The menu **persists in Feed sub-views** (Reels, Groups, Page, Group, Tag,
   Album) and "Feed" returns home.
5. Left sidebar tabs (Chat · Feed · Virtual Workspace) still work.
6. Post actions (react/comment/share/save/more), lightbox, Stories viewer, poll.
7. No horizontal overflow at 390px; menu does not cover content.
8. No console/page errors; no duplicate/missing posts.

### Commands
- `npm run typecheck -w @botifyr/ui`
- `npm test`
- `node scripts/feed-screenshots.mjs` (visual)
- `node scripts/feed-qa.mjs` (journey harness — reuse/extend as you wish)

### Acceptance
All journeys pass; no regressions in the 452-test suite; a short release-readiness
report distinguishing **verified / unverified / blocked**.

## Known limitations to respect (do not mark as failures without context)
- **Reference screenshot not provided** → pixel-match not assessed.
- **No video fixture** → Reels autoplay/seek is jsdom-only.
- **Backend gaps:** DB-1 realtime `feed.*`; DB-2 pagination tie-break; no
  story-view endpoint; no Reels captions; Page tabs/cursor; no permalink/router.
- **Concurrent multi-agent edits** on shared files (`FeedView.tsx`,
  `BotifyrApp.tsx`, `styles.css`); re-run the gate after the tree quiesces.

## Evidence already available
- `docs/assets/feed/*.png` (desktop/tablet/mobile, menu, lightbox, story viewer,
  reels, pages).
- `docs/feed-experience-qa-report.md` (earlier Lead QA run: 16/16).
- `docs/agent-progress/feed-experience-lead.md` (my checkpoint).

## Instruction
Please run the Final Integrated QA and return a release-readiness report. Route
defects to the owning feature agent; I (Agent 1) own page layout/navigation
integration fixes.
