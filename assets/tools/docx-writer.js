// Hand-rolled minimal .docx (OOXML) writer, used by PDF to Word. A .docx is
// just a zip of a few small XML parts, so this avoids pulling in a whole
// document-building library — fflate (already vendored for the zip/unzip
// tools) is all it needs.
import * as fflate from "/assets/vendor/fflate.min.js";

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// paragraphs: array of { heading?: 1|2|3, runs: [{ text, bold?, italic? }] }
export function buildDocxBytes(paragraphs) {
  const bodyXml = paragraphs.map((p) => {
    const runs = p.runs && p.runs.length ? p.runs : [{ text: "" }];
    const runsXml = runs.map((r) => {
      const props = [];
      if (p.heading) {
        props.push(`<w:b/>`, `<w:sz w:val="${p.heading === 1 ? 32 : p.heading === 2 ? 28 : 24}"/>`);
      } else {
        if (r.bold) props.push("<w:b/>");
        if (r.italic) props.push("<w:i/>");
      }
      const rPr = props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";
      const text = esc(r.text).replace(/\n/g, "</w:t></w:r><w:r><w:br/><w:t xml:space=\"preserve\">");
      return `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
    }).join("");
    return `<w:p>${runsXml}</w:p>`;
  }).join("");

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${bodyXml}` +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
    "</w:body></w:document>";

  const contentTypesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    "</Types>";

  const rootRelsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>";

  const enc = new TextEncoder();
  return fflate.zipSync(
    {
      "[Content_Types].xml": enc.encode(contentTypesXml),
      "_rels/.rels": enc.encode(rootRelsXml),
      "word/document.xml": enc.encode(documentXml),
    },
    { level: 6 }
  );
}
