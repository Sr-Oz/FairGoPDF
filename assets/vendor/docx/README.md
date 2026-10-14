# Word to PDF engine files (self-hosted)

Everything the Word to PDF tool needs is in this folder and is served from Fair Go PDF itself. Nothing is fetched
from a CDN or any outside server at runtime.

| File | What it is | Licence |
|---|---|---|
| `docx-preview.min.js` | docx-preview 0.4.1: turns a .docx into HTML with the document's fonts, colours, borders, tables and pictures | Apache-2.0 (`LICENSE-docx-preview.txt`) |
| `jszip.min.js` | JSZip 3.10.1, which docx-preview needs to open the .docx (a zip file) | MIT or GPL-3.0-or-later, used here under MIT (`LICENSE-jszip.txt`) |
| `fontkit.umd.min.js` | `@pdf-lib/fontkit` 1.1.1, lets pdf-lib embed TrueType fonts | MIT |
| `fonts/` | Look-alike fonts embedded into the PDFs (see below) | SIL Open Font License 1.1 |

The tool code is `assets/tools/word-to-pdf.js` (page), `assets/tools/docx-to-pdf-engine.js` (layout reading and
drawing) and `assets/tools/ttf-subset.js` (shrinks each embedded font to the characters actually used).

## How it works

docx-preview builds the document as HTML in an off-screen element. The browser lays it out, using the fonts below
loaded under the document's own font names, so measurements match what ends up in the PDF. The page is cut into
pages with CSS columns (one column per page), then every word, background, border, picture and link is read back
from the laid-out page and redrawn as vector PDF with pdf-lib. Header and footer text is repeated on each page, and
PAGE / NUMPAGES fields are filled in.

## Fonts

Metric-compatible substitutes, unmodified files from their upstream releases:

| Document font | PDF font | Source |
|---|---|---|
| Calibri, Aptos, Segoe UI, Candara, Corbel | Carlito | googlefonts/carlito (OFL 1.1) |
| Arial, Helvetica and other sans-serif | Liberation Sans | liberationfonts/liberation-fonts 2.1.5 (OFL 1.1) |
| Times New Roman, Georgia, Garamond and other serif | Liberation Serif | same |
| Courier New, Consolas and other monospace | Liberation Mono | same |
| Cambria | Caladea | huertatipografica/Caladea (OFL 1.1) |

The licence texts are alongside the fonts (`fonts/OFL-*.txt`, `fonts/LICENSE-Liberation.txt`). The fonts allow
embedding in documents (`fsType` 0). Only the characters a document uses are kept in each PDF.

## Why not the font subsetting built into pdf-lib

pdf-lib's own font subsetting (via fontkit) produced fonts that lost most glyphs when rendered, so `ttf-subset.js`
subsets the fonts itself and the result is embedded whole. It keeps glyph numbers unchanged, empties every unused
outline, and drops the layout tables. Kerning is applied by the engine when it places each word.
