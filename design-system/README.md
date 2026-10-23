# Golden Wattle Modern — design system reference

**Status: applied to the live site**, via `assets/style.css` directly rather
than by importing these files (this project has no build step, so the
site's actual `:root` block is now hand-synced to `tokens.css` below rather
than generated from it — if you change one, update the other). The files
here remain the canonical, framework-agnostic reference for the palette and
component rules, and `tailwind.config.js` is still just reference — this
repo has no Tailwind/React and never will unless that changes.

## Files

- `tokens.css` — the `:root` CSS custom properties block (colors, shades/tints, fonts, text-on-* pairings).
- `tailwind.config.js` — the `theme.extend` block for a Tailwind project. Won't do anything here since Tailwind isn't installed in this repo.
- `components.css` — button variants, typography scale, nav, search bar / input states. Each rule notes its Tailwind utility-class equivalent in a comment, since the brief asked for both vanilla and Tailwind framing.
- `sample-hero.html` — a self-contained hero + card layout. Open it directly in a browser (uses the self-hosted fonts in `/assets/fonts/`, pulls in `tokens.css` + `components.css`).

## One deviation from the brief, on purpose

The brief specified "Primary Button: solid golden background, light text."
White (or any light) text on `#FFD700` is roughly **1.5:1 contrast** —
fails WCAG AA (needs 4.5:1) by a wide margin. `components.css` uses dark
neutral text (`#1B1C1C`) on the gold background instead, which clears
**10.4:1**. Everything else follows the brief as given.

## What actually changed on the live site

- `assets/style.css` `:root` (and `:root[data-theme="dark"]`): `--brand` is
  now `#004D40` (was `#d3321d`), `--accent` is `#FFD700` (was `#ffcf67`),
  plus every hardcoded shadow/gradient/icon-cycling color that referenced
  the old red literally (not via the CSS variable) got swapped too.
- (Historical) Every `<link>` to Google Fonts across all 34 pages loaded `Manrope`
  instead of `Public Sans`.
- The Southern Cross favicon/logo mark (`assets/img/favicon.svg`,
  `logo-light.svg`, `logo-dark.svg`) was reconciled to this same palette:
  green `#2E5339` → `#004D40`, gold `#FFC72C` → `#FFD700`, so the mark and
  the rest of the site now share one consistent color source.
- Dark mode's `--brand` is a lightened teal tint (`#4ECDC4`), not `#004D40`
  directly — the deep teal doesn't have enough contrast against the dark
  background to work as link/button color there, same reasoning as the
  original red palette's dark-mode tint.
