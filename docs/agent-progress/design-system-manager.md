# Design System Manager (Agent 2) — Progress

> **Historical record** — ports reflect the run at the time. Canonical local dev is defined in [`AGENTS.md`](../../AGENTS.md) §10.

> Durable resume point for the Facebook-inspired **dark social UI design system**.
> Spec: [`docs/design-system-spec.md`](../design-system-spec.md) ·
> Audit: [`docs/design-system-audit.md`](../design-system-audit.md) ·
> Plan: [`docs/design-system-plan.md`](../design-system-plan.md) ·
> Inventory: [`docs/design-system-components.md`](../design-system-components.md).

## Objective

Own the shared visual foundations and reusable primitives for the Main feed,
Composer, Stories, Posts, Reels, Pages, right sidebar and fixed bottom navigation:
consistent tokens, typography, spacing, shape, states, responsive conventions and
accessibility — without rebuilding Agent 1's layout or duplicating feature agents'
work.

## Environment

- Repo `G:\Developments\botifyr.xyz` (npm workspaces); UI in `packages/ui`,
  stylesheet `packages/ui/src/styles.css`.
- Running: cloud `:8787`, portal `:4322`, desktop Vite dev `:1420`.
- Verification: `browser.*` (axe-core injected), `getComputedStyle`, plus
  `npm test` / `typecheck` / `lint` / `prettier`.

## Baseline (Phase 1 — inspected)

- **Framework:** React + Vite; **styling:** one global CSS file with custom
  properties (no Tailwind/CSS-JS); `BotifyrApp` is the single shared interface.
- **Tokens before:** `--bg/--panel/--panel-2/--border/--text/--muted/--hover/
  --bubble/--accent/--accent-2/--ok/--warn/--danger`. No shape/type/spacing/tint/
  focus/input/overlay tokens; light theme overrode only surfaces.
- **Inconsistencies found:** light theme reused dark accents (≈3:1, fails AA);
  the Feed hardcoded accent/red literals; a second red (`#f0556b`); white-on-
  `--accent` on every solid button (3.1:1); hardcoded input surface `#0e0e10`;
  ungoverned radii/type/spacing; no reduced-motion for interactive states.
- Details: `design-system-audit.md` (findings DS-1…DS-16).

## Delivered tokens (Phase 2)

- **Surfaces** `--bg/--panel/--panel-2/--hover/--bubble/--input-bg/--overlay`.
- **Text** `--text/--muted/--on-media/--on-media-muted`; **line** `--border`.
- **Accent** `--accent/--accent-2/--accent-soft/-soft-strong/-border/-glow/
  -solid`; **focus** `--focus-ring`.
- **Status** `--ok/--warn/--danger` + `-soft/-border` + `--danger-solid`.
- **Shape** `--radius-2xs/xs/control/sm/md/bubble/card/lg/pill/round`.
- **Type** `--text-4xs…--text-5xl` (10→18px); **spacing** `--space-1…6`
  (4/8/12/16/20/24).
- **Light theme** darkened accents/status to clear AA; tints derive via
  `color-mix()`.

## Files changed

- `packages/ui/src/styles.css` — all of the above; app-wide adoption of color,
  shape, type, spacing, overlay; reduced motion; Reels/lightbox on-media text.
- `packages/ui/src/FeedView.tsx` — `aria-label` on the composer schedule input.
- `packages/ui/src/designSystem.test.ts` — **31** token/contrast/literal guards.
- `docs/design-system-spec.md`, `docs/design-system-audit.md`,
  `docs/design-system-plan.md`, `docs/design-system-components.md`,
  `docs/design-system-progress.md`, and this file.
- `scripts/design-system-screenshots.mjs`, `docs/assets/design-system/*.png`.

## Components migrated / covered

Avatar, AuthorLine, PostCard, CommentRow, PageView, GroupView, ReelsView,
StoryViewer/Stories, FeedRail, Composer, buttons (primary/secondary/ghost/
destructive/icon), inputs, menus, dialogs (lightbox/confirm/story), skeletons/
empty/error states, bottom+top navigation items. All now consume tokens; no
hardcoded accent/danger/input literals remain.

## Test results (actual)

| Command | Result |
| --- | --- |
| `npx vitest run packages/ui/src/designSystem.test.ts` | **31 passed** |
| `npm test` | **467 passed** (65 files) |
| `npm run typecheck` / `lint` | exit 0 / exit 0 |
| `prettier --check` | clean |
| axe-core (Feed All/Pages/Reels, Chat, Workspace; both themes) | **0 violations** |
| Horizontal overflow (Chat/Feed/Pages/Workspace) | 0px at 1460px |

## Integration requirements for other agents

1. Consume tokens (colors/radius/type/spacing); do not hardcode literals.
2. Solid buttons with **white text** must use `--accent-solid`/`--danger-solid`.
3. Text on the black media backdrop uses `--on-media*`.
4. Add new color/radius/size tokens + a `designSystem.test.ts` assertion rather
   than one-off values.
5. Coordinate any breakpoint or shared-component contract change with Agent 1.

## Known issues / limitations

- **Reference screenshot missing** (Agent 1's note: the temp `ref.png` is a
  placeholder). Spec follows the described dark charcoal + blue direction and the
  existing identity; no pixel-accurate comparison was possible.
- Off-grid tails remain: spacing 18/22/26/40px; some `ok`/`warn`/overlay alpha
  variants (intentional per-component values).
- Screen-reader pass not performed; axe is automated only.
- Concurrent multi-agent edits touch `styles.css`/`FeedView.tsx` directly; I keep
  edits token/atomic and re-verify the gate after each batch.

## Next actions

1. If the reference screenshot arrives, do a spacing/typography/shape comparison
   pass and adjust tokens (additive, guarded).
2. Extend the axe pass to remaining non-Feed surfaces as owners land their work.
3. Close the off-grid alpha tails if a normalisation decision is made.
