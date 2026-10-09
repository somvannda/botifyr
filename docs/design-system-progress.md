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
9. **Guard test** `packages/ui/src/designSystem.test.ts` (30 assertions),
   including pinned dark/light token values and shape/type-scale adoption.
10. **Screenshots** for dark/light Feed (desktop + mobile) and the confirm dialog.

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
- **Shape tokens added, adoption partial** (Feed + touched surfaces) to avoid a
  large regression-prone sweep; the long tail is documented.

## Test results (actual — final gate green)

| Command | Result |
| --- | --- |
| `npx vitest run packages/ui/src/designSystem.test.ts` | **30 passed** |
| `npx vitest run packages/ui/src/designSystem.test.ts parity.test.ts smoke.dom.test.tsx` | **35 passed** |
| `npm test` | **451 passed** (64 files) |
| `npm run typecheck -w @botifyr/ui` | **clean** |
| `npm run lint` | **0 errors** |
| `npx prettier --check` (new files) | clean |
| In-app contrast audit (dark & light) | all Feed text ≥4.5:1 (audit §4.1) |
| axe-core 4.10.2 scoped to `.feed` (dark & light, composer enabled) | **0 violations** |
| `getComputedStyle` probe | `.feed-tag` → `color(srgb 0.427… / 0.14)`; `--focus-ring` = `#6d8bff`/`#3d52c2`; `--accent-solid` = `#5568e0`/`#3d52c2` |
| Visual | dark + light Feed and the confirm dialog render correctly (`docs/assets/design-system/`) |

## Remaining tasks

1. **DS-T10** introduce type/spacing token scales and adopt them incrementally.
2. Extend the axe pass to non-Feed surfaces (chat/workspace) and fix the
   light-theme gaps it surfaced (e.g. `.connect-apps-label`).
3. Normalise the 10 legacy radius one-offs (`2/3/4/5/7/11/16/22/24px`) onto the
   shape scale.
4. Re-run the gate after the concurrent Feed workstream lands (currently green).

## Blockers / caveats

- Concurrent workstream refactored `FeedView.tsx` into `Stories.tsx`/`feedKit.tsx`
  and is now changing `@botifyr/client` exports; the tree flaps between green
  (e.g. `npm test` 451 passed) and typecheck errors in their files
  (`Session` export). My design-system files stay green (30 guard tests).
- Fresh Playwright contexts no longer authenticate (the app now requires device
  keys), so `scripts/design-system-screenshots.mjs` re-capture failed; the saved
  screenshots predate the final light-accent tweak (hue-only change).
- Light theme outside the Feed is only token-deep (not component-audited); axe
  on the chat/workspace still reports findings.
- Screen-reader verification not performed.

## Exact next action

Finish DS-T10's spacing half: define a `--space-*` scale and adopt it in the
Feed's shared surfaces (card, composer, action bar, metadata). The Feed's spacing
is off-grid (5/6/7/9/10/14px), so normalise deliberately and inspect both themes,
or add explicit steps. Then re-run `npx vitest run
packages/ui/src/designSystem.test.ts` and `npm test`.
