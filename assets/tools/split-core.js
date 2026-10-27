// The rules behind the Split PDF page, kept apart so they can be tested: which pages go in which file, what each file is called,
// and how a PDF is cut into parts under a size. No DOM and no PDF library in here.
import { parsePageSpec, compactPages, safeBaseName } from "./page-tools.js";

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// "page-5" or "pages-1-3_7": what a file says about its contents in its name
export const pageLabel = (pages) => (pages.length === 1 ? `page-${pages[0]}` : `pages-${compactPages(pages).replace(/, /g, "_")}`);

// opts: { mode, count (pages in the PDF), selected [page numbers], ranges "text", every N, parts N, bookmarks [{ title, page }] }
// mode: selected-one | selected-each | ranges | every | equal | bookmarks | size
// -> { parts: [{ pages: [1-based], label }] }, { error: "message" }, or { bySize: true } (the size mode needs the real file sizes)
export function planSplit({ mode, count, selected = [], ranges = "", every = 1, parts = 2, bookmarks = [] }) {
  if (!(count > 0)) return { error: "Choose a PDF first." };

  if (mode === "selected-one" || mode === "selected-each") {
    const pages = [...new Set(selected)].sort((a, b) => a - b);
    if (!pages.length) return { error: "Select at least one page." };
    return { parts: mode === "selected-one" ? [{ pages, label: "" }] : pages.map((p) => ({ pages: [p], label: pageLabel([p]) })) };
  }

  if (mode === "ranges") {
    const groups = String(ranges).split(/[;\n]+/).map((g) => g.trim()).filter(Boolean);
    if (!groups.length) return { error: "Type the pages for each file, one file per line, for example 1-3 on one line and 4-7, 9 on the next." };
    const out = [];
    for (const [i, group] of groups.entries()) {
      const r = parsePageSpec(group, count);
      if (r.error) return { error: `File ${i + 1}: ${r.error}` };
      out.push({ pages: r.pages, label: pageLabel(r.pages) });
    }
    return { parts: out };
  }

  if (mode === "every") {
    const n = Math.floor(every);
    if (!(n >= 1)) return { error: "Enter how many pages each file should have." };
    if (n >= count) return { error: `Each file would hold ${n} pages, which is the whole PDF, so there is nothing to split.` };
    const out = [];
    for (let from = 1; from <= count; from += n) {
      const pages = range(from, Math.min(count, from + n - 1));
      out.push({ pages, label: pageLabel(pages) });
    }
    return { parts: out };
  }

  if (mode === "equal") {
    const k = Math.floor(parts);
    if (!(k >= 2)) return { error: "Enter two or more files." };
    if (k > count) return { error: `This PDF has ${count} page${count === 1 ? "" : "s"}, so it cannot make ${k} files.` };
    const base = Math.floor(count / k);
    const extra = count % k; // the first few files take one more page each
    const out = [];
    for (let i = 0, from = 1; i < k; i++) {
      const size = base + (i < extra ? 1 : 0);
      const pages = range(from, from + size - 1);
      out.push({ pages, label: pageLabel(pages) });
      from += size;
    }
    return { parts: out };
  }

  if (mode === "bookmarks") {
    const marks = [...bookmarks].filter((m) => m.page >= 1 && m.page <= count).sort((a, b) => a.page - b.page);
    const starts = marks.filter((m, i) => i === 0 || m.page !== marks[i - 1].page); // two bookmarks on one page start one file
    if (!starts.length) return { error: "This PDF has no bookmarks to split at." };
    if (starts[0].page > 1) starts.unshift({ title: "Front pages", page: 1 });
    if (starts.length < 2) return { error: "The bookmarks only make one file, so there is nothing to split." };
    return {
      parts: starts.map((m, i) => {
        const end = i + 1 < starts.length ? starts[i + 1].page - 1 : count;
        return { pages: range(m.page, end), label: safeBaseName(m.title, `part-${i + 1}`).slice(0, 40).trim() };
      }),
    };
  }

  if (mode === "size") return { bySize: true };
  return { error: "Choose how to split." };
}

// Cuts pages 1..count into runs that each come out at no more than `limit` bytes, taking as many pages as fit. sizeOf(from, to)
// says how big a file of those pages would really be. Sizes grow with the page count, so each run is found by doubling the
// length until it is too big, then narrowing down, which takes a handful of tries per file instead of one per page.
// A single page bigger than the limit still gets a file to itself, marked oversize.
export async function partitionBySize(count, limit, sizeOf) {
  const parts = [];
  for (let start = 1; start <= count; ) {
    let end = start;
    let oversize = false;
    if ((await sizeOf(start, start)) > limit) {
      oversize = true;
    } else {
      let step = 1;
      let tooBig = 0;
      while (end < count) {
        const next = Math.min(count, end + step);
        if ((await sizeOf(start, next)) <= limit) { end = next; step *= 2; } else { tooBig = next; break; }
      }
      while (tooBig - end > 1) {
        const mid = Math.floor((end + tooBig) / 2);
        if ((await sizeOf(start, mid)) <= limit) end = mid; else tooBig = mid;
      }
    }
    const pages = range(start, end);
    parts.push({ pages, label: pageLabel(pages), ...(oversize && { oversize: true }) });
    start = end + 1;
  }
  return parts;
}

// -> "report.pdf" when everything goes in one file, otherwise "report-03-pages-7-9.pdf" (the number keeps names unique and in order)
export function fileNameFor(base, index, total, label) {
  if (total === 1) return label ? `${base}-${label}.pdf` : `${base}.pdf`;
  const number = String(index + 1).padStart(String(total).length, "0");
  return `${base}-${number}${label ? `-${label}` : ""}.pdf`;
}
