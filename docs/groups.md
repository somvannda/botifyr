# Groups

Groups are communities with their own post stream. They reuse the existing Feed
post model (`PostRecord` + the `PostCard` experience: reactions, comments,
shares, media, polls) rather than duplicating social interactions.

## Data model

- `groups` — one row per group. `owner_id` is the creator; `privacy`
  (`public` | `private`), `category`, `cover_url`, `avatar_url`, `avatar_emoji`,
  `about`.
- `group_members` — `(group_id, user_id, role)` where role is
  `admin` | `moderator` | `member`. The owner is stored as a member too and is
  always treated as an admin.
- `group_join_requests` — `(group_id, user_id, status, created_at, updated_at)`
  with status `pending` | `approved` | `rejected`. Only private groups create
  requests.
- `posts.group_id` — links a post to a group. Posts stay ordinary posts, so all
  existing feed features (reactions, comments, media, reports, blocks) work
  unchanged.

Migrations are additive and idempotent (`store/schema.ts`), applied on startup.

## Roles and permissions

| Action | Owner | Admin | Moderator | Member | Visitor |
| --- | :-: | :-: | :-: | :-: | :-: |
| View public stream | ✓ | ✓ | ✓ | ✓ | ✓ |
| View private stream | ✓ | ✓ | ✓ | ✓ | — |
| Post in group | ✓ | ✓ | ✓ | ✓ | — |
| React / comment / share | ✓ | ✓ | ✓ | ✓ | — |
| Delete any group post | ✓ | ✓ | ✓ | — | — |
| Edit group settings | ✓ | ✓ | — | — | — |
| Manage members / roles | ✓ | ✓ | — | — | — |
| Approve / reject requests | ✓ | ✓ | — | — | — |
| Delete group | ✓ | — | — | — | — |

Moderators manage content; administrators manage membership. Authorization is
enforced server-side on every route, not just in the UI.

## Privacy

- **Public** — appears in discovery; anyone may join immediately.
- **Private** — hidden from discovery; joining creates a pending request that an
  owner/admin must approve. The stream and member list return `403` for
  non-members.

## API (all under `/v1`, authenticated)

- `GET /v1/groups` — groups the viewer belongs to (joined ∪ owned).
- `GET /v1/groups/managed` — groups the viewer owns.
- `GET /v1/groups/discover?q=&category=&limit=&offset=` — public-group discovery.
- `GET /v1/groups/categories` — distinct public categories.
- `POST /v1/groups` — create (`name`, `handle?`, `about?`, `category?`,
  `privacy?`, `avatarEmoji?`, `avatarUrl?`, `coverUrl?`).
- `GET /v1/groups/:handle` — group detail for the viewer.
- `PATCH /v1/groups/:id` — edit (owner/admin).
- `DELETE /v1/groups/:id` — delete (owner).
- `GET /v1/groups/:handle/posts` — group stream (private ⇒ members only).
- `POST /v1/groups/:id/join` — join (public) or request (private).
- `DELETE /v1/groups/:id/join` — leave or withdraw a request.
- `GET /v1/groups/:id/members` — members with roles/profiles.
- `PUT /v1/groups/:id/members/:userId` — set role (owner/admin).
- `DELETE /v1/groups/:id/members/:userId` — remove member / leave.
- `GET /v1/groups/:id/requests` — pending requests (owner/admin).
- `POST /v1/groups/:id/requests/:userId` — `{ action: "approve" | "reject" }`.
- `POST /v1/groups/:id/invite` — add a user directly (owner/admin).

## Realtime

Over the websocket stream (see `packages/shared` `ServerEvent`):

- `group.request` → group admins: someone asked to join.
- `group.joined` → the requester: approved, or added by an admin.

## UI

All shared UI lives in `packages/ui` (never in the desktop/portal hosts):

- Groups landing (`GroupsView`) — Discover (search + category filter), Your
  groups, Managed by you, and a create form with cover/profile image pickers.
- Group detail (`GroupView`) — cover, avatar, privacy badge, membership action,
  and tabs for Discussion, Members, About and Photos.
- Discussion reuses `PostCard` and a composer; Photos aggregates post media.
- Members tab hosts role management, member removal and join-request approvals
  (owner/admin), with confirmation dialogs for destructive actions.
- `FeedRail` "Your Groups" reloads when the host bumps `feedRefresh`, which the
  group views trigger via `onChanged` after mutations.

## Limitations

- Profile/cover images are stored as small data URLs on the group record (max
  3 MB / 4 MB client-side). This matches the existing profile-avatar pattern but
  inflates the row; a media-backed flow would be lighter.
- Invitations are API-only (`POST .../invite`); there is no "invite a person"
  picker in the UI yet.
- Group notifications surface as in-app toasts via the realtime stream; there is
  no dedicated group notification list.
- Post moderation is deletion of a group post by a moderator/admin. There is no
  group-level report queue (reports still flow through the global admin console).
- Discovery is paginated via `limit`/`offset`; the landing page loads the first
  page only.
- Automated coverage: cloud route tests (`server.groups.test.ts`) cover create,
  discovery, privacy, join requests and roles. There is no dedicated browser e2e
  for the Groups surfaces yet.
