# Pages — UX & Reliability Audit

> Owner: **Pages Manager** · Workstream: Feed Experience · Last updated: **Oct 2026**.
> Method: **source inspection** of `packages/ui/src/FeedView.tsx` (`PageView`),
> `packages/ui/src/styles.css` (`.page-*`), `packages/client/src/index.ts`
> (`Page` DTO + `*Page*` methods), `apps/cloud/src/server.ts`
> (`pageDto`, `/v1/pages*`), and `apps/cloud/src/server.pages.test.ts`.
> No live logged-in screenshots of external products were captured; findings
> below are from this repository's code and the running dev host where noted.

## Status summary

The Pages backend and UI are **substantially implemented, not a placeholder**
(see [`feed-next.md`](feed-next.md) §Implementation status): Page profile,
timeline, follow, roles, settings, pinned posts, insights, and community inbox
all exist. The remaining work is **polish, resilience, and missing sections** —
not core functionality. `PageView` lives in one component and reuses the shared
`PostCard`/`Avatar` and `.page-*` styles.

## Findings by area

Legend: severity **S1** (blocking/broken) · **S2** (high) · **S3** (medium) ·
**S4** (low/polish).

### A. Page discovery

| # | Severity | Finding | Evidence | Impact | Fix | Deps |
| --- | --- | --- | --- | --- | --- | --- |
| PG-01 | S3 | Page load failure is **silently swallowed**; no error state and no way to recover. | `PageView` `useEffect` → `.catch(() => {})` (FeedView.tsx ~944). | A transient 5xx/network failure renders "No posts yet." as if the Page were empty — misleading and unrecoverable. | Add an `error` state + Retry. | — |
| PG-02 | S4 | Discovery rail distinguishes Pages only by name/avatar; the Page badge is small. | `FeedRail` "Pages to follow" (FeedView.tsx ~2939). | Acceptable; not changed this pass. | — | Design System |

### B. Page identity

| # | Severity | Finding | Evidence | Impact | Fix | Deps |
| --- | --- | --- | --- | --- | --- | --- |
| PG-03 | S2 | `PageView` ignores `page.avatarUrl`; it only renders the emoji/number. | `<Avatar emoji={page.avatarEmoji} name={page.name} />` (FeedView.tsx ~1149) vs `Avatar` supporting `url`. | An uploaded Page logo never appears, even though the DTO returns it — an identity regression vs posts (FEED-6). | Pass `url={resolveAvatar(page.avatarUrl, cloudUrl)}`. | — |
| PG-04 | S4 | Page name is a `<div>`, not a heading; About is a `<p>`. | FeedView.tsx ~1151. | Screen-reader users get no landmark heading for the Page. | Use `<h1 class="page-name">`. | Design System |
| PG-05 | S4 | `verified` is rendered as a literal `" ✓"` text suffix. | FeedView.tsx ~1153. | Reads as text, not a verified badge; `verified` is always false today. | Leave as-is; documented as deferred. | — |

### C. Page navigation

| # | Severity | Finding | Evidence | Impact | Fix | Deps |
| --- | --- | --- | --- | --- | --- | --- |
| PG-06 | S2 | **No section navigation.** The Page is a header followed directly by the timeline; there is no About/Photos/etc. | `PageView` render tree. | `about`/`category` are buried in the header; the Page feels like a bare profile, not a destination. | Add a **Posts / About** tab row using existing data. Do **not** add tabs with no backing endpoint. | — |
| PG-07 | S3 | Direct-link/refresh support is absent — Page view state is in-memory (`feedPage` in `BotifyrApp`). | `BotifyrApp.tsx` `const [feedPage, setFeedPage]`. | A refresh or shared link loses the Page; back/forward is app-managed, not URL-managed. | Documented limitation (no URL router in the app); out of scope for this component. | Feed Experience Lead |

### D. Page content

| # | Severity | Finding | Evidence | Impact | Fix | Deps |
| --- | --- | --- | --- | --- | --- | --- |
| PG-08 | S3 | Empty state says only "No posts yet." regardless of viewer. | FeedView.tsx ~1406. | An owner isn't guided to publish; a visitor can't tell whether the Page is new or broken. | Tailor the empty copy to owner vs visitor. | — |
| PG-09 | S2 | Loading is a bare `"Loading…"` — no skeleton; the header pops in after load. | FeedView.tsx ~1403. | Perceived jank and layout shift; inconsistent with the Feed's skeleton conventions. | Add a header + posts skeleton. | Design System |
| PG-10 | S4 | Timeline is capped at 20 posts with no "load more" (server returns an array, no cursor). | `GET /v1/pages/:handle/posts` → `listPostsByAuthor(page.id, 20)` (server.ts ~5179). | Older Page posts are unreachable. | Documented backend limitation; do not fake pagination. | Cloud |

### E. Page interactions

| # | Severity | Finding | Evidence | Impact | Fix | Deps |
| --- | --- | --- | --- | --- | --- | --- |
| PG-11 | S2 | The **CTA is a dead control** when `page.cta` is not a URL: it renders a `<button>` with no handler. | FeedView.tsx ~1197 ` <button …>{page.cta}</button>`. | Violates "no visible controls that do nothing"; a click does nothing. | Render an `<a>` only for real URLs; otherwise a non-interactive badge. **Now backed by `pages.cta_url`** (label + destination). | ✅ `cta_url` shipped |
| PG-12 | S3 | The URL CTA's label shows only the **domain**, discarding the author's CTA text. | FeedView.tsx ~1194 `page.cta.replace(/^https?:\/\//i,"").split("/")[0]`. | The button's words don't match what the owner set. | Show the CTA text; keep the URL as `href`. | — |
| PG-13 | S3 | Follow failure leaves no feedback; the button shows no pending state beyond `disabled`. | `toggleFollow` `.catch(() => {})` (FeedView.tsx ~1120). | A failed follow looks like nothing happened; no retry cue. | Set an inline error + `aria-busy`; keep optimistic update only on success. | — |
| PG-14 | S4 | Follow toggles optimistically before the server confirms. | FeedView.tsx ~1119. | A failed request can leave a stale count until reload (the server response isn't used). | Update from confirmed result; revert on error. | — |

### F. Reliability & accessibility

| # | Severity | Finding | Evidence | Impact | Fix | Deps |
| --- | --- | --- | --- | --- | --- | --- |
| PG-15 | S4 | Cover `<img>` is not lazy-loaded and has no `decoding` hint. | `<img class="page-cover" …>` (FeedView.tsx ~1144). | Minor: an above-the-fold cover is usually eager; kept eager but add `decoding="async"`. | — |
| PG-16 | S4 | Management buttons stack in `.page-head-actions` and can crowd the identity block on narrow screens. | `.page-head-actions { flex-direction: column }` (styles.css). | On mobile the action column squeezes the name/description. | Make the action row wrap horizontally below the identity on narrow widths. | Design System |
| PG-17 | S4 | Section tabs must be keyboard-navigable and expose the active state. | new | a11y parity with `.feed-tab`. | Use `<button role="tab" aria-selected>` + visible active style. | — |
| PG-18 | **S1** | **Posting as a Page returns HTTP 500 on Postgres.** `posts.author_id` had a legacy `REFERENCES users(id)` FK, but post-as-Page stores the **Page id** there (FR-17). The MemoryStore doesn't enforce FKs, so the Pages backend tests passed. | Live harness: `POST /v1/posts {pageId}` → `23503 posts_author_id_fkey`; confirmed by the screenshot run. | The core Pages capability (publish as the Page) was **broken in production** while tests were green. | Drop the FK (`posts.author_id` is a generic author id, like `author_mutes.author_id`); guard it in `server.pages.test.ts`. | Cloud |
| PG-19 | S2 | **Page header actions were clipped on mobile.** `.page-head { overflow: hidden }` zeroes a flex item's automatic `min-height`, so on short viewports the header shrank and cut off the owner action row entirely. | Live DOM: `.page-head` height 371px vs ~499px content; actions present but not painted. Confirmed in `page-mobile.png` before the fix. | Owners lost all management entry points on mobile. | Add `flex: none` to `.page-head`; verified in the re-captured `page-mobile.png`. | — |
| PG-20 | S2 | **Management controls ignored the viewer's role.** The UI used one `canManage` (admin/editor) for Pin, Community, Insights and Settings, but the backend allows **Community for moderators** and **Insights for analysts**. | `server.ts`: inbox = admin/editor/moderator; insights = admin/editor/analyst; pin/settings = admin/editor. `PageView` used `canManage` for all. | Moderators and analysts saw the visitor view and had **no entry point** to capabilities the server permits. | Role-aware flags (`canManage`/`canModerate`/`canViewInsights`); controls render per role; component test covers moderator + analyst. | — |

## Prioritised fix list (this workstream)

1. **PG-18** — post-as-Page 500 on Postgres (**shipped blocker**).
2. **PG-19** — mobile header action clipping.
3. **PG-20** — role-accurate management controls.
4. **PG-01 / PG-09 / PG-08** — error + Retry, skeleton, tailored empty (resilience).
5. **PG-03** — render the uploaded Page avatar (identity parity with posts).
6. **PG-11 / PG-12** — stop rendering a dead CTA; show the owner's CTA text.
7. **PG-06** — add Posts / About section navigation (data already present).
7. **PG-13 / PG-14** — safer follow action (pending + confirmed state, inline error).
8. **PG-04 / PG-16 / PG-17** — heading semantics, responsive action row, accessible tabs.

## Visual evidence

Captured headlessly by `scripts/feed-screenshots.mjs` (now seeds a Page):
`docs/assets/feed/page-desktop.png`, `page-about.png`, `page-mobile.png`.


## Explicitly out of scope (documented, not hidden)

- **Page Videos/Reels/Stories sections** — no Page-scoped read endpoint
  (Photos shipped via `GET /v1/pages/:handle/media`).
- **Page contact/website/hours** — no schema field.
- **`verified` badge** — `verified` is always `false` at creation.

## Shipped after the original audit

- **Timeline pagination (PG-10)** — `GET /v1/pages/:handle/posts?cursor=&limit=`
  (keyset) with a **Load more** control.
- **Photos section (PG-06)** — `GET /v1/pages/:handle/media` + a **Photos** tab
  and the shared lightbox.
- **URL/deep-link routing (PG-07)** — `#/pages/:handle` (refresh, share,
  back/forward) in `BotifyrApp`.
- **CTA destination (PG-11)** — `cta_url` (label + destination).
