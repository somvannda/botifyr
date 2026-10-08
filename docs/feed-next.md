# Feed — next improvements (Facebook-parity requirements)

Reference model: **Facebook Feed** (the ranked stream) and **Facebook Pages**
(public entities distinct from personal Profiles). This document compares those to
what Botifyr ships today and specifies the next improvements in detail.

- **Shipped today:** friends-only Feed (see [`docs/feed.md`](feed.md)) — posts with
  a single image, post reactions, comments, shares, a per-user Wall, notifications,
  "Who to follow", realtime, report/block, admin review, Top posts.
- **Pages:** backend (tables, `Store`, `/v1/pages*`, post-as-Page,
  followed-Pages-in-feed) and UI (timeline, follow, composer "Post as",
  "Your Pages" rail, settings, roles) are **done**; only insights / community
  inbox / discovery / scheduling remain. See *Implementation status* below.
- **This document:** what to build next, with requirements, data model, API, UI,
  priorities, and phases.

Priority legend: **P0** = next release · **P1** = soon after · **P2** = later.

### Implementation status

**Pages**

- **Backend — done.** Tables (`pages`, `page_roles`, `page_followers`,
  `posts.page_id`), `Store` methods, API (`/v1/pages…`), post-as-Page, and
  followed-Pages-in-feed are implemented and covered by `server.pages.test.ts`.
  A Page maps to a company workspace / bot / user (FR-14 default).
- **UI — done.** In `packages/ui/src/FeedView.tsx`: `PageView` (page timeline,
  cover/avatar/follower count, Follow/Unfollow, manager role badge), the composer
  **"Post as"** switcher (You / managed Pages) with an inline **New Page**
  creator, a **"Your Pages"** rail section linking to each timeline, a **View
  page** action on page-authored posts, and a **Page settings** panel (edit
  identity) with **role management** (assign Editor/Moderator/Analyst, remove).
  **Remaining:** Page **insights** and **community-inbox** screens, a "Pages to
  follow" discovery surface, and scheduled/pinned posts.

**Reactions (FR-1) — done.** Likes are now a full reaction set
(`like/love/care/haha/wow/sad/angry`): `post_reactions` table +
`setPostReaction`, `PUT`/`DELETE /v1/posts/:id/reaction`, `reactions` +
`myReaction` on the feed DTO, and a reaction picker in the post UI.

**Comment threads (FR-2) — done.** One level of replies: a
`post_comments.parent_id` column, `parentId` on `POST /v1/posts/:id/comments`,
`BotifyrClient.addComment(id, body, parentId?)`, and a reply UI (a **Reply**
button per comment, a "Replying to a comment" indicator, and nested rendering).

**Everything else** in this document (comment reactions, reposts, multi-image,
audience, ranking, stories, groups, …) is **not started**.

> **Reconciled with the product as of Oct 2026.** Facebook's reference section
> (§1) reflects its 2026 behaviour; §2 and §5 note where Botifyr has already moved
> toward the target.

## Positioning note (why friends-first is a feature, not a gap)

Facebook's 2026 Feed is roughly **50/50 connected vs. recommended** content, driven
by AI ranking — and Meta had to *reintroduce* a dedicated **Friends tab** (2025)
made entirely of friends' posts, with no recommendations, in response to user
demand. Botifyr's deliberate **friends-only, chronological default** is therefore a
distinctive, defensible stance rather than a missing feature: ship ranking and
discovery as **opt-in additions** (tabs/toggles) and keep the friends stream pure.

---

## 1. How Facebook does it (reference)

### 1.1 Facebook Feed (the stream)
- **AI-ranked, not chronological:** a multi-stage recommender — *inventory →
  signals → predictions → relevance score* — scores thousands of candidates and
  orders the top ~500. Users can still switch to "Most recent".
- **Connected vs. recommended:** roughly **50/50** between content from friends /
  followed Pages and **recommended** content from accounts you don't follow.
- **Content-type diversity:** explicit rules prevent streaks (e.g. no two videos in
  a row) and keep the mix varied.
- **Primary 2026 signals:** **dwell time** dominates; also meaningful social
  interactions, **long-form / threaded comments** (10+ words), and **video
  completion (~60s)**. Groups and Reels get a distribution boost.
- **Retrieval changes (2026):** "SilverTorch" retrieval overhaul and "Friend
  Bubbles" (close-friend Reels).
- **Friends tab (2025):** a separate, pin-able tab that shows a feed made *entirely*
  of friends' content — stories, reels, posts, birthdays — with **no recommended
  content**. Direct analogue for Botifyr's friends-only default.
- **Feed tabs/filters:** Home, Friends, Favorites, Groups, Pages, Most recent.
- **Post types:** text status, photo(s), album, video, reel, live, link preview,
  life event, check-in, poll, question, fundraiser, shared/reposted.
- **Reactions (not just Like):** Like, Love, Care, Haha, Wow, Sad, Angry — on posts
  and comments.
- **Comments:** threaded replies, reactions on comments, GIF/sticker/photo replies,
  ranked (Most relevant / Newest), author moderation (hide, delete, block). The
  Dec-2025 redesign streamlined replies, surfaced badges, and added comment pinning.
- **Share:** share now, share to timeline, to a group, to a Page, in a message, with
  a caption; track share counts.
- **Post controls:** Save, Hide post, Snooze (30 days), Unfollow, See fewer like
  this, Report.
- **Feed controls:** Follow/Unfollow, Favorites, Pause following, "Why am I seeing
  this?".
- **Stories:** 24-hour ephemeral photo/text/video above the feed, with reactions
  and replies.
- **Mentions & tags:** `@user`, `@Page`, `#hashtag`, tag friends/brands, location.
- **Audience:** Public, Friends, Friends except…, Specific friends, Only me, Custom.
  The Dec-2025 redesign made **audience and cross-posting settings more prominent**
  in the composer and promoted a standardized photo grid with double-tap-to-like.
- **Notifications:** push, email, in-app; per-item controls.

### 1.2 Profiles vs Pages (2026)
- **Profile** = a person; friendship is mutual; audience defaults to Friends. A
  profile can also switch on **Professional Mode**: public followers join your
  existing friends in **one feed** (no separate Page needed), unlocking insights and
  monetization while keeping the friends-and-family experience.
- **Page** = a brand/public figure/organization; **anyone can Follow** (one-way);
  it has its **own separate feed**, distinct from any personal profile. As of
  2026 every Page is assigned a **type — Business or Creator** — switchable once
  per 7 days; the type tunes tools and distribution expectations.
- **Page management** is by **roles**:
  - Admin (full), Editor (content), Moderator (comments/community), Advertiser,
    Analyst (insights only).
- **Page surfaces:** username (`@page`), category, About, cover photo, CTA button,
  tabs (Home, About, Photos, Videos, Reviews, Events, Shop, Community).
- **Page timeline:** posts by the Page; visitors can post/review to the Page.
  (Meta renamed "Wall" to **Timeline** years ago; the Wall term is legacy.)
- **Content tools:** schedule posts, pin a post, feature/spotlight, crosspost,
  drafts, post as Page vs profile. The Professional Dashboard can compare posts and
  track creator activity.
- **Community:** Page Inbox (messages + comments), saved replies, auto-replies,
  moderation filters.
- **Insights:** reach, engagement, followers growth, top posts, demographics.
- **Verification:** verified badge; page quality/transparency; support/inbox.
- **Follow vs Like:** historically Like = follow; now explicit Follow button +
  follower count.
- **Follow limits:** profiles cap at 5,000 friends and 5,000 follows; followers and
  Page followers are unlimited.

---

## 2. Gap analysis (Botifyr today → target)

| Area | Facebook | Botifyr today | Gap |
| --- | --- | --- | --- |
| Feed ordering | Ranked + Most recent | Newest-first only | Add ranking + toggle |
| Feed tabs | Home / Friends / Pages / … | Single stream | Add tabs/filters |
| Reactions | 7 reactions | **Post reactions shipped** | Comment reactions |
| Comments | Threads, reactions, media | **Threads shipped** | Comment reactions + comment media |
| Share | Multiple destinations + caption | Toggle count only | Real reposts |
| Media | Multi-image, albums, video | 1 image | Multi-image + video |
| Public entities | Pages (followers, roles, insights) | **Backend + UI shipped** — `/v1/pages*`, timeline, follow, post-as-Page, settings, roles | Page insights + community inbox (see §4) |
| Page type | Business vs Creator | None | Page type field (P1) |
| Follow graph | One-way follow | Mutual friends only | Follow model |
| Audience | Public/Friends/Only me/Custom | Friends-only | Audience selector + public |
| Mentions/tags | @, #, location | None | Mentions, hashtags, location |
| Stories | 24h ephemeral | None | Stories |
| Groups | Groups | None (companies exist) | Groups (maybe later) |
| Save/hide/snooze | Yes | No | Post controls |
| Insights | Yes | No | Page/post insights |
| Scheduling/pin | Yes | No | Page content tools |

**Key Botifyr mapping:** a Facebook **Page** should map to an existing **Company
workspace** (and optionally a **Bot**) — so "Pages" are not a brand-new concept but
the public face of companies/bots the user already has. Facebook **Professional
Mode on a profile** maps neatly to a Botifyr user who wants a public, followable
presence *without* creating a workspace/Page: allow one-way follow on top of
friendship and surface a public audience option — no separate entity required.

---

## 3. Functional requirements — Feed

### FR-1 Reactions (P0) — **shipped**
- Support a reaction set: `like`, `love`, `care`, `haha`, `wow`, `sad`, `angry`.
- One reaction per user per post/comment; tapping the current reaction removes it;
  a different reaction replaces it.
- Show a reaction breakdown (counts per type) and the viewer's reaction.
- Acceptance: reacting updates optimistically; counts persist; feed shows the
  viewer's own reaction; only one reaction at a time.

### FR-2 Comment threads (P0) — **shipped**
- Comments may have a `parentId` forming one level of replies (Facebook-style).
- Show top-level comments with reply count; expand to load replies.
- Acceptance: reply nests under its parent; deleting a comment hides its replies
  or marks them "deleted"; counts update.

### FR-3 Comment reactions + media (P1)
- Reactions on comments (same set as FR-1).
- Optional image attachment on comments.
- Acceptance: reaction counts render; image renders via the same signed-URL
  mechanism as posts.

### FR-4 Real sharing / reposts (P0)
- Share creates a `repost` record (optionally with a caption) that appears on the
  sharer's timeline/Wall and in followers' feeds.
- Share destinations (P1): own timeline, a Page (if the sharer manages one), a
  Group (P2), a DM (existing conversation).
- Acceptance: a repost links back to the original; share count increments; deleting
  a repost removes it without deleting the original.

### FR-5 Multi-image & albums (P0)
- A post can attach **up to N images** (start with 4; grid 2×2; 1–3 layouts).
- Optional named **album** grouping (P1).
- Acceptance: grid renders; per-image signed URLs; deletes cascade to media.

### FR-6 Video (P1)
- Attach a video (mp4/webm) with a poster frame; inline playback; store via media.
- Live video / reels: **P2 / non-goal for now**.

### FR-7 Audience selector (P0)
- Per-post audience: `public`, `friends`, `only_me`, and `custom` (P1: include/
  exclude lists).
- Default from the author's preference; remember last choice.
- Acceptance: `only_me` is visible only to the author; `public` is visible to
  anyone (with public feeds enabled); `friends` as today.

### FR-8 Feed ranking + "Most recent" toggle (P1)
- Rank by affinity × engagement × recency (see §6). Provide a "Most recent" toggle.
- Acceptance: changing the toggle changes ordering; ranking is deterministic given
  a fixture; blocked/muted authors never appear.

### FR-9 Feed tabs / filters (P1)
- Tabs: Home, Friends, Pages, Most recent (add Groups at P2).
- **Friends tab is pure:** like Facebook's 2025 Friends tab, it shows *only* content
  from friends — no recommended/suggested posts. This preserves Botifyr's
  friends-first stance while Home may rank and mix.
- Acceptance: each tab filters the stream; state persists per session; the Friends
  tab never surfaces non-friend content.

### FR-10 Post controls: Save / Hide / Snooze / Unfollow (P0 for Hide+Save)
- **Save** to a private collection; **Hide post** (remove + "see fewer like this");
  **Snooze** an author for 30 days (P1); **Unfollow** an author (P1).
- Acceptance: hidden/ snoozed authors are filtered server-side; saved posts appear
  in a "Saved" list.

### FR-11 Mentions, hashtags, location (P1)
- `@handle` and `@page` mentions resolve to entities; `#hashtag` becomes a link;
  optional location string.
- Acceptance: mentions notify the mentioned user/Page; hashtag pages list posts.

### FR-12 Polls (P2)
- A post may include a poll (2–4 options, optional end time, one vote each).
- Acceptance: vote once; results shown after voting or when closed.

### FR-13 Stories (P2)
- 24-hour ephemeral photo/text/video shown in a strip above the feed; viewers can
  react and reply (reply opens a DM).
- Acceptance: stories expire after 24h; a story ring shows unseen/seen state.

---

## 4. Functional requirements — Pages

### FR-14 Page as a public entity (P0)
- A **Page** is created from a **Company workspace** (or Bot) and has: `id`,
  `handle` (unique), `name`, `category`, `about`, `avatar`, `cover`, `cta`,
  `verified?`, `createdAt`.
- Pages have **Followers** (one-way), separate from the owner's friends.
- Acceptance: creating a Page from a workspace sets a unique handle; visitors can
  Follow/Unfollow; follower count is shown.

### FR-15 Page roles & permissions (P0)
- Roles: `admin`, `editor`, `moderator`, `analyst` (skip advertiser for now).
  - admin: everything incl. roles/settings.
  - editor: create/edit/delete posts, schedule.
  - moderator: comment/community moderation, hide/delete comments.
  - analyst: read-only insights.
- Derived from existing workspace roles where possible; explicit Page roles override.
- Acceptance: an editor cannot manage roles; an analyst can only view insights.

### FR-16 Page timeline & Wall (P0)
- A Page has a public timeline of its posts; the Wall endpoint generalizes to
  `GET /v1/pages/:handle/posts`.
- Acceptance: anyone can view a Page's public posts; audience rules still apply.

### FR-17 Post as a Page (P0)
- A user who manages a Page can post **as the Page** (author = Page) from the
  composer (entity switcher: profile vs each managed Page).
- Acceptance: the post is attributed to the Page; appears on the Page timeline and
  in followers' feeds; role permissions enforced.

### FR-18 Follow model (P0)
- `follow(Page)` / `unfollow(Page)`; followers' Home feed includes Pages they follow.
- Acceptance: following a Page adds its posts to the follower's feed; unfollow
  removes them.

### FR-19 Page content tools (P1)
- Schedule a post (P1), pin a post, feature/spotlight, save draft, crosspost
  (Page → personal) (P1/P2).
- Acceptance: a scheduled post publishes at its time (scheduler ticker exists in
  cloud); pinned post appears first on the Page timeline.

### FR-20 Page insights (P1)
- Reach, engagement (reactions/comments/shares), follower growth, top posts, per
  time window.
- Acceptance: insights render from stored counters; exportable (P2).

### FR-21 Page settings & discovery (P1)
- Category, About, CTA button, contact; searchable by name/handle; suggested
  Pages ("Who to follow" includes Pages).
- Acceptance: Pages appear in search and suggestions; blocked Pages excluded.

### FR-22 Community inbox & comment moderation on Pages (P1)
- Page owners see comments needing review; hide/delete/block users; keyword filters.
- Acceptance: moderators can hide a comment on a Page post; hidden comments are
  not shown to the public.

### FR-23 Page type — Business vs Creator (P1)
- Each Page has a `type` (`business` | `creator`), defaulting by heuristic (a Page
  linked to a workspace/bot ⇒ business; otherwise creator). Owners may switch, but
  **at most once every 7 days**.
- Acceptance: the type is stored and shown in Page settings; switching is rate
  limited; insights/tools can key off the type.

### FR-24 Professional Mode on profiles (P2)
- A user can opt in to a **public, followable** profile without creating a Page:
  anyone may follow; posts may target a `public` audience; followers see the user's
  public posts in their Home feed.
- This is the profile analogue of FR-18 (follow a Page) — the same follow graph,
  different subject kind.
- Acceptance: enabling pro mode does not change existing friendships; public posts
  are visible to non-friend followers; disabling it returns audience defaults to
  friends and drops non-friend followers (mirroring Meta's behaviour).
- **Privacy gate:** requires the public-audience enforcement in §9 to be live first.

---

## 5. Data model additions (`store/schema.ts`)

> **Already shipped:** `pages`, `page_roles`, and `page_followers` (plus
> `posts.page_id`) exist in `schema.ts`, with the matching `Store` interface and
> both `memory.ts` / `postgres.ts` implementations. The SQL below is repeated for
> reference; the only **new** Pages change is the `type` column (FR-23).

```sql
-- Public entities (ALREADY SHIPPED — shown for reference)
CREATE TABLE IF NOT EXISTS pages (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT,                       -- optional link to a company workspace
  bot_id      TEXT,                        -- optional: a bot page
  handle      TEXT NOT NULL,
  name        TEXT NOT NULL,
  category    TEXT,
  about       TEXT,
  avatar_url  TEXT,
  cover_url   TEXT,
  cta         TEXT,
  verified    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pages_handle_idx ON pages (lower(handle));

-- FR-23: Business (default) vs Creator.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'business';
ALTER TABLE pages ADD COLUMN IF NOT EXISTS type_changed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS page_roles (
  page_id  TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role     TEXT NOT NULL,                  -- admin | editor | moderator | analyst
  PRIMARY KEY (page_id, user_id)
);

CREATE TABLE IF NOT EXISTS page_followers (
  page_id    TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, user_id)
);

-- Posts gain an optional Page author + audience
ALTER TABLE posts ADD COLUMN IF NOT EXISTS page_id  TEXT REFERENCES pages(id) ON DELETE CASCADE;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'friends'; -- public|friends|only_me|custom
ALTER TABLE posts ADD COLUMN IF NOT EXISTS repost_of TEXT REFERENCES posts(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hashtags  TEXT[];

-- Multi-media + video on posts
CREATE TABLE IF NOT EXISTS post_media (
  post_id  TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, media_id)
);

-- Pluggable reactions (replace the single "like")
CREATE TABLE IF NOT EXISTS post_reactions (
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction   TEXT NOT NULL,                -- like|love|care|haha|wow|sad|angry
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS comment_reactions (
  comment_id TEXT NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction   TEXT NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);

-- Comment threads
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES post_comments(id) ON DELETE CASCADE;
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS media_id  TEXT;

-- Mentions / tags
CREATE TABLE IF NOT EXISTS post_mentions (
  post_id  TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,                  -- user | page
  ref_id   TEXT NOT NULL,
  PRIMARY KEY (post_id, kind, ref_id)
);

-- Post controls
CREATE TABLE IF NOT EXISTS post_saves (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS post_hides (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS author_mutes (   -- snooze / unfollow
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,                  -- user or page id
  until     TIMESTAMPTZ,                    -- null = unfollow (indefinite)
  PRIMARY KEY (user_id, author_id)
);

-- (P2) polls and stories
CREATE TABLE IF NOT EXISTS post_polls (post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE, closes_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS poll_options (id TEXT PRIMARY KEY, post_id TEXT REFERENCES post_polls(post_id) ON DELETE CASCADE, label TEXT, position INTEGER);
CREATE TABLE IF NOT EXISTS poll_votes (option_id TEXT, user_id TEXT, PRIMARY KEY (option_id, user_id));
CREATE TABLE IF NOT EXISTS stories (id TEXT PRIMARY KEY, author_id TEXT, page_id TEXT, media_id TEXT, caption TEXT, created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ);
```

Backfill: migrate existing `post_likes` → `post_reactions(reaction='like')` and
existing single `posts.media_id` → `post_media`.

---

## 6. API additions

> The `/v1/pages*` routes below are **already implemented** (see
> `server.pages.test.ts`) and are listed for reference; new work is the **Pages UI**.
> The remaining rows (reactions, threads, reposts, saves/hides, ranking, …) are
> still to build.

| Method | Path | Purpose | Pri |
| --- | --- | --- | --- |
| `PUT`/`DELETE` | `/v1/posts/:id/reaction` | Set/clear a reaction (`?reaction=love`) | P0 |
| `GET`/`POST` | `/v1/posts/:id/comments/:cid/replies` | Comment threads | P0 |
| `PUT`/`DELETE` | `/v1/comments/:id/reaction` | Comment reactions | P1 |
| `POST` | `/v1/posts/:id/repost` | Share with optional caption + destination | P0 |
| `POST`/`DELETE` | `/v1/posts/:id/save` | Save/unsave | P0 |
| `POST`/`DELETE` | `/v1/posts/:id/hide` | Hide / unhide | P0 |
| `POST`/`DELETE` | `/v1/authors/:id/mute` | Snooze / unfollow | P1 |
| `POST`/`PATCH` | `/v1/pages` `/v1/pages/:id` | Create/edit a Page | P0 |
| `PATCH` | `/v1/pages/:id/type` | Switch Business/Creator (≥7 days apart) | P1 |
| `GET` | `/v1/pages/:handle` | Page profile | P0 |
| `GET` | `/v1/pages/:handle/posts` | Page timeline | P0 |
| `POST`/`DELETE` | `/v1/pages/:id/follow` | Follow/unfollow | P0 |
| `GET`/`PUT` | `/v1/pages/:id/roles` | List/set Page roles | P0 |
| `POST` | `/v1/posts` (extend) | `pageId`, `audience`, `mediaIds[]`, `mentions[]`, `hashtags[]` | P0 |
| `GET` | `/v1/feed?tab=&sort=` | Tabs + ranking toggle | P1 |
| `GET` | `/v1/pages/:id/insights` | Insights | P1 |
| `GET` | `/v1/search?q=&type=people\|pages\|posts` | Unified search | P1 |
| `POST` | `/v1/stories`, `GET /v1/stories` | Stories (P2) | P2 |

Events to emit: `feed.reaction`, `feed.repost`, `page.post`, `page.followed`,
`comment.reply`.

---

## 7. UI changes

### 7.1 Composer
- Entity switcher: post **as** Me or a managed Page — **shipped** (composer
  "Post as" select + inline "New Page" creator).
- **Audience selector** (Public / Friends / Only me / Custom).
- **Attach:** photo(s) up to N (grid preview), video (P1), poll (P2), location,
  feeling/activity, tag people/Page.
- Character counter; drafts (P1).

### 7.2 Feed stream & rail
- Post card: reaction picker (hover/tap), reaction summary, Save/Hide/… menu,
  threaded comments with reactions, repost card with "X shared Y's post".
- **Feed tabs**: Home · Friends · Pages · Most recent.
- Rail: **Pages to follow**, keep Who to follow / Top posts / Blocked.

### 7.3 Page experience
- **Page timeline** (public), cover + avatar + follower count + Follow button, and a
  **View page** action — **shipped** (`PageView`). Remaining: CTA-button rendering.
- **Page management** (admins): **settings** and **roles** rails are shipped;
  scheduled/pinned posts, insights, and community inbox — **not started**.

### 7.4 Post/author menus
- Save, Hide, Snooze 30 days, Unfollow, Report, Block, "Why am I seeing this?".

All UI lives in `packages/ui` (one UI, two hosts — see `AGENTS.md`); Pages reuse
the existing `.main` + `.bot-panel` layout pattern.

---

## 8. Ranking (FR-8) — initial scoring

```
score = w_affinity * affinity(viewer, author)
      + w_engagement * normalized(engagement(post))
      + w_recency * exp(-ageHours / halfLifeHours)
      - penalties   # seen, hidden, muted, reported
```
- `affinity` from interactions (likes/comments/shares/msgs/DMs) between viewer and
  author/Page; `engagement` = reactions + comments + shares; seen/hide/mute are
  penalties. Start simple; make weights configurable in `platform_settings`.
- Deterministic for tests; never surfaces blocked/muted authors.

---

## 9. Privacy, safety, moderation (extend §Moderation in `feed.md`)

- Audience is enforced **server-side on every read** (feed, Wall, Page, search,
  comments), never only in the UI.
- Public content raises the bar: rate limits, spam heuristics, report categories,
  appeal path, and admin takedown (reuse `post_reports` + `audit_events`).
- Page roles gate all management actions; log admin/editor actions to audit.
- Minors/age and data-export are out of scope until a compliance review.

---

## 10. Phasing

- **Phase A (P0) — Post depth (partly done):** reactions (**done**), comment
  threads (**done**), real reposts, multi-image, audience selector, Save/Hide.
  *Note: the Pages backend/UI also ship; remaining Pages work is insights +
  community inbox (P1).*
- **Phase B (P1) — Discovery & community:** feed ranking + tabs (incl. a pure
  Friends tab), video, mentions/hashtags, Page **type (Business/Creator)**,
  scheduling/pin/insights, community inbox, search, comment reactions,
  snooze/unfollow.
- **Phase C (P2) — Rich & ephemeral:** polls, stories, groups, live/reels,
  **Professional Mode on profiles**, Page analytics export, crossposting.

---

## 11. Non-goals (for now)

- Ad system / boosting / Meta Ads parity.
- Marketplace, Fundraisers, Events, Shops, Dating, Gaming.
- End-to-end encryption for Feed (DMs already have it separately).
- Full ML ranking pipeline — start with a simple, configurable score.

---

## 12. Cost & risk notes (see `AGENTS.md`)

- Feed reads/writes/reactions remain **model-free**; ranking is local math.
- Any **bot auto-posting** to a Page must use the cheapest adequate model and obey
  `docs/cost-controls.md` (per-workspace budget, per-task caps). Never an
  unbounded auto-post loop.
- Biggest risks: **privacy** (public audience leaks), **spam/abuse** on public
  surfaces, and **scope creep** (Pages + ranking + media is a lot). Ship P0 first
  and keep public posting opt-in.
