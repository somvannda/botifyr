# Post — Improvement Backlog

> Owner: **Post Manager**. Companion to `docs/post-improvement-plan.md`.
> Status: `todo` · `in progress` · `done` · `deferred (dependency)`.
> Last updated: Oct 2026.

All items are frontend-only and touch `packages/ui/src/FeedView.tsx` and the
`.feed-*` block of `packages/ui/src/styles.css` unless noted. No other agent's
owned files are modified.

| ID | Priority | Task | Owner | Depends on | Acceptance criteria | Status |
| --- | --- | --- | --- | --- | --- | --- |
| POST-1 | P1 | Auto-link URLs in post body/republished original; make inline `#hashtags` open the tag view; style `@mentions` distinctly | Post Manager | — | A URL in `body` renders as `<a href target="_blank" rel="noreferrer noopener">`; clicking an inline `#tag` calls the Feed's `onOpenTag`; mentions render `.feed-mention`; long tokens don't overflow | done |
| POST-2 | P1 | Close `⋯` menu + reaction picker on Escape and outside click; move focus into the menu, support ArrowUp/Down, restore focus to the trigger | Post Manager | — | Escape closes the menu and returns focus to `More options`; clicking outside closes; menu items reachable by arrow keys | done |
| POST-3 | P1 | Confirmation dialog before Delete post and Block author | Post Manager | — | Clicking Delete/Block opens a `role="alertdialog"` with Cancel/Confirm; Escape cancels; only Confirm performs the API call | done |
| POST-4 | P1 | Optimistic-action guards + failure feedback for react/save/share/vote | Post Manager | — | Rapid repeat clicks send one request; a failed request rolls the optimistic state back and shows an inline `role="alert"`; success clears the message | done |
| POST-5 | P1 | Comment submit progress + error feedback; label the comment input | Post Manager | — | Input has an accessible name; a failed submit keeps the draft and shows `role="alert"`; send button is disabled while posting | done |
| POST-6 | P2 | Render the full reposted original (gallery/video/hashtags + rich body) | Post Manager | POST-1 | A repost of a 3-image post shows its grid inside `.feed-repost`; the original's hashtag chips work | done |
| POST-7 | P2 | Broken-image fallback + video accessible name | Post Manager | — | A failed `<img>` swaps to a neutral "Image unavailable" placeholder; each `<video>` has an `aria-label` | done |
| POST-8 | P2 | Make the reaction summary keyboard-focusable with a readable label | Post Manager | — | `.feed-reaction-summary` is a button with `aria-label` = per-type counts and `title` retained | done |
| POST-9 | P2 | Semantic, complete timestamps | Post Manager | — | `AuthorLine` time uses `<time dateTime title="<full date>">` | done |
| POST-10 | P2 | Confirmation feedback for Report | Post Manager | POST-4 | A successful report shows an inline `role="status"` acknowledgement; failures show `role="alert"` | done |
| POST-11 | P3 | Delete own comment (with confirmation) and keep counts consistent | Post Manager | — | Author sees Delete on their comment; confirming removes it and decrements the post's comment count | done |
| POST-15 | P3 | Comment preview: show the first two threads behind a "View all N comments" action | Post Manager | — | Opening comments shows ≤2 threads + a "View all N comments" button; revealing shows the rest; a new comment always appears | done |
| POST-12 | P2 | Comment pagination: server `limit`/`cursor`, client `listCommentsPage`, UI "Load more comments" | Post Manager | — | `GET /v1/posts/:id/comments?limit=&cursor=` returns `{items,nextCursor}` (legacy array without `limit`); opening comments loads one page; "Load more comments" appends the next page | done |
| POST-13 | P3 | Copy post link / permalink | — | **host routing** (`BotifyrApp` has no `location.hash`/`search` handling, so a copied link can't open the post on reload) | A copied link opens the Feed focused on the post | deferred (host dependency) |
| POST-14 | P3 | `@mention` navigation to a profile | — | **host/Feed & Discovery** (no person-profile surface) | Clicking a mention opens the person's profile | deferred (host dependency) |

## Notes

- **Ownership:** the post card, its media rendering and its comments are Post
  Manager–owned (`PostCard`, `CommentRow`, `PostBody`, `AuthorLine`, `Avatar`,
  `MediaLightbox` in `FeedView.tsx`). Global tokens/primitives (`styles.css`
  base tokens, `Icons.tsx`) are Design System–owned — this batch only adds new
  `.feed-*` classes and reuses existing icons.
- **No API contract changes.** Every interaction uses an existing client method.
