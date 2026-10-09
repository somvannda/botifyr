# Design System — Improvement Plan

> Owner: **Design System Manager** · Companion to
> [`design-system-audit.md`](design-system-audit.md). Last updated: Oct 2026.

## 1. Goal

Give the Feed experience one coherent, accessible, maintainable visual
foundation: semantic tokens the Feed shares with the rest of the app, a light
theme that meets WCAG AA, and documented component conventions — without
forking the UI or changing brand identity.

## 2. Principles → decisions

| Principle | How this work honours it |
| --- | --- |
| Consistency | One red role (`--danger*`), one accent-tint set, one shape scale, one focus ring. |
| Clarity | Solid buttons use `--accent-solid`/`--danger-solid` so labels stay legible. |
| Visual hierarchy | Existing Feed hierarchy kept; only token plumbing changed. |
| Simplicity | No new dependencies; tints derived with `color-mix` instead of duplicated rgba. |
| Accessibility | Light theme meets AA; axe-clean Feed; visible `--focus-ring`; reduced motion. |
| Responsiveness | Verified at 1440/900/390 widths (screenshots); no layout change. |
| Reusability | Semantic tokens consumed by Feed, Post, Pages, Stories, Reels, Composer. |
| Maintainability | Values live in `:root`/`[data-theme=light]`; pinned by `designSystem.test.ts`. |
| Performance | CSS-only; `color-mix` computed once; no extra JS. |
| Product identity | Brand hues preserved (indigo/red) — darkened only where AA required. |

## 3. Research (Oct 2026)

Established product knowledge, not live captures:

| Reference | Pattern adopted | Why it fits |
| --- | --- | --- |
| Apple HIG / Material | Semantic color roles (not literal colors) | One source of truth per state, per theme |
| WCAG 2.2 AA | ≥4.5:1 text, visible focus, reduced motion | Legal/a11y baseline |
| Instagram / LinkedIn | quiet secondary metadata, accent used sparingly for emphasis | Matches the shipped Feed hierarchy |
| CSS `color-mix()` | derive tints from the base hue | keeps light/dark in sync without duplicating rgba |

## 4. Work items

| ID | Change | Priority | Affected | Acceptance | Status |
| --- | --- | --- | --- | --- | --- |
| DS-T1 | Add semantic tint tokens `--accent-soft`, `--accent-soft-strong`, `--accent-border`, `--accent-glow`, `--danger-soft`, `--danger-border`, `--focus-ring` | P0 | `:root` | tokens resolve; components use them | **Done** |
| DS-T2 | Accessible light theme: override `--accent`, `--accent-2`, `--ok`, `--warn`, `--danger` | P0 | `[data-theme=light]` | every pair ≥4.5:1 | **Done** |
| DS-T3 | Fix light `--muted` contrast | P0 | `[data-theme=light]` | `--muted on --bg` ≥4.5:1 | **Done** |
| DS-T4 | Adopt tokens in the Feed; remove raw accent/danger literals | P0 | Feed region of `styles.css` | 0 literals app-wide | **Done** |
| DS-T5 | Shape scale tokens; adopt across surfaces | P2 | `:root`, `styles.css` | values unchanged | **Done** (common radii) |
| DS-T6 | Reduced motion for interactive Feed states | P1 | Feed | reaction pop disabled when requested | **Done** |
| DS-T7 | Token/contrast guard test | P1 | `designSystem.test.ts` | test green | **Done** |
| DS-T8 | Tokenise the global accent literals (chat/workspace) | P2 | rest of `styles.css` | same computed colors | **Done** |
| DS-T9 | Normalise the red family to `--danger*` | P2 | `styles.css` | one red role | **Done** |
| DS-T10 | Type/spacing token scale | P3 | `styles.css` | documented scale adopted incrementally | **Partial** (type scale app-wide; 4-pt spacing grid, Feed-first) |
| DS-T11 | Automated a11y check (axe) + light-theme component pass | P3 | CI, UI | axe clean on Feed | **Partial** (axe clean on Feed; non-Feed pending) |
| DS-T12 | `--danger-solid` for solid destructive buttons (white text ≥4.5:1) | P1 | `:root`, `.feed-confirm-danger` | 4.8:1 in both themes | **Done** |
| DS-T13 | `--accent-solid` for solid accent buttons (white text ≥4.5:1) | P1 | `:root`, Feed buttons | ≥4.7:1 in both themes | **Done** |
| DS-T14 | `--input-bg` for input/search surfaces; drop the scattered light override | P2 | `:root`/`[data-theme=light]`, inputs | identical computed values | **Done** |
| DS-T15 | Apply `--accent-solid` to all solid-accent elements (not just the Feed) | P1 | `styles.css` | 0 white-on-`--accent`; axe clean | **Done** |
| DS-T16 | `--on-media` / `--on-media-muted` for text on dark media backdrops; fix Reels empty state | P1 | `:root`, `.reels-scroll` | axe clean (light Reels) | **Done** |
| DS-T17 | Status tint tokens `--ok-soft/-border`, `--warn-soft/-border` | P2 | `:root`, components | value-preserving; light-adaptive | **Done** |
| DS-T18 | Close the shape/overlay tails (`--radius-2xs/-lg`, `--overlay`) | P3 | `styles.css` | all `border-radius` tokenised | **Done** |

## 5. Acceptance criteria

- Tokens are the single source for accent/danger tints and the five semantic
  colors; changing `--accent` updates every tint automatically.
- Both themes satisfy WCAG AA for Feed text, verified by measurement and a test.
- No visual change in the dark theme beyond the intentional red unification
  (`#f0556b` → `--danger`), confirmed by before/after screenshots.
- `npm run typecheck -w @botifyr/ui`, `npm test`, `eslint` green for touched files.

## 6. Dependencies & risks

- **Depends on** `color-mix()` support (verified in the desktop WebView).
- **Concurrent workstream** edits `FeedView.tsx`/`styles.css`; keep edits
  content-matched and re-verify integration after it lands.
- Light-theme component coverage outside the Feed is deliberately deferred.

## 7. Verification

See [`design-system-progress.md`](design-system-progress.md) for executed
commands, results and screenshots (`docs/assets/design-system/`).
