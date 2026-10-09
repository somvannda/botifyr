# Post — UX/UI Improvement Plan

> Owner: **Post Manager** · Scope: the reusable individual post component and
> its directly related interactions (`PostCard`, `CommentRow`, post media,
> reactions, comments, share/save, contextual menus) in
> `packages/ui/src/FeedView.tsx` + `packages/ui/src/styles.css`.
>
> Grounded in **source inspection** and a **live runtime audit** of the running
> dev host (`http://localhost:1420`, cloud `http://localhost:8787`) with a seeded
> feed. Findings marked *(verified)* were observed in the running app via
> `scripts/post-audit.mjs`; *(code review)* come from reading source.
> Last updated: Oct 2026.

## A. Executive summary

The post card is mature: author identity first, content, media galleries,
7-way reactions, threaded comments with reactions, polls, reposts, save/hide/
snooze/unfollow/report/block, an action bar with a `⋯` overflow menu, long-text
clamping, and an image lightbox (see `docs/feed-improvement-plan.md`
FEED-1…FEED-11).

The remaining problems are **post-level reliability and content legibility**,
not missing surfaces:

1. **Links in post text aren't clickable** — a URL renders as plain text; the
   live audit found `0` anchors inside `.feed-body`. *(verified)*
2. **The `⋯` menu cannot be dismissed by keyboard or outside click** — the live
   audit found `menuClosedByEscape: false`; focus is not moved into the menu.
   *(verified)*
3. **Delete fires immediately with no confirmation** — the live audit found no
   dialog and the post gone after one click (`deleteDialogAppeared: false`).
   *(verified)*
4. **Failed actions are silent** — react / save / share / vote / comment catch
   errors and either roll back invisibly or do nothing; the user is never told,
   and rapid repeat clicks are not guarded against duplicate requests. *(code
   review)*
5. **Reposted originals lose content** — only `body` + a single `imageUrl`
   render; galleries, videos and hashtags of the original are dropped. *(code
   review)*
6. **Media has no broken-image fallback** and videos have no accessible name;
   inline `@mentions` are indistinguishable from body text. *(code review)*

The work below is **frontend-only** and reuses the existing data contract.
Backend-dependent ideas (comment pagination, copy-link permalinks, mention
routing) are documented separately and are **not** implemented here.

## B. Current implementation

- **Entry point:** `FeedView` (`packages/ui/src/FeedView.tsx`) renders `PostCard`
  in five contexts — main Feed, Page timeline, Group stream, hashtag view, and
  profile/album timeline — plus a reposted original nested one level deep.
- **Post structure:** `AuthorLine` (avatar → name → `@handle · time`) → audience/
  repost badges → `PostBody` (clamped) → hashtag chips → media (`videos` |
  `feed-image-grid` | single image | placeholder) → poll → `feed-stats` →
  `feed-actions` (Like/Comment/Share/Save/More) → `feed-menu` → comments.
- **Data (`FeedPost`):** `body`, `images[]`, `videos[]`, `imageUrl`, `mediaId`,
  `poll`, `hashtags[]`, `original`, `repostOf`, `audience`, `scheduledAt`,
  `savedByMe`, `likes`, `comments`, `shares`, `reactions`, `myReaction`,
  `likedByMe`, `sharedByMe`, `author.avatarUrl`.
- **API:** `listFeed`, `reactPost`/`unreactPost`, `listComments`/`addComment`/
  `deleteComment`, `repost`, `savePost`, `hidePost`, `muteAuthor`, `reportPost`,
  `blockUser`, `deletePost`, `votePoll` (`packages/client/src/index.ts`), served
  by `apps/cloud/src/server.ts` (`/v1/posts*`). Deletion of a comment is
  authorized by ownership server-side.
- **Styling:** `.feed-*` classes in `styles.css`; dark/light via CSS variables;
  shared `Avatar`/`AuthorLine`/tokens.
- **Tests:** `packages/ui/src/FeedView.dom.test.tsx` (13 tests), backend
  `apps/cloud/src/server.feed.test.ts`, e2e boot `e2e/portal.spec.ts`.

## C. Competitive research

Research date: **Oct 2026**. Established product patterns, **not** live
screenshots captured this session.

| Product | Pattern | User problem solved | Relevance | Adopt / adapt / reject |
| --- | --- | --- | --- | --- |
| **X / Threads** | URLs auto-linked and tappable; `@mentions` and `#hashtags` coloured inline | Text is a live document; navigation without copy/paste | **High** | **Adopt** (URLs + inline tags) |
| **Facebook / LinkedIn** | Destructive/rare actions live behind `⋯` and destructive ones confirm | Prevents accidental deletion; scannable cards | **High** | **Adopt** (confirm delete) |
| **Facebook** | Optimistic reaction/save with rollback on failure; a retryable error toast | Feels instant without lying about success | **High** | **Adopt** (rollback + inline feedback) |
| **Instagram** | Broken/unavailable media shows a neutral placeholder, never a broken icon | Keeps the card composed when a CDN asset dies | **High** | **Adopt** |
| **LinkedIn** | Menu is keyboard operable (Escape, arrows) and returns focus to the trigger | Keyboard/screen-reader users can act | **High** | **Adopt** |
| **Reddit** | Permalink per post for copy-link | Sharing a specific post | Medium | Defer (needs routing) |

## D. UX/UI gap analysis (ranked)

| # | Gap | Impact | Frequency | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Links/mentions in body not interactive | High | URL/mention posts | High | High *(verified)* | Low |
| 2 | `⋯` menu not dismissible by Esc/outside; no focus move | High (a11y) | Keyboard/screen-reader | High | High *(verified)* | Low |
| 3 | Delete executes with no confirmation | High | Own posts | High | High *(verified)* | Low |
| 4 | Silent failures; no duplicate-request guard | High | Flaky networks / fast clicks | High | High *(code)* | Low |
| 5 | Comment submit has no error feedback, input unlabelled | Medium | Commenters | Medium | High *(code)* | Low |
| 6 | Reposted original drops gallery/video/hashtags | Medium | Reposts of media | Medium | High *(code)* | Low |
| 7 | No broken-media fallback; video unlabelled | Medium | CDN errors / a11y | Medium | High *(code)* | Low |
| 8 | Reaction summary not keyboard-focusable | Low (a11y) | Keyboard users | Low | High *(code)* | Low |
| 9 | Timestamps not semantic (no `<time>`, no full date) | Low | All posts | Low | High *(code)* | Low |
| 10 | Report gives no confirmation | Low | Reporting | Low | Medium *(code)* | Low |

Backend-dependent (documented, **not** implemented): comment paging/"view more"
(`listComments` returns all), copy-post-link/permalinks (no stable public URL),
`@mention` profile routing (no person-profile route from the Feed).

## E. Target experience

- **Content:** URLs auto-link (new-tab, `rel="noreferrer noopener"`, underlined so
  the link is distinguishable without colour alone); inline `#hashtags` open the
  tag view; `@mentions` are visually distinct. Body uses
  `overflow-wrap: anywhere` so long tokens can't overflow.
- **Post actions:** optimistic react/save/share/vote behind a per-action
  in-flight guard; on failure the optimistic change rolls back and an inline
  `role="alert"` message with a clear sentence is shown. `aria-busy` while a
  request is in flight.
- **Menus:** the `⋯` menu and the reaction picker close on **Escape** and
  **outside click**; the menu moves focus to its first item, supports
  ArrowUp/ArrowDown, and returns focus to the trigger on close.
- **Destructive actions:** Delete post and Block author open an
  `role="alertdialog"` confirmation with focus trap, Escape-to-cancel, and a
  danger-styled confirm.
- **Comments:** unlabelled input gets `aria-label`; submission shows a
  `role="alert"` error and keeps the draft; authors can delete their own comment
  (with confirmation), keeping the count consistent.
- **Reposts:** the nested original renders the full body (with rich text),
  galleries/videos, and hashtags, in a clear inset frame.
- **Media:** a failed image swaps to a neutral "Image unavailable" placeholder;
  videos carry accessible names; timestamps use `<time datetime title>`.
- **Consistency:** all of the above reuse `Avatar`, `AuthorLine`, `.feed-*`
  conventions and the existing `:focus-visible` ring.

## F. Implementation roadmap

- **P0:** none outstanding (core flows render and work).
- **P1:** POST-1 link/mention legibility; POST-2 menu/picker keyboard + outside
  dismissal; POST-3 destructive confirmation; POST-4 optimistic guards + error
  feedback; POST-5 comment feedback + label.
- **P2:** POST-6 repost fidelity; POST-7 broken-media fallback + video label;
  POST-8 reaction summary focusability; POST-9 semantic timestamps; POST-10
  report confirmation.
- **P3:** comment pagination (backend), copy-link (backend), mention routing
  (backend).

## G. Engineering backlog

See `docs/post-improvement-backlog.md` for owners, dependencies and acceptance
criteria. Progress is tracked in `docs/post-improvement-progress.md`.

## H. Test plan

- **Component (vitest + jsdom, `FeedView.dom.test.tsx`):** rich-text links/tags;
  menu Escape + outside-click + focus; delete confirmation then confirm calls
  `deletePost` and removes the card; failed react/save rolls back and shows the
  error; comment error keeps the draft; own-comment delete; broken image
  fallback; repost gallery renders.
- **Regression:** existing 13 post tests stay green; full `npm test`.
- **Live (headless Playwright, `scripts/post-audit.mjs`):** URL anchors inside
  `.feed-body`; menu closes on Escape/outside; delete shows a dialog before
  removing; no console errors; no horizontal overflow at 390px; before/after
  screenshots in `docs/assets/post/`.
- **A11y:** accessible names for icon-only controls and inputs; focus visible;
  `role="menu"`/`menuitem`/`alertdialog` semantics; Lighthouse spot check.
