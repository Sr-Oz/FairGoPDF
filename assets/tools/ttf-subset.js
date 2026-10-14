// Minimal TrueType subsetter: keeps the glyphs you ask for (plus any glyphs they are built from) and empties every
// other outline. Glyph numbers do not change, so cmap / hmtx keep working. Layout tables (GSUB, GPOS, kern, ...) are
// dropped because the PDF only needs the outlines and the widths.
//
// Written because the subsetting bundled with pdf-lib's font support produced fonts that lost most glyphs when
// rendered, so fonts are subsetted here and embedded whole.

const KEEP_TABLES = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "prep", "gasp"];

function tag(view, offset) {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}

function checksum(bytes) {
  let sum = 0;
  const padded = new Uint8Array((bytes.length + 3) & ~3);
  padded.set(bytes);
  const v = new DataView(padded.buffer);
  for (let i = 0; i < padded.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
  return sum;
}

export function subsetTtf(buffer, glyphIds) {
  const src = new Uint8Array(buffer);
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const numTables = view.getUint16(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables[tag(view, o)] = { offset: view.getUint32(o + 8), length: view.getUint32(o + 12) };
  }
  if (!tables.glyf || !tables.loca || !tables.head || !tables.maxp) throw new Error("Not a TrueType font");
  const head = tables.head;
  const longLoca = view.getInt16(head.offset + 50) === 1;
  const numGlyphs = view.getUint16(tables.maxp.offset + 4);
  const locaOf = (g) =>
    longLoca ? view.getUint32(tables.loca.offset + g * 4) : view.getUint16(tables.loca.offset + g * 2) * 2;

  // glyphs to keep, including the parts of composite glyphs
  const keep = new Set([0]);
  const queue = [...glyphIds].filter((g) => g >= 0 && g < numGlyphs);
  while (queue.length) {
    const g = queue.pop();
    if (keep.has(g)) continue;
    keep.add(g);
    const start = locaOf(g);
    const end = locaOf(g + 1);
    if (end - start < 10) continue;
    const go = tables.glyf.offset + start;
    if (view.getInt16(go) >= 0) continue; // simple glyph
    let p = go + 10;
    for (;;) {
      const flags = view.getUint16(p);
      const comp = view.getUint16(p + 2);
      if (comp < numGlyphs && !keep.has(comp)) queue.push(comp);
      p += 4 + (flags & 1 ? 4 : 2);
      if (flags & 8) p += 2;
      else if (flags & 0x40) p += 4;
      else if (flags & 0x80) p += 8;
      if (!(flags & 0x20)) break;
    }
  }

  // new glyf + loca (long offsets)
  const parts = [];
  const newLoca = new DataView(new ArrayBuffer((numGlyphs + 1) * 4));
  let total = 0;
  for (let g = 0; g < numGlyphs; g++) {
    newLoca.setUint32(g * 4, total);
    if (!keep.has(g)) continue;
    const start = locaOf(g);
    const end = locaOf(g + 1);
    if (end <= start) continue;
    let chunk = src.subarray(tables.glyf.offset + start, tables.glyf.offset + end);
    const padded = (chunk.length + 3) & ~3;
    if (padded !== chunk.length) {
      const c = new Uint8Array(padded);
      c.set(chunk);
      chunk = c;
    }
    parts.push(chunk);
    total += chunk.length;
  }
  newLoca.setUint32(numGlyphs * 4, total);
  const glyf = new Uint8Array(total);
  let o = 0;
  for (const c of parts) {
    glyf.set(c, o);
    o += c.length;
  }

  const out = {};
  for (const name of KEEP_TABLES) {
    if (!tables[name]) continue;
    out[name] = src.slice(tables[name].offset, tables[name].offset + tables[name].length);
  }
  if (out.post && out.post.length > 32) {
    // glyph names for every glyph are dead weight in a PDF; keep the 32-byte header and mark it "no names" (format 3)
    out.post = out.post.slice(0, 32);
    new DataView(out.post.buffer).setUint32(0, 0x00030000);
  }
  out.glyf = glyf;
  out.loca = new Uint8Array(newLoca.buffer);
  const hv = new DataView(out.head.buffer);
  hv.setInt16(50, 1); // indexToLocFormat = long
  hv.setUint32(8, 0); // checkSumAdjustment, set again below

  const names = Object.keys(out).sort();
  const dirSize = 12 + names.length * 16;
  let offset = dirSize;
  const layout = names.map((n) => {
    const entry = { name: n, data: out[n], offset, length: out[n].length };
    offset += (out[n].length + 3) & ~3;
    return entry;
  });
  const file = new Uint8Array(offset);
  const fv = new DataView(file.buffer);
  fv.setUint32(0, 0x00010000);
  fv.setUint16(4, names.length);
  let pow = 1;
  let log = 0;
  while (pow * 2 <= names.length) {
    pow *= 2;
    log++;
  }
  fv.setUint16(6, pow * 16);
  fv.setUint16(8, log);
  fv.setUint16(10, names.length * 16 - pow * 16);
  layout.forEach((t, i) => {
    const e = 12 + i * 16;
    for (let k = 0; k < 4; k++) file[e + k] = t.name.charCodeAt(k);
    fv.setUint32(e + 4, checksum(t.data));
    fv.setUint32(e + 8, t.offset);
    fv.setUint32(e + 12, t.length);
    file.set(t.data, t.offset);
  });
  const headEntry = layout.find((t) => t.name === "head");
  fv.setUint32(headEntry.offset + 8, 0);
  const adjustment = (0xb1b0afba - checksum(file)) >>> 0;
  fv.setUint32(headEntry.offset + 8, adjustment);
  return file;
}
