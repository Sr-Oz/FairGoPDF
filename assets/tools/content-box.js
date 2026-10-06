// Shared by Extract Images (trim) and Crop PDF (auto-fit): finds the box around
// what is really on a canvas, ignoring dust, faint scanner lines and shadows.

// ---------------------------------------------------------------------------
// Trim blank borders. Looks at a shrunken copy so dust, faint scanner lines
// and shadows wash out, then finds the box around what is really on the page.
// ---------------------------------------------------------------------------

export function findContentBox(canvas) {
  const scale = Math.min(1, 400 / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  if (w < 12 || h < 12) return null;
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  sctx.fillStyle = "#fff";
  sctx.fillRect(0, 0, w, h);
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(canvas, 0, 0, w, h);
  const px = sctx.getImageData(0, 0, w, h).data;

  // Background colour = middle value of the outer ring of pixels.
  const ring = [];
  for (let x = 0; x < w; x++) { ring.push((x) * 4, ((h - 1) * w + x) * 4); }
  for (let y = 0; y < h; y++) { ring.push((y * w) * 4, (y * w + w - 1) * 4); }
  const bg = [0, 1, 2].map((c) => {
    const vals = ring.map((o) => px[o + c]).sort((a, b) => a - b);
    return vals[vals.length >> 1];
  });

  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const diff = Math.max(Math.abs(px[o] - bg[0]), Math.abs(px[o + 1] - bg[1]), Math.abs(px[o + 2] - bg[2]));
    if (diff > 38) ink[i] = 1;
  }

  // Connected blobs of ink; drop specks and thin lines that run along an edge.
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let start = 0; start < w * h; start++) {
    if (!ink[start] || seen[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let area = 0, bx0 = w, by0 = h, bx1 = -1, by1 = -1;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w, y = (p / w) | 0;
      area++;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (ink[n] && !seen[n]) { seen[n] = 1; stack[sp++] = n; }
        }
      }
    }
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    const edge = Math.max(3, Math.round(Math.max(w, h) * 0.02));
    const touchesEdge = bx0 < edge || by0 < edge || bx1 >= w - edge || by1 >= h - edge;
    const thin = Math.min(bw, bh) <= 3;
    if (area < 4) continue;
    if (thin && touchesEdge) continue;
    if (bx0 < x0) x0 = bx0;
    if (by0 < y0) y0 = by0;
    if (bx1 > x1) x1 = bx1;
    if (by1 > y1) y1 = by1;
  }
  if (x1 < 0) return null;

  const pad = Math.round(Math.max(canvas.width, canvas.height) * 0.01) + 4;
  const left = Math.max(0, Math.floor(x0 / scale) - pad);
  const top = Math.max(0, Math.floor(y0 / scale) - pad);
  const right = Math.min(canvas.width, Math.ceil((x1 + 1) / scale) + pad);
  const bottom = Math.min(canvas.height, Math.ceil((y1 + 1) / scale) + pad);
  const area = (right - left) * (bottom - top);
  if (area >= canvas.width * canvas.height * 0.97) return null;
  return { left, top, width: right - left, height: bottom - top };
}
