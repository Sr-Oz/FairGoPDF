import test from "node:test";
import assert from "node:assert/strict";
import { sortEntries, blanksNeeded, imagePlacement, jpegOrientation, bookmarkTitle } from "../assets/tools/merge-core.js";

const entry = (name, lastModified = 0) => ({ file: { name, lastModified } });

test("sorting by name treats numbers as numbers", () => {
  const names = (m) => sortEntries([entry("file10.pdf"), entry("File2.pdf"), entry("file1.pdf")], m).map((e) => e.file.name);
  assert.deepEqual(names("az"), ["file1.pdf", "File2.pdf", "file10.pdf"]);
  assert.deepEqual(names("za"), ["file10.pdf", "File2.pdf", "file1.pdf"]);
});

test("sorting by date, and the original array is left alone", () => {
  const list = [entry("b", 200), entry("a", 300), entry("c", 100)];
  assert.deepEqual(sortEntries(list, "oldest").map((e) => e.file.name), ["c", "b", "a"]);
  assert.deepEqual(sortEntries(list, "newest").map((e) => e.file.name), ["a", "b", "c"]);
  assert.deepEqual(list.map((e) => e.file.name), ["b", "a", "c"]);
});

test("reverse flips the current order", () => {
  assert.deepEqual(sortEntries([entry("x"), entry("y"), entry("z")], "reverse").map((e) => e.file.name), ["z", "y", "x"]);
});

test("blank pages between files", () => {
  assert.equal(blanksNeeded(5, "none", false), 0);
  assert.equal(blanksNeeded(5, "one", false), 1);
  assert.equal(blanksNeeded(5, "one", true), 0); // nothing before the first file
  assert.equal(blanksNeeded(5, "odd", false), 1); // 5 pages so far, the next file would start on page 6
  assert.equal(blanksNeeded(4, "odd", false), 0); // it would start on page 5, a right-hand page
  assert.equal(blanksNeeded(5, "odd", true), 0);
});

test("an image on A4 is as big as fits, centred, and the page turns for a wide picture", () => {
  const tall = imagePlacement(1000, 2000, "a4");
  assert.equal(Math.round(tall.pw), 595);
  assert.equal(Math.round(tall.height), 842); // limited by the page height
  assert.ok(Math.abs(tall.x - (tall.pw - tall.width) / 2) < 1e-9);
  const wide = imagePlacement(2000, 1000, "letter");
  assert.deepEqual([wide.pw, wide.ph], [792, 612]);
  assert.ok(wide.width <= wide.pw + 1e-9 && wide.height <= wide.ph + 1e-9);
});

test("fit makes the page the picture's size", () => {
  const p = imagePlacement(800, 400, "fit");
  assert.deepEqual([p.pw, p.ph, p.x, p.y, p.width, p.height], [600, 300, 0, 0, 600, 300]);
});

// a minimal JPEG header with an EXIF block holding one tag, orientation
function jpegWith(orientation, little = true) {
  const w16 = (v) => (little ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const w32 = (v) => (little ? [v & 255, (v >> 8) & 255, 0, 0] : [0, 0, (v >> 8) & 255, v & 255]);
  const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...w16(42), ...w32(8), ...w16(1), ...w16(0x0112), ...w16(3), ...w32(1), ...w16(orientation), 0, 0, ...w32(0)];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = body.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...body, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
}

test("reads the EXIF orientation in either byte order", () => {
  assert.equal(jpegOrientation(jpegWith(6, true)), 6);
  assert.equal(jpegOrientation(jpegWith(8, false)), 8);
  assert.equal(jpegOrientation(jpegWith(3, true)), 3);
});

test("no EXIF, a junk value, or not a JPEG all mean upright", () => {
  assert.equal(jpegOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9])), 1);
  assert.equal(jpegOrientation(jpegWith(9, true)), 1);
  assert.equal(jpegOrientation(Uint8Array.from([1, 2, 3, 4, 5])), 1);
  assert.equal(jpegOrientation(new Uint8Array(0)), 1);
});

test("names", () => {
  assert.equal(bookmarkTitle("Invoice March.pdf"), "Invoice March");
  assert.equal(bookmarkTitle("scan.final.pdf"), "scan.final");
  assert.equal(bookmarkTitle("noext"), "noext");
});
