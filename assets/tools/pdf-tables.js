// Finds tables on a PDF page, from the ruled lines when it has them and from how the text lines up when it does not.
// No DOM and no PDF library in here, so it can be tested with made-up pages.
//
// Coordinates are in points with the origin at the top left, y growing downwards.
// items: { str, x, y (baseline), w, size, ... }   rules: { x1, y1, x2, y2 } straight line pieces drawn on the page
// -> { tables, rest } where `rest` is the text that is not in a table, and each table is
//    { ruled, x0, y0, x1, y1, ncols, edges: [x of each column edge, ncols + 1 of them], rows: [[{ col, span, items }]] }

const TOL = 2.5;

const centreOf = (it) => ({ x: it.x + it.w / 2, y: it.y - it.size * 0.3 });
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------------------------------------------------------------- ruled tables

// Straight pieces become horizontal and vertical rules, and pieces on the same line that touch become one.
export function normaliseRules(rules) {
  const h = [];
  const v = [];
  for (const r of rules) {
    const dx = Math.abs(r.x2 - r.x1);
    const dy = Math.abs(r.y2 - r.y1);
    if (dy <= 1.2 && dx >= 6) h.push({ y: (r.y1 + r.y2) / 2, a: Math.min(r.x1, r.x2), b: Math.max(r.x1, r.x2) });
    else if (dx <= 1.2 && dy >= 6) v.push({ x: (r.x1 + r.x2) / 2, a: Math.min(r.y1, r.y2), b: Math.max(r.y1, r.y2) });
  }
  const merge = (list, key) => {
    const sorted = [...list].sort((p, q) => p[key] - q[key] || p.a - q.a);
    const out = [];
    for (const s of sorted) {
      const last = out.find((o) => Math.abs(o[key] - s[key]) <= 1.2 && s.a <= o.b + TOL);
      if (last) { last.b = Math.max(last.b, s.b); last.a = Math.min(last.a, s.a); } else out.push({ ...s });
    }
    return out;
  };
  return { h: merge(h, "y"), v: merge(v, "x") };
}

// groups of rules that touch each other
function clusters(h, v) {
  const nodes = [...h.map((s) => ({ ...s, kind: "h" })), ...v.map((s) => ({ ...s, kind: "v" }))];
  const parent = nodes.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  nodes.forEach((p, i) => {
    if (p.kind !== "h") return;
    nodes.forEach((q, j) => {
      if (q.kind !== "v") return;
      if (q.x >= p.a - TOL && q.x <= p.b + TOL && p.y >= q.a - TOL && p.y <= q.b + TOL) parent[find(i)] = find(j);
    });
  });
  const groups = new Map();
  nodes.forEach((n, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)).push(n); });
  return [...groups.values()];
}

// sorted positions with the ones that are really one line merged
function positions(values) {
  const out = [];
  for (const x of [...values].sort((a, b) => a - b)) {
    if (out.length && x - out[out.length - 1].end <= TOL) { out[out.length - 1].end = x; out[out.length - 1].sum += x; out[out.length - 1].n++; } else out.push({ end: x, sum: x, n: 1 });
  }
  return out.map((o) => o.sum / o.n);
}

function ruledTables(items, h, v, page) {
  const tables = [];
  const taken = new Set();
  for (const group of clusters(h, v)) {
    const hs = group.filter((g) => g.kind === "h");
    const vs = group.filter((g) => g.kind === "v");
    if (hs.length < 2 || vs.length < 2) continue;
    const ys = positions(hs.map((s) => s.y));
    const xs = positions(vs.map((s) => s.x));
    if (xs.length < 3 || ys.length < 3) continue; // at least two columns and two rows; anything less is a box
    const x0 = xs[0], x1 = xs[xs.length - 1], y0 = ys[0], y1 = ys[ys.length - 1];
    if (page && x1 - x0 > 0.9 * page.width && y1 - y0 > 0.85 * page.height) continue; // the border of the page, not a table
    const ncols = xs.length - 1;
    const nrows = ys.length - 1;
    const grid = Array.from({ length: nrows }, () => Array.from({ length: ncols }, () => []));
    const inside = [];
    items.forEach((it, i) => {
      if (taken.has(i)) return;
      const c = centreOf(it);
      if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) return;
      const col = xs.findIndex((x, k) => k < ncols && c.x >= x && c.x < xs[k + 1]);
      const row = ys.findIndex((y, k) => k < nrows && c.y >= y && c.y < ys[k + 1]);
      if (col < 0 || row < 0) return;
      if (it.str.trim() !== "") grid[row][col].push(it); // a blank piece only spaces things out
      inside.push(i);
    });
    if (grid.flat().filter((cell) => cell.length).length < 3) continue;
    inside.forEach((i) => taken.add(i));
    tables.push({ ruled: true, x0, y0, x1, y1, ncols, edges: xs, rowEdges: ys, rows: grid.map((r) => r.map((cell, col) => ({ col, span: 1, items: cell }))) });
  }
  return { tables, taken };
}

// ---------------------------------------------------------------- tables with no lines

function clusterRows(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.y - last.y) <= 0.45 * Math.max(it.size, last.size)) {
      last.items.push(it);
      if (it.size > last.size) { last.y = it.y; last.size = it.size; }
    } else rows.push({ y: it.y, size: it.size, items: [it] });
  }
  return rows;
}

// the pieces of a row that are separated by a gap too wide to be a space between words
function cellsOfRow(row) {
  const items = [...row.items].sort((a, b) => a.x - b.x);
  const cells = [];
  for (const it of items) {
    const last = cells[cells.length - 1];
    if (last && it.x - last.x1 <= 1.7 * Math.min(it.size, last.size)) { last.items.push(it); last.x1 = Math.max(last.x1, it.x + it.w); } else cells.push({ x0: it.x, x1: it.x + it.w, items: [it] });
  }
  return cells;
}

const textOf = (cell) => cell.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
const LEADERS = /\.{4,}|…{2,}|_{4,}|-{5,}/;

function unions(cells) {
  const sorted = [...cells].sort((a, b) => a.x0 - b.x0);
  const cols = [];
  for (const c of sorted) {
    const last = cols[cols.length - 1];
    if (last && c.x0 <= last.x1 + 1) last.x1 = Math.max(last.x1, c.x1); else cols.push({ x0: c.x0, x1: c.x1 });
  }
  return cols;
}

// one run of rows that look like a table, or null
function tableFromRun(rows) {
  const counts = rows.map((r) => r.cells.length);
  const tally = new Map();
  for (const n of counts) tally.set(n, (tally.get(n) || 0) + 1);
  let mode = 0;
  let most = 0;
  for (const [n, k] of tally) if (n >= 2 && (k > most || (k === most && n > mode))) { mode = n; most = k; }
  if (!mode || most < 2) return null;
  const core = rows.filter((r) => r.cells.length === mode);
  const cols = unions(core.flatMap((r) => r.cells));
  if (cols.length !== mode) return null;
  const lengths = rows.flatMap((r) => r.cells.map((c) => textOf(c).length));
  if (median(lengths) > 45) return null; // columns of ordinary text, not a table
  if (rows.some((r) => r.cells.some((c) => LEADERS.test(textOf(c))))) return null; // a contents list or a form
  const placed = [];
  for (const r of rows) {
    const out = [];
    for (const c of r.cells) {
      const over = cols.map((col, k) => (Math.min(col.x1, c.x1) - Math.max(col.x0, c.x0) > 1 ? k : -1)).filter((k) => k >= 0);
      if (!over.length) return null; // a piece that sits between the columns
      out.push({ col: over[0], span: over[over.length - 1] - over[0] + 1, items: c.items });
    }
    if (out.some((c, i) => i && c.col < out[i - 1].col + out[i - 1].span)) return null; // two pieces in one column
    placed.push(out);
  }
  // how each column is lined up, from its single-column cells below the first row: the edge they share is the alignment
  const body = placed.length >= 4 ? placed.slice(1) : placed;
  const colAlign = cols.map((_, k) => {
    const exts = body.flat().filter((c) => c.col === k && c.span === 1).map((c) => ({ x0: Math.min(...c.items.map((i) => i.x)), x1: Math.max(...c.items.map((i) => i.x + i.w)) }));
    if (exts.length < 2) return "left";
    const spread = (f) => Math.max(...exts.map(f)) - Math.min(...exts.map(f));
    const [l, r, m] = [spread((e) => e.x0), spread((e) => e.x1), spread((e) => (e.x0 + e.x1) / 2)];
    if (l <= 2.5) return "left";
    if (r <= 2.5 && r < l) return "right";
    if (m <= 2.5 && m < l) return "center";
    return "left";
  });
  // edges halfway through the gaps between columns
  const edges = [cols[0].x0];
  for (let k = 1; k < cols.length; k++) edges.push((cols[k - 1].x1 + cols[k].x0) / 2);
  edges.push(cols[cols.length - 1].x1);
  const items = rows.flatMap((r) => r.items);
  const size = median(items.map((i) => i.size));
  return {
    ruled: false, ncols: cols.length, edges, colAlign, rows: placed,
    x0: edges[0], x1: edges[edges.length - 1], y0: Math.min(...items.map((i) => i.y - i.size * 0.85)), y1: Math.max(...items.map((i) => i.y + i.size * 0.25)), size,
  };
}

// a title or heading above or below the table that runs across two or more of its columns joins it as a spanning cell
function absorb(table, row) {
  if (!row || row.cells.length !== 1) return false;
  const c = row.cells[0];
  const cols = [];
  for (let k = 0; k < table.ncols; k++) if (Math.min(table.edges[k + 1], c.x1) - Math.max(table.edges[k], c.x0) > 1) cols.push(k);
  if (cols.length < 2 || textOf(c).length > 80) return false;
  return { col: cols[0], span: cols.length, items: c.items };
}

function alignedTables(all) {
  // blank pieces are how some PDFs space columns out, so they must not join the cells on either side
  const items = all.filter((i) => i.str.trim() !== "");
  const blanks = all.filter((i) => i.str.trim() === "");
  const rows = clusterRows(items).map((r) => ({ ...r, cells: cellsOfRow(r) }));
  const tables = [];
  const taken = new Set();
  let start = -1;
  const flush = (end) => {
    if (start >= 0 && end - start >= 3) {
      const run = rows.slice(start, end);
      const t = tableFromRun(run);
      if (t) {
        const above = absorb(t, rows[start - 1]);
        if (above && run[0].y - rows[start - 1].y <= 2.6 * rows[start - 1].size) {
          t.rows.unshift([above]);
          for (const it of rows[start - 1].items) taken.add(it);
          t.y0 = Math.min(t.y0, rows[start - 1].y - rows[start - 1].size * 0.85);
        }
        tables.push(t);
        for (const r of run) for (const it of r.items) taken.add(it);
        for (const b of blanks) if (b.y >= t.y0 - 2 && b.y <= t.y1 + 2 && b.x >= t.x0 - 2 && b.x <= t.x1 + 2) taken.add(b);
      }
    }
    start = -1;
  };
  rows.forEach((r, i) => {
    const gapOk = start < 0 || r.y - rows[i - 1].y <= 2.6 * Math.max(r.size, rows[i - 1].size);
    if (r.cells.length >= 2 && gapOk) { if (start < 0) start = i; } else { flush(i); if (r.cells.length >= 2) start = i; }
  });
  flush(rows.length);
  return { tables, taken };
}

// ---------------------------------------------------------------- both

// page: { width, height }, rules: straight line pieces, opts: { ruled, aligned }
export function findTables(items, rules, page, opts = {}) {
  const useRuled = opts.ruled !== false;
  const useAligned = opts.aligned !== false;
  const tables = [];
  let remaining = items;
  if (useRuled && rules && rules.length) {
    const { h, v } = normaliseRules(rules);
    const found = ruledTables(items, h, v, page);
    tables.push(...found.tables);
    remaining = items.filter((_, i) => !found.taken.has(i));
  }
  if (useAligned) {
    const found = alignedTables(remaining);
    tables.push(...found.tables);
    remaining = remaining.filter((it) => !found.taken.has(it));
  }
  tables.sort((a, b) => a.y0 - b.y0);
  return { tables, rest: remaining };
}
