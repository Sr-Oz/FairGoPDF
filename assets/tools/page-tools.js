// Small helpers for choosing pages and naming files, shared by Merge PDF and Split PDF. No DOM and no PDF library in here.

// "1-3, 7, 10-" takes those pages in that order; "except 2, 5" (or "!2,5") takes everything but them; "last" is the last page.
// count is how many pages the file has; pass 0 while that is not known yet.
// -> { pages: [1-based numbers] } or { error: "message" } or { pending: true } while the page count is unknown
export function parsePageSpec(spec, count) {
  let text = String(spec || "").trim();
  if (!text) return count > 0 ? { pages: Array.from({ length: count }, (_, i) => i + 1) } : { pending: true, all: true };
  let except = false;
  const lead = text.match(/^(except|not|!)\s*/i);
  if (lead) { except = true; text = text.slice(lead[0].length); }
  if (!text) return { error: "Say which pages to leave out, for example except 2, 5." };
  if (!(count > 0)) return { pending: true };

  const at = (word) => (/^last$/i.test(word) ? count : /^\d+$/.test(word) ? Number(word) : NaN);
  const picked = [];
  for (const part of text.split(",").map((p) => p.trim()).filter(Boolean)) {
    const range = part.match(/^(\d+|last)\s*-\s*(\d+|last)?$/i);
    const single = part.match(/^(\d+|last)$/i);
    if (!range && !single) return { error: `"${part}" is not a page or a range. Try 1-3, 7 or 10-.` };
    const from = at(range ? range[1] : single[1]);
    const to = range ? (range[2] ? at(range[2]) : count) : from;
    if (from < 1 || to < 1) return { error: "Pages start at 1." };
    if (from > count || to > count) return { error: `This file has ${count} page${count === 1 ? "" : "s"}, so ${Math.max(from, to)} is too high.` };
    if (from > to) return { error: `"${part}" runs backwards. Write it as ${to}-${from}.` };
    for (let n = from; n <= to; n++) picked.push(n);
  }
  if (!picked.length) return { error: "No pages chosen." };
  const unique = [...new Set(picked)];
  if (!except) return { pages: unique };
  const out = new Set(unique);
  const pages = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !out.has(n));
  return pages.length ? { pages } : { error: "That would leave no pages." };
}


// "1-3, 7" for the pages [1, 2, 3, 7]: runs of neighbouring pages are joined into ranges
export function compactPages(pages) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(", ");
}

// the name the visitor typed, made safe to use as a file name
export function safeBaseName(name, fallback = "merged") {
  const cleaned = String(name || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().replace(/\.pdf$/i, "").trim().replace(/^\.+/, "");
  return cleaned.slice(0, 100) || fallback;
}
