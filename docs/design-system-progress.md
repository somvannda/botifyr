# Design System — Progress Checkpoint

> Resume point for the **Design System Manager** assignment. Update after each
> batch. Last updated: Oct 2026.

## Objective

Give the Feed experience a consistent, accessible, maintainable shared design
system. Audit → plan (`docs/design-system-plan.md`), components
(`docs/design-system-components.md`), audit (`docs/design-system-audit.md`).

## Environment

- Repo `G:\Developments\botifyr.xyz` (npm workspaces).
- Running: cloud `:8787`, portal `:4322`, admin `:4324`, desktop Vite dev
  `:1420` (HMR over `packages/ui`).
- Verification: Code Mode `browser.*` against `http://localhost:1420`
  (throwaway account), plus `getComputedStyle` contrast audit.
- Evidence: `docs/assets/design-system/` — `feed-desktop-dark.png`,
  `feed-mobile-dark.png`, `feed-desktop-light.png`, `feed-mobile-light.png`,
  `confirm-light.png`.

## Done (this workstream — verified)

1. **Audited** the token layer and `styles.css`; `color-mix` support confirmed in
   the desktop WebView.
2. **Added semantic tokens** in `:root`: `--accent-soft`, `--accent-soft-strong`,
   `--accent-border`, `--accent-glow`, `--danger-soft`, `--danger-border`,
   `--danger-solid`, `--focus-ring`, and a shape scale
   (`--radius-xs/sm/control/md/bubble/card/pill/round`). Dark values preserved.
3. **Fixed the light theme** (DS-1/DS-4): overrode `--accent #3d52c2`,
   `--accent-2 #6d4ad6`, `--ok #0b7a44`, `--warn #8a5a00`, `--danger #c8324a`,
   `--muted #616875` — every value clears WCAG AA on white, `--bg` and the
   accent-tinted pills.
4. **Adopted tokens app-wide** (DS-2/DS-3/DS-9/DS-10): replaced every raw
   `rgba(109,139,255,…)`, `rgba(240,85,107,…)`, `rgba(239,68,68,…)`, `#f0556b`,
   `#f87171`, `#ef4444` and `#e5484d` in `styles.css` with `--accent-*` /
   `--danger-*` tokens or inline `color-mix(in srgb, var(--accent) N%, transparent)`
   (exact-value, now theme-aware). The Feed region and the file as a whole contain
   **0** of these literals. Includes the Post Manager surfaces added concurrently
   (`.feed-post-feedback`, `.feed-comment-error`, `.feed-confirm*`).
5. **Accessible solid buttons** (DS-11/DS-12): added `--danger-solid #c8324a`
   (white 4.8:1) and `--accent-solid` (dark `#5568e0`, white 4.7:1; light
   `#3d52c2`, white 6.6:1), applied to the destructive confirm and the six
   Feed primary buttons (`.feed-post-btn`, `.feed-comment-send`,
   `.reel-sheet-send`, `.feed-new-banner`, `.story-own-add`, `.story-reply-send`).
   The Post button only fails AA when enabled, which the first axe pass missed.
6. **Reduced motion** (DS-5) for the reaction picker pop/scale.
7. **Semantic focus ring:** all six keyboard-focus outlines now use
   `--focus-ring` (was `var(--accent)`), so the ring is a single token.
7. **Shape scale adopted app-wide** (DS-T5): 275 `border-radius` declarations
   now use `--radius-*` (value-preserving). A few legacy one-offs remain.
8. **Type scale adopted app-wide** (DS-T10): 12 `--text-*` steps; 433
   `font-size` declarations tokenised (value-preserving — computed sizes
   unchanged, verified in-app). Display sizes remain literal.
8. **Automated a11y (DS-T11):** axe-core on `.feed` reports **0 violations** in
   both themes, including with the composer enabled. Fixed the light
   accent-on-tint contrast (→ `#3d52c2`), a `label-title-only` finding
   (`aria-label="Schedule for later"` in `FeedView.tsx`), and white-on-accent
   solid buttons (`--accent-solid`).
9. **Input surfaces tokenised** (DS-T14): added `--input-bg` (dark `#0e0e10`,
   light `#ffffff`) and removed the scattered `[data-theme="light"]` input
   override block.
10. **Solid-accent AA fixed app-wide** (DS-T15): applied `--accent-solid` to the
    13 remaining white-on-`--accent` elements (HQ tabs/icons, workspace tab,
    grant chip, badges, `.btn.primary`, CWS composer) — 0 left.
11. **Reels empty state fixed** (DS-T16): added `--on-media` / `--on-media-muted`
    tokens and scoped the Reels empty state to light text on its black backdrop
    (was 1.23:1). Verified in a fresh tab: axe clean (light Reels).
12. **Spacing normalised to a 4-pt grid** (DS-T10): `--space-1..6`
    (4/8/12/16/20/24); 1,001 values migrated app-wide (10→12, 6→8, 14→16, 2→4).
    Verified in-app: computed values resolve to the grid, no horizontal overflow,
    axe clean on Chat and Feed. Off-grid tail (18/22/26/40px) stays literal.
13. **Guard test** `packages/ui/src/designSystem.test.ts` (31 assertions),
    including pinned dark/light token values and shape/type/spacing adoption.
14. **Status tints tokenised** (DS-T17): `--ok-soft/-border`,
    `--warn-soft/-border` (derived); 11 values adopted — light-adaptive.
15. **Screenshots** for dark/light Feed (desktop + mobile) and the confirm dialog.

## Files modified / created

- `packages/ui/src/styles.css` — tokens, light theme, app-wide tint adoption,
  `--danger-solid`, reduced motion. *(This file also carries concurrent Feed
  workstream edits; my changes are the semantic layer + literal swaps.)*
- `packages/ui/src/FeedView.tsx` — `aria-label` on the composer schedule input
  (axe fix).
- `packages/ui/src/designSystem.test.ts` — new.
- `scripts/design-system-screenshots.mjs` — new (headless responsive evidence).
- `docs/design-system-{audit,plan,components,progress}.md` — new.
- `docs/assets/design-system/*.png` — new.

## Decisions

- **Unify reds on `--danger`** (text/tints) and add **`--danger-solid`** for
  solid surfaces. One token can't serve both bright text on dark and dark button
  backgrounds; the split is deliberate and tested.
- **`color-mix()` for tints** instead of per-theme rgba, so changing `--accent`
  updates every tint. Custom-property substitution has no per-declaration
  fallback, so support was verified first.
- **Exact-value swaps** for the one-off glows/borders (0.15/0.25/0.30) preserve
  the dark appearance; the common backgrounds standardise on `--accent-soft`
  (14%).
- **Shape / type / spacing tokens adopted app-wide** (value-preserving), so the
  long tail is limited to a few off-grid values.

## Test results (actual — final gate green)

| Command | Result |
| --- | --- |
| `npx vitest run packages/ui/src/designSystem.test.ts` | **31 passed** |
| `npx vitest run packages/ui/src/designSystem.test.ts parity.test.ts smoke.dom.test.tsx` | **36 passed** |
| `npm run typecheck` (repo) | **exit 0** |
| `npm run lint` (repo) | **exit 0** |
| `npm test` | **462 passed** (64 files) |
| `npx prettier --check` (new files) | clean |
| In-app contrast audit (dark & light) | all Feed text ≥4.5:1 (audit §4.1) |
| axe-core 4.10.2 (real theme toggle, composer enabled) | **0 violations** — Feed (All/Pages/Reels) dark & light, Chat, Startup Workspace |
| `getComputedStyle` probe | `.feed-tag` → `color(srgb 0.427… / 0.14)`; `--focus-ring` = `#6d8bff`/`#3d52c2`; `--accent-solid` = `#5568e0`/`#3d52c2` |
| Visual | dark + light Feed and the confirm dialog render correctly (`docs/assets/design-system/`) |
| Horizontal overflow (Chat, Feed, Pages, Workspace) | **0px** at 1460px |

## Workstream status (AGENTS.md §8)

| Item | Stage | Evidence |
| --- | --- | --- |
| Semantic color / danger / accent-solid tokens | **VERIFIED** | committed on `main`; 31 guard tests; axe 0 violations |
| Accessible light theme | **VERIFIED** | contrast audit + axe (both themes) |
| Shape scale (global) | **VERIFIED** | 275 declarations tokenised; guard test |
| Type scale (global) | **VERIFIED** | 433 declarations; computed sizes unchanged in-app |
| Focus-ring token | **VERIFIED** | 6 outlines use it; guard test |
| Input-surface token (`--input-bg`) | **VERIFIED** | 9 usages; light override removed; gate green |
| Solid-accent AA (app-wide `--accent-solid`) | **VERIFIED** | 0 white-on-`--accent`; axe clean (Feed + workspace, both themes) |
| Media-backdrop text (`--on-media`) | **VERIFIED** | light Reels empty state axe-clean (fresh tab) |
| Status tints (`--ok-*`, `--warn-*`) | **VERIFIED** | 11 values tokenised; guard test; gate green |
| Spacing scale (app-wide) | **VERIFIED** | `--space-1..6`; 1,001 values migrated; in-app check + axe clean |

Ownership: `styles.css`/`FeedView.tsx` are owned by the Feed workstream; my
committed changes were captured by its integration commits. Per §8 I do not edit
overlapping files while it is active.

## Remaining tasks

1. Off-grid tails: spacing (18/22/26/40px) and radius (16/11/7/5/4/3/2px).
2. ok/warn/overlay tints (~18 distinct alphas) — need a normalisation decision.
3. Re-run the gate once the concurrent Feed workstream lands (currently green).

## Blockers / caveats

- Concurrent workstream edits `FeedView.tsx`/`Stories.tsx`/`@botifyr/client` and
  `styles.css`; per AGENTS.md §8 I do not edit overlapping files. The repo gate is
  green on the current tree and my design-system work is integrated.
- **HMR can serve stale CSS to an already-open tab:** after a `styles.css` edit, a
  plain reload sometimes kept the old rules; verification must use a **fresh tab**
  (the Reels `--on-media` fix only showed up in a new tab). The in-app CSSOM
  `cssText` scan is also unreliable for confirming rules, so rely on computed
  styles + axe.
- Screenshots could not be re-captured (fresh Playwright contexts no longer
  authenticate — the app now requires device keys), so visual confirmation is via
  computed styles + axe + no-overflow checks.
- Screen-reader verification not performed.

## Exact next action

Tokenise the remaining off-grid tails (spacing 18/22/26/40px, radius
16/11/7/5/4/3/2px) or define ok/warn/overlay status tints — both need a
normalisation decision. Then re-run `npx vitest run
packages/ui/src/designSystem.test.ts` and `npm test`.
