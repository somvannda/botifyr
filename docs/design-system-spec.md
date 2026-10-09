# Design System — Specification

> Owner: **Design System Manager** (Agent 2) · Applies to: the shared UI in
> `packages/ui` consumed by the desktop host, web portal and admin.
>
> Companion docs: [`design-system-audit.md`](design-system-audit.md) (findings),
> [`design-system-plan.md`](design-system-plan.md) (work items),
> [`design-system-components.md`](design-system-components.md) (inventory),
> [`design-system-progress.md`](design-system-progress.md) (status).
> Last updated: Oct 2026.

## 0. Scope & basis

Shared visual foundations and reusable primitives for the Main feed, Composer,
Stories, Posts, Reels, Pages, the right sidebar and the fixed bottom navigation.

**Reference:** no reference screenshot file is present in the repository, so this
system follows the described direction — a modern **dark social UI with charcoal
surfaces and a blue accent** — while preserving the app's existing brand identity
(indigo `#6d8bff`, Inter, rounded/compact controls). It does **not** copy Facebook
branding.

**Stack (inspected):** React + Vite; one shared UI package `packages/ui` (no
Tailwind/CSS-in-JS) with a single global stylesheet `packages/ui/src/styles.css`
driven by CSS custom properties. `BotifyrApp` is the only interface; desktop and
portal are thin hosts (`parity.test.ts`).

## 1. Color tokens

Defined in `styles.css` `:root` (dark default) and `[data-theme="light"]`.
Components **must** reference these, never raw color literals.

### 1.1 Surfaces (dark → light)

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` | `#0a0a0b` | `#f5f6f8` | page background |
| `--panel` | `#121214` | `#ffffff` | cards, modals |
| `--panel-2` | `#17171a` | `#eef0f3` | inset surfaces, chips, secondary cards |
| `--hover` | `#232327` | `#e6e9ef` | hover fill |
| `--bubble` | `#2a2a2e` | `#e4e7ee` | chat bubbles / raised rows |
| `--input-bg` | `#0e0e10` | `#ffffff` | text inputs, selects, search |
| `--overlay` | `rgba(0,0,0,.5)` | same | modal/menu backdrops |

### 1.2 Text

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--text` | `#ececef` | `#1a1c21` | primary text |
| `--muted` | `#8b8b92` | `#616875` | secondary/metadata |
| `--on-media` | `#ffffff` | same | text on dark media (reels/lightbox/story) |
| `--on-media-muted` | `rgba(255,255,255,.8)` | same | secondary on media |

### 1.3 Lines

| Token | Dark | Light |
| --- | --- | --- |
| `--border` | `#26262b` | `#e0e3e9` |

### 1.4 Accent

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--accent` | `#6d8bff` | `#3d52c2` | links, active state, accent **text** |
| `--accent-2` | `#8f6dff` | `#6d4ad6` | gradients |
| `--accent-soft` | accent 14% | — | active pill / tag background |
| `--accent-soft-strong` | accent 22% | — | hover of the above |
| `--accent-border` | accent 45% | — | accent borders/badges |
| `--accent-glow` | accent 35% | — | small accent shadow |
| `--accent-solid` | `#5568e0` | `#3d52c2` | solid buttons with **white** text |
| `--accent-2-solid` | `#6d4ad6` | — | second gradient stop for white-text buttons (`.btn.allow`) |
| `--focus-ring` | `= --accent` | | focus outline |

### 1.5 Status

| Token | Dark | Light |
| --- | --- | --- |
| `--ok` | `#3fd18b` | `#0b7a44` |
| `--warn` | `#f2b544` | `#8a5a00` |
| `--danger` | `#ff6b6b` | `#c8324a` |
| `--ok-soft` / `--ok-border` | ok 10% / 40% | — |
| `--warn-soft` / `--warn-border` | warn 10% / 40% | — |
| `--danger-soft` / `--danger-border` | danger 12% / 40% | — |
| `--danger-solid` | `#c8324a` | solid destructive buttons |

Tints use `color-mix(in srgb, <base> N%, transparent)` so they follow the base
hue into the light theme automatically.

**Contrast:** every text/background pair above clears **WCAG AA (≥4.5:1)** in both
themes, including `--accent` on `--accent-soft`, white on `--accent-solid`/
`--danger-solid`, and `--on-media` on the black media backdrop. Locked by
`designSystem.test.ts`.

## 2. Surface hierarchy

1. **Page** — `--bg`.
2. **Cards** — `--panel` + 1px `--border`, `--radius-card`.
3. **Composer / inputs** — `--panel` (card) with `--input-bg` for fields.
4. **Menus / dropdowns** — `--panel-2` + `--border`.
5. **Modals/dialogs** — `--panel` + `--overlay` backdrop.
6. **Hover/active** — `--hover`; active nav/controls use `--accent-soft` + `--accent`.
7. **Dividers** — 1px `--border`.

Elevation is expressed mainly by surface step + border; shadows are reserved for
floating layers (menus, dialogs, lightbox).

## 3. Typography

Font: **Inter** (bundled, latin subset) with **Noto Sans Khmer** fallback so Khmer
text renders correctly; weights 100–900. Form controls inherit the page font.

| Role | Token | Size |
| --- | --- | --- |
| Micro / badges | `--text-4xs`…`--text-3xs` | 10 / 10.5px |
| Captions, metadata | `--text-2xs`…`--text-xs` | 11 / 11.5px |
| Labels, tags, actions | `--text-sm`…`--text-md` | 12 / 12.5px |
| Body, rail names | `--text-lg`…`--text-xl` | 13 / **13.5px body** |
| Titles | `--text-3xl`…`--text-5xl` | 15 / 16 / 18px |

Body line-height 1.55. Truncation: single-line `overflow:hidden;text-overflow:
ellipsis;white-space:nowrap`; multi-line `-webkit-line-clamp` (posts clamp at 12
lines with a “See more” toggle).

## 4. Spacing (4-pt grid)

`--space-1` 4 · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-5` 20 ·
`--space-6` 24.

Guidance: content padding `--space-3/4`; avatar-to-text `--space-2/3`; card gaps
`--space-3`; button padding `--space-1/2` vertical, `--space-3` horizontal;
section spacing `--space-4/6`. A small off-grid tail (18/22/26/40px) remains for
display/large spacing.

## 5. Shape & elevation

`--radius-2xs` 4 · `--radius-xs` 6 · `--radius-control` 8 · `--radius-sm` 9 ·
`--radius-md` 10 · `--radius-bubble` 12 · `--radius-card` 14 · `--radius-lg` 16 ·
`--radius-pill` 999 · `--radius-round` 50%.

Convention: cards `--radius-card`; inputs/buttons `--radius-control`; pills/chips/
tags/badges `--radius-pill`; avatars `--radius-round`; media `--radius-bubble`.
All `border-radius` in the stylesheet now uses these tokens. Borders are 1px
`--border`. Motion is subtle (100–150ms ease) and disabled under
`prefers-reduced-motion`.

## 6. Component conventions

All primitives live in `packages/ui/src/styles.css`; React components in
`FeedView.tsx`, `Stories.tsx`, `Icons.tsx`. **Do not fork a second component
library.**

### A. Buttons
| Variant | Class / pattern |
| --- | --- |
| Primary | solid `--accent-solid`, white text, `--radius-pill` (e.g. `.feed-post-btn`) |
| Secondary | `--panel-2` + `--border` (e.g. `.feed-more`, `.feed-confirm-cancel`) |
| Ghost/subtle | transparent, `--muted` → `--text` on hover (e.g. `.feed-action`, `.feed-composer-tool`) |
| Destructive | `--danger` text; solid `--danger-solid` (e.g. `.feed-confirm-danger`) |
| Icon-only | round, `aria-label` required (e.g. `.feed-comment-send`) |
| Disabled | `:disabled` + `opacity:.5`, `cursor:default` |
| Loading | label/`aria-busy` (see composer upload `.feed-upload*`) |

Minimum touch target ≥32px; focus ring via `--focus-ring`.

### B. Inputs
`.feed-composer-input` (borderless textarea), `.feed-comment-input` (pill),
`.feed-composer-as-input`, `.search`/settings inputs (`--input-bg`). Focus =
`border-color: var(--accent)` + the shared ring. Placeholders are hints; every
field has a visible label or `aria-label`. Error text uses `--danger`; the
composer counter (`.feed-composer-count.over`) turns `--danger` past the limit.

### C. Cards
Standard `.feed-post` /`.feed-composer` (`--panel`, `--border`, `--radius-card`,
`--space-3/4` padding). Interactive cards add a `--hover`/`--accent` affordance.
Header = `AuthorLine`; body = post text/media; footer = `.feed-actions`.

### D. Identity
`Avatar` (`FeedView.tsx`): photo (`img.feed-avatar-photo`, lazy, `object-fit:cover`)
or emoji/initial fallback (`span.feed-avatar`, `aria-hidden`). Sizes 24/30/32/36/
40/64. `AuthorLine` = avatar + name + `@handle · time`. Names are real text.

### E. Navigation
Bottom navigation uses `.feed-bottom-nav` / `.bottom-nav-item` /
`.bottom-nav-badge`: `--panel` bar + `--border` top, `env(safe-area-inset-bottom)`
padding, ≥52px touch targets, `--muted` inactive → `--accent` active with a
non-colour indicator bar and `--focus-ring`. Top tabs are `role="tab"` with
`aria-selected`; active = `--accent-soft` + `--accent`. Badges use `--accent` +
white with an accessible label. Placement/routing is Agent 1's.

### F. Feedback
Loading `.feed-skeleton*` (shimmer, disabled under reduced motion); empty
`.feed-empty` (+ emoji/title/sub); error `.feed-error` + retry `.feed-error-retry`
(`--danger*`); states inside the black Reels backdrop use `--on-media*`.

### G. Overlays
`.feed-menu`/`.feed-menu-item` (`role="menuitem"`), `.feed-lightbox`,
`.story-viewer`, `.feed-confirm-backdrop`/`.feed-confirm`. Dialogs are
`role="dialog"` `aria-modal`, Escape-closable, `--overlay` backdrop.

## 7. Responsive

Breakpoints (`max-width`): 1200 (rail hidden) · 1100 · 1040 · **820** (mobile
drawer; Feed topbar wraps; card radius/padding shrink) · 640 · 520. The Feed
column caps at 620px and centres; action bars wrap. Verified: **0px horizontal
overflow** at 1460px (Chat/Feed/Pages/Workspace). Coordinate any breakpoint change
with Agent 1.

## 8. Accessibility

Semantic HTML; accessible names on icon-only controls; visible `--focus-ring`;
AA contrast (both themes); `aria-modal` dialogs; `aria-hidden` decorative avatars;
reduced-motion honoured; disabled/loading states exposed. **Automated check:**
axe-core reports **0 violations** across the Feed (All/Pages/Reels), Chat and
Startup Workspace in both themes. Screen-reader pass not performed.

## 9. Consumption guide (Agents 1, 3–8)

- Use tokens, not literals: colors `var(--panel/--text/--accent*/--danger*/…)`,
  radii `var(--radius-*)`, type `var(--text-*)`, spacing `var(--space-*)`.
- Reuse existing classes/primitives above; extend via new variants in
  `styles.css` rather than duplicating.
- Solid buttons with white text **must** use `--accent-solid`/`--danger-solid`
  (AA), not `--accent`.
- Text on the black media backdrop uses `--on-media*`.
- If you add a new color/radius/size, add a token and a `designSystem.test.ts`
  assertion; never reintroduce the legacy literals.

## 10. Verification

`npm test` (includes `designSystem.test.ts`, 31 assertions), `npm run typecheck`,
`npm run lint`, `prettier --check`; axe-core in the running app. See
`design-system-progress.md` for executed results.

## 11. Known limitations

- No reference screenshot was available; direction inferred from the brief +
  existing identity.
- Off-grid tails remain: spacing 18/22/26/40px; some `ok`/`warn`/overlay alpha
  variants (intentional per-component values).
- Light theme is token-complete and axe-clean on the audited surfaces; a full
  component-by-component light pass across every screen is follow-up.
