# Stories — Implementation Plan

> Owner: **Stories Manager** (Feed Experience Team). Date: **Oct 2026**.
> Companion docs: [`stories-competitive-research.md`](stories-competitive-research.md),
> [`stories-ux-audit.md`](stories-ux-audit.md), progress in
> [`agent-progress/stories-manager.md`](agent-progress/stories-manager.md).
>
> Legend: **Done** = implemented + tested in this iteration; **Planned** = designed
> but not built; **Backend-blocked** = needs an API that does not exist yet.

## A. Scope & ownership

Owned by the Stories Manager:
- The story tray (`stories-strip` + tiles) and its creator grouping.
- The full-screen `StoryViewer` (progress, navigation, timing, taps, pause).
- Story-specific loading / empty / error states.
- The story viewing lifecycle and the local "seen" model.
- The story reply control (routed through the existing DM channel).

**Not** changed: shared tokens, global feed ranking, and unrelated messaging
behaviour. Story logic now lives in its own module **`packages/ui/src/Stories.tsx`**
(the self-contained `StoriesStrip` + `StoryViewer`); shared presentational helpers
(`Avatar`, `authorName`, `authorEmoji`, `relativeTime`, `resolveAvatar`) moved to
`packages/ui/src/feedKit.tsx` so Stories and Feed share them without an import
cycle. `FeedView.tsx` only renders `<StoriesStrip client cloudUrl viewerId />`;
styles stay in `styles.css`.

## B. Data model (as it actually exists)

`Story` (`packages/client/src/index.ts`):

```ts
interface Story {
  id: string;
  author: FeedAuthor;      // id, handle?, displayName?, avatarEmoji?, avatarUrl?, online
  caption: string;
  imageUrl?: string;       // signed image path; the only media field
  createdAt: string;
  expiresAt: string;       // server sets createdAt + 24h
}
```

- Creation: `createStory({ mediaId? , caption? })`; image caption max 200 chars.
- **No** video field, **no** view route, **no** reaction route.
- Feed: `listStories(): Promise<Story[]>` — flat, newest-first, ≤50, friends-only.

Implications: no video story support and no server-side viewed tracking. We
implement the best client-side equivalents and document the gaps (see §F, §G).

## C. State model

```
stories: Story[]                              // raw API list
storyGroups = useMemo(groupStories(stories))  // [{ author, stories[] }]
storyOpen: { authorId, storyId } | null       // active story, id-keyed (not index)
seenStories: Record<string, true>             // localStorage-backed
storiesLoading / storyError                   // tray states
```

`StoryViewer` receives `groups`, resolved `groupIndex`/`storyIndex`,
`onSeen`, `onNavigate`, `onClose`, and optional `onReplyToStory`. It owns only
ephemeral playback state (elapsed, paused, media error, reply state). The open
story is identified by ids so a list refresh cannot silently swap the content
under the viewer; if it disappears, a guard effect closes the viewer.

## D. Tray (Done)

- One tile per creator, ordered by most-recent activity.
- Unseen ring vs dimmed viewed ring; the accessible name also states
  "new story"/"viewed" (not colour-only).
- Own tile: opens your story when present, `+` overlay (or the whole tile with no
  story) starts a new upload via `uploadFile` + `createStory`.
- Loading skeletons, a Retry tile, and a quiet empty label.
- Opens at the creator's **first unseen** story.

## E. Viewer & progression (Done)

- Immersive `role="dialog" aria-modal` with creator header and close button.
- Segmented progress for the **active creator only**; completed = filled,
  active = animating fill.
- Timing: 5 s images, 4 s text (`storyDuration`).
- Advance within a collection → next creator → exit. Prev mirrors it; at the very
  start it restarts the current story.
- **Pause/resume:** press-and-hold (220 ms threshold) and `Space`; a held press
  suppresses the follow-up click. Progress freezes and resumes from the elapsed
  offset (CSS `animation-delay` + `animation-play-state` mirror `elapsedRef`).
- **Backgrounding:** `visibilitychange` pauses; returning resumes.
- **Keyboard:** `←`/`→`/`Esc`/`Space`, ignored while the reply field is focused.
- **Tap zones:** left third = previous, rest = next; the zone layer is
  `aria-hidden` and sits below the accessibile arrow buttons.
- **Media errors:** `onError` → recoverable Retry/Next panel.
- **Cleanup:** the timer, keyboard, and visibility listeners are all released by
  effect teardown; nothing runs after close.

## F. Viewing state (Done, server + local)

- A story is marked seen when it becomes **active**, persisted locally to
  `localStorage["botifyr.seenStories"]` (capped at 500 ids), **and** recorded
  server-side via `POST /v1/stories/:id/view` (idempotent; `story_views` table).
- `GET /v1/stories` returns `viewedByMe`; the client seeds the local seen store
  from it, so "seen" now survives across devices.
- Failed view writes are swallowed locally (optimistic); the local list is the
  immediate source of truth and is reconciled on the next fetch.

## G. Replies & reactions

- **Replies (Done):** a reply bar appears for other people's stories. Submitting
  calls `client.openDm(authorId)` then `client.sendDm(sessionId, text)` — the
  existing DM channel from FR-13 ("reply opens a DM"). Success shows "Sent ✓";
  failure shows a retryable error. Replies are hidden for your own story and
  when no reply capability is provided.
- **Reactions (Done):** quick reactions (❤️ 😂 😮 😢 👏) use
  `POST /v1/stories/:id/reaction` (`story_reactions` table). The UI is optimistic
  with refetch-on-failure; tapping the active reaction clears it. `GET /v1/stories`
  returns `reactions` counts and `myReaction`.
- **Open the DM (Done):** after a reply is sent, the host opens that conversation
  (`onStoryReplySent` → `BotifyrApp.openStoryConversation`), matching FR-13's
  "reply opens a DM".

## H. Expiration & availability (Done)

- Server filters by `expiresAt`; the client additionally drops locally-expired
  items inside `groupStories`.
- If the open story disappears from a refreshed list, the guard effect closes the
  viewer instead of advancing into unavailable content.

## I. Responsive & accessibility (Done)

- Mobile: tap zones, hold-to-pause, safe padding; media constrained rather than
  stretched.
- Desktop: visible prev/next + close, keyboard control, letterboxed portrait
  media.
- a11y: focus moved into the dialog and restored on close; every control named;
  `role="alert"`/`role="status"` for errors and Sent; text-based seen state;
  `prefers-reduced-motion` disables the fill animation.

## J. Performance & resources

- The tray uses only the latest story's thumbnail for each creator (no eager load
  of every image).
- No prefetch of next media this iteration (bandwidth/privacy); noted as
  **Planned** (prefetch only the next story's image on tap).
- Exactly one `setTimeout` per active story; no overlapping timers.
- No new media library introduced.

## K. Coordination

| Agent | Interface touched | Status |
| --- | --- | --- |
| Design System | reuses `Avatar`, `.story-*`, focus ring | No token changes |
| Feed & Discovery | tray sits above the feed; no feed-behaviour change | Coexists |
| Post Manager | reuses reaction/comment patterns conceptually | No code coupling |
| Reels Manager | shares the surface/`FeedView.tsx`; no shared player code | Concurrent edits noted |
| Composer Manager | confirms `uploadFile`+`createStory` as the create path | Aligned |
| Feed QA & E2E | component tests added in `FeedView.dom.test.tsx` | Agreed |
| Feed Experience Lead | status via `agent-progress/stories-manager.md` | Reported |

## L. Testing

- **Done:** component tests for grouping, per-creator progress, seen state +
  persistence, pause/resume with fake timers, reply via DM, media-error recovery.
- **Existing:** the prior EXP-1/EXP-2 tests were updated to the corrected
  per-creator semantics.
- **Planned:** Playwright E2E opening a seeded story on a mobile viewport
  (needs a seeded account/backend session).

## M. Remaining / deferred

- Server story views (backend) → replaces local seen store.
- Story reactions (backend).
- Video stories (no media field).
- Swipe-down dismiss and swipe-between-creators gestures.
- Post-send navigation to the DM thread.
- Extract Stories into its own module to reduce `FeedView.tsx` contention.
