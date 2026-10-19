// Turns a photo or scan of a handwritten signature into something that can be stamped on a PDF:
// the paper colour becomes transparent, the ink keeps its own colour, and the empty margin is trimmed.
import { findContentBox } from "/assets/tools/content-box.js";

const MAX_SIDE = 1400; // plenty for a signature a few centimetres wide, and keeps the PDF small

export function loadSignatureSource(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; // a PNG with a transparent background is treated as white paper
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't a picture this browser can open."));
    };
    img.src = url;
  });
}

function smoothstep(lo, hi, x) {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

function paperColour(data) {
  // average of the brightest quarter of pixels = the paper, even if it is a bit grey or yellow from the photo
  const lums = [];
  const step = Math.max(1, Math.floor(data.length / 4 / 40000)) * 4;
  for (let i = 0; i < data.length; i += step) lums.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  const sorted = [...lums].sort((a, b) => a - b);
  const cutoff = sorted[Math.floor(sorted.length * 0.75)];
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += step) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (l >= cutoff) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : [255, 255, 255];
}

// Returns { canvas, transparent } — the canvas to preview / embed.
export function processSignature(source, { removeBackground = true, trim = true } = {}) {
  let canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);

  if (removeBackground) {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    const paper = paperColour(d);
    const paperLum = 0.299 * paper[0] + 0.587 * paper[1] + 0.114 * paper[2];
    const range = paperLum * 0.5 + 1;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const a = smoothstep(0.1, 0.85, (paperLum - lum) / range);
      if (a < 0.02) {
        d[i + 3] = 0;
        continue;
      }
      // take the paper out of the colour so edges don't keep a pale halo
      for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, Math.max(0, (d[i + c] - (1 - a) * paper[c]) / a));
      d[i + 3] = Math.round(a * 255);
    }
    ctx.putImageData(img, 0, 0);
  }

  if (trim) {
    const box = findContentBox(canvas);
    if (box) {
      const cropped = document.createElement("canvas");
      cropped.width = box.width;
      cropped.height = box.height;
      cropped.getContext("2d").drawImage(canvas, box.left, box.top, box.width, box.height, 0, 0, box.width, box.height);
      canvas = cropped;
    }
  }
  return { canvas, transparent: removeBackground };
}
