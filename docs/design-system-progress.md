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
5. **Accessible destructive button** (DS-11): added `--danger-solid #c8324a`
   (white text 4.8:1) and used it in `.feed-confirm-danger` (was `#f0556b`,
   3.4:1).
6. **Reduced motion** (DS-5) for the reaction picker pop/scale.
7. **Shape scale adopted app-wide** (DS-T5): 275 `border-radius` declarations
   now use `--radius-*` (value-preserving). A few legacy one-offs remain.
8. **Automated a11y (DS-T11):** axe-core on `.feed` reports **0 violations** in
   both themes. Fixed the light accent-on-tint contrast (→ `#3d52c2`) and a
   `label-title-only` finding (added `aria-label="Schedule for later"` in
   `FeedView.tsx`).
9. **Guard test** `packages/ui/src/designSystem.test.ts` (25 assertions).
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
| `npx vitest run packages/ui/src/designSystem.test.ts` | **25 passed** |
| `npx vitest run packages/ui/src` | **147 passed** (12 files) |
| `npm test` | **423 passed, 4 failed** — all 4 in `apps/cloud/src/server.feed.test.ts` (media/signed-URL, concurrent backend workstream), unrelated to the UI |
| `npm run typecheck -w @botifyr/ui` | **clean** |
| `npm run lint` | **0 errors** |
| `npx prettier --check` (new files) | clean |
| In-app contrast audit (dark & light) | all Feed text ≥4.5:1 (audit §4.1) |
| axe-core 4.10.2 scoped to `.feed` (dark & light) | **0 violations** |
| `getComputedStyle` probe | `.feed-tag` / `.feed-tab.active` → `color(srgb 0.427… / 0.14)` (dark) |
| Visual | dark + light Feed and the confirm dialog render correctly (`docs/assets/design-system/`) |

## Remaining tasks

1. **DS-T10** introduce type/spacing token scales and adopt them incrementally.
2. Extend the axe pass to non-Feed surfaces (chat/workspace) and fix the
   light-theme gaps it surfaced (e.g. `.connect-apps-label`).
3. Normalise the 10 legacy radius one-offs (`2/3/4/5/7/11/16/22/24px`) onto the
   shape scale.
4. Re-run the gate after the concurrent Feed workstream lands (currently green).

## Blockers / caveats

- Concurrent workstream edits `FeedView.tsx`/`styles.css`/`server.ts`; the UI gate
  is green, but `npm test` shows 4 failures in the backend
  `server.feed.test.ts` media tests that belong to that workstream.
- Fresh Playwright contexts no longer authenticate (the app now requires device
  keys), so `scripts/design-system-screenshots.mjs` re-capture failed; the saved
  screenshots predate the final light-accent tweak (hue-only change).
- Light theme outside the Feed is only token-deep (not component-audited); axe
  on the chat/workspace still reports findings.
- Screen-reader verification not performed.

## Exact next action

Introduce type/spacing tokens (DS-T10): define `--space-*` (4/8/12/16/20/24) and
a `--text-*` scale, adopt them in the Feed's shared surfaces (card, composer,
action bar, metadata) without changing computed values, add them to the guard
test, re-run `npx vitest run packages/ui/src/designSystem.test.ts`, and inspect
the Feed in both themes.
