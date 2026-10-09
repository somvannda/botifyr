# Pages — Implementation Plan

> Owner: **Pages Manager** · Workstream: Feed Experience · Last updated: **Oct 2026**.
> Companion documents: [`pages-competitive-research.md`](pages-competitive-research.md),
> [`pages-ux-audit.md`](pages-ux-audit.md), [`feed-next.md`](feed-next.md) §4.
> Progress: [`agent-progress/pages-manager.md`](agent-progress/pages-manager.md).

## A. Page header

Keep the shipped composition (cover over an overlapping avatar, identity block,
action column) and fix the identity/resilience gaps:

- **Cover** — `page.coverUrl` if present, else the gradient placeholder. Fixed
  140px height avoids layout shift; add `decoding="async"`.
- **Avatar** — use `page.avatarUrl` via the shared `Avatar` (`resolveAvatar`),
  falling back to `avatarEmoji`/initial. This matches posts (FEED-6).
- **Name** — render as an `<h1 class="page-name">` (was a `<div>`), with the
  verified marker kept as a text suffix (no badge design exists yet).
- **Sub-line** — `@handle · category · N followers` (ellipsis, no wrap).
- **Description** — `page.about` if present.
- **CTA** — a real `<a target="_blank" rel="noreferrer">` whose `href` is
  `pages.cta_url` (falling back to a `cta` that is itself a URL) and whose label
  is the owner's `cta` text. With no destination it renders a non-interactive
  badge (no dead button). **Shipped** (`cta_url` schema/API/UI).
- **Follow** — pill button; pending/disabled while in flight, `aria-busy`.
- **Owner controls** — `role` ∈ {admin, editor} get Pin / Community / Insights /
  Settings; keep them out of the visitor header.
- **Responsive** — on narrow widths the action row wraps below the identity
  block instead of squeezing it.

## B. Page navigation

A **four-tab** model, using only data/endpoints that exist:

| Tab | Backing data | Notes |
| --- | --- | --- |
| **Posts** | `GET /v1/pages/:handle/posts?cursor=&limit=` | Reuses the shared `PostCard`; "Load more". |
| **About** | `page.about`, `category`, `followers`, `cta`, `createdAt` | Always available. |
| **Photos** | `GET /v1/pages/:handle/media` | Grid + shared lightbox; lazy-loaded. |
| **Videos** | `GET /v1/pages/:handle/media?kind=video` | Native `<video controls>`; lazy-loaded. |

Tabs are `<button role="tab">` with a visible active state, keyboard focus, and
no tab for an unsupported section. Reels/Stories/Reviews are still **not** shown
(no Page-scoped read endpoints).

## C. Page feed

- Reuse `PostCard` unchanged (owned by the Post Manager). `PageView` only maps
  the list, handles delete-visibility, pin labels, and block removal.
- Respect the server's ordering: pinned first (first page only), then newest,
  keyset-paged by `(createdAt, id)`; dedupe on append.
- Empty state is explained per viewer (§D below).
- **Load more** appends the next cursor page; "You're all caught up" at the end.

## D. Follow / engagement

- One action, distinct semantics: **Follow / Following** (`POST`/`DELETE
  /v1/pages/:id/follow`). "Like" is not used for Pages.
- Guard against double-submit with an in-flight flag.
- Update the button/count from the **confirmed** response; on error, revert and
  show an inline message with `role="alert"`.

## E. About & contact

`about`, `category`, follower count, CTA (when it points somewhere), and the
Page's created date. **No** website/contact/hours (no schema). Privacy: these
fields are already public in `pageDto`; we do not expose `ownerId`, `workspaceId`,
or `botId` in the UI.

## F. Owner experience

Existing entry points stay: **Settings** (name/handle/category/about/avatar
emoji/CTA), **Roles**, **Community** (comment moderation), **Insights** (+ CSV),
**Pin**. This workstream only reorganises their placement and keeps them behind
`canManage`, plus an owner-aware empty state. No new admin operations.

## G. Accessibility

- `<h1>` Page name; `<button>` for tabs with `aria-pressed`; `aria-busy` on the
  follow button; `role="alert"` for errors.
- Visible focus via the shared `:focus-visible` ring.
- Avatar/cover: cover decorative (`alt=""`), avatar carries the Page name.

## H. Performance & reliability

- Cover `decoding="async"`; avatars already `loading="lazy"` in `Avatar`.
- Single combined load (`getPage` + `listPagePosts`) on mount; Retry re-runs the
  same load, no duplicate requests while one is in flight.
- No new caching layer.

## I. Dependencies & coordination

| Dependency | Owner | Status |
| --- | --- | --- |
| Shared `PostCard` interface (props unchanged) | Post Manager | Reused as-is |
| `.page-*` styles + tokens | Design System Manager | Additive classes only |
| `cta_url` schema field | Cloud | **Shipped** (schema + API + UI + tests) |
| Page-scoped media endpoint | Cloud | **Shipped** (`GET /v1/pages/:handle/media`) |
| Timeline cursor pagination | Cloud | **Shipped** (`?cursor=&limit=`) |
| URL routing for Pages | Feed Experience Lead | **Shipped** (`#/pages/:handle`) |
| Page navigation/E2E regression tests | Feed QA & E2E Manager | Tests added here; extend if desired |

## J. Test plan

- **Component (`FeedView.dom.test.tsx`):** identity render, avatar photo,
  missing metadata fallbacks, About tab navigation + active state, CTA link vs
  badge, visitor empty state, error + Retry, follow pending/confirm, owner vs
  visitor controls. **8 tests, passing.**
- **Backend (`server.pages.test.ts`):** post-as-Page behaviour + a schema guard
  that `posts.author_id` stays generic (no users FK).
- **Gate:** `npm run typecheck`, `npx vitest run`, `eslint`, `prettier --check`.
- **Visual E2E:** `scripts/feed-screenshots.mjs` now seeds a Page (identity,
  Page-authored post, CTA URL) and captures `page-desktop.png`,
  `page-about.png`, `page-mobile.png`. This surfaced two live-only bugs the
  MemoryStore hid — a Postgres FK violation on post-as-Page (PG-18) and a mobile
  header-clipping bug (PG-19).

