// Turns the positioned text of a PDF into the structure of a Word document: lines, paragraphs, headings, lists, columns,
// alignment, indents and spacing. It works from where each piece of text sits on the page and how big it is, because a PDF
// has no paragraphs, only text drawn at positions. This is best-effort guesswork, tuned for ordinary letters, reports and
// contracts. No DOM and no PDF library in here, so it can be tested with made-up pages.
//
// Coordinates are in points with the origin at the top left and y growing downwards (the way the page is seen).
// Input text item:  { str, x, y (baseline), w (width), size, bold, italic, family, link }
// Input image:      { id, sig, x, y, w, h } (the picture's box on the page)

// ---------------------------------------------------------------- small helpers

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentile = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};
const round5 = (n) => Math.round(n * 2) / 2;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// the most common value, counting each by its weight
function weightedMode(pairs) {
  const tally = new Map();
  for (const [value, weight] of pairs) tally.set(value, (tally.get(value) || 0) + weight);
  let best = null;
  let most = -1;
  for (const [value, weight] of tally) if (weight > most) { best = value; most = weight; }
  return best;
}

// ---------------------------------------------------------------- fonts

const SUBSET = /^[A-Z]{6}\+/;
const FAMILY_MAP = { helvetica: "Arial", times: "Times New Roman", "times roman": "Times New Roman", courier: "Courier New", "courier new": "Courier New", symbol: "Symbol" };

// "ABCDEF+TimesNewRomanPS-BoldItalicMT" -> { family: "Times New Roman", bold: true, italic: true }
export function fontStyleOf(raw) {
  const name = String(raw || "").replace(SUBSET, "");
  if (!name || /^g_d\d/i.test(name)) return { family: null, bold: false, italic: false }; // pdf.js's own id, not a real name
  const lower = name.toLowerCase();
  const bold = /bold|black|heavy|semibold|extrabold|ultrabold|demibold/.test(lower);
  const italic = /italic|oblique|kursiv/.test(lower) || /[-,]it(?:$|[-,])/.test(lower);
  let family = name.split(/[-,]/)[0].replace(/(PSMT|MT|PS)$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  family = family.replace(/\s+(bold|italic|oblique|regular|black|light|medium)$/i, "").trim();
  family = FAMILY_MAP[family.toLowerCase()] || family;
  return { family: family || null, bold, italic };
}

// ---------------------------------------------------------------- lines

function clusterRows(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.y - last.y) <= 0.45 * Math.max(it.size, last.size)) {
      last.items.push(it);
      if (it.size > last.size) { last.y = it.y; last.size = it.size; } // a superscript must not drag the line off its baseline
    } else {
      rows.push({ y: it.y, size: it.size, items: [it] });
    }
  }
  return rows;
}

const sameStyle = (a, b) => a.bold === b.bold && a.italic === b.italic && Math.abs(a.size - b.size) < 0.4 && a.family === b.family && (a.link || null) === (b.link || null);

// items on one baseline -> a line with its text in runs of one style each
function lineFromRow(row) {
  const items = [...row.items].sort((a, b) => a.x - b.x);
  const runs = [];
  let prev = null;
  let tabbed = false;
  for (const it of items) {
    let text = it.str;
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      const ref = Math.min(prev.size, it.size);
      if (gap > 5 * ref) { text = `\t${text.replace(/^\s+/, "")}`; tabbed = true; }
      else if (gap > 0.15 * ref && !/\s$/.test(prev.str) && !/^\s/.test(text)) text = ` ${text}`;
    }
    const last = runs[runs.length - 1];
    if (last && sameStyle(last, it)) last.text += text;
    else runs.push({ text, bold: it.bold, italic: it.italic, size: it.size, family: it.family, link: it.link || null, x: it.x });
    prev = it;
  }
  const chars = items.map((it) => [round5(it.size), it.str.length]);
  const size = weightedMode(chars) || row.size;
  const text = runs.map((r) => r.text).join("");
  const allBold = runs.every((r) => r.bold || !r.text.trim());
  return {
    kind: "line", y: row.y, top: row.y - 0.85 * size, bottom: row.y + 0.25 * size,
    x0: items[0].x, x1: Math.max(...items.map((it) => it.x + it.w)), size, runs, text, tabbed, allBold,
  };
}

export const buildLines = (items) => clusterRows(items.filter((i) => i.str !== "")).map(lineFromRow).filter((l) => l.text.trim() !== "");

// ---------------------------------------------------------------- columns

// Finds a vertical gutter running through a page of two columns of ordinary text, or null. Careful on purpose: a table or a form
// also has gaps, and reading those one column at a time would be worse than reading them across.
export function findGutter(items, bodySize) {
  const rows = clusterRows(items);
  if (rows.length < 8) return null;
  const minX = Math.min(...items.map((i) => i.x));
  const maxX = Math.max(...items.map((i) => i.x + i.w));
  const width = maxX - minX;
  if (width < 250) return null;
  const from = minX + 0.25 * width;
  const to = maxX - 0.25 * width;
  const covered = (x) => rows.filter((r) => r.items.some((i) => i.x <= x && x <= i.x + i.w)).length;
  let best = null;
  let start = null;
  const close = (end) => { if (!best || end - start > best.x1 - best.x0) best = { x0: start, x1: end }; start = null; };
  for (let x = from; x <= to; x += 2) {
    const free = covered(x) <= Math.max(1, rows.length * 0.06);
    if (free && start === null) start = x;
    if (!free && start !== null) close(x - 2);
  }
  if (start !== null) close(to); // a gap that runs to the edge of the searched zone still counts
  if (!best || best.x1 - best.x0 < Math.max(1.2 * bodySize, 10)) return null;
  const mid = (best.x0 + best.x1) / 2;
  const both = rows.filter((r) => r.items.some((i) => i.x + i.w / 2 < mid) && r.items.some((i) => i.x + i.w / 2 >= mid));
  if (both.length < rows.length * 0.3) return null;
  // both sides must be running text that fills its column, not short cells
  const colW = best.x0 - minX;
  const prose = both.filter((r) => Math.max(...r.items.filter((i) => i.x + i.w / 2 < mid).map((i) => i.x + i.w)) >= best.x0 - 0.2 * colW);
  if (prose.length < both.length * 0.5) return null;
  return { ...best, mid };
}

// -> groups of items, each to be read on its own, top to bottom: a full-width block, then a left column, then a right column
export function splitColumns(items, bodySize) {
  const gutter = findGutter(items, bodySize);
  if (!gutter) return [{ kind: "full", items }];
  const groups = [];
  let left = [];
  let right = [];
  let full = [];
  const flushColumns = () => {
    if (left.length) groups.push({ kind: "left", items: left, mid: gutter.mid });
    if (right.length) groups.push({ kind: "right", items: right, mid: gutter.mid });
    left = []; right = [];
  };
  const flushFull = () => { if (full.length) groups.push({ kind: "full", items: full }); full = []; };
  for (const row of clusterRows(items)) {
    const crossing = row.items.some((i) => i.x < gutter.x0 && i.x + i.w > gutter.x1);
    if (crossing) {
      flushColumns();
      full.push(...row.items);
    } else {
      flushFull();
      for (const i of row.items) (i.x + i.w / 2 < gutter.mid ? left : right).push(i);
    }
  }
  flushColumns();
  flushFull();
  return groups;
}

// ---------------------------------------------------------------- headers, footers and page numbers

const PAGE_NUMBER = /^(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$|^[-–—]\s*\d{1,4}\s*[-–—]$/i;
const normaliseKey = (text) => text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
const inMargin = (y, height) => y < 0.1 * height || y > 0.9 * height;

// pages: [{ height, lines }]. -> a Set of the lines that repeat at the top or bottom of the pages, and of page numbers.
export function findRunningLines(pages) {
  const drop = new Set();
  const seen = new Map(); // normalised text -> the lines and the pages they are on
  for (const [pi, p] of pages.entries()) {
    for (const line of p.lines) {
      if (!inMargin(line.y, p.height)) continue;
      const text = line.text.trim();
      if (PAGE_NUMBER.test(text)) { drop.add(line); continue; }
      const key = normaliseKey(text);
      if (!seen.has(key)) seen.set(key, { lines: [], pages: new Set() });
      const entry = seen.get(key);
      entry.lines.push(line);
      entry.pages.add(pi);
    }
  }
  const need = Math.max(2, Math.ceil(pages.length * 0.5));
  for (const entry of seen.values()) if (entry.pages.size >= need) entry.lines.forEach((l) => drop.add(l));
  return drop;
}

// ---------------------------------------------------------------- lists

const BULLETS = "•●○◦▪▫■□–—‣⁃·*-";
const BULLET_RE = new RegExp(`^([${BULLETS.replace(/[\]\\^-]/g, "\\$&")}])[ \\t]+`);
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

// what a line starts with if it starts a list item: { kind, value, length (characters of marker and space) } or null
export function listMarker(text) {
  let m = BULLET_RE.exec(text);
  if (m) return { kind: "bullet", value: 0, length: m[0].length };
  m = /^\(?(\d{1,3})[.)][ \t]+/.exec(text);
  if (m) return { kind: "decimal", value: Number(m[1]), length: m[0].length };
  m = /^\(?(i{1,3}|iv|vi{0,3}|ix|x)[.)][ \t]+/.exec(text);
  if (m) return { kind: "lowerRoman", value: ROMAN[m[1]], length: m[0].length };
  m = /^\(?([a-z])[.)][ \t]+/.exec(text);
  if (m) return { kind: "lowerLetter", value: m[1].charCodeAt(0) - 96, length: m[0].length };
  m = /^\(?([A-Z])[.)][ \t]+/.exec(text);
  if (m) return { kind: "upperLetter", value: m[1].charCodeAt(0) - 64, length: m[0].length };
  return null;
}

// numbered markers only count when the numbers run on (1, 2, 3...), so "A. Smith" and "2. Thanks" are left as text
export function findMarkers(lines) {
  const found = lines.map((l) => (l.tabbed && !/^[^\t]{1,4}\t/.test(l.text) ? null : listMarker(l.text)));
  const out = new Map();
  found.forEach((m, i) => {
    if (!m) return;
    if (m.kind === "bullet") { out.set(lines[i], m); return; }
    const near = found.some((o, j) => o && j !== i && o.kind === m.kind && Math.abs(o.value - m.value) === 1 && Math.abs(j - i) <= 14);
    if (near) out.set(lines[i], m);
  });
  return out;
}

function stripPrefix(runs, count) {
  const out = runs.map((r) => ({ ...r }));
  let left = count;
  while (left > 0 && out.length) {
    if (out[0].text.length <= left) { left -= out[0].text.length; out.shift(); }
    else { out[0].text = out[0].text.slice(left); left = 0; }
  }
  if (out[0]) out[0].text = out[0].text.replace(/^\s+/, "");
  return out;
}

// ---------------------------------------------------------------- joining lines into paragraphs

// a hyphen at the end of a line, with the word carrying on in lower case, is a word split across lines
function appendRuns(target, add, joinHyphens) {
  if (!target.length) return add.map((r) => ({ ...r }));
  const last = target[target.length - 1];
  const next = add[0];
  const split = joinHyphens && /[A-Za-zÀ-ɏ][-­]$/.test(last.text) && next && /^[a-zß-ÿ]/.test(next.text);
  if (split) last.text = last.text.slice(0, -1);
  else if (/­$/.test(last.text)) last.text = last.text.slice(0, -1);
  else if (!/\s$/.test(last.text) && !/^\s/.test(next ? next.text : "")) last.text += " ";
  for (const r of add) {
    const tail = target[target.length - 1];
    if (sameStyle(tail, r)) tail.text += r.text;
    else target.push({ ...r });
  }
  return target;
}

function alignmentOf(line, ctx) {
  const textW = ctx.right - ctx.left;
  const centre = (line.x0 + line.x1) / 2;
  const middle = (ctx.left + ctx.right) / 2;
  if (line.x1 - line.x0 < 0.85 * textW && Math.abs(centre - middle) < 0.03 * textW && line.x0 - ctx.left > 0.06 * textW) return "center";
  if (line.x0 - ctx.left > 0.3 * textW && line.x1 >= ctx.right - 0.02 * textW) return "right";
  return "left";
}

function startsParagraph(cur, prev, line, marker, ctx) {
  if (marker || !prev) return true;
  const dy = line.y - prev.y;
  if (Math.abs(line.size - prev.size) > 0.12 * ctx.body) return true;
  if (dy > Math.max(1.45 * ctx.leading, 1.9 * prev.size)) return true;
  if (cur.marker) return !(line.x0 >= cur.textX - 0.6 * line.size && !line.tabbed); // a wrapped list line lines up with the text
  if (line.tabbed || prev.tabbed) return true;
  const head = ctx.isHeadingLine(line);
  const prevHead = ctx.isHeadingLine(prev);
  if (head || prevHead) return !(head && prevHead && dy < 1.4 * line.size && Math.abs(line.size - prev.size) < 0.5);
  if (alignmentOf(line, ctx) !== alignmentOf(prev, ctx)) return true;
  if (line.x0 - prev.x0 > 0.8 * line.size) return true; // a first-line indent
  return prev.x1 < ctx.right - 0.22 * (ctx.right - ctx.left); // the previous line stopped short, so the paragraph ended there
}

// seq: lines and images in reading order for one group -> paragraph and image blocks
function paragraphsFrom(seq, ctx) {
  const out = [];
  const markers = ctx.opts.lists ? findMarkers(seq.filter((e) => e.kind === "line")) : new Map();
  let cur = null;
  let prev = null;
  const flush = () => {
    if (!cur) return;
    out.push(finishParagraph(cur, ctx));
    cur = null;
  };
  for (const e of seq) {
    if (e.kind === "image") { flush(); out.push({ type: "image", id: e.id, w: e.w, h: e.h, y: e.y, x: e.x, align: Math.abs(e.x + e.w / 2 - (ctx.left + ctx.right) / 2) < 0.04 * (ctx.right - ctx.left) ? "center" : "left" }); prev = null; continue; }
    const marker = ctx.isHeadingLine(e) ? null : markers.get(e) || null; // "1. Introduction" in bold is a heading, not a list
    if (cur && !startsParagraph(cur, prev, e, marker, ctx)) {
      cur.lines.push(e);
      cur.runs = appendRuns(cur.runs, e.runs, ctx.opts.joinHyphens);
    } else {
      flush();
      const runs = marker ? stripPrefix(e.runs, marker.length) : e.runs.map((r) => ({ ...r }));
      cur = { lines: [e], runs, marker, textX: marker ? (runs[0] && runs[0].x > e.x0 + 0.4 * e.size ? runs[0].x : e.x0 + 1.5 * e.size) : e.x0 };
    }
    prev = e;
  }
  flush();
  return out;
}

function finishParagraph(cur, ctx) {
  const lines = cur.lines;
  const first = lines[0];
  const last = lines[lines.length - 1];
  const size = median(lines.map((l) => l.size));
  const align = lines.every((l) => alignmentOf(l, ctx) === "center") ? "center" : alignmentOf(first, ctx) === "right" && lines.length === 1 ? "right" : "left";
  const contX = lines.length > 1 ? median(lines.slice(1).map((l) => l.x0)) : first.x0;
  const p = {
    type: "p", runs: cur.runs.map(({ x, ...r }) => r), size, align, y0: first.top, y1: last.bottom, yLast: last.y, yFirst: first.y,
    left: align === "left" ? Math.max(0, contX - ctx.left) : 0,
    firstLine: align === "left" && lines.length > 1 ? first.x0 - contX : 0,
    allBold: lines.every((l) => l.allBold), allCaps: false, lines: lines.length, x1: last.x1, x0: first.x0,
    marker: cur.marker ? { kind: cur.marker.kind, value: cur.marker.value, x: first.x0 } : null,
  };
  const plain = p.runs.map((r) => r.text).join("");
  p.allCaps = /[A-Z]/.test(plain) && plain === plain.toUpperCase();
  p.text = plain.replace(/ {2,}/g, " ").trim();
  return p;
}

// ---------------------------------------------------------------- the whole document

function urlRuns(runs) {
  // a web address or email in the text becomes a link even when the PDF did not mark it as one
  const out = [];
  for (const r of runs) {
    if (r.link) { out.push(r); continue; }
    let last = 0;
    for (const m of r.text.matchAll(/(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|www\.[\w-]+(?:\.[\w-]+)+[^\s<>"]*[^\s<>".,;:!?)\]])/g)) {
      if (m.index > last) out.push({ ...r, text: r.text.slice(last, m.index) });
      const url = /^[\w.+-]+@/.test(m[0]) ? `mailto:${m[0]}` : /^www\./.test(m[0]) ? `https://${m[0]}` : m[0];
      out.push({ ...r, text: m[0], link: url });
      last = m.index + m[0].length;
    }
    out.push(last ? { ...r, text: r.text.slice(last) } : r);
  }
  return out.filter((r) => r.text !== "");
}

const TERMINAL = /[.!?:;]["')”’»\]]?\s*$/;

// pages: [{ number, width, height, items, images, rotated (text as a string) }]
// opts: { pageBreaks, usePdfPage, joinHyphens, dropRunning, columns, styling, lists, links, images }
// -> { sections: [{ pageW, pageH, margins, blocks }], style, stats }
export function buildDocument(pages, options = {}) {
  const opts = { pageBreaks: false, usePdfPage: true, joinHyphens: true, dropRunning: true, columns: true, styling: true, lists: true, links: true, images: true, ...options };
  const allItems = pages.flatMap((p) => p.items);
  const bodySize = round5(weightedMode(allItems.map((i) => [round5(i.size), i.str.length])) || 11);

  // 1. lines for each page, reading a two-column page one column at a time
  const prepared = pages.map((p) => {
    const items = p.items.map((i) => ({ ...i, bold: opts.styling && i.bold, italic: opts.styling && i.italic, link: opts.links ? i.link : null }));
    const groups = (opts.columns ? splitColumns(items, bodySize) : [{ kind: "full", items }]).map((g) => ({ ...g, lines: buildLines(g.items) }));
    return { ...p, groups, lines: groups.flatMap((g) => g.lines) };
  });

  // 2. headers, footers and page numbers
  const dropped = opts.dropRunning ? findRunningLines(prepared) : new Set();
  const imageSeen = new Map();
  if (opts.dropRunning) {
    prepared.forEach((p, pi) => p.images.forEach((im) => { if (inMargin(im.y + im.h / 2, p.height)) { if (!imageSeen.has(im.sig)) imageSeen.set(im.sig, new Set()); imageSeen.get(im.sig).add(pi); } }));
  }
  const imageNeed = Math.max(2, Math.ceil(pages.length * 0.5));
  for (const p of prepared) {
    for (const g of p.groups) g.lines = g.lines.filter((l) => !dropped.has(l));
    p.lines = p.groups.flatMap((g) => g.lines);
    p.images = (opts.images ? p.images : []).filter((im) => {
      if (opts.dropRunning && inMargin(im.y + im.h / 2, p.height) && (imageSeen.get(im.sig) || new Set()).size >= imageNeed) return false;
      const behind = p.items.filter((i) => i.x + i.w / 2 > im.x && i.x + i.w / 2 < im.x + im.w && i.y > im.y && i.y < im.y + im.h).length;
      return behind < 4 && im.w >= 8 && im.h >= 8; // text drawn over a picture means it is a background, and tiny ones are dots
    });
  }

  // 3. the size the text is, which decides what counts as a heading
  const lines = prepared.flatMap((p) => p.lines);
  const body = round5(weightedMode(lines.map((l) => [round5(l.size), l.text.length])) || bodySize);
  const bodyFamily = weightedMode(lines.flatMap((l) => l.runs.map((r) => [r.family, r.text.length]))) || "Arial";
  const boldShare = lines.reduce((n, l) => n + (l.allBold ? l.text.length : 0), 0) / Math.max(1, lines.reduce((n, l) => n + l.text.length, 0));
  const pitches = [];
  for (const p of prepared) for (const g of p.groups) for (let i = 1; i < g.lines.length; i++) {
    const dy = g.lines[i].y - g.lines[i - 1].y;
    if (Math.abs(g.lines[i].size - body) < 0.6 && Math.abs(g.lines[i - 1].size - body) < 0.6 && dy > 0.8 * body && dy < 2.2 * body) pitches.push(dy);
  }
  const leading = median(pitches) || 1.2 * body;

  const isBigLine = (l) => opts.styling && l.size >= 1.12 * body && l.text.trim().length <= 160;
  const isBoldHeading = (l) => opts.styling && boldShare < 0.5 && l.allBold && l.text.trim().length <= 90 && !/[.,;]$/.test(l.text.trim()) && Math.abs(l.size - body) <= 0.12 * body;
  const isHeadingLine = (l) => isBigLine(l) || isBoldHeading(l);

  // 4. paragraphs, page by page
  const pageBlocks = prepared.map((p) => {
    const blocks = [];
    const ordered = p.groups.filter((g) => g.lines.length);
    const placed = new Set();
    // pictures go into the group they sit in, by height, or between groups
    const seqs = ordered.map((g) => ({ g, seq: [...g.lines] }));
    for (const im of p.images) {
      const cx = im.x + im.w / 2;
      const home = seqs.find(({ g }) => {
        const top = Math.min(...g.lines.map((l) => l.top));
        const bottom = Math.max(...g.lines.map((l) => l.bottom));
        const sideOk = g.kind === "full" || (g.kind === "left" ? cx < g.mid : cx >= g.mid);
        return sideOk && im.y >= top - leading && im.y <= bottom;
      });
      const entry = { kind: "image", id: im.id, x: im.x, y: im.y, w: im.w, h: im.h };
      if (home) { home.seq.push(entry); placed.add(im); }
    }
    const loose = p.images.filter((im) => !placed.has(im));
    for (const s of seqs) s.seq.sort((a, b) => (a.kind === "image" ? a.y : a.top) - (b.kind === "image" ? b.y : b.top));
    // loose pictures become groups of their own, slotted in by height
    const stream = seqs.map((s) => ({ top: Math.min(...s.seq.map((e) => (e.kind === "image" ? e.y : e.top))), seq: s.seq, kind: s.g.kind }));
    for (const im of loose) {
      const entry = { top: im.y, seq: [{ kind: "image", id: im.id, x: im.x, y: im.y, w: im.w, h: im.h }], kind: "full" };
      const at = stream.findIndex((s) => s.top > im.y);
      stream.splice(at < 0 ? stream.length : at, 0, entry);
    }
    for (const s of stream) {
      const ls = s.seq.filter((e) => e.kind === "line");
      const ctx = {
        opts, body, leading,
        left: ls.length ? percentile(ls.map((l) => l.x0), 0.1) : 0,
        right: ls.length ? percentile(ls.map((l) => l.x1), 0.92) : p.width,
        isHeadingLine,
      };
      blocks.push(...paragraphsFrom(s.seq, ctx).map((b) => ({ ...b, ctx: { left: ctx.left, right: ctx.right } })));
    }
    if (p.rotated) blocks.push({ type: "p", runs: [{ text: p.rotated, bold: false, italic: false, size: body, family: bodyFamily, link: null }], size: body, align: "left", left: 0, firstLine: 0, allBold: false, allCaps: false, lines: 1, text: p.rotated, y0: 0, y1: 0, yFirst: 0, yLast: 0, marker: null, ctx: { left: 0, right: p.width } });
    return { page: p, blocks };
  });

  // 5. headings, links, spacing and lists on each block
  const headingSizes = [...new Set(pageBlocks.flatMap((pb) => pb.blocks).filter((b) => b.type === "p" && !b.marker && opts.styling && b.size >= 1.12 * body && b.text.length <= 160 && b.lines <= 3).map((b) => round5(b.size)))].sort((a, b) => b - a);
  let boldLevel = Math.min(4, Math.max(2, headingSizes.length + 1));
  const headingStats = new Map();
  for (const pb of pageBlocks) {
    pb.blocks.forEach((b, i) => {
      if (b.type !== "p") return;
      const sizeRank = headingSizes.indexOf(round5(b.size));
      let level = 0;
      if (opts.styling && !b.marker && b.lines <= 3 && b.text.length <= 160) {
        if (sizeRank >= 0 && b.size >= 1.12 * body) level = Math.min(3, sizeRank + 1);
        else if (boldShare < 0.5 && b.allBold && b.lines === 1 && b.text.length <= 90 && !/[.,;]$/.test(b.text) && Math.abs(b.size - body) <= 0.12 * body) level = boldLevel;
      }
      if (level) {
        b.heading = level;
        b.runs = b.runs.map((r) => ({ text: r.text, link: r.link, bold: false, italic: r.italic, size: null, family: null }));
        (headingStats.get(level) || headingStats.set(level, []).get(level)).push(b.size);
      } else {
        b.runs = b.runs.map((r) => ({ ...r, size: Math.abs(r.size - body) < 0.6 ? null : r.size, family: r.family === bodyFamily ? null : r.family }));
      }
      if (opts.links) b.runs = urlRuns(b.runs);
      // space after, from the gap to the next block on the page
      const next = pb.blocks[i + 1];
      b.after = next && next.type === "p" && next.yFirst > b.yLast ? clamp(Math.round(next.yFirst - b.yLast - leading), 0, 48) : 0;
    });
  }

  // 6. lists: a run of list paragraphs is one list, numbered from where it starts
  let listId = 0;
  for (const pb of pageBlocks) {
    let open = null;
    for (const b of pb.blocks) {
      if (b.type !== "p" || !b.marker) { open = null; continue; }
      if (!open || open.kind !== b.marker.kind) open = { id: ++listId, kind: b.marker.kind, base: b.marker.x, start: b.marker.value };
      const level = clamp(Math.floor((b.marker.x - open.base) / (1.6 * body) + 0.2), 0, 3);
      b.list = { id: open.id, kind: b.marker.kind, level, start: open.start };
      b.left = 0;
      b.firstLine = 0;
    }
  }

  // 7. page breaks and paragraphs that run over from one page to the next
  const out = [];
  pageBlocks.forEach((pb, pi) => {
    const blocks = pb.blocks;
    if (!blocks.length) { if (opts.pageBreaks && pi > 0) out.push({ type: "p", runs: [], pageBreakBefore: true, after: 0, size: body, align: "left", left: 0, firstLine: 0 }); return; }
    if (opts.pageBreaks) {
      blocks[0].pageBreakBefore = pi > 0;
      out.push(...blocks);
      return;
    }
    const prev = out[out.length - 1];
    const first = blocks[0];
    const joinable = prev && prev.type === "p" && first.type === "p" && !prev.heading && !first.heading && !prev.list && !first.list &&
      !prev.pageBreakBefore && prev.align === "left" && first.align === "left" && !TERMINAL.test(prev.text) &&
      first.firstLine <= 0.5 * body && first.left <= prev.left + 0.8 * body && prev.lines >= 2 && /^[a-z0-9(“"]/.test(first.text) === true;
    if (joinable) {
      prev.runs = appendRuns(prev.runs, first.runs, opts.joinHyphens);
      prev.text = `${prev.text} ${first.text}`;
      prev.after = first.after;
      out.push(...blocks.slice(1));
    } else {
      out.push(...blocks);
    }
  });

  // 8. the page: size and margins from the PDF, or A4 with 2.54 cm
  const first = pages[0] || { width: 595.28, height: 841.89 };
  const marginOf = (p, pb) => {
    const ls = p.lines;
    if (!ls.length) return null;
    return {
      left: Math.min(...ls.map((l) => l.x0)), right: p.width - Math.max(...ls.map((l) => l.x1)),
      top: Math.min(...ls.map((l) => l.top)), bottom: p.height - Math.max(...ls.map((l) => l.bottom)),
    };
  };
  const fitMargins = (list, w, h) => {
    const widest = (k) => Math.min(...list.map((m) => m[k])); // a short page leaves a big gap that is not a margin
    return list.length
      ? { left: clamp(widest("left"), 36, 0.3 * w), right: clamp(widest("right"), 36, 0.3 * w), top: clamp(widest("top"), 36, 108), bottom: clamp(widest("bottom"), 36, 108) }
      : { left: 72, right: 72, top: 72, bottom: 72 };
  };
  const margins = prepared.map((p) => marginOf(p)).filter(Boolean);
  const sections = [];
  const sectionFor = (w, h, list) => ({ pageW: w, pageH: h, margins: opts.usePdfPage ? fitMargins(list, w, h) : { left: 72, right: 72, top: 72, bottom: 72 }, blocks: [] });
  if (!opts.usePdfPage) {
    sections.push({ pageW: 595.28, pageH: 841.89, margins: { left: 72, right: 72, top: 72, bottom: 72 }, blocks: out });
  } else if (opts.pageBreaks && pages.some((p) => Math.abs(p.width - first.width) > 2 || Math.abs(p.height - first.height) > 2)) {
    // a different page size starts a new section; the blocks of each page go with their page
    let blockIndex = 0;
    let current = null;
    pageBlocks.forEach((pb, pi) => {
      const p = pb.page;
      const count = pb.blocks.length || (pi > 0 ? 1 : 0);
      if (!current || Math.abs(p.width - current.pageW) > 2 || Math.abs(p.height - current.pageH) > 2) {
        current = sectionFor(p.width, p.height, []);
        current.list = [];
        sections.push(current);
      }
      if (margins[pi]) current.list.push(margins[pi]);
      current.blocks.push(...out.slice(blockIndex, blockIndex + count));
      blockIndex += count;
    });
    for (const s of sections) s.margins = fitMargins(s.list, s.pageW, s.pageH);
  } else {
    sections.push(sectionFor(first.width, first.height, margins));
    sections[0].blocks = out;
  }

  const sizes = (level) => round5(median(headingStats.get(level) || []) || 0);
  const count = (fn) => out.filter(fn).length;
  return {
    sections,
    style: {
      bodySize: body, bodyFamily, leading,
      lineMultiple: clamp(leading / (1.15 * body), 0.95, 2),
      headings: { 1: sizes(1) || round5(body * 1.6), 2: sizes(2) || round5(body * 1.35), 3: sizes(3) || round5(body * 1.15), 4: sizes(4) || body },
    },
    stats: {
      pages: pages.length, paragraphs: count((b) => b.type === "p" && !b.heading && !b.list), headings: count((b) => b.heading), listItems: count((b) => b.list),
      images: count((b) => b.type === "image"), links: out.reduce((n, b) => n + (b.runs || []).filter((r) => r.link).length, 0), removed: dropped.size,
    },
  };
}
