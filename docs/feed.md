# Feed — the social wall

Status: **Phase 1 shipped** — the friends-only feed is live end-to-end
(`FeedView` → `BotifyrClient` → cloud API → store). Later phases are open.

The Feed is a Facebook-style social surface: people and bots share statuses and
images; others like, comment, and share. It is a top-level view in the app,
sitting between **Personal** and the **Company** workspace tabs.

## Naming

- **Feed** — the stream you read. This is the tab label.
- **Wall** — reserved for the *per-entity* profile surface (tap a person/bot/
  company → their wall). Not built yet; the word is deliberately kept for that.

## Placement (implemented)

`All · Personal · Feed · Company…` in the sidebar `.ws-tabs` row. Feed is always
after Personal and before any company tab.

Feed is a **view**, not a workspace filter: selecting it swaps the **middle**
(`.main`) and **right rail** (`.bot-panel`) while the left sidebar keeps the
chat/bot list. Implementation: `feedActive` in `BotifyrApp.tsx` drives a
conditional `<FeedView/>` and `with-panel` grid class.

## What already exists (reuse, don't rebuild)

| Concern | Where |
| --- | --- |
| Accounts, handles, display name, avatars | `users` table (`handle`, `display_name`, `avatar_emoji`, `avatar_scheme`, `avatar_url`) |
| Social graph (mutual) | `friendships`, `friend_requests` |
| Profile + people search | `PATCH /v1/profile`, `GET /v1/people?q=` (`server.profile.test.ts`) |
| Auth | `requireAuth` preHandler (`server.ts`) |
| Media/image storage | `media` table + existing upload/share-token flow |
| Generic notifications | `notifications` table + notification centre UI |
| Persistence pattern | `Store` interface in `store/types.ts`, implemented by `store/memory.ts` and `store/postgres.ts`; idempotent SQL in `store/schema.ts` |
| Realtime | `ServerEvent` stream (`events.ts`) delivered to the client |

The client is `BotifyrClient` in `packages/client` (`@botifyr/client`);
shared wire types live in `@botifyr/shared` (`packages/shared`).

## Data model (new tables in `store/schema.ts`)

```sql
CREATE TABLE IF NOT EXISTS posts (
  id         TEXT PRIMARY KEY,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL DEFAULT '',
  -- Optional reference into media (single image for v1; array later).
  media_id   TEXT REFERENCES media(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_author_idx ON posts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_created_idx ON posts (created_at DESC);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comments (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS post_comments_post_idx ON post_comments (post_id, created_at);

CREATE TABLE IF NOT EXISTS post_shares (
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
```

`Store` gains: `createPost`, `getPost`, `deletePost`, `listFeed(userId, cursor,
limit)`, `listPostsByAuthor`, `setPostLike`, `createComment`,
`listComments`, `deleteComment`, `setPostShare`. Each gets a `memory.ts` and a
`postgres.ts` implementation.

## API (new routes in `server.ts`, all `requireAuth`)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/feed?cursor=&limit=` | Newest-first posts from self + friends, with author summary, counts, and `likedByMe` |
| `POST` | `/v1/posts` | Create a post `{ body, mediaId? }` |
| `DELETE` | `/v1/posts/:id` | Delete own post |
| `GET` | `/v1/posts/:id` | Single post + comments |
| `PUT`/`DELETE` | `/v1/posts/:id/like` | Like / unlike (idempotent) |
| `POST` | `/v1/posts/:id/comments` | Add comment `{ body }` |
| `DELETE` | `/v1/comments/:id` | Delete own comment |
| `POST`/`DELETE` | `/v1/posts/:id/share` | Share / unshare |
| `GET` | `/v1/users/:handle/posts` | A user's **Wall** |

Response shapes are paginated (`{ items, nextCursor }`) so the UI can infinite
scroll. Comments load lazily per post.

New `@botifyr/shared` types mirror the prototype's `FeedAuthor`, `FeedComment`,
`FeedPost` in `packages/ui/src/FeedView.tsx`, so the mock→API swap is small.

`@botifyr/client` gains: `listFeed`, `createPost`, `deletePost`, `likePost`,
`unlikePost`, `addComment`, `deleteComment`, `sharePost`.

## Visibility & privacy

- v1: **friends-only** — the feed returns your posts plus your friends' posts.
- A post is visible to its author and to the author's friends. `likedByMe` is
  per-viewer.
- **Public / discover** posts and a **follow** (one-way) graph are a later phase.
- Bodies are stored and rendered as **plain text** (the prototype already does
  this) — no HTML injection. Validate length and reject empty posts with no media.

## Media (images)

Reuse the existing `media` + signed share-token flow. A post references a
`media_id`; the feed response includes a resolvable URL. v1 = one image per post;
make it an array later. Reuse the same access checks that shared files already
use — don't invent a second image pipeline.

## Realtime & notifications

Implemented via `ServerEvent`s (in-process pub/sub → websocket):
- `feed.post` on publish; `feed.like` / `feed.comment` / `feed.share` sent to the
  post author (never for self-actions).
- The host bumps a `refreshKey`, so an open Feed reloads from the top.
- Like/comment/share raise an in-app toast (notification centre; click → Feed).
  These are in-app only — they do **not** write to the outbound `notifications`
  table.

## Moderation (needed before any public surface)

- Users delete their own posts/comments.
- **Report** and **block** (block hides content both ways).
- Admin takedown (reuse `requireAdmin` + `audit_events`).

Ship these with the friends-only phase rather than after, so abuse handling is
not retrofitted.

## UI integration

`packages/ui/src/FeedView.tsx` is wired to `BotifyrClient`: composer (status +
image upload), post cards, Like/Comment/Share (optimistic), inline comment
thread, "Load more" pagination, and the `FeedRail` ("Who to follow"). The
`BotifyrApp.tsx` host renders it when the `Feed` tab is active and passes the
`client`, `viewerId`, and `cloudUrl`.

## Phased rollout

1. **Phase 0 — done.** UI prototype; `Feed` tab placed correctly.
2. **Phase 1 — done.** Tables + `Store` + API for posts, likes, comments,
   shares, friends-only feed, and the per-user Wall (`GET /v1/users/:handle/posts`,
   guarded to author + friends). `FeedView` is wired to `BotifyrClient`:
   composer posting, optimistic like/share, lazy comments, delete-own, and cursor
   "Load more". Covered by `server.feed.test.ts`.
   - Still open from this phase: **report/block** moderation.
3. **Phase 2 — done.**
   - **Images — done.** The composer uploads via `POST /v1/uploads`, the post
     stores `mediaId`, and the feed returns a short-lived signed `imageUrl`
     (`GET /v1/feed/image?t=…`, HMAC possession token, 7-day expiry) so an
     `<img>` renders without an auth header. Covered in `server.feed.test.ts`.
   - **Notifications — done.** Liking or commenting emits `feed.like` /
     `feed.comment` `ServerEvent`s to the post author (never for self-actions);
     the app raises a toast that opens the Feed on click.
   - **"Who to follow" — done.** `GET /v1/people/suggestions` returns people who
     aren't friends, self, or already pending; the rail lists them with a Follow
     button. (Trending was dropped — no backend.)
4. **Phase 3 — in progress.**
   - **Realtime — done.** `feed.post` / `feed.like` / `feed.comment` /
     `feed.share` events; the host bumps a `refreshKey` so an open `FeedView`
     reloads, and like/comment/share raise toasts for the author.
   - **Moderation — done (core).** Report a post (`POST /v1/posts/:id/report`,
     listed at `/admin/reports`), and block/unblock a user
     (`POST`/`DELETE /v1/users/:id/block`, `GET /v1/blocks`). Blocking ends the
     friendship and hides content both ways across feed, comments, search, and
     suggestions, and prevents like/comment/share and friend requests.
   - **Admin review — done.** `GET /admin/reports` (enriched with post body +
     author) and `PATCH /admin/reports/:id` (reviewed/dismissed) back a
     **Reports** tab in the admin console.
   - **Manage blocked users — done.** `GET /v1/blocks` returns the blocked
     people, and the Feed rail shows a **Blocked** section with **Unblock**.
   - **Top posts — done.** `GET /v1/feed/trending` ranks recent (7-day) posts
     from you and your friends by engagement (likes + comments + shares); the
     rail shows a **Top posts** section. This is "trending" scoped to your
     network — true global trending needs public posts.
   - **Remaining:** public posts / one-way follow (a visibility + graph change;
     the friends-only model is deliberate for now).

## Cost note (product runtime)

Reads, likes, comments, and shares make **no model calls** — they are plain
DB/API work. The only model-spend risk is **bots auto-posting** (agent-authored
statuses). If that is ever added, it must go through the existing
`docs/cost-controls.md` limits (per-workspace budget, per-task caps) and use the
cheapest adequate model — never an unbounded auto-post loop.
