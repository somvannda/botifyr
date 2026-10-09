# Feed & Discovery — Implementation Plan

> Agent 3 (Feed & Discovery Manager). Companion to the audit
> ([`feed-discovery-ux-audit.md`](feed-discovery-ux-audit.md)) and the detailed
> engineering ledger ([`feed-discovery-plan.md`](feed-discovery-plan.md),
> [`feed-discovery-backlog.md`](feed-discovery-backlog.md)). Date: **Oct 2026**.

## A. Target experience

The central column, top to bottom:

1. **Composer** — the existing composer (Agent 8), unchanged.
2. **Stories row** — the existing `StoriesStrip` (Agent 6), unchanged.
3. **Main post feed** — the shared post card (Agent 4), then loading/end states.

Constraints honoured:

- Comfortable reading width (620px), centred, aligned with composer/Stories.
- Consistent vertical rhythm via the timeline's flex `gap`; no extra headings or
  dividers that break the compact reference layout.
- No horizontal overflow at desktop / tablet / mobile.
- Posts come from the shared post component — no duplicate card.

## B. Delivered

| ID | Change | Where | Verified |
| --- | --- | --- | --- |
| FEED-ORDER | Reordered the timeline to **Composer → Stories → posts** | `FeedView.tsx` | unit test + live E2E + screenshot |
| FEED-D1 | Infinite scroll (`IntersectionObserver`, 600px look-ahead) + Load-more fallback | `FeedView.tsx` | live (20→25 by scrolling) |
| FEED-D2 | End-of-timeline state (`role="status"`) | `FeedView.tsx` + css | live |
| FEED-D3 | Append de-dup + stale-response guard + identical-request de-dup | `FeedView.tsx` | unit + live (25 unique; 3 requests) |
| FEED-D4 | Per-view scroll restoration across sub-views | `FeedView.tsx` | live (700→700) |
| FEED-D5 | Labelled topbar **Refresh** control | `FeedView.tsx` | unit + live |
| FEED-D6 | "New activity" banner instead of silent replace | `FeedView.tsx` | unit + live |
| FEED-D7 | Explicit, labelled **Sort** `<select>` | `FeedView.tsx` | unit + live |
| FEED-D10 | Focus/visibility freshness fallback (works without realtime) | `FeedView.tsx` | unit + live |
| FEED-D11 | Polite live region announces "N more posts loaded" | `FeedView.tsx` | unit + live |
| DB-1 | Deliver `feed.*` realtime events (routing filter) | `server.ts` + `events.ts` | websocket integration test |
| DB-2 | Stable `(createdAt, id)` keyset pagination | `server.ts` + stores | pagination test |

## C. Roadmap

- **P0 — none outstanding.** Core timeline flows work.
- **P1 — done:** timeline order, pagination integrity, scroll continuity.
- **P2 — done:** end state, manual refresh, new-activity banner, labelled sort,
  pagination a11y, freshness fallback.
- **P3 — open:** `FEED-D8` paginate the `Top` sort (needs a stable ranked
  cursor); `FEED-D9` list virtualization only if profiling shows a real cost.
- **Backend follow-up:** deliver friends' *new posts* over realtime (DB-1
  extension).

## D. Contracts & coordination

- **Agent 4 (posts):** consumes `PostCard`; no changes requested.
- **Agent 6 (Stories):** consumes `StoriesStrip`; only its position changed.
- **Agent 8 (composer):** consumes the composer form; only its position changed.
- **Agent 1 (shell/width):** timeline width/responsive rules confined to
  `.feed-*`; no page-grid edits.
- **Agent 9 (QA):** independent verification via `npm run test:e2e` and the two
  `scripts/feed-discovery-*.mjs` harnesses.

## E. Verification strategy

- **Unit/component:** ordering, de-dup, pagination, end state, refresh, a11y
  announcements (`FeedView.dom.test.tsx`).
- **Integration:** feed + reels API, websocket delivery, keyset pagination
  (`apps/cloud/src/{server.feed,feed-realtime,feed-pagination,events}.test.ts`).
- **E2E / visual:** `scripts/feed-discovery-verify.mjs` (order, pagination,
  refresh, scroll restoration, a11y, responsive) and `feed-discovery-perf.mjs`
  (request de-dup, no loop, tablet/wide). Screenshots in `docs/assets/feed/`.
- **Gate:** `npm run typecheck && npm run lint && npm test`.
