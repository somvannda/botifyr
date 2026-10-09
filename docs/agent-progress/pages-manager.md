# Pages Manager — Progress & Context Recovery

> **Historical record** — ports reflect the run at the time. Canonical local dev is defined in [`AGENTS.md`](../../AGENTS.md) §10.

> Owner: **Pages Manager** (Feed Experience Team, reports to Feed Experience Lead).
> Update after each batch. Companion docs: `docs/pages-competitive-research.md`,
> `docs/pages-ux-audit.md`, `docs/pages-implementation-plan.md`.

## Current status

**Destination v3 — INTEGRATED + VERIFIED.** Stage: PLANNED → IMPLEMENTED →
TESTED → **INTEGRATED** (PR **#20**, squash-merged to `origin/main` as `d4d9118`)
→ **VERIFIED** (CI green: Typecheck/Lint/Test + Cloud image).
Adds a **Videos** section on top of v2: `GET /v1/pages/:handle/media?kind=video`
(shared endpoint with Photos) + a lazy **Videos** tab with native playback.
Local gate: `typecheck` 0, `lint` 0, `npm test` **475/475**; cloud Pages **12/12**;
UI Pages **12/12**.

> ⚠️ **Known flaky test (not Pages):** `FeedView.dom.test.tsx > Post interactions
> > "highlights the permalink-focused post (POST-13)"` intermittently fails
> (`expected null to be truthy`) and broke CI once on PR #20 (passed on re-run and
> on pristine `origin/main`). Owner: **Post Manager / Feed QA** — worth making
> deterministic.

**Destination v2 — INTEGRATED + VERIFIED.** Stage: PLANNED → IMPLEMENTED →
TESTED → **INTEGRATED** (PR **#13**, squash-merged to `origin/main` as
`3105f9d`) → **VERIFIED** (CI green: Typecheck/Lint/Test + Cloud image).
Adds the three requested capabilities on top of the verified base:

- **A — timeline pagination:** `GET /v1/pages/:handle/posts?cursor=&limit=` returns
  `{ items, nextCursor }` (keyset over `(createdAt,id)`, pin-first on page 1);
  client + `PageView` "Load more" (dedup on append).
- **B — Photos section:** `GET /v1/pages/:handle/media` (image attachments,
  signed URLs) + a lazy **Photos** tab and the shared lightbox.
- **C — hash routing:** `#/pages/:handle` in `BotifyrApp` (refresh, share,
  back/forward; activates the Feed view).

Local gate in the worktree: `typecheck` 0, `lint` 0, `npm test` **462/462**;
cloud Pages tests **12/12**; UI Pages tests **11/11**; CI green on the PR.

**Prior verified base** (on `origin/main`): PG-18/19/20 fixes, `listPostMedia`
coordination fix, `pages.cta_url`, E2E seed fix (PR #5), CI green.

## Problem statement

The Pages backend/UI are substantially implemented (profile, timeline, follow,
roles, settings, pinned posts, insights, community inbox) per
`docs/feed-next.md`. The remaining gaps are resilience/polish and missing
supported sections — not core functionality. See the audit for the ranked list.

## Files inspected

- `packages/ui/src/FeedView.tsx` — `PageView` (~898–1428), `FeedView` host
  routing (~1954–2364), `FeedRail` "Pages to follow" (~2730–2970).
- `packages/ui/src/FeedView.dom.test.tsx` — mock `BotifyrClient`, existing tests.
- `packages/ui/src/styles.css` — `.page-*`, `.feed-state`, `.feed-follow-btn`.
- `packages/ui/src/BotifyrApp.tsx` — `feedPage` state + `FeedView` wiring.
- `packages/client/src/index.ts` — `Page` DTO + `*Page*` methods.
- `apps/cloud/src/server.ts` — `pageDto`, `/v1/pages*`, `/v1/pages/:id/insights`.
- `apps/cloud/src/server.pages.test.ts` — backend coverage (read for behaviour).
- `docs/feed.md`, `docs/feed-next.md`, `docs/feed-experience-*.md`.

## Files modified (this workstream)

- `docs/pages-competitive-research.md` (new)
- `docs/pages-ux-audit.md` (new)
- `docs/pages-implementation-plan.md` (new)
- `docs/agent-progress/pages-manager.md` (this file)
- `packages/ui/src/FeedView.tsx` — `PageView`.
- `packages/ui/src/styles.css` — additive `.page-*`, plus two fixes:
  `flex: none` on `.page-head` (PG-19) and a higher-specificity mobile rule.
- `packages/ui/src/FeedView.dom.test.tsx` — 9 Pages tests.
- `apps/cloud/src/store/schema.ts` — drop the legacy `posts.author_id` users FK
  (PG-18); add the `pages.cta_url` column.
- `apps/cloud/src/server.pages.test.ts` — schema regression guard + cta_url test.
- `apps/cloud/src/store/types.ts`, `apps/cloud/src/store/postgres.ts` —
  `PageRecord.ctaUrl` + persistence.
- `packages/client/src/index.ts` — `Page.ctaUrl` + create/update inputs.
- `apps/cloud/src/server.ts` — coordination fix (media consumers) + `ctaUrl` on
  the Page DTO and create/patch routes.
- `scripts/feed-screenshots.mjs` — seeds a Page and captures
  `page-desktop.png` / `page-about.png` / `page-mobile.png`.
- `e2e/pages.spec.ts` (new) — Playwright E2E: discover/open a Page, identity +
  posts, Posts/About navigation, owner controls, mobile visibility. Token-gated
  (`E2E_PAGES_TOKEN`), so it skips without credentials.
- `docs/assets/feed/page-{desktop,about,mobile}.png` (new).

## Architectural decisions

- Keep Pages inside `packages/ui/src/FeedView.tsx` (`PageView`); one UI, two
  hosts (`AGENTS.md` §7). No new UI files.
- Only present sections the backend supports: **Posts** and **About**.
- Never render a control with no destination: CTA is a link only when it is a
  real URL, otherwise a non-interactive badge.
- Reuse `PostCard`, `Avatar`, `resolveAvatar`; do not duplicate post rendering.
- `posts.author_id` is a **generic author id** (user *or* Page), matching the
  existing `author_mutes.author_id`; the users FK was a legacy mistake (PG-18).


## Tests executed (actual)

- Baseline before changes: `npx vitest run packages/ui` → **64 passed / 64**.
- Pages component tests: `npx vitest run packages/ui -t "Pages experience"`
  → **8 passed / 8**.
- Full UI suite `npx vitest run packages/ui` → **112 passed / 112** (11 files),
  once the concurrent Story/design work settled; later churn raised the file
  total further.
- Whole-repo `npm test` → **399 passed / 399** (60 files).
- `npm run typecheck -w @botifyr/ui` → **exit 0**.
- `eslint` on edited files → **0 errors**; `prettier --check` → **clean**.
- The `designSystem.test.ts` Feed-token guard is satisfied for the Pages block
  (`.page-follow-error` uses `var(--danger)`; no raw literals added).

### Final full gate (actual)

- `npm test` → **451 passed / 451** (64 files). ✅
- `npm run typecheck` (all workspaces) → **exit 0**. ✅
- `npm run lint` → **exit 0**, 0 errors. ✅
- `npx vitest run apps/cloud/src/server.pages.test.ts` → **9 passed / 9**. ✅
- Pages component tests → **9 passed / 9** (incl. role + `cta_url` coverage).
- `prettier --check` on Pages-authored files → **clean**. (`FeedView.tsx` is
  shared and concurrently edited; its remaining churn is in other managers'
  regions, not the `PageView` code.)
- Visual evidence: `node scripts/feed-screenshots.mjs` → `page-desktop.png`,
  `page-about.png`, `page-mobile.png` captured and inspected. ✅
- E2E (`E2E_PAGES_TOKEN=… E2E_BASE_URL=http://localhost:1420 npx playwright test e2e/pages.spec.ts`)
  → **4 passed**: discover/open, identity + posts, Posts/About nav, owner
  controls, mobile visibility. ✅
- E2E seed made **unique per parallel worker** (a millisecond stamp could make
  two workers race for one Page handle). Verified with 3 consecutive 4/4 runs;
  shipped as **PR #5** (`94fdabe`), CI green (Typecheck/Lint/Test + Cloud image).

> The repo churned heavily under concurrent edits during this session: gate runs
> went transiently red from other managers' in-flight changes (Story viewer,
> Composer, design tokens, Reels suite, `listPostMedia` interface,
> Marketplace/Discovery). All settled; the numbers above are the settled state.
> If the gate goes red again, re-run `npm run typecheck && npm run lint && npm test`
> — failures will be outside Pages unless stated otherwise.



## Bug fixes found via live E2E (not covered by unit tests)

- **PG-18 (S1):** posting as a Page 500'd on Postgres (legacy `posts.author_id`
  users FK). Fixed in `schema.ts` + guarded in `server.pages.test.ts`. Required
  `docker compose up -d --build cloud` (baked image).
- **PG-19 (S2):** `.page-head { overflow:hidden }` shrank in the flex column and
  clipped the owner actions on mobile. Fixed with `flex: none`; verified by the
  re-captured `page-mobile.png`.
- **PG-20 (S2):** management controls ignored the viewer's role (moderators had
  no Community entry; analysts had no Insights). Fixed with role-aware flags;
  component test now covers admin/moderator/analyst/visitor.


## Note on concurrent work

`FeedView.tsx`, `styles.css`, and `FeedView.dom.test.tsx` are being edited live
by other workstreams (Story viewer `groups`, Composer attachments + upload state,
design tokens). During this session the shared file was transiently broken
multiple times (`singleImage is not defined`, `groups[groupIndex]` undefined,
attachment type mismatch, unused locals). I made **one** small coordination fix
in the Composer's `pickImages` to satisfy their declared `ComposerAttachment`
interface; they then replaced that code with their own implementation, which is
correct. No other Composer/Story/token regions were changed by me.

## Outstanding tasks

- [x] Inspect existing Pages implementation + backend + tests.
- [x] Competitive research doc.
- [x] UX/reliability audit doc.
- [x] Implementation plan doc.
- [x] Implement `PageView` resilience: error + Retry, skeleton, tailored empty.
- [x] Render `avatarUrl`.
- [x] `Posts` / `About` tabs + About content.
- [x] CTA link-vs-badge; show owner CTA text.
- [x] Follow pending/confirmed state + inline error.
- [x] Heading semantics + responsive action row.
- [x] Component tests (8) — all passing.
- [x] Visual E2E: seeded Page + `page-desktop/about/mobile.png`.
- [x] Fixed PG-18 (post-as-Page 500 on Postgres) + schema guard.
- [x] Fixed PG-19 (mobile header clipping).
- [x] Full gate: `npm run typecheck` (all workspaces), `npm run lint`, and
  `npm test` (417/417) — all green.

## Dependencies & blockers

- ~~`pages.cta` is a label only (no `cta_url`)~~ → **resolved**: `cta_url` shipped.
- No Page-scoped media/story endpoints → no Photos/Reels/Stories tabs.
- Timeline capped at 20 with no cursor → no "load more".
- App has no URL router → no deep-link/refresh for a Page.
- Concurrent uncommitted work touches `FeedView.tsx`, `styles.css`,
  `BotifyrApp.tsx`; keep edits surgical and re-verify.

## Next concrete action

Pages workstream is complete and verified (unit + component + backend + visual
E2E), including `pages.cta_url`. The schema/API changes need the cloud image
rebuilt wherever it runs (`docker compose up -d --build cloud`) — done locally
and confirmed live. Remaining items are backend/product decisions (Page-scoped
media/story endpoints, timeline pagination, URL routing) — see
`docs/pages-ux-audit.md` "out of scope". If the repo gate goes red again, re-run
`npm run typecheck && npm run lint && npm test`.

## Handoff notes

- **Post Manager:** `PostCard` props unchanged; `PageView` reuses it.
- **Design System Manager:** new `.page-tab`, `.page-about*`, `.page-skel*`,
  `.page-cta-badge` classes are additive; no token changes. NOTE: `.page-head`
  now needs `flex: none` because `overflow: hidden` zeroes its flex min-height.
- **Feed QA & E2E:** Page component tests in `FeedView.dom.test.tsx`; seeded
  Page screenshots in `scripts/feed-screenshots.mjs`; Playwright spec
  `e2e/pages.spec.ts` (set `E2E_PAGES_TOKEN`).
- **Cloud/backend:** `posts.author_id` is a generic author id (user or Page);
  do **not** re-add a `REFERENCES users(id)` FK (guarded by a test). Page CTA is
  now `cta` (label) + `cta_url` (destination).
- **Feed Experience Lead:** see PG-18 — the MemoryStore hides FK violations;
  run Pages flows against Postgres (the screenshot harness now does).

