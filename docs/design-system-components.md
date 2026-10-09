# Design System — Component Inventory

> Owner: **Design System Manager** · Shared primitives used by the Feed
> experience. Conventions, variants and accessibility requirements for each.
> Last updated: Oct 2026.

## 1. Tokens

Defined in `packages/ui/src/styles.css`. Components must reference these, never
raw colors.

| Group | Tokens |
| --- | --- |
| Surfaces | `--bg`, `--panel`, `--panel-2`, `--hover`, `--bubble` |
| Text | `--text` (primary), `--muted` (secondary) |
| Lines | `--border` |
| Accent | `--accent`, `--accent-2`, `--accent-soft`, `--accent-soft-strong`, `--accent-border`, `--accent-glow`, `--accent-solid` |
| Status | `--ok`, `--warn`, `--danger`, `--danger-soft`, `--danger-border`, `--danger-solid` |
| Focus | `--focus-ring` (= `--accent`) |
| Shape | `--radius-xs` 6 · `--radius-sm` 9 · `--radius-control` 8 · `--radius-md` 10 · `--radius-bubble` 12 · `--radius-card` 14 · `--radius-pill` 999 · `--radius-round` 50% |
| Type | `--text-4xs` 10 · `--text-3xs` 10.5 · `--text-2xs` 11 · `--text-xs` 11.5 · `--text-sm` 12 · `--text-md` 12.5 · `--text-lg` 13 · `--text-xl` 13.5 · `--text-2xl` 14 · `--text-3xl` 15 · `--text-4xl` 16 · `--text-5xl` 18 |

Tints (`--accent-soft`, `--danger-soft`, `--accent-glow`, …) are derived with
`color-mix(in srgb, <base> N%, transparent)` so they follow the base color into
the light theme automatically.

**Shape adoption:** the common corner radii (`999px`, `14`, `12`, `10`, `9`,
`8`, `6px`, `50%`) are tokenised app-wide (275 declarations). A few legacy
one-offs (`2/3/4/5/7/11/16/22/24px`) remain and are scheduled for normalisation
onto the scale.

**Type scale.** All common font sizes now use `--text-*` tokens (411 + 22
declarations). Feed body `--text-xl` 13.5px/1.55 · author name `--text-xl` ·
labels/actions `--text-md` 12.5px · tags `--text-sm` 12px · captions `--text-xs`
11.5px · micro `--text-3xs` 10.5px · titles `--text-3xl`/`--text-4xl` 15–16px.
Display sizes (20/22/24/26/28/30/36/40px) remain literal. Truncation:
`overflow:hidden; text-overflow:ellipsis; white-space:nowrap` (single line) or
`-webkit-line-clamp` (multi-line).

**Spacing (observed convention).** 4-pt base with an 8-pt rhythm for layout:
content padding `12–16px`, gaps `8/10/12px`, section spacing `16–22px`.

## 2. Primitives

### Avatar — `Avatar` (`FeedView.tsx`)
- **Variants:** photo (`img.feed-avatar.feed-avatar-photo`, `loading="lazy"`,
  `object-fit:cover`) vs emoji/initial fallback (`span.feed-avatar`, glyph at
  `size*0.5`). Sizes used: 24, 30, 32, 36, 40 (default), 64.
- **Consumers:** `AuthorLine`, `CommentRow`, Page/Group headers, Story viewer,
  Feed rail (`people/pages/groups`).
- **A11y:** fallback is `aria-hidden` (decorative; a name is always adjacent).
  Photo carries `alt={name}`. Keep the size prop so all call sites agree.

### AuthorLine — `AuthorLine` (`FeedView.tsx`)
- Avatar + name + `@handle · time`. Consumers: `PostCard`, page timeline.
- **A11y:** name is real text (not an image), so it is announced once.

### Buttons
| Class | Role | Notes |
| --- | --- | --- |
| `.feed-post-btn` | primary (solid `--accent-solid`, white text, pill) | `:disabled` opacity .5 |
| `.feed-follow-btn` | secondary/outline | `.following` mutes it |
| `.feed-more` | secondary (panel-2, pill) | pagination |
| `.feed-comment-send` | primary icon-only | `aria-label` required |
| `.feed-action` | tertiary (borderless, flex-1) | `.active` uses `--danger`; `.feed-action-danger` uses `--danger` |
| `.feed-composer-tool` | tertiary | Photo/Mood/Poll |
| `.feed-menu-item` | menu row (`role="menuitem"`) | `.feed-menu-danger` uses `--danger` |
| `.feed-confirm-cancel` / `.feed-confirm-danger` | dialog actions | danger uses `--danger-solid` (white text ≥4.5:1) |

Requirements: real `<button type="button">`; ≥32px hit target; visible
`:focus-visible` ring (`.feed` rule); disabled via `:disabled`, not `pointer-events`.

### Inputs / textareas
- `.feed-composer-input` (borderless textarea), `.feed-comment-input` (pill,
  `--panel-2`), `.feed-composer-as-input`.
- Placeholder is a hint, always paired with a label (`aria-label` or visible
  label). Focus = `border-color: var(--accent)` and the shared ring.
- The composer counter (`.feed-composer-count`, `.over` → `--danger`) is
  `aria-live`-friendly text next to the publish button.

### Menus / dropdowns
- `.feed-menu` + `.feed-menu-item` + `.feed-menu-sep`. Triggered by
  `.feed-action-more` ("More options"). Items are `role="menuitem"`; the
  destructive item is visually red and last, behind `.feed-menu-sep`.
- **A11y:** the trigger has an accessible name; destructive actions are never
  top-level buttons (FEED-1).

### Dialogs / overlays
- `MediaLightbox` (`.feed-lightbox`), `StoryViewer` (`.story-viewer`). Both
  `role="dialog"`, `aria-modal="true"`, labelled; Escape closes; arrows navigate.
- Overlays are fixed, above the shell (`z-index` 300/320), and render inside the
  `.feed` subtree so the shared focus ring applies.

### Loading / empty / error
- `LoadingState` → `.feed-skeleton*` (shimmer, disabled under reduced motion).
- Empty → `.feed-empty` (+ emoji/title/sub); retry → `.feed-error` with
  `.feed-error-retry` (now `--danger*` tokens).

### Icons — `Icons.tsx`
- Inline SVG, `viewBox="0 0 24 24"`, `stroke="currentColor"`, `strokeWidth 1.9`,
  `strokeLinecap/Join="round"`, default `size=18`, `aria-hidden`.
- Filled exceptions: `MoreIcon`, `PlayIcon`, `PauseIcon`, `StopIcon`.
- `HeartIcon` lives in `FeedView.tsx` (stroke 2, toggleable fill). Prefer moving
  it into `Icons.tsx` if more consumers appear. Icon-only buttons need an
  `aria-label`; pair text with the icon where possible.

## 3. Responsive & theme conventions

Breakpoints (`max-width`, from `styles.css`):

| Width | Effect |
| --- | --- |
| 1200px | 3-column shell collapses (right rail hidden) |
| 1100px | Feed grid tightens |
| 1040px | secondary columns drop |
| **820px** | **mobile drawer breakpoint**: shell nav becomes a drawer, the Feed topbar wraps, cards drop to `--radius-bubble`/12px padding |
| 640px / 520px | narrow cards; composer and action bar stack |

Rules:
- The Feed content column is capped at **620px** and centred; the action bar
  wraps with `row-gap`.
- Touch targets stay ≥32px; hit areas don't shrink below the control.
- Both themes are driven entirely by tokens — components must not hardcode
  colors (enforced by `designSystem.test.ts`).

## 4. Shared across the app
- `BotLogo`, `BrandIcons`, `AppIcons` — brand/app glyphs (not Feed-specific).
- `Markdown`, `ErrorBoundary` — shared rendering/error primitives.
- **One UI, two hosts:** `BotifyrApp` is the only interface; desktop/portal are
  thin bridges (`parity.test.ts` enforces this).

## 5. Guardrails
- `designSystem.test.ts` — tokens exist, light theme overrides all five semantic
  colors, and WCAG AA contrast holds for text/muted/accent/danger in both themes;
  the Feed region contains no raw accent/danger literals.
- `FeedView.dom.test.tsx` — Feed behaviour (actions, lightbox, stories, reels,
  composer).
- `parity.test.ts` — hosts stay thin and share `BotifyrApp`.
