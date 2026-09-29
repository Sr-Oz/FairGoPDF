// Solves a 4-point planar homography (Direct Linear Transform, exactly
// determined for 4 correspondences) and uses it to un-skew a photographed
// document: given the 4 corners of the page as they appear in the photo
// (possibly a skewed quadrilateral because the camera wasn't square-on),
// warps that region into a flat rectangle, sampling with bilinear
// interpolation. This is the same "point camera at a wonky page, get a
// straight scan" trick every phone scanner app does.

// Solve an 8x8 linear system via Gaussian elimination with partial pivoting.
function solve8(A, b) {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const pv = M[col][col];
    if (Math.abs(pv) < 1e-12) throw new Error("degenerate point selection");
    for (let c = col; c <= n; c++) M[col][c] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

// Homography mapping (x,y) in the destination rectangle -> a point in the
// source image, i.e. solved from rectCorners -> quadCorners so it can be
// applied directly for inverse-warping (for each output pixel, find where
// to sample from).
export function homographyRectToQuad(w, h, quad) {
  const rect = [[0, 0], [w, 0], [w, h], [0, h]];
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = rect[i];
    const [X, Y] = quad[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  }
  const h8 = solve8(A, b);
  return [h8[0], h8[1], h8[2], h8[3], h8[4], h8[5], h8[6], h8[7], 1];
}

export function applyHomography(H, x, y) {
  const denom = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / denom, (H[3] * x + H[4] * y + H[5]) / denom];
}

function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

// quad: [topLeft, topRight, bottomRight, bottomLeft] in source-image pixel space.
export function warpQuadToCanvas(sourceCanvas, quad, maxDim = 2000) {
  const outW = Math.round((dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2) || 1;
  const outH = Math.round((dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2) || 1;
  const scale = Math.min(1, maxDim / Math.max(outW, outH));
  const w = Math.max(1, Math.round(outW * scale));
  const h = Math.max(1, Math.round(outH * scale));

  const H = homographyRectToQuad(w, h, quad);

  const srcCtx = sourceCanvas.getContext("2d");
  const src = srcCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const sw = sourceCanvas.width, sh = sourceCanvas.height;

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const outCtx = out.getContext("2d");
  const dstImg = outCtx.createImageData(w, h);

  function sample(sx, sy) {
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    const fx = sx - x0, fy = sy - y0;
    const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
    const cx0 = Math.max(0, Math.min(sw - 1, x0)), cy0 = Math.max(0, Math.min(sh - 1, y0));
    const idx = (x, y) => (y * sw + x) * 4;
    const out4 = [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) {
      const p00 = src.data[idx(cx0, cy0) + c];
      const p10 = src.data[idx(x1, cy0) + c];
      const p01 = src.data[idx(cx0, y1) + c];
      const p11 = src.data[idx(x1, y1) + c];
      out4[c] = p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
    }
    return out4;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [sx, sy] = applyHomography(H, x, y);
      const di = (y * w + x) * 4;
      if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) {
        dstImg.data[di] = 255; dstImg.data[di + 1] = 255; dstImg.data[di + 2] = 255; dstImg.data[di + 3] = 255;
        continue;
      }
      const [r, g, bl, a] = sample(sx, sy);
      dstImg.data[di] = r; dstImg.data[di + 1] = g; dstImg.data[di + 2] = bl; dstImg.data[di + 3] = a;
    }
  }
  outCtx.putImageData(dstImg, 0, 0);
  return out;
}

// In-place grayscale + auto-contrast stretch ("Enhance" mode), a common
// scanner-app cleanup pass.
export function enhanceCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const n = d.length;
  let min = 255, max = 0;
  const gray = new Uint8ClampedArray(n / 4);
  for (let i = 0, j = 0; i < n; i += 4, j++) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    gray[j] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0, j = 0; i < n; i += 4, j++) {
    const v = Math.round(((gray[j] - min) / range) * 255);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}
