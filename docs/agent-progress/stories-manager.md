# Stories Manager — Progress & Context Recovery

> Owner: **Stories Manager** (Feed Experience Team, reports to Feed Experience
> Lead). Update after each milestone. Companion docs:
> [`stories-competitive-research.md`](../stories-competitive-research.md),
> [`stories-ux-audit.md`](../stories-ux-audit.md),
> [`stories-implementation-plan.md`](../stories-implementation-plan.md).

## Current status

**Implementation complete and verified, including the previously backend-blocked
story views and reactions.** `FeedView.dom.test.tsx` → **66 passed**. Backend
story tests → **2 passed**. `typecheck` clean for `@botifyr/cloud`,
`@botifyr/client`, `@botifyr/ui`. Cloud container rebuilt and the new routes are
live (unauthenticated `POST /v1/stories/:id/view` → 401).

> Concurrent-writer note: sibling agents are editing shared files. One introduced
> a backtick typo in `apps/cloud/src/store/schema.ts` (inside the SQL template
> literal) that broke the cloud test transform; fixed. Four `server.feed.test.ts`
> post-media/alt-text failures remain and belong to that workstream, not Stories.

## Environment

- Repo `G:\Developments\botifyr.xyz` (npm workspaces). Node ≥20.
- **A sibling agent is actively rewriting `packages/ui/src/FeedView.tsx` and
  `styles.css`** (hash changed repeatedly within seconds during this session).
  Stories edits were applied by exact-text match to the stable Stories regions;
  re-verify the file after that workstream settles.

## Files inspected

- `packages/ui/src/FeedView.tsx` — `StoryViewer`, story tray, `FeedView` state.
- `packages/ui/src/styles.css` — `.stories-strip`, `.story-*`, `.reel-*`.
- `packages/client/src/index.ts` — `Story`, `listStories`/`createStory`,
  `openDm`/`sendDm`/`sendMessage`.
- `apps/cloud/src/server.ts` — `POST/GET /v1/stories`, `/v1/dm/*`.
- `apps/cloud/src/store/{types,schema,memory,postgres}.ts` — story records.
- `apps/cloud/src/server.feed.test.ts` — story expiry test.
- `packages/ui/src/FeedView.dom.test.tsx` — existing EXP-1/EXP-2 tests.
- `docs/feed-next.md` §FR-13, `docs/feed-experience-{plan,backlog,progress}.md`.

## Files modified

- `packages/ui/src/FeedView.tsx`
  - Replaced pre-change `STORY_DURATION_MS` + `StoryViewer` with grouped,
    pausable viewer + helpers (`StoryGroup`, `groupStories`, `storyDuration`,
    `readSeenStories`).
  - New state: `storiesLoading`, `storyError`, id-keyed `storyOpen`,
    `seenStories` seeded from storage, `storyGroups` memo.
  - `loadStories` callback; seen-persistence effect; close-stale-story effect.
  - Handlers: `addStory` (now `loadStories`), `markStorySeen`, `openStory`,
    `navigateStory`, `replyToStory` (DM).
  - Grouped tray with own-story tile, skeletons, retry, empty label.
  - Viewer usage resolves indices from ids; hides reply on your own story.
- `packages/ui/src/styles.css`
  - Raised `.story-viewer-head`/`.story-nav` z-index; immersive media sizing and
    centred caption; new `.story-own*`, `.story-taps`/`.story-tap`,
    `.story-paused`, `.story-error*`, `.story-reply*`, `.story-skeleton`,
    `.story-empty` rules; `story-pulse` keyframes.
- `packages/ui/src/FeedView.dom.test.tsx`
  - `makeStory(id, name, authorId?, createdAt?)`, future `expiresAt`,
    `openDm`/`sendDm`/`viewStory`/`reactStory` mocks, `act` import.
  - Updated EXP-1 to per-creator progress; kept EXP-2; added grouping,
    seen-persistence, pause/resume (fake timers), reply-via-DM, media-error,
    expiry, end-of-collection, keyboard, tab-hidden, view-recorded, reaction tests.
- `apps/cloud/src/store/schema.ts` — `story_views` + `story_reactions` tables;
  fixed a concurrent backtick typo in the SQL template literal.
- `apps/cloud/src/store/types.ts` — `StoryReactionRecord` + store interface.
- `apps/cloud/src/store/memory.ts` / `postgres.ts` — view + reaction methods.
- `apps/cloud/src/server.ts` — `GET /v1/stories` now returns
  `viewedByMe`/`reactions`/`myReaction`; added `POST /v1/stories/:id/view` and
  `POST /v1/stories/:id/reaction`.
- `apps/cloud/src/server.feed.test.ts` — "records story views and reactions".
- `packages/client/src/index.ts` — `Story` gains `viewedByMe`/`reactions`/
  `myReaction`; added `viewStory` + `reactStory`.
- `packages/ui/src/styles.css` — `.story-reactions`/`.story-reaction` and spacing.
- New docs: `stories-competitive-research.md`, `stories-ux-audit.md`,
  `stories-implementation-plan.md`, this file.

## Completed work

- Creator grouping (tray + progress segments), first-unseen open.
- Pause/resume (hold + `Space`), visibility-change pause, correct resume offset.
- Tap left/right regions with click-suppression after a hold.
- Keyboard `←/→/Esc/Space` with reply-field guard.
- Focus move-in + restore; text-based seen labels; `role=status/alert`.
- Media-error Retry/Next; tray skeletons/retry/empty; own-story tile.
- Local, persisted seen state marking the story actually viewed.
- Reply via the existing DM channel; no decorative reaction controls.
- Client-side expiry filter + close-stale-story guard.
- **Story views server-side** (`story_views` + `POST /v1/stories/:id/view`;
  `viewedByMe` seeds the local seen store).
- **Story reactions** (`story_reactions` + `POST /v1/stories/:id/reaction`;
  optimistic UI, refetch on failure, toggle-to-clear).

## Decisions & rationale

- **Reuse, don't invent.** Replies use `openDm`+`sendDm`. Reactions use a new,
  minimal `story_reactions` table/route (FR-13 asks for reactions); no external
  messaging API was invented.
- **Server views + local cache.** `POST /v1/stories/:id/view` records views;
  `viewedByMe` seeds the local `localStorage` seen store so it survives across
  devices. The local list updates immediately (optimistic).
- **Id-keyed open story** instead of an index, so a refresh cannot swap content.
- **In-place in `FeedView.tsx`** (not a new module) because `StoryViewer` already
  lives there; noted as a future extraction to reduce sibling-agent contention.

## Test results (actual)

- `npx vitest run packages/ui/src/FeedView.dom.test.tsx` → **66 passed / 0 failed**
  (13 Stories tests: grouping, per-creator progress, expiry hidden, end-of-
  collection close, keyboard nav, tab-hidden pause, seen + persistence,
  pause/resume, reply, media error, view-recorded, reaction toggle).
- `npx vitest run apps/cloud/src/server.feed.test.ts -t story` → **2 passed**
  (expiry + "records story views and reactions").
- `npm test` (repo-wide) → **423 passed / 4 failed** (61 files). The 4 failures
  are the concurrent post-media/alt-text work, not Stories.
- `npm run typecheck -w @botifyr/{cloud,client,ui}` → **clean**.
- Live: cloud rebuilt; `POST /v1/stories/:id/view` returns 401 unauthenticated.

## Outstanding tasks

1. **Playwright story E2E** with a seeded account (mobile viewport).
2. Optional: extract Stories into `packages/ui/src/Stories.tsx`.
3. Optional: prefetch only the next story's image; post-send DM navigation.

## Dependencies & blockers

- **Not ours:** 4 `server.feed.test.ts` post-media/alt-text failures from a sibling
  workstream. Also fixed their `schema.ts` backtick typo that broke the transform.
- **No video stories:** the `Story` DTO has no video field.
- **Coordination:** `FeedView.tsx`/`styles.css` are shared; re-run the gate if they
  resume editing.

## Next concrete actions

1. Add a Playwright story E2E.
2. Keep the local seen store as an optimistic cache alongside the server route.
3. Optional: extract Stories into its own module to end shared-file contention.

## Handoff notes

- Stories logic is in `FeedView.tsx` near `StoryViewer`/`storyGroups`; grep
  `storyGroups`, `storyOpen`, `storyDuration`, `groupStories`, `reactToStory`.
- Strip opens at the first unseen story; "seen" is per-story-id (local + server
  `viewedByMe`), aggregated per creator in the tray.
- Story views/reactions live in `story_views`/`story_reactions`; server routes in
  `server.ts`; client `viewStory`/`reactStory`.
- Coordinate any further `FeedView.tsx` edits with the Feed Experience Lead; the
  file is under active concurrent authorship.
