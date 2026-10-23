# Self-hosted fonts

These files are served from this site so a page load never contacts Google or any other font service.

| Font | Licence | Used for |
|------|---------|----------|
| Manrope | SIL Open Font Licence 1.1 | Page text |
| Roboto Condensed | SIL OFL 1.1 | Headings |
| JetBrains Mono | SIL OFL 1.1 | Code and numbers |
| Caveat | SIL OFL 1.1 | Sign PDF typed signatures |
| Dancing Script | SIL OFL 1.1 | Handwriting Worksheets, Sign PDF |
| Schoolbell | SIL OFL 1.1 | Handwriting Worksheets |
| Material Symbols Outlined | Apache License 2.0 | Icons (cut down to the icons the site uses) |

OFL 1.1: https://openfontlicense.org/ · Apache 2.0: https://www.apache.org/licenses/LICENSE-2.0

The files are downloaded from the Google Fonts API by `scripts/build-fonts.py`, which is run by the developer only.
Re-run it whenever an icon is added or removed; it rewrites `fonts.css`, the `.woff2` files and `icons-used.txt`.
