// Repair PDF: reading a damaged file's bytes to say what is wrong with it, and cutting it back to what is whole. No DOM and no PDF
// library in here, so it can be tested with small made-up files.
//
// A PDF is a run of numbered objects ("5 0 obj ... endobj"), then a table (xref) saying where each one is, then a trailer naming the
// catalog that starts everything. Most damage is to the end of the file (a cut-off download, a failed save), where the table and
// trailer live. The objects before that are usually fine, so this finds them by reading the file from the start.

const WS = new Set([0, 9, 10, 12, 13, 32]);
const isDigit = (c) => c >= 48 && c <= 57;
const latin = (b, from, to) => { let s = ""; for (let i = from; i < to; i++) s += String.fromCharCode(b[i]); return s; };
const match = (b, at, word) => { for (let i = 0; i < word.length; i++) if (b[at + i] !== word.charCodeAt(i)) return false; return true; };
const find = (b, word, from = 0, to = b.length) => {
  const c = word.charCodeAt(0);
  for (let i = from; i <= to - word.length; i++) if (b[i] === c && match(b, i, word)) return i;
  return -1;
};
const findLast = (b, word) => {
  const c = word.charCodeAt(0);
  for (let i = b.length - word.length; i >= 0; i--) if (b[i] === c && match(b, i, word)) return i;
  return -1;
};

// ---------------------------------------------------------------- what kind of file this is

// A file that is not a PDF at all, by its first bytes. Returns null when it is a PDF (the header may come a little way in).
export function sniff(b) {
  if (!b.length) return { kind: "empty", label: "empty", hint: "The file has no content at all. Check the original, or download or copy it again." };
  const head = latin(b, 0, Math.min(b.length, 1024));
  if (head.includes("%PDF-")) return null;
  const starts = (s) => head.startsWith(s);
  const text = head.trimStart().slice(0, 200).toLowerCase();
  if (/^(<!doctype html|<html|<head|<\?xml)/.test(text) || text.includes("<body")) return { kind: "web", label: "a web page", hint: "This looks like a web page saved with a .pdf name, usually a failed download or a login page. Download the PDF again from where it came from." };
  if (starts("PK\x03\x04")) return { kind: "zip", label: "a zip-based file", hint: "This is a zip-type file (Word, Excel, PowerPoint, EPUB or a zip) with a .pdf name. Try opening it with the program that made it, or change its name to its real one." };
  if (starts("\xD0\xCF\x11\xE0")) return { kind: "office", label: "an older Microsoft Office file", hint: "This is an older Word, Excel or PowerPoint file with a .pdf name. Open it in Office and save as PDF." };
  if (starts("\xFF\xD8\xFF")) return { kind: "jpeg", label: "a JPEG picture", hint: "This is a JPEG picture with a .pdf name. Use Images to PDF to make a real PDF from it." };
  if (starts("\x89PNG")) return { kind: "png", label: "a PNG picture", hint: "This is a PNG picture with a .pdf name. Use Images to PDF to make a real PDF from it." };
  if (starts("{\\rtf")) return { kind: "rtf", label: "an RTF document", hint: "This is an RTF document with a .pdf name. Use RTF to PDF to make a real PDF from it." };
  if (/^[\x00\s]*$/.test(head)) return { kind: "blank", label: "all blank", hint: "The file is filled with empty bytes, so nothing can be recovered from it. A copy or download probably failed." };
  return { kind: "other", label: "not a PDF", hint: "The start of this file does not look like a PDF, and no PDF marker is anywhere near it, so there is nothing to repair." };
}

// ---------------------------------------------------------------- reading the objects

// the dictionary at `at` (just after "obj"): where it ends, or -1 when the file stops first
function dictEnd(b, at) {
  let i = at;
  while (i < b.length && WS.has(b[i])) i++;
  if (b[i] !== 60 || b[i + 1] !== 60) return { start: i, end: -1, isDict: false };
  let depth = 0;
  const start = i;
  while (i < b.length) {
    const c = b[i];
    if (c === 40) { // a string, which may hold brackets
      let nest = 1;
      i++;
      while (i < b.length && nest) { if (b[i] === 92) i++; else if (b[i] === 40) nest++; else if (b[i] === 41) nest--; i++; }
      continue;
    }
    if (c === 60 && b[i + 1] === 60) { depth++; i += 2; continue; }
    if (c === 62 && b[i + 1] === 62) { depth--; i += 2; if (depth === 0) return { start, end: i, isDict: true }; continue; }
    i++;
  }
  return { start, end: -1, isDict: true };
}

// Every object the file holds in full, in file order. `complete` is false for the last one when the file stops part-way through it.
export function scanObjects(b) {
  const objects = [];
  const n = b.length;
  let i = 0;
  while (i < n - 5) {
    if (!(b[i] === 111 && b[i + 1] === 98 && b[i + 2] === 106) || (i > 0 && b[i - 1] === 100)) { i++; continue; } // "obj", not "endobj"
    // back over "<number> <generation> "
    let j = i - 1;
    while (j >= 0 && WS.has(b[j])) j--;
    const genEnd = j + 1;
    while (j >= 0 && isDigit(b[j])) j--;
    const genStart = j + 1;
    if (genStart === genEnd || j < 0 || !WS.has(b[j])) { i += 3; continue; }
    while (j >= 0 && WS.has(b[j])) j--;
    const numEnd = j + 1;
    while (j >= 0 && isDigit(b[j])) j--;
    const numStart = j + 1;
    if (numStart === numEnd || (j >= 0 && !WS.has(b[j]) && b[j] !== 100 && b[j] !== 70 && b[j] !== 114)) { i += 3; continue; } // after whitespace, "endobj" or an end of table
    const num = Number(latin(b, numStart, numEnd));
    const gen = Number(latin(b, genStart, genEnd));
    const d = dictEnd(b, i + 3);
    let end = -1;
    let stream = false;
    let complete = true;
    let dictText = "";
    if (d.isDict && d.end < 0) {
      complete = false;
      end = n;
    } else {
      if (d.isDict) dictText = latin(b, d.start, Math.min(d.end, d.start + 4000));
      let k = d.isDict ? d.end : i + 3;
      while (k < n && WS.has(b[k])) k++;
      if (d.isDict && match(b, k, "stream")) {
        stream = true;
        k += 6;
        if (b[k] === 13) k++;
        if (b[k] === 10) k++;
        const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dictText);
        let data = -1;
        if (length) {
          let after = k + Number(length[1]);
          while (after < n && WS.has(b[after])) after++;
          if (after <= n && match(b, after, "endstream")) data = after + 9;
        }
        if (data < 0) { const e = find(b, "endstream", k); data = e < 0 ? -1 : e + 9; }
        if (data < 0) { complete = false; end = n; } else k = data;
      }
      if (complete) {
        const e = find(b, "endobj", k);
        const next = find(b, " obj", k, e >= 0 ? e : n); // another object's header before this one closes
        if (e >= 0 && next < 0) end = e + 6;
        else if (e < 0 && next < 0) { complete = false; end = n; } // the file stops before this object closes
        else { // no "endobj", but another object starts, so this one is only sloppy; it ends where that one's number begins
          let m = next;
          while (m > k && (isDigit(b[m - 1]) || WS.has(b[m - 1]))) m--;
          end = Math.max(k, m);
        }
      }
    }
    objects.push({ num, gen, start: numStart, end, complete, stream, dictText, type: (/\/Type\s*\/(\w+)/.exec(dictText) || [])[1] || "" });
    i = Math.max(i + 3, complete ? end : n);
  }
  return objects;
}

// ---------------------------------------------------------------- the whole file

// -> what is in the file and what is wrong with it
export function analyse(b) {
  const not = sniff(b);
  if (not) return { isPdf: false, ...not };
  const headerAt = find(b, "%PDF-");
  const version = latin(b, headerAt + 5, headerAt + 8).replace(/[^0-9.]/g, "");
  const objects = scanObjects(b);
  const whole = objects.filter((o) => o.complete);
  const cut = objects.find((o) => !o.complete) || null;
  const eofAt = findLast(b, "%%EOF");
  const startxrefAt = findLast(b, "startxref");
  let startxrefValid = false;
  if (startxrefAt >= 0) {
    const m = /^\s*(\d+)/.exec(latin(b, startxrefAt + 9, Math.min(b.length, startxrefAt + 40)));
    if (m) {
      const at = Number(m[1]) + headerAt;
      startxrefValid = at < b.length && (match(b, at, "xref") || /^\s*\d+\s+\d+\s+obj/.test(latin(b, at, Math.min(b.length, at + 30))));
    }
  }
  const byType = (t) => whole.filter((o) => o.type === t);
  const encrypted = /\/Encrypt\b/.test(latin(b, Math.max(0, b.length - 4000), b.length)) || objects.some((o) => /\/Filter\s*\/Standard\b/.test(o.dictText) && /\/O\s*[(<]/.test(o.dictText));
  const objStreams = whole.filter((o) => o.type === "ObjStm");
  return {
    isPdf: true, headerAt, version, objects, whole: whole.length, cut,
    catalogs: byType("Catalog").map((o) => o.num), pagesNodes: byType("Pages").map((o) => o.num), pageNums: byType("Page").map((o) => o.num),
    objStreams: objStreams.length, encrypted,
    eofAt, hasEof: eofAt >= 0, startxrefValid, hasTrailer: findLast(b, "trailer") >= 0 || objects.some((o) => o.type === "XRef"),
    trailing: eofAt >= 0 ? b.length - (eofAt + 5) : 0,
    truncated: !!cut || eofAt < 0,
  };
}

// plain statements about what was found, each with how bad it is
export function describe(a, size) {
  if (!a.isPdf) return [{ level: "bad", text: `This file is ${a.label}. ${a.hint}` }];
  const out = [];
  const pageWord = (n) => `${n} page${n === 1 ? "" : "s"}`;
  if (a.headerAt > 0) out.push({ level: "fix", text: `There are ${a.headerAt} bytes of junk before the PDF starts. They will be cut off.` });
  if (a.cut) out.push({ level: "bad", text: `The file stops part-way through object ${a.cut.num}, so it was cut short, probably by an interrupted download or copy. Everything before that point can be kept.` });
  else if (!a.hasEof) out.push({ level: "bad", text: "The end-of-file marker is missing, so the file may be cut short." });
  if (!a.cut && a.hasEof && !a.hasTrailer) out.push({ level: "fix", text: "The trailer that says where the document starts is missing. It will be rebuilt." });
  else if (a.hasEof && !a.startxrefValid && !a.cut) out.push({ level: "fix", text: "The table of where each part sits points to the wrong place. It will be rebuilt." });
  if (a.trailing > 64) out.push({ level: "fix", text: `There are ${a.trailing} extra bytes after the end of the PDF. They will be cut off.` });
  if (!a.catalogs.length && !a.objStreams) out.push({ level: "bad", text: "The catalog, the part that says where the pages are, was not found. A new one will be built from the pages that survive." });
  if (a.encrypted) out.push({ level: "note", text: "This PDF is encrypted. If it needs a password, remove it with Unlock PDF first." });
  const pages = a.pageNums.length;
  out.push({ level: "ok", text: pages ? `${pageWord(pages)} found${a.objStreams ? ", and more may be packed inside compressed data" : ""}, in ${a.whole} intact parts.` : `${a.whole} intact parts found${a.objStreams ? ", with the pages packed inside compressed data" : ", but no pages yet"}.` });
  return out;
}

// ---------------------------------------------------------------- cutting back to what is whole

// The file from its header to the end of its last whole object: junk before the header, any cut-off object and the damaged table and
// trailer at the end are dropped.
export function cutBack(b, a) {
  const last = [...a.objects].reverse().find((o) => o.complete);
  const end = last ? last.end : b.length;
  return b.slice(a.headerAt, Math.max(end, a.headerAt));
}

const enc = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
const join = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let k = 0; for (const p of parts) { out.set(p, k); k += p.length; } return out; };

// The cut-back file with a new catalog and page list added, listing the pages that survived (in the order they appear), and a
// new table and trailer. `pageNums` are object numbers of whole pages.
export function withNewCatalog(body, a, pageNums) {
  const top = Math.max(0, ...a.objects.map((o) => o.num)) + 1;
  const pagesNum = top;
  const catalogNum = top + 1;
  const kids = pageNums.map((n) => `${n} 0 R`).join(" ");
  const add = enc(`\n${pagesNum} 0 obj\n<< /Type /Pages /Count ${pageNums.length} /Kids [${kids}] /MediaBox [0 0 595.28 841.89] >>\nendobj\n${catalogNum} 0 obj\n<< /Type /Catalog /Pages ${pagesNum} 0 R >>\nendobj\n`);
  const all = join(body, add);
  // a fresh table of where each object starts
  const found = scanObjects(all);
  const size = Math.max(...found.map((o) => o.num)) + 1;
  const at = new Map();
  for (const o of found) if (o.complete) at.set(o.num, o.start);
  let xref = `xref\n0 ${size}\n`;
  for (let n = 0; n < size; n++) xref += at.has(n) ? `${String(at.get(n)).padStart(10, "0")} 00000 n \n` : n === 0 ? "0000000000 65535 f \n" : "0000000000 00000 f \n";
  const tail = enc(`${xref}trailer\n<< /Size ${size} /Root ${catalogNum} 0 R >>\nstartxref\n${all.length}\n%%EOF\n`);
  return join(all, tail);
}
