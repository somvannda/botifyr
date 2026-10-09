# Stories Manager — Progress & Context Recovery

> Owner: **Stories Manager** (Feed Experience Team, reports to Feed Experience
> Lead). Update after each milestone. Companion docs:
> [`stories-competitive-research.md`](../stories-competitive-research.md),
> [`stories-ux-audit.md`](../stories-ux-audit.md),
> [`stories-implementation-plan.md`](../stories-implementation-plan.md).

## Current status

**Implementation complete and verified, including the previously backend-blocked
story views and reactions, the Stories module extraction, and reply-opens-DM.**
Repo-wide `npm test` → **452 passed / 0 failed** (64 files). Stories Playwright
E2E → **2 passed** (desktop + mobile: open, react, pause, close). Live Feed QA
(`scripts/feed-qa.mjs`) → "Story viewer opens" **true**, **0 console errors**.
Cloud container rebuilt; new routes live (unauthenticated `POST
/v1/stories/:id/view` → 401). `npm run typecheck` clean across all workspaces;
ESLint 0 errors; Prettier clean.

> Concurrent-writer note: sibling agents edit shared files; one introduced (then
> fixed) a backtick typo in `apps/cloud/src/store/schema.ts`. The earlier 4
> post-media test failures and the 6 unused-import errors were resolved by their
> owners. The Vite dev server on `:1420` was restarted to pick up the new
> `@botifyr/client` (HMR missed it).

## Environment

- Repo `G:\Developments\botifyr.xyz` (npm workspaces). Node ≥20.
- Stories now live in **`packages/ui/src/Stories.tsx`** (+ shared helpers in
  `packages/ui/src/feedKit.tsx`), so the earlier `FeedView.tsx` contention no
  longer affects story edits. `FeedView.tsx`/`styles.css` remain shared with
  sibling agents; re-verify the gate if that workstream resumes.

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

- `packages/ui/src/Stories.tsx` **(new)** — self-contained story surface:
  `StoriesStrip` (fetch, creator grouping, seen store, tray, viewer) +
  `StoryViewer` (progress, pause/resume, taps, keyboard, error, replies,
  reactions).
- `packages/ui/src/feedKit.tsx` **(new)** — shared `Avatar`/`authorName`/
  `authorEmoji`/`relativeTime`/`resolveAvatar`, used by Feed + Stories (no cycle).
- `packages/ui/src/FeedView.tsx` — story logic extracted to `Stories.tsx`; now
  renders `<StoriesStrip client cloudUrl viewerId />` and imports helpers from
  `feedKit`; `useMemo`/`Story` imports removed.
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
- `packages/ui/src/BotifyrApp.tsx` — `openStoryConversation` + `onStoryReplySent`
  wiring so a story reply opens the DM (FR-13).
- `packages/ui/src/styles.css` — `.story-reactions`/`.story-reaction`, spacing,
  more opaque viewer backdrop.
- `e2e/stories.spec.ts` — live Stories journey at desktop + mobile 390px (open,
  react, pause, close) + `docs/assets/feed/story-viewer.png` and
  `story-viewer-mobile.png` screenshots.
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
- **Reply opens the DM:** after sending, `onStoryReplySent` → `BotifyrApp`
  opens the conversation (FR-13).
- **Modularized:** the story surface moved to `packages/ui/src/Stories.tsx`
  (self-contained `StoriesStrip` + `StoryViewer`), with shared helpers in
  `packages/ui/src/feedKit.tsx`; `FeedView` now just renders `<StoriesStrip />`.

## Decisions & rationale

- **Reuse, don't invent.** Replies use `openDm`+`sendDm`. Reactions use a new,
  minimal `story_reactions` table/route (FR-13 asks for reactions); no external
  messaging API was invented.
- **Server views + local cache.** `POST /v1/stories/:id/view` records views;
  `viewedByMe` seeds the local `localStorage` seen store so it survives across
  devices. The local list updates immediately (optimistic).
- **Id-keyed open story** instead of an index, so a refresh cannot swap content.
- **Own module.** Stories live in `Stories.tsx` (not inside `FeedView.tsx`) to
  keep the logic modular and end shared-file contention; shared presentational
  helpers moved to `feedKit.tsx` to avoid an import cycle.

## Test results (actual)

- `npm test` (repo-wide) → **452 passed / 0 failed** (64 files).
- `npx vitest run packages/ui/src/FeedView.dom.test.tsx` → **72 passed** (14
  Stories tests: grouping, per-creator progress, expiry hidden, end-of-collection
  close, keyboard nav, tab-hidden pause, seen + persistence, pause/resume, reply,
  reply-opens-DM, media error, view-recorded, reaction toggle).
- `npx vitest run apps/cloud/src/server.feed.test.ts` → **2 story tests passed**
  (expiry + "records story views and reactions").
- `npx playwright test e2e/stories.spec.ts` → **2 passed** (desktop + mobile 390px:
  open, react, pause badge, close; screenshots `docs/assets/feed/story-viewer.png`
  and `story-viewer-mobile.png`).
- `node scripts/feed-qa.mjs` → Story viewer opens **true**, **0 console errors**.
- Live API: `POST /v1/stories/:id/view` → 200 then `viewedByMe: true`; reaction →
  `{ "❤️": 1 }` + `myReaction`; clear → `{}`; unknown → 404.
- `npm run typecheck` → **clean** (all workspaces).
- `npx eslint .` → **0 errors**; `npx prettier --check` clean on touched files.

## Outstanding tasks

1. Optional: prefetch only the next story's image.
2. Optional: commit the work (currently uncommitted).

## Dependencies & blockers

- **Resolved:** the sibling workstream's post-media/alt-text failures and the
  `schema.ts` backtick typo were fixed; the gate is green.
- **No video stories:** the `Story` DTO has no video field.
- **Coordination:** `FeedView.tsx`/`styles.css` are shared; re-run the gate if they
  resume editing.

## Next concrete actions

1. Keep the local seen store as an optimistic cache alongside the server route.
2. Commit per owner for clean attribution.

## Handoff notes

- Stories logic lives in `packages/ui/src/Stories.tsx`; shared helpers in
  `packages/ui/src/feedKit.tsx`. `FeedView` renders `<StoriesStrip />`.
- Strip opens at the first unseen story; "seen" is per-story-id (local + server
  `viewedByMe`), aggregated per creator in the tray.
- Story views/reactions live in `story_views`/`story_reactions`; server routes in
  `server.ts`; client `viewStory`/`reactStory`.
- Coordinate any further `FeedView.tsx` edits with the Feed Experience Lead; the
  file is under active concurrent authorship.
