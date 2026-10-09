# Agent 3 — Feed & Discovery Manager — Progress

> **Historical record** — ports reflect the run at the time. Canonical local dev is defined in [`AGENTS.md`](../../AGENTS.md) §10.

> Checkpoint for the main-feed / content-discovery workstream. Update after each
> meaningful batch. Plan: [`../feed-discovery-implementation-plan.md`](../feed-discovery-implementation-plan.md) ·
> Audit: [`../feed-discovery-ux-audit.md`](../feed-discovery-ux-audit.md).

## Status

**VERIFIED** — audit done, timeline restructured to Composer → Stories → posts,
loading/pagination/refresh/ordering hardened, states + a11y covered, responsive
and E2E checks passing.

## Files touched (this workstream)

- `packages/ui/src/FeedView.tsx` — timeline structure and mechanics.
- `packages/ui/src/FeedView.dom.test.tsx` — ordering, pagination, a11y tests.
- `packages/ui/src/styles.css` — `.feed-end`, `.feed-sentinel`, `.feed-new-banner`,
  `.feed-sort` (shared file; edits scoped to `.feed-*`).
- `apps/cloud/src/server.ts`, `apps/cloud/src/events.ts`,
  `apps/cloud/src/store/{types,postgres,memory}.ts` — DB-1/DB-2.
- `apps/cloud/src/{events,feed-realtime,feed-pagination}.test.ts` — backend tests.
- `scripts/feed-discovery-verify.mjs`, `scripts/feed-discovery-perf.mjs` — harnesses.
- `docs/feed-discovery-*.md`, `docs/agent-progress/feed-discovery-manager.md`.

## Completed

- **Phase 1 — audit:** architecture + data flow traced; findings recorded in the
  UX audit.
- **Phase 2 — timeline layout:** order corrected to **Composer → Stories → posts**
  (FEED-ORDER); width/rhythm align with composer/Stories; no horizontal overflow.
- **Phase 3 — loading/pagination:** infinite scroll + Load-more fallback, de-dup,
  stale/duplicate-request guards, end-of-feed, retry of the failed page.
- **Phase 4 — publish integration:** composer prepends the confirmed post; no
  duplicate insertion (de-dup by id).
- **Phase 5 — interactions/navigation:** scroll restoration across sub-views; feed
  state preserved on return.
- **Phase 6 — responsive:** verified at 390 / 900 / 1440 / 1680 — no overflow.
- **Phase 7 — performance/reliability:** request de-dup (exactly one call per
  page), no infinite-scroll loop, stable keys.
- **Phase 8 — states:** skeletons, empty, error+Retry, end state, deleted/missing
  media handled by the shared card.
- **Phase 9 — testing:** unit + integration + E2E + websocket tests (below).
- **Phase 10/11 — coordination/docs:** contracts documented; this file + audit +
  plan maintained.

## Tests executed (actual results)

- `npm run typecheck` → clean · `npm run lint` → clean.
- `npm test` → **468 passed / 468** (65 files).
- `FeedView.dom.test.tsx` → **79 passed / 79** (incl. FEED-ORDER).
- `node scripts/feed-discovery-verify.mjs` → all checks pass, incl.
  `timeline order: composer<stories=true, stories<post=true`.
- `node scripts/feed-discovery-perf.mjs` → 60 posts, 3 `/v1/feed` calls, no dupes,
  no loop, no overflow at 900/1680.
- `npm run test:e2e` → 4 passed / 7 skipped (skips are pre-existing setup-gated).
- Lighthouse (Feed): Accessibility **0.96**, Best Practices 1.0.
- Evidence: `docs/assets/feed/discovery-feed-order.png`, `discovery-end-of-feed.png`,
  `discovery-restored.png`, `discovery-mobile.png`, `discovery-tablet.png`,
  `discovery-wide.png`, `discovery-new-activity.png`.

## Remaining limitations / next actions

- **Done since:** **FEED-D8** (`Top`-sort offset pagination) and the **DB-1
  follow-up** (friends' new posts over realtime) — both implemented with tests
  (`feed-top-pagination.test.ts`, extended `feed-realtime.test.ts`).
- **FEED-D9 — decided: not needed.** Measured with
  `node scripts/feed-discovery-scale.mjs`:
  - 120 posts → 3,284 DOM nodes, **0 long tasks**, 6 `/v1/feed` calls.
  - 300 posts → 8,144 DOM nodes, **1 long task (73ms)**, 15 `/v1/feed` calls.
  No scroll jank at current scale, so introducing virtualization would add
  complexity without evidence.
- **Concurrent WIP (not ours):** at the time of writing, another workstream had
  **uncommitted** edits in `packages/ui/src/{FeedView.tsx,BotifyrApp.tsx,styles.css}`
  that left the repo gate red (`setNonce` unused; `designSystem.test.ts`). These
  are not part of this workstream and were left untouched per AGENTS.md §8.
- **Known flaky test (not ours):** `FeedView.dom.test.tsx > Post interactions >
  highlights the permalink-focused post (POST-13)` fails only under a loaded
  full-suite run (it asserts on a class removed by a 2.5s timer); it passes when
  the file runs alone. Owner: Post Manager (Agent 4).
- **Handoff:** completion report to Agent 1 (Feed Experience Lead); final
  independent QA by Agent 9.
