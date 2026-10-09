# Design System — Audit

> **Historical record** — ports reflect the run at the time. Canonical local dev is defined in [`AGENTS.md`](../AGENTS.md) §10.

> Owner: **Design System Manager** · Scope: shared tokens, primitives and
> conventions used by the Feed experience (Feed, Posts, Reels, Stories, Pages,
> Composer). Last updated: Oct 2026.
>
> Companion docs: [`design-system-spec.md`](design-system-spec.md) (specification),
> [`design-system-plan.md`](design-system-plan.md),
> [`design-system-components.md`](design-system-components.md),
> [`design-system-progress.md`](design-system-progress.md),
> [`agent-progress/design-system-manager.md`](agent-progress/design-system-manager.md).

## 1. Method

Inspected the live repository and the running app:

- `packages/ui/src/styles.css` — the single global stylesheet (160 KB, ~9,700 lines).
- `packages/ui/src/FeedView.tsx`, `BotifyrApp.tsx`, `Icons.tsx`, `Avatar`.
- `packages/ui/src/*.test.*` (existing guardrails).
- Running desktop dev host `http://localhost:1420` (Vite + HMR): tokens read via
  `getComputedStyle`, Feed surfaces audited in both themes.

No Tailwind, CSS-in-JS or component library is present. Styling is **plain CSS
with custom properties** on `:root` (dark default) plus a
`[data-theme="light"]` override, toggled by `document.documentElement`
(`BotifyrApp.tsx`, Settings → Appearance). Fonts: bundled Inter (100–900) with
Noto Sans Khmer fallback.

## 2. Token inventory (before this work)

| Token | Dark (`:root`) | Light override | Role |
| --- | --- | --- | --- |
| `--bg` | `#0a0a0b` | `#f5f6f8` | page background |
| `--panel` | `#121214` | `#ffffff` | raised surface (cards) |
| `--panel-2` | `#17171a` | `#eef0f3` | inset surface (inputs, bubbles) |
| `--border` | `#26262b` | `#e0e3e9` | borders/dividers |
| `--text` | `#ececef` | `#1a1c21` | primary text |
| `--muted` | `#8b8b92` | `#6b7280` | secondary text |
| `--hover` | `#232327` | `#e6e9ef` | hover fill |
| `--bubble` | `#2a2a2e` | `#e4e7ee` | chat bubble |
| `--accent` | `#6d8bff` | **not overridden** | primary action / links |
| `--accent-2` | `#8f6dff` | **not overridden** | accent gradient |
| `--ok` | `#3fd18b` | **not overridden** | success |
| `--warn` | `#f2b544` | **not overridden** | warning |
| `--danger` | `#ff6b6b` | **not overridden** | error/destructive |

There were **no** tokens for: interaction tints, focus ring, radii, spacing,
typography or elevation. Those values were inlined per rule.

## 3. Findings

| # | Finding | Severity | Evidence | Status |
| --- | --- | --- | --- | --- |
| DS-1 | Light theme reuses the **dark** `--accent`/`--accent-2`/`--ok`/`--warn`/`--danger` on white. `#6d8bff` ≈ **3.1:1** — fails WCAG AA for text. | High | Source + measured `#accent on --panel = 3.09:1` | **Fixed** |
| DS-2 | The Feed hardcodes `rgba(109,139,255,…)` and a *different* red `#f0556b` instead of tokens — two reds for one semantic. | High | Source `styles.css` Feed region | **Fixed** (app-wide) |
| DS-3 | No semantic interaction tints (`--accent-soft`, `--danger-soft`, …); every rule invented its own alpha. | Medium | 6 distinct alphas for the accent tint | **Fixed** |
| DS-4 | `--muted` in light theme (`#6b7280`) = **4.47:1** on `--bg` — just under AA. | Medium | Measured in-app | **Fixed** (`#616875`, 5.19:1) |
| DS-5 | Reduced-motion honoured only for skeletons + story progress; `.reaction-btn` hover scale still animated. | Low | `styles.css` | **Fixed** |
| DS-6 | Radii ungoverned: 54× `999px`, then `8/9/10/11/12/14/16px` — no scale. | Low | `grep border-radius` | **Fixed** (all `border-radius` now uses `--radius-*`; tail normalised onto the scale) |
| DS-7 | Type scale inlined: 74× `12.5px`, 73× `12px`, 64× `13px`, … 26 distinct sizes. | Low | `grep font-size` | **Fixed** (12 `--text-*` steps; 433 declarations adopted) |
| DS-8 | Spacing inlined; no scale. | Low | `grep gap/padding` | **Fixed** (4-pt grid `--space-1..6`; 1,001 values migrated app-wide) |
| DS-9 | Global accent literals remained outside the Feed (chat, workspace, page composer). | Low | 12× `rgba(109,139,255,…)` outside Feed | **Fixed** (all → tokens/`color-mix`) |
| DS-10 | Red family drift app-wide: `#f0556b`, `#f87171`, `#ef4444`, `#e5484d`, `--danger #ff6b6b`. | Low | `grep` counts | **Fixed** (all unified to `--danger*`) |
| DS-11 | Solid destructive button used `#f0556b` with white text — **3.4:1** (fails AA); switching to `--danger` would worsen it. | Medium | `.feed-confirm-danger` | **Fixed** via `--danger-solid` (4.8:1) |
| DS-12 | Solid **accent** buttons (Post, comment send, story reply/send, reel sheet) put white text on `--accent` — **3.09:1** in dark (fails AA). Only visible once the composer is enabled, so the first axe pass missed it. | High | `.feed-post-btn`, `.feed-comment-send`, `.story-*`, `.reel-sheet-send` | **Fixed** via `--accent-solid` (4.7–6.6:1) |
| DS-13 | Input/search surfaces hardcoded `#0e0e10` (9×) with a scattered `[data-theme="light"]` override block — duplicated theming. | Low | `styles.css` | **Fixed** via `--input-bg`; override block removed |
| DS-14 | The same white-on-`--accent` AA failure (DS-12) exists in **13 non-Feed** solid-accent elements (HQ tabs/icons, workspace tab, grant chip, badges, `.btn.primary`, CWS composer). | High | `styles.css` | **Fixed** via `--accent-solid` app-wide |
| DS-15 | Reels empty state (`No reels yet`) used light-theme text on the black Reels backdrop — **1.23:1**. | Medium | `.reels-scroll .feed-empty-*` | **Fixed** via `--on-media` / `--on-media-muted` |
| DS-16 | `--ok`/`--warn` tints inlined as `rgba(…)` across components. | Low | `styles.css` | **Fixed** via `--ok-soft/-border`, `--warn-soft/-border` (11 values) |

## 4. Accessibility

### 4.1 Measured text contrast (in-app, after the fix)

Computed on the running Feed via `getComputedStyle`, resolving the effective
background by walking the DOM.

| Element | Dark | Light |
| --- | --- | --- |
| `.feed-body` / `.feed-author-name` (`--text`) | 15.87:1 | 17.05:1 |
| `.feed-author-sub` / `.feed-action` (`--muted`) | 5.53:1 | 4.83:1 |
| `.feed-tag` (`--accent` on the tinted pill) | 6.05:1 | 5.35:1 |
| `.feed-tab.active` (`--accent` on the tinted pill) | 6.40:1 | 4.98:1 |
| `.feed-follow-btn` (`--accent`) | 6.40:1 | 4.98:1 |
| `--accent` on plain white | — | 6.59:1 |

All Feed text now clears WCAG AA (≥4.5:1) in **both** themes, including
accent text sitting on the `--accent-soft` tinted pills. The light `--accent`
was tuned to `#3d52c2` for exactly this reason (the earlier `#4b64d8` measured
3.95–4.23:1 on the tint). `designSystem.test.ts` locks these pairs in.

### 4.2 Other checks

- **Focus:** `.feed button/input/textarea/select/[role=menuitem]:focus-visible`
  get `outline: 2px solid var(--accent); outline-offset: 2px` (FEED-2). The
  light theme accent change keeps the ring visible on white.
- **Reduced motion:** skeletons, story progress and the reaction pop now opt out.
- **Semantics:** media lightbox and story viewer are `role="dialog"`
  `aria-modal`; icon-only controls carry `aria-label`; emoji avatars are
  `aria-hidden`.
- **Automated a11y (axe-core 4.10.2):** using the app's real theme switch,
  `.feed` and the shell report **0 violations** in both themes (composer
  enabled; Startup Workspace clean in light). Four findings were fixed to get
  there: the light accent on tinted pills, a `label-title-only` on the schedule
  input, white-on-accent on the solid primary buttons (Feed **and 13 app-wide**),
  and the workspace tab.
- **Method note:** toggling `data-theme` directly is unreliable — some
  components key off React theme state, not the attribute — so axe audits must
  use the app's switch (or set `botifyr.theme` and reload). The earlier
  `.connect-apps-label` finding was such an artifact (real bg `#eef0f3`, no
  violation).
- **Not verified:** a full screen-reader pass.

## 5. Risks / caveats

- **Concurrent editing:** another workstream is active in `FeedView.tsx` /
  `styles.css`. Token edits are content-matched and value-preserving, but the
  Feed's component tree may still change under us.
- **`color-mix()`** powers the tint tokens. Verified supported in the desktop
  WebView (`CSS.supports` → true) and in Chromium; older engines would drop the
  tint. Fallback literals were intentionally not used (custom-property
  substitution does not fall back per-declaration).
- **Light theme coverage** is still shallow: only tokens are fixed here; a
  component-by-component light pass (chat, workspace) is follow-up.

## 6. Recommendations (prioritised)

1. ~~**P1 — tokenise the long tail** (DS-9)~~ — **done**; the accent tint and the
   legacy Feed red are gone app-wide, guarded by `designSystem.test.ts`.
2. ~~**P2 — normalise the remaining reds** (DS-10)~~ — **done**; `#f87171`,
   `#ef4444`, `#e5484d` and `rgba(239,68,68,…)` all now use `--danger*`.
3. **P2 — shape/spacing/type tokens** (DS-6/7/8): the shape scale is now adopted
   app-wide; type/spacing scales are documented and adopted incrementally.
4. **P3 — light-theme component pass** and an automated a11y check (axe) in CI.
