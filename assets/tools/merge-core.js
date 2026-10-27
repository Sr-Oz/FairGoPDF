// The rules behind the Merge PDF page, kept apart so they can be tested: which pages a "1-3, 7" box means, how files are
// sorted, where blank pages go, how an image sits on a page. No DOM and no PDF library in here.

// ---------------------------------------------------------------- sorting

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }); // file2 comes before file10

// entries: anything with a { file: { name, lastModified } }; mode: az | za | oldest | newest | reverse. Returns a new array.
export function sortEntries(entries, mode) {
  const list = [...entries];
  if (mode === "reverse") return list.reverse();
  const by = {
    az: (a, b) => collator.compare(a.file.name, b.file.name),
    za: (a, b) => collator.compare(b.file.name, a.file.name),
    oldest: (a, b) => a.file.lastModified - b.file.lastModified,
    newest: (a, b) => b.file.lastModified - a.file.lastModified,
  }[mode];
  return by ? list.sort(by) : list;
}

// ---------------------------------------------------------------- blank pages between files

// total: pages in the merged file so far. mode: none | one (a blank page between files) | odd (only when needed, so each file
// starts on a right-hand page, which is what double-sided printing wants)
export function blanksNeeded(total, mode, isFirst) {
  if (isFirst) return 0;
  if (mode === "one") return 1;
  if (mode === "odd") return total % 2 === 1 ? 1 : 0;
  return 0;
}

// ---------------------------------------------------------------- images

const PAGES = { a4: [595.28, 841.89], letter: [612, 792] };

// Where an image goes on its page, in PDF points (origin at the bottom left). mode: a4 | letter | fit (the page is the image's size).
// A4 and Letter turn sideways for a wide image, and the picture is as big as fits without cropping.
export function imagePlacement(w, h, mode) {
  if (mode === "a4" || mode === "letter") {
    let [pw, ph] = PAGES[mode];
    if (w > h) [pw, ph] = [ph, pw];
    const k = Math.min(pw / w, ph / h);
    const width = w * k;
    const height = h * k;
    return { pw, ph, x: (pw - width) / 2, y: (ph - height) / 2, width, height };
  }
  const pw = w * 0.75; // 96 pixels to the inch on screen, 72 points to the inch in a PDF
  const ph = h * 0.75;
  return { pw, ph, x: 0, y: 0, width: pw, height: ph };
}

// The EXIF orientation of a JPEG (1 to 8; 1 when there is none). PDF software ignores it, so a phone photo taken sideways
// would land on its side; the page turns it upright first when this is not 1.
export function jpegOrientation(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let p = 2;
  while (p + 4 < b.length && b[p] === 0xff) {
    const marker = b[p + 1];
    if (marker === 0xda || marker === 0xd9) return 1; // the picture itself starts here, so there was no EXIF block
    const len = (b[p + 2] << 8) | b[p + 3];
    const isExif = marker === 0xe1 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66 && b[p + 8] === 0 && b[p + 9] === 0;
    if (isExif) {
      const t = p + 10; // where the TIFF header starts; every offset below counts from here
      const little = b[t] === 0x49;
      const u16 = (o) => (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
      const u32 = (o) => (little ? b[o] + b[o + 1] * 256 + b[o + 2] * 65536 + b[o + 3] * 16777216 : b[o] * 16777216 + b[o + 1] * 65536 + b[o + 2] * 256 + b[o + 3]);
      const ifd = t + u32(t + 4);
      if (ifd + 2 > b.length) return 1;
      for (let i = 0, n = u16(ifd); i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > b.length) return 1;
        if (u16(e) === 0x0112) {
          const v = u16(e + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    p += 2 + len;
  }
  return 1;
}

// ---------------------------------------------------------------- names

export const bookmarkTitle = (filename) => filename.replace(/\.[^.\\/]+$/, "");
