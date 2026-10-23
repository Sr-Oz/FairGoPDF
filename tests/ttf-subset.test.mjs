import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, require, loadAsset } from "./load.mjs";

const { subsetTtf } = await loadAsset("assets/tools/ttf-subset.js");
const fontkit = require(join(ROOT, "assets/vendor/docx/fontkit.umd.min.js"));

const original = readFileSync(join(ROOT, "assets/vendor/docx/fonts/LiberationSans-Regular.ttf"));
const open = (bytes) => fontkit.create(Buffer.from(bytes));
const outlineSize = (glyph) => glyph.path.commands.length;

test("kept glyphs keep their outlines and widths, the rest are emptied", () => {
  const full = open(original);
  const keepIds = full.glyphsForString("Hello Kia ora").map((g) => g.id);
  const small = open(subsetTtf(original.buffer.slice(original.byteOffset, original.byteOffset + original.length), keepIds));

  assert.equal(small.numGlyphs, full.numGlyphs, "glyph numbers must not change");
  for (const g of full.glyphsForString("Hello Kia ora")) {
    const kept = small.getGlyph(g.id);
    assert.ok(outlineSize(kept) > 0 || g.codePoints[0] === 32, `glyph ${g.name} lost its outline`);
    assert.equal(kept.advanceWidth, g.advanceWidth, `glyph ${g.name} changed width`);
  }
  const dropped = full.glyphsForString("Z")[0];
  assert.equal(outlineSize(small.getGlyph(dropped.id)), 0, "an unused glyph should be empty");
});

test("the subset is much smaller than the font", () => {
  const ids = open(original).glyphsForString("abc").map((g) => g.id);
  const out = subsetTtf(original.buffer.slice(original.byteOffset, original.byteOffset + original.length), ids);
  assert.ok(out.length < original.length / 2, `${out.length} bytes is not much smaller than ${original.length}`);
});

test("accented letters built from other glyphs keep their parts", () => {
  const full = open(original);
  const [a] = full.glyphsForString("ā");
  const small = open(subsetTtf(original.buffer.slice(original.byteOffset, original.byteOffset + original.length), [a.id]));
  assert.ok(outlineSize(small.getGlyph(a.id)) > 0, "macron a lost its outline");
});

test("a file that is not TrueType is refused", () => {
  assert.throws(() => subsetTtf(new Uint8Array(64).buffer, [1]), /TrueType/);
});
