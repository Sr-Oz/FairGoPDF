// Small hand-written RTF reader: enough of the RTF control-word set to recover
// paragraphs, line breaks, bold/italic runs and basic text from a .rtf file,
// as an HTML string the shared doc-pdf-render.js block renderer can lay out.
// It intentionally does not attempt full RTF fidelity (fonts, tables, images,
// embedded objects, footnotes) — those are skipped rather than mis-rendered.

// A minimal Windows-1252 map for the \'hh hex escape, covering the common
// "smart" punctuation range (0x80-0x9F) that plain ASCII doesn't have.
const CP1252_HIGH = {
  0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”",
  0x96: "–", 0x97: "—", 0x85: "…", 0x95: "•",
};

const SKIP_DESTINATIONS = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "generator", "pict", "object",
  "footnote", "header", "footer", "headerf", "footerf", "headerl", "footerl",
  "headerr", "footerr", "listtable", "listoverridetable", "revtbl", "themedata",
  "datastore", "xmlnstbl", "rsidtbl", "colorschememapping", "latentstyles",
  "panose", "fldinst", "nonshppict",
]);

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function rtfToHtml(rtf) {
  const paragraphs = [[]]; // array of paragraphs, each an array of {text, bold, italic}
  const stack = [];
  let bold = false, italic = false, skipDepth = 0;
  let pending = "";
  let ucSkip = 1;
  let i = 0;
  const n = rtf.length;

  function flush() {
    if (!pending) return;
    paragraphs[paragraphs.length - 1].push({ text: pending, bold, italic });
    pending = "";
  }
  function newParagraph() {
    flush();
    paragraphs.push([]);
  }

  while (i < n) {
    const ch = rtf[i];

    if (ch === "{") {
      flush();
      stack.push({ bold, italic, skipDepth });
      i++;
      continue;
    }
    if (ch === "}") {
      flush();
      const prev = stack.pop();
      if (prev) { bold = prev.bold; italic = prev.italic; skipDepth = prev.skipDepth; }
      i++;
      continue;
    }

    if (ch === "\\") {
      i++;
      const next = rtf[i];
      if (next === "\\" || next === "{" || next === "}") {
        if (!skipDepth) pending += next;
        i++;
        continue;
      }
      if (next === "'") {
        // \'hh — one hex-escaped byte in the current codepage.
        const hex = rtf.slice(i + 1, i + 3);
        i += 3;
        const code = parseInt(hex, 16);
        if (!skipDepth && !isNaN(code)) {
          pending += code < 0x80 ? String.fromCharCode(code) : (CP1252_HIGH[code] || String.fromCharCode(code));
        }
        continue;
      }
      if (next === "*") {
        // Ignorable-destination marker; the control word right after it names
        // the destination, and we skip its whole group's text either way.
        skipDepth++;
        i++;
        continue;
      }
      if (next === "\n" || next === "\r") { i++; continue; }

      // A control word: letters, then an optional signed number, then one
      // optional space (the space is the delimiter, not content).
      const m = /^([a-zA-Z]+)(-?\d+)?/.exec(rtf.slice(i));
      if (!m) { i++; continue; }
      const word = m[1];
      const arg = m[2] !== undefined ? parseInt(m[2], 10) : null;
      i += m[0].length;
      if (rtf[i] === " ") i++;

      if (SKIP_DESTINATIONS.has(word)) { skipDepth++; continue; }
      if (word === "b") { flush(); bold = arg !== 0; continue; }
      if (word === "i") { flush(); italic = arg !== 0; continue; }
      if (word === "par" || word === "page" || word === "sect") { newParagraph(); continue; }
      if (word === "line" || word === "tab") { if (!skipDepth) pending += word === "tab" ? "\t" : "\n"; continue; }
      if (word === "uc") { ucSkip = arg === null ? 1 : arg; continue; }
      if (word === "u") {
        if (!skipDepth && arg !== null) {
          const code = arg < 0 ? arg + 65536 : arg;
          pending += String.fromCodePoint(code);
        }
        // \uN is followed by ucSkip fallback characters to discard.
        let skipped = 0;
        while (skipped < ucSkip && i < n) {
          if (rtf[i] === "\\") { const mm = /^\\[a-zA-Z]+(-?\d+)? ?/.exec(rtf.slice(i)); if (mm) { i += mm[0].length; skipped++; continue; } }
          i++;
          skipped++;
        }
        continue;
      }
      // Unrecognised control word: ignore it (its argument, if any, was already consumed).
      continue;
    }

    if (ch === "\r" || ch === "\n") {
      // A bare (non-escaped) line break in the RTF source is just how the
      // file happens to be wrapped, not a real line or paragraph break —
      // those always come through explicit \line/\par control words.
      if (!skipDepth && pending && !/\s$/.test(pending)) pending += " ";
      i++;
      continue;
    }
    if (!skipDepth) pending += ch;
    i++;
  }
  flush();

  const html = paragraphs
    .map((runs) => runs.filter((r) => r.text.replace(/\t/g, "").length))
    .filter((runs) => runs.length)
    .map((runs) => {
      const inner = runs.map((r) => {
        let t = esc(r.text).replace(/\n/g, "<br>");
        if (r.bold) t = `<strong>${t}</strong>`;
        if (r.italic) t = `<em>${t}</em>`;
        return t;
      }).join("");
      return `<p>${inner}</p>`;
    })
    .join("");

  return html || "<p></p>";
}
