// Writes a .docx (Word) file from the document structure made by pdf-layout.js. A .docx is a zip of a few XML parts, so this
// builds them by hand with fflate (already on the site) instead of pulling in a document library.
//
// model: { sections: [{ pageW, pageH, margins: { top, right, bottom, left }, blocks }], style: { bodySize, bodyFamily,
//          lineMultiple, headings: { 1..4: points } } }, with sizes in points. Paragraph blocks look like
//          { type: "p", runs: [{ text, bold, italic, size, family, link }], heading, list: { id, kind, level, start },
//            align, left, firstLine, after, pageBreakBefore }
//          and picture blocks like { type: "image", id, w, h, align }.
// extras: { images: Map(id -> { bytes, ext, pxW, pxH }), title, author, language }
import * as fflate from "../vendor/fflate.min.js";

const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
};
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// characters XML does not allow (control codes) would make Word refuse the file, so they never get through
const clean = (s) => String(s).replace(/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu, "");
const esc = (s) => clean(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const twips = (pt) => Math.round(pt * 20);
const halfPoints = (pt) => Math.round(pt * 2);
const emu = (pt) => Math.round(pt * 12700);

const KIND_LEVELS = {
  bullet: ["•", "–", "▪"],
  decimal: ["decimal", "lowerLetter", "lowerRoman"],
  lowerLetter: ["lowerLetter", "decimal", "lowerRoman"],
  upperLetter: ["upperLetter", "decimal", "lowerRoman"],
  lowerRoman: ["lowerRoman", "decimal", "lowerLetter"],
};
const KIND_ORDER = ["bullet", "decimal", "lowerLetter", "upperLetter", "lowerRoman"];

function numberingXml(lists) {
  const abstract = KIND_ORDER.map((kind, k) => {
    const levels = Array.from({ length: 9 }, (_, l) => {
      const spec = KIND_LEVELS[kind][l % 3];
      const bullet = kind === "bullet";
      const left = (l + 1) * 360;
      return `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${bullet ? "bullet" : spec}"/><w:lvlText w:val="${bullet ? esc(spec) : `%${l + 1}.`}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr></w:lvl>`;
    }).join("");
    return `<w:abstractNum w:abstractNumId="${k}"><w:multiLevelType w:val="hybridMultilevel"/>${levels}</w:abstractNum>`;
  }).join("");
  const nums = lists.map((l) => `<w:num w:numId="${l.numId}"><w:abstractNumId w:val="${KIND_ORDER.indexOf(l.kind)}"/>${l.kind === "bullet" ? "" : `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${l.start}"/></w:lvlOverride>`}</w:num>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="${NS.w}">${abstract}${nums}</w:numbering>`;
}

function stylesXml(style, language) {
  const font = esc(style.bodyFamily || "Arial");
  const lang = language ? `<w:lang w:val="${esc(language)}" w:eastAsia="${esc(language)}"/>` : "";
  const heading = (n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${twips(n === 1 ? 18 : 12)}" w:after="${twips(6)}"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${halfPoints(style.headings[n])}"/><w:szCs w:val="${halfPoints(style.headings[n])}"/></w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="${NS.w}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/><w:sz w:val="${halfPoints(style.bodySize)}"/><w:szCs w:val="${halfPoints(style.bodySize)}"/>${lang}</w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${Math.round(240 * style.lineMultiple)}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
    `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>` +
    [1, 2, 3, 4].map(heading).join("") +
    `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>` +
    `</w:styles>`;
}

export function buildDocx(model, extras = {}) {
  const images = extras.images || new Map();
  const rels = []; // { id, type, target, external }
  const addRel = (type, target, external = false) => {
    const id = `rId${rels.length + 1}`;
    rels.push({ id, type, target, external });
    return id;
  };
  addRel(`${REL}/styles`, "styles.xml");
  addRel(`${REL}/numbering`, "numbering.xml");

  const linkRel = new Map();
  const imageRel = new Map(); // picture id -> { rel, name }
  const media = {}; // path in the zip -> bytes
  const lists = []; // { numId, kind, start }
  const listNum = new Map(); // list id from the layout -> numId
  let bulletNum = null;
  let pictureNo = 0;

  const numIdFor = (list) => {
    if (list.kind === "bullet") {
      if (bulletNum === null) { bulletNum = lists.length + 1; lists.push({ numId: bulletNum, kind: "bullet", start: 1 }); }
      return bulletNum;
    }
    if (!listNum.has(list.id)) { const numId = lists.length + 1; lists.push({ numId, kind: list.kind, start: list.start || 1 }); listNum.set(list.id, numId); }
    return listNum.get(list.id);
  };

  const runXml = (r, style) => {
    const props = [];
    if (r.link) props.push('<w:rStyle w:val="Hyperlink"/>');
    if (r.family && r.family !== style.bodyFamily) props.push(`<w:rFonts w:ascii="${esc(r.family)}" w:hAnsi="${esc(r.family)}" w:cs="${esc(r.family)}"/>`);
    if (r.bold) props.push("<w:b/><w:bCs/>");
    if (r.italic) props.push("<w:i/><w:iCs/>");
    if (r.size) props.push(`<w:sz w:val="${halfPoints(r.size)}"/><w:szCs w:val="${halfPoints(r.size)}"/>`);
    const rPr = props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";
    return String(r.text).split("\t").map((piece, i) => (i ? `<w:r>${rPr}<w:tab/></w:r>` : "") + (piece ? `<w:r>${rPr}<w:t xml:space="preserve">${esc(piece)}</w:t></w:r>` : "")).join("");
  };

  const paragraphXml = (b, style) => {
    const pPr = [];
    if (b.heading) pPr.push(`<w:pStyle w:val="Heading${b.heading}"/>`);
    if (b.pageBreakBefore) pPr.push("<w:pageBreakBefore/>");
    if (b.list) pPr.push(`<w:numPr><w:ilvl w:val="${b.list.level}"/><w:numId w:val="${numIdFor(b.list)}"/></w:numPr>`);
    pPr.push(`<w:spacing w:after="${twips(b.after || 0)}"/>`);
    if (!b.list && (b.left > 0 || b.firstLine)) {
      const hang = b.firstLine < 0 ? ` w:hanging="${twips(-b.firstLine)}"` : b.firstLine > 0 ? ` w:firstLine="${twips(b.firstLine)}"` : "";
      pPr.push(`<w:ind w:left="${twips(b.left)}"${hang}/>`);
    }
    if (b.align === "center" || b.align === "right") pPr.push(`<w:jc w:val="${b.align}"/>`);
    let body = "";
    let open = null;
    const close = () => { if (open) { body += `</w:hyperlink>`; open = null; } };
    for (const r of b.runs) {
      if (r.link) {
        if (open !== r.link) {
          close();
          if (!linkRel.has(r.link)) linkRel.set(r.link, addRel(`${REL}/hyperlink`, r.link, true));
          body += `<w:hyperlink r:id="${linkRel.get(r.link)}" w:history="1">`;
          open = r.link;
        }
      } else close();
      body += runXml(r, style);
    }
    close();
    return `<w:p><w:pPr>${pPr.join("")}</w:pPr>${body}</w:p>`;
  };

  const imageXml = (b, textWidth) => {
    const file = images.get(b.id);
    if (!file) return "";
    if (!imageRel.has(b.id)) {
      const name = `image${imageRel.size + 1}.${file.ext}`;
      media[`word/media/${name}`] = file.bytes;
      imageRel.set(b.id, { rel: addRel(`${REL}/image`, `media/${name}`), name });
    }
    const { rel, name } = imageRel.get(b.id);
    const scale = Math.min(1, textWidth / b.w);
    const cx = emu(b.w * scale);
    const cy = emu(b.h * scale);
    const n = ++pictureNo;
    return `<w:p><w:pPr><w:spacing w:after="${twips(6)}"/>${b.align === "center" ? '<w:jc w:val="center"/>' : ""}</w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}" descr="Picture from the PDF"/><a:graphic xmlns:a="${NS.a}"><a:graphicData uri="${NS.pic}"><pic:pic xmlns:pic="${NS.pic}"><pic:nvPicPr><pic:cNvPr id="${n}" name="${esc(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  };

  const sectPr = (s) => {
    const landscape = s.pageW > s.pageH;
    const m = s.margins;
    return `<w:sectPr><w:pgSz w:w="${twips(s.pageW)}" w:h="${twips(s.pageH)}"${landscape ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="${twips(m.top)}" w:right="${twips(m.right)}" w:bottom="${twips(m.bottom)}" w:left="${twips(m.left)}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
  };

  let bodyXml = "";
  model.sections.forEach((s, i) => {
    const textWidth = s.pageW - s.margins.left - s.margins.right;
    for (const b of s.blocks) bodyXml += b.type === "image" ? imageXml(b, textWidth) : paragraphXml(b, model.style);
    if (i < model.sections.length - 1) bodyXml += `<w:p><w:pPr>${sectPr(s)}</w:pPr></w:p>`;
  });
  if (!bodyXml) bodyXml = "<w:p/>";
  const last = model.sections[model.sections.length - 1];

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}"><w:body>${bodyXml}${sectPr(last)}</w:body></w:document>`;

  const used = new Set(Object.keys(media).map((p) => p.split(".").pop()));
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${used.has("png") ? '<Default Extension="png" ContentType="image/png"/>' : ""}${used.has("jpg") ? '<Default Extension="jpg" ContentType="image/jpeg"/>' : ""}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`).join("")}</Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${extras.title ? `<dc:title>${esc(extras.title)}</dc:title>` : ""}${extras.author ? `<dc:creator>${esc(extras.author)}</dc:creator>` : ""}<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created></cp:coreProperties>`;

  const enc = new TextEncoder();
  const parts = {
    "[Content_Types].xml": enc.encode(contentTypes),
    "_rels/.rels": enc.encode(rootRels),
    "word/document.xml": enc.encode(documentXml),
    "word/_rels/document.xml.rels": enc.encode(docRels),
    "word/styles.xml": enc.encode(stylesXml(model.style, extras.language)),
    "word/numbering.xml": enc.encode(numberingXml(lists)),
    "docProps/core.xml": enc.encode(core),
    ...media,
  };
  // pictures are already compressed, so only the XML is worth deflating
  return fflate.zipSync(Object.fromEntries(Object.entries(parts).map(([name, bytes]) => [name, [bytes, { level: /\.(png|jpg)$/.test(name) ? 0 : 6 }]])));
}
