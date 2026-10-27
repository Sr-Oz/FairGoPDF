// Colours, warnings and the options passed to the QR drawing library.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STYLE, TEMPLATES, ICONS, contrastRatio, normaliseHex, scanWarnings, toOptions, applyTemplate, iconDataUrl, utf8AsBytes } from "../assets/tools/qr-style.js";

test("hex colours: accepts three or six digits, with or without the hash", () => {
  assert.equal(normaliseHex("#0AF"), "#00aaff");
  assert.equal(normaliseHex("004D40"), "#004d40");
  assert.equal(normaliseHex("#12345"), null);
  assert.equal(normaliseHex("blue"), null);
});

test("contrast: black on white is 21, a colour on itself is 1", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
  assert.equal(contrastRatio("#336699", "#336699"), 1);
});

test("scan warnings: a pale colour on white is flagged, the default is not", () => {
  assert.deepEqual(scanWarnings(DEFAULT_STYLE), []);
  assert.equal(scanWarnings({ ...DEFAULT_STYLE, dotsColour: "#ffd700" }).length, 1);
  assert.equal(scanWarnings({ ...DEFAULT_STYLE, cornersDotColour: "#fafafa" }).length, 1);
  const white = { dotsColour: "#ffffff", cornersSquareColour: "#ffffff", cornersDotColour: "#ffffff", background: "#111111" };
  assert.equal(scanWarnings({ ...DEFAULT_STYLE, ...white }).length, 1, "a light-on-dark code gets one note");
  assert.equal(scanWarnings({ ...DEFAULT_STYLE, dotsColour: "#ffffff", background: "#111111" }).length, 2, "black corners on dark are flagged too");
});

test("every template passes the scan check and sets all the look fields", () => {
  for (const t of TEMPLATES) {
    const style = applyTemplate(DEFAULT_STYLE, t);
    assert.deepEqual(scanWarnings(style), [], t.id);
    for (const key of ["dotsType", "dotsColour", "cornersSquareType", "cornersSquareColour", "cornersDotType", "cornersDotColour", "background"]) assert.ok(style[key], `${t.id}.${key}`);
  }
});

test("options: colours, shapes and the background reach the library", () => {
  const o = toOptions({ ...DEFAULT_STYLE, dotsType: "rounded", dotsColour: "#004d40" }, "hello", 300);
  assert.equal(o.data, "hello");
  assert.equal(toOptions(DEFAULT_STYLE, "Āe 😀", 300).data, "Äe ð", "non-ASCII text goes in as UTF-8 bytes");
  assert.equal(o.width, 300);
  assert.equal(o.dotsOptions.type, "rounded");
  assert.equal(o.dotsOptions.color, "#004d40");
  assert.equal(o.backgroundOptions.color, "#ffffff");
  assert.equal(o.image, undefined);
  assert.equal(o.qrOptions.errorCorrectionLevel, "M");
});

test("options: a gradient replaces the plain colour", () => {
  const ocean = applyTemplate(DEFAULT_STYLE, TEMPLATES.find((t) => t.id === "ocean"));
  const o = toOptions(ocean, "x", 300);
  assert.equal(o.dotsOptions.color, undefined);
  assert.equal(o.dotsOptions.gradient.colorStops.length, 2);
});

test("options: adding an icon switches to the highest error correction", () => {
  const withIcon = toOptions({ ...DEFAULT_STYLE, icon: { kind: "builtin", id: "wifi", dataUrl: "" } }, "x", 300);
  assert.equal(withIcon.qrOptions.errorCorrectionLevel, "H");
  assert.equal(withIcon.imageOptions.saveAsBlob, false, "no fetch() of the data: image, the page policy blocks it");
  assert.ok(withIcon.image.startsWith("data:image/svg+xml"));
  assert.ok(decodeURIComponent(withIcon.image).includes('stroke="#000000"'));
  const upload = toOptions({ ...DEFAULT_STYLE, icon: { kind: "upload", id: "", dataUrl: "data:image/png;base64,AAAA" } }, "x", 300);
  assert.equal(upload.image, "data:image/png;base64,AAAA");
  assert.equal(toOptions({ ...DEFAULT_STYLE, icon: { kind: "upload", id: "", dataUrl: "" } }, "x", 300).image, undefined);
});

test("every built-in icon draws", () => {
  for (const [id] of ICONS) assert.ok(iconDataUrl(id, "#000000").length > 200, id);
  assert.equal(iconDataUrl("nope", "#000"), "");
});

test("utf8AsBytes: plain text is unchanged, others become one character per byte", () => {
  assert.equal(utf8AsBytes("abc 123"), "abc 123");
  assert.equal(utf8AsBytes("é").length, 2);
  assert.equal(utf8AsBytes("日").length, 3);
  assert.equal(utf8AsBytes("😀").length, 4);
});
