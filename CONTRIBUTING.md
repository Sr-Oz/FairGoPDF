# Contributing

Thanks for considering a contribution! This project intentionally stays simple: plain HTML/CSS/JS,
no build step, no framework.

## Ground rules

- **Privacy is non-negotiable.** Nothing in a tool page may upload user files to a server or a
  third party. If a feature genuinely needs server-side processing, it doesn't belong in this repo
  as-is — open an issue to discuss it first.
- **No new build tooling** (bundlers, transpilers, package managers as a hard requirement) without
  a strong reason and prior discussion in an issue. The zero-build-step setup is a deliberate
  choice, not an oversight.
- **No accounts, no email gates, no watermarks.** Keep tools genuinely free and frictionless.

## Adding a new tool

1. Create a new folder at the repo root named after the tool's URL slug, e.g. `rotate-pdf/`, with
   an `index.html` inside (so it's served at `/rotate-pdf/`).
2. Copy the structure of an existing tool page (e.g. `compress-image/index.html` or
   `merge-pdf/index.html`) for the layout markup. The header and footer are shared, see
   "Shared header and footer" below.
3. Add the tool's logic as a new file in `assets/tools/your-tool.js`. Reuse the helpers in
   `assets/tools.js` (dropzone wiring, download triggering, byte formatting) and, for PDF tools,
   `assets/tools/pdf-common.js` (pdf-lib / pdf.js loading and rendering helpers).
4. Add a card for it on the homepage (`index.html`) in the appropriate section.
5. Add it to the tool table in `README.md`.
6. Test it locally by running a static server (see README) and exercising the tool in a browser —
   including drag-and-drop, at least one mobile viewport width, and an invalid/edge-case input.

## Shared header and footer

There's no build step, so every page contains its own copy of the site header and footer. To keep
them identical, `partials/header.html` and `partials/footer.html` are the master copies:

1. Edit the file in `partials/` (never the copy inside a single page).
2. Run `python scripts/sync-partials.py` to copy it into every page.
3. Commit the partial and the updated pages together.

`python scripts/sync-partials.py --check` reports any page that has drifted without changing
anything. The 404 page is skipped on purpose (reduced header, no footer). If a change needs a new
third-party domain (for example an image host), the Content-Security-Policy `<meta>` in each page's
`<head>` also has to be updated, since that isn't part of the shared blocks.

## Reporting bugs / requesting tools

Please open a GitHub issue using the provided templates. Include your browser and OS, and steps to
reproduce for bugs.

## Code style

- No comments explaining *what* code does — only *why*, when it's genuinely non-obvious.
- Keep functions small and DRY through the shared helper files rather than a build-time bundler.
- Match the existing CSS variable-based theming (light/dark via `prefers-color-scheme`).
