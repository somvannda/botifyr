# Pages — Competitive Research

> Owner: **Pages Manager** · Workstream: Feed Experience.
> Research date: **Oct 2026**. Sources are linked; see *Limitations* at the end.
> This document informs [`pages-implementation-plan.md`](pages-implementation-plan.md)
> and [`pages-ux-audit.md`](pages-ux-audit.md).

## Scope

How leading products present a **public, followable entity** (Facebook Page,
Instagram professional profile, LinkedIn company page, YouTube channel), and
which patterns fit Botifyr's existing Pages model
(`pages` + `page_roles` + `page_followers`, `POST /v1/pages*`).

Botifyr's model is fixed: a Page has `handle`, `name`, `category`, `about`,
`avatarEmoji`/`avatarUrl`, `coverUrl`, `cta`, `verified`, `pinnedPostId`,
`workspaceId`/`botId`, `followers`, one-way `following`, and a viewer `role`
(`admin`/`editor`/`moderator`/`analyst`). We adopt only patterns that map to
those fields or to an existing endpoint.

## Patterns

### 1. Cover + avatar composition

- **What:** a wide cover image with the circular avatar overlapping its
  lower-left; the avatar is the recognisable brand mark, the cover sets tone.
- **Problem:** a Page with only a name is not identifiable at a glance; the
  avatar must stay legible at small sizes in search/suggestions.
- **Fits?** Yes — `coverUrl` + `avatarUrl`/`avatarEmoji` already exist.
- **Botifyr implementation:** keep the existing `.page-head` / `.page-cover`
  composition, overlap the avatar, render `avatarUrl` (photo) when present and
  fall back to the emoji glyph. Facebook sizes: avatar 320×320 source, cover
  851×315 (min 400×150). Our fixed 140px cover height avoids layout shift.
  ([Meta page sizes](https://www.facebook.com/help/125379114252045))

### 2. Category label as instant relevance signal

- **What:** the Page's category ("Coffee shop", "Software company") sits beside
  the name.
- **Problem:** a visitor needs to know *what this is* in one line.
- **Fits?** Yes — `category` exists (max 40 chars).
- **Botifyr implementation:** render `category` in the identity sub-line next to
  `@handle` and followers, truncated with an ellipsis rather than wrapping.

### 3. A single, explicit CTA button

- **What:** one high-contrast action button ("Book now", "Shop now") bound to a
  destination (website, phone, message).
- **Problem:** removes friction — visitors shouldn't hunt for the next step.
- **Fits?** **Partly.** `pages.cta` is a *label only* today; there is no
  `cta_url`. So a CTA can be shown, but only forwarded when the stored value is
  itself a URL. Non-URL CTA text has no destination.
- **Botifyr implementation (this workstream):** render a real `<a>` when the
  stored value is an `http(s)` URL (or `mailto:`/`tel:`), and render a
  **non-interactive badge** otherwise — never a button that does nothing. A
  dedicated `cta_url` field is recorded as a backend dependency
  ([`pages-implementation-plan.md`](pages-implementation-plan.md) §Dependencies).
  ([Meta CTA guidance](https://www.facebook.com/help/1602483780062090))

### 4. Tabs / sections for navigation

- **What:** a tab row (Home/Timeline, About, Photos, Videos, Reviews) that
  splits identity from content.
- **Problem:** a long profile becomes a wall; tabs let visitors jump to intent.
- **Fits?** Yes for **Posts** and **About** (data exists). Photos/Videos/Reels/
  Community/Reviews have **no Page-scoped read endpoint** (media is resolved per
  post; there is no gallery endpoint), so we must **not** present empty tabs.
- **Botifyr implementation:** a two-tab model — **Posts** and **About** — with
  About always available (description, category, followers, CTA, created). Extra
  sections are documented dependencies, not fake UI.

### 5. Follower count + Follow action with clear state

- **What:** follower count beside an explicit Follow/Following button.
- **Problem:** a visitor needs to know their relationship and act in one tap.
- **Fits?** Yes — `followers`, `following`, `POST`/`DELETE /v1/pages/:id/follow`.
- **Botifyr implementation:** keep the pill button; add a pending/disabled state
  and never double-submit; update from the confirmed response.

### 6. Owner/admin controls separated from visitor actions

- **What:** managers get Edit/Settings/Insights/Inbox entry points; visitors see
  Follow/Share only.
- **Problem:** mixing management controls into the public header confuses
  visitors and invites accidental taps.
- **Fits?** Yes — `role` is returned per viewer.
- **Botifyr implementation:** keep management actions behind `canManage`; this
  workstream groups them so they don't collide with the identity block.

### 7. About / contact information block

- **What:** a dedicated "About" area with description, category, and public
  contact/website info.
- **Problem:** credibility — visitors need the "who/what/how to reach".
- **Fits?** **Partly.** We have `about` and `category`. There is **no
  website/contact/phone/address** field, so we must not fabricate them.
- **Botifyr implementation:** About renders `about` + `category` + follower
  count + the CTA when it points somewhere. A contact/website field is a
  documented dependency.

### 8. Pinned post as a mini-landing page

- **What:** one post pinned to the top of the Page timeline.
- **Problem:** foregrounds the most important message.
- **Fits?** Yes — `pages.pinnedPostId` + `POST /v1/pages/:id/pin`; the server puts
  the pinned post first.
- **Botifyr implementation:** already shipped; keep the "📌 Pinned" label.

## Adopt / adapt / reject

| Pattern | Decision | Why |
| --- | --- | --- |
| Cover + overlapping avatar | **Adopt** | Data + styles exist. |
| Category + handle + followers sub-line | **Adopt** | Data exists. |
| Single CTA, real link only when a URL | **Adapt** | No `cta_url`; avoid a dead control. |
| Posts / About tabs | **Adopt** | Only sections the backend supports. |
| Follow with pending state | **Adopt** | Endpoint + DTO fields exist. |
| Manager vs visitor action split | **Adopt** | `role` per viewer. |
| About text + CTA | **Adapt** | No website/contact fields yet. |
| Pinned post label | **Already adopted** | Shipped. |
| Photos / Videos / Reviews / Community tabs | **Reject (now)** | No Page-scoped read endpoints. |
| Story highlights strip | **Reject (now)** | `stories.page_id` exists in schema but no Page story endpoint/UI. |
| "Verified" badge styling | **Defer** | `verified` exists but is always `false` on create. |

## Limitations (honesty note)

- Research used web search results for official Meta/Instagram help pages and
  current (2026) third-party guides ([Facebook Page sizes](https://www.facebook.com/help/125379114252045),
  [Facebook Page customization](https://www.facebook.com/help/1602483780062090),
  [Instagram professional accounts](https://help.instagram.com/502981923235522)).
  **No live logged-in screenshots** of Facebook/Instagram/LinkedIn/YouTube were
  captured in this environment, so layout proportions are described from
  published guidance, not pixel measurement.
- LinkedIn company pages and YouTube channels informed the "About block" and
  "single primary CTA" patterns, but no dedicated source was fetched for them.
