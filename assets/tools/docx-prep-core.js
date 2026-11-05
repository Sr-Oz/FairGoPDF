// Word to PDF: the rules that do not need a browser, kept apart so they can be tested.
// Equations are read as small trees: { n: localName, a: { attributeName: value }, c: [children], t: "text" for m:t }.

// ---------------------------------------------------------------- equations

const SIMPLE = /^[A-Za-z0-9.]+$/;
const plain = (runs) => runs.map((r) => r.text).join("");
const wrap = (runs) => {
  const text = plain(runs);
  return text.length > 1 && !SIMPLE.test(text) ? [{ text: "(" }, ...runs, { text: ")" }] : runs;
};
const raised = (runs) => runs.map((r) => ({ ...r, sup: true, sub: undefined }));
const lowered = (runs) => runs.map((r) => ({ ...r, sub: true, sup: undefined }));

const kids = (node, name) => (node.c || []).filter((k) => k.n === name);
const first = (node, name) => kids(node, name)[0];
const val = (node, name, fallback) => {
  const props = node && (node.c || []).find((k) => /Pr$/.test(k.n));
  const el = props && first(props, name);
  return el && el.a && el.a.val !== undefined ? el.a.val : fallback;
};

// Turns an Office Math (OMML) tree into runs of plain text, some raised or lowered: (a+b)/c, x², √(x), ∑ with its limits.
// This is the readable text version, not Word's typeset layout.
export function ommlToRuns(node) {
  const out = [];
  const add = (runs) => out.push(...runs);
  const body = (n) => (n ? ommlToRuns(n) : []);
  switch (node.n) {
    case "t":
      return node.t ? [{ text: node.t }] : [];
    case "f": {
      const type = val(node, "type", "bar");
      const num = wrap(body(first(node, "num")));
      const den = wrap(body(first(node, "den")));
      return [...num, { text: type === "lin" || type === "bar" ? "/" : type === "skw" ? "/" : " / " }, ...den];
    }
    case "sSup":
      add(body(first(node, "e")));
      add(raised(body(first(node, "sup"))));
      return out;
    case "sSub":
      add(body(first(node, "e")));
      add(lowered(body(first(node, "sub"))));
      return out;
    case "sSubSup":
      add(body(first(node, "e")));
      add(lowered(body(first(node, "sub"))));
      add(raised(body(first(node, "sup"))));
      return out;
    case "sPre":
      add(lowered(body(first(node, "sub"))));
      add(raised(body(first(node, "sup"))));
      add(body(first(node, "e")));
      return out;
    case "rad": {
      const degree = body(first(node, "deg"));
      if (degree.length && plain(degree) !== "2") add(raised(degree));
      add([{ text: "√" }]);
      add(wrap(body(first(node, "e"))));
      return out;
    }
    case "nary": {
      add([{ text: val(node, "chr", "∫") }]);
      add(lowered(body(first(node, "sub"))));
      add(raised(body(first(node, "sup"))));
      const inner = body(first(node, "e"));
      if (inner.length) add([{ text: " " }, ...inner]);
      return out;
    }
    case "d": {
      const open = val(node, "begChr", "(");
      const close = val(node, "endChr", ")");
      const sep = val(node, "sepChr", "|");
      const parts = kids(node, "e").map(body);
      add([{ text: open }]);
      parts.forEach((p, i) => {
        if (i) add([{ text: sep }]);
        add(p);
      });
      add([{ text: close }]);
      return out;
    }
    case "func": {
      const name = body(first(node, "fName"));
      const arg = body(first(node, "e"));
      add(name);
      if (name.length && arg.length && /[A-Za-z]$/.test(plain(name)) && /^[A-Za-z0-9]/.test(plain(arg))) add([{ text: " " }]);
      add(arg);
      return out;
    }
    case "limLow":
      add(body(first(node, "e")));
      add(lowered(body(first(node, "lim"))));
      return out;
    case "limUpp":
      add(body(first(node, "e")));
      add(raised(body(first(node, "lim"))));
      return out;
    case "m": {
      add([{ text: "[" }]);
      kids(node, "mr").forEach((row, i) => {
        if (i) add([{ text: "; " }]);
        kids(row, "e").forEach((cell, j) => {
          if (j) add([{ text: " " }]);
          add(body(cell));
        });
      });
      add([{ text: "]" }]);
      return out;
    }
    case "eqArr":
      kids(node, "e").forEach((line, i) => {
        if (i) add([{ text: "; " }]);
        add(body(line));
      });
      return out;
    default:
      // properties describe the look, not the content
      if (/Pr$/.test(node.n)) return [];
      for (const child of node.c || []) add(ommlToRuns(child));
      return out;
  }
}

// ---------------------------------------------------------------- page size

const TWIPS = { a4: [11906, 16838], letter: [12240, 15840] };

// The size to give a page, in twips. The page keeps its orientation: a landscape page stays landscape.
export function pageSizeTwips(kind, currentWidth, currentHeight) {
  const base = TWIPS[kind];
  if (!base) return null;
  return currentWidth > currentHeight ? { w: base[1], h: base[0] } : { w: base[0], h: base[1] };
}

// ---------------------------------------------------------------- what could not be drawn

// Names the writing system of a character the built-in fonts do not have
export function scriptName(codePoint) {
  const r = (a, b) => codePoint >= a && codePoint <= b;
  if (r(0x4e00, 0x9fff) || r(0x3400, 0x4dbf) || r(0x3040, 0x30ff) || r(0xac00, 0xd7af) || r(0x3000, 0x303f) || r(0xff00, 0xffef) || r(0x20000, 0x2a6df)) return "Chinese, Japanese or Korean";
  if (r(0x0600, 0x06ff) || r(0x0750, 0x077f) || r(0xfb50, 0xfdff) || r(0xfe70, 0xfeff)) return "Arabic";
  if (r(0x0590, 0x05ff)) return "Hebrew";
  if (r(0x0e00, 0x0e7f)) return "Thai";
  if (r(0x0900, 0x0dff)) return "Indian-language";
  if (r(0x1f000, 0x1faff) || r(0x2600, 0x27bf)) return "emoji or symbol";
  return "other";
}

// "24 Chinese, Japanese or Korean characters and 3 Arabic characters" from the characters that were left out
export function summariseMissing(chars) {
  const counts = new Map();
  for (const ch of chars) {
    const name = scriptName(ch.codePointAt(0));
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => (name === "other" ? `${n} other character${n === 1 ? "" : "s"}` : `${n} ${name} character${n === 1 ? "" : "s"}`));
  if (!parts.length) return "";
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `${list} could not be drawn, because the built-in fonts do not have them`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Two lists for the person: what was changed to fit, and what could not be carried over.
// `features` is the count of each thing found in the document.
export function buildNotes(f, missing = "") {
  const adjusted = [];
  const lost = [];
  if (f.textBoxes) adjusted.push(`${plural(f.textBoxes, "text box was", "text boxes were")} placed in the flow of the text, in a bordered block, where each was anchored`);
  if (f.equations) adjusted.push(`${plural(f.equations, "equation was", "equations were")} written as plain text, such as (a+b)/c and x²`);
  if (f.footnotes) adjusted.push(`${plural(f.footnotes, "footnote is", "footnotes are")} listed at the end of ${f.footnotes === 1 ? "its section rather than the foot of its page" : "their section rather than the foot of their page"}`);
  if (f.endnotes) adjusted.push(`${plural(f.endnotes, "endnote is", "endnotes are")} listed at the end of the document`);
  if (f.trackedChanges) adjusted.push("tracked changes were accepted: insertions are kept and deletions are gone");
  if (f.continuousBreaks) adjusted.push(`${plural(f.continuousBreaks, "continuous section break starts", "continuous section breaks start")} a new page`);
  if (f.charts) lost.push(`${plural(f.charts, "chart was", "charts were")} left out`);
  if (f.smartArt) lost.push(`${plural(f.smartArt, "SmartArt diagram was", "SmartArt diagrams were")} left out`);
  if (f.shapes) lost.push(`${plural(f.shapes, "drawn shape was", "drawn shapes were")} left out`);
  if (f.comments) lost.push(`${plural(f.comments, "comment is", "comments are")} not included`);
  if (missing) lost.push(missing);
  return { adjusted, lost };
}
