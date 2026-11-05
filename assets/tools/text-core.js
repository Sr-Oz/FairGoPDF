// Extract PDF Text: turning what the layout code found (blocks of paragraphs, headings, lists and tables, or the positioned pieces of text
// on a page) into plain text or Markdown, plus counting and searching. No DOM and no PDF library in here, so it can be tested.

// ---------------------------------------------------------------- Markdown

// characters that would turn into formatting
const MD_SPECIAL = /([\\`*_[\]<>|])/g;
export const escapeMarkdown = (s) => s.replace(MD_SPECIAL, "\\$1").replace(/^(\s*)([#>+-])(\s)/, "$1\\$2$3").replace(/^(\s*)(\d+)([.)])(\s)/, "$1$2\\$3$4");

// runs of one style each -> a line of text; Markdown gets bold, italic and links
export function runsToText(runs, md = false) {
  let out = "";
  for (const r of runs || []) {
    let t = String(r.text || "").replace(/\t/g, " ");
    if (!md) { out += t; continue; }
    const lead = /^\s*/.exec(t)[0];
    const trail = /\s*$/.exec(t)[0];
    let core = t.slice(lead.length, t.length - trail.length);
    if (!core) { out += t; continue; }
    const bare = r.link && core.replace(/[.,;:!?)\]]+$/, "") === r.link; // a link that is its own text is written as a plain address
    core = bare ? `<${r.link}>` : escapeMarkdown(core);
    if (r.link && !bare) core = `[${core}](${r.link})`;
    if (r.bold && r.italic) core = `***${core}***`;
    else if (r.bold) core = `**${core}**`;
    else if (r.italic) core = `*${core}*`;
    out += lead + core + trail;
  }
  return out;
}

// ---------------------------------------------------------------- numbering lists

const toRoman = (n) => {
  const map = [[10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
};
const letter = (n) => String.fromCharCode(96 + ((n - 1) % 26) + 1);

// how the marker of a list item is written: "-" for a bullet, "3." for a number
function marker(kind, n, md) {
  if (kind === "bullet") return md ? "-" : "•";
  if (kind === "decimal") return `${n}.`;
  if (kind === "lowerRoman") return `${toRoman(n)}.`;
  if (kind === "lowerLetter") return `${letter(n)}.`;
  if (kind === "upperLetter") return `${letter(n).toUpperCase()}.`;
  return `${n}.`;
}

// ---------------------------------------------------------------- tables

// a Markdown table's heading row is already set apart, so bold there would only be noise
const cellText = (cell, md, heading = false) => runsToText(heading ? (cell.runs || []).map((r) => ({ ...r, bold: false })) : cell.runs, md).replace(/\s+/g, " ").trim();

// a table's rows as text: pipes for Markdown, padded columns for plain text
function tableToText(block, md) {
  const rows = block.rows.map((cells, ri) => {
    const out = [];
    for (const c of cells) {
      out.push(cellText(c, md, md && ri === 0));
      for (let i = 1; i < (c.span || 1); i++) out.push("");
    }
    return out;
  });
  const n = Math.max(1, ...rows.map((r) => r.length));
  for (const r of rows) while (r.length < n) r.push("");
  if (md) {
    const line = (r) => `| ${r.join(" | ")} |`; // the cells' text has its pipes escaped already
    return [line(rows[0]), `| ${rows[0].map(() => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
  }
  const widths = Array.from({ length: n }, (_, c) => Math.max(...rows.map((r) => [...r[c]].length)));
  return rows.map((r) => r.map((cell, c) => cell + " ".repeat(widths[c] - [...cell].length)).join("  ").replace(/\s+$/, "")).join("\n");
}

// ---------------------------------------------------------------- the whole document

// blocks: from buildDocument (flattened over its sections), built with pageBreaks on so the first block of each page after the first
// has pageBreakBefore. pageNumbers: the PDF page number of each page that was read, in order.
//   options: { format: "txt" | "md", markers: show where each page begins }
export function blocksToText(blocks, { format = "txt", markers = false, pageNumbers = [] } = {}) {
  const md = format === "md";
  const parts = [];
  const counters = new Map(); // list id -> how many items so far
  let page = 0;
  let lastList = null; // the id of the list the last block belonged to
  const mark = () => {
    if (!markers) return;
    const n = pageNumbers[page] ?? page + 1;
    parts.push(md ? `---\n\n*Page ${n}*` : `--- Page ${n} ---`);
    lastList = null;
  };
  let first = true;
  for (const b of blocks) {
    if (b.pageBreakBefore && !first) page++;
    if (b.pageBreakBefore || first) mark();
    first = false;
    if (b.type === "table") { parts.push(tableToText(b, md)); lastList = null; continue; }
    if (b.type !== "p") continue;
    const text = runsToText(b.runs, md).replace(/[ \t]+/g, " ").trim();
    if (!text) continue;
    if (b.list) {
      const n = (counters.get(b.list.id) || 0) + 1;
      counters.set(b.list.id, n);
      const item = `${"  ".repeat(b.list.level || 0)}${marker(b.list.kind, (b.list.start || 1) + n - 1, md)} ${text}`;
      if (lastList === b.list.id) parts[parts.length - 1] += `\n${item}`;
      else parts.push(item);
      lastList = b.list.id;
      continue;
    }
    lastList = null;
    parts.push(md && b.heading ? `${"#".repeat(Math.min(6, b.heading))} ${text}` : text);
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------- the page as it is laid out

// Text kept where it sits on the page, in a plain font. items: { str, x, y, w, size } in points, y counting down from the top.
// -> the page's text, with spaces to keep columns and gaps, and blank lines where there is a bigger gap
export function layoutPage(items) {
  const live = items.filter((i) => typeof i.str === "string" && i.str.trim() !== "" && i.size > 0);
  if (!live.length) return "";
  // one character is about this wide: the median across the page, so a form and a letter both come out sensibly
  const widths = live.map((i) => i.w / Math.max(1, [...i.str].length)).filter((w) => w > 0).sort((a, b) => a - b);
  const charW = Math.min(Math.max(widths[Math.floor(widths.length / 2)] || 5, 3), 12);
  const sorted = [...live].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.y - last.y) <= 0.45 * Math.max(it.size, last.size)) {
      last.items.push(it);
      if (it.size > last.size) { last.y = it.y; last.size = it.size; }
    } else rows.push({ y: it.y, size: it.size, items: [it] });
  }
  const minX = Math.min(...live.map((i) => i.x));
  const sizes = live.map((i) => i.size).sort((a, b) => a - b);
  const line = sizes[Math.floor(sizes.length / 2)] * 1.2;
  const out = [];
  let prevY = null;
  for (const row of rows) {
    if (prevY !== null) {
      const gaps = Math.min(3, Math.max(1, Math.round((row.y - prevY) / line)) - 1);
      for (let i = 0; i < gaps; i++) out.push("");
    }
    let text = "";
    for (const it of row.items.sort((a, b) => a.x - b.x)) {
      const col = Math.round((it.x - minX) / charW);
      if (text.length < col) text += " ".repeat(col - text.length);
      else if (text.length && !/\s$/.test(text) && !/^\s/.test(it.str)) text += " ";
      text += it.str;
    }
    out.push(text.replace(/\s+$/, ""));
    prevY = row.y;
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- counting and searching

export function countWords(text) {
  const m = String(text || "").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

// the places a search text turns up: the start of each, in order, none overlapping
export function findAll(text, query, matchCase = false) {
  if (!query) return [];
  const hay = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? query : query.toLowerCase();
  const out = [];
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}

// which match to go to from where the cursor is: the next one after `pos` (or the one before it when going back), going round
export function stepMatch(matches, pos, direction = 1) {
  if (!matches.length) return -1;
  if (direction >= 0) { const i = matches.findIndex((m) => m >= pos); return i === -1 ? 0 : i; }
  for (let i = matches.length - 1; i >= 0; i--) if (matches[i] < pos) return i;
  return matches.length - 1;
}

// ---------------------------------------------------------------- pages with nothing to read

// the pages (their numbers) that have no text at all, from { number, items, rotated } for each page read
export const emptyPages = (pages) => pages.filter((p) => !(p.items || []).some((i) => String(i.str).trim()) && !String(p.rotated || "").trim()).map((p) => p.number);

export function describeEmpty(empty, total) {
  if (!empty.length) return "";
  if (empty.length === total) return total === 1 ? "This page has no text to read. It may be a scan, which is a picture of text." : `None of these ${total} pages has text to read. They may be scans, which are pictures of text.`;
  const list = empty.length <= 6 ? empty.join(", ") : `${empty.slice(0, 6).join(", ")} and ${empty.length - 6} more`;
  return `${empty.length === 1 ? "Page" : "Pages"} ${list} ${empty.length === 1 ? "has" : "have"} no text to read: blank, or a scan.`;
}
