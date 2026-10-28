// Turning the picture data pdf.js hands over into a canvas or file bytes, shared by Extract Images and PDF to Word.

export function imageToCanvas(img) {
  const { width, height } = img;
  if (!width || !height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (img.bitmap) {
    ctx.drawImage(img.bitmap, 0, 0);
    return canvas;
  }
  const src = img.data;
  if (!src) return null;
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (img.kind === 3 && src.length >= width * height * 4) {
    rgba.set(src.subarray(0, width * height * 4));
  } else if (img.kind === 2 && src.length >= width * height * 3) {
    for (let i = 0, p = 0; i < width * height; i++, p += 3) {
      rgba[i * 4] = src[p];
      rgba[i * 4 + 1] = src[p + 1];
      rgba[i * 4 + 2] = src[p + 2];
      rgba[i * 4 + 3] = 255;
    }
  } else if (img.kind === 1) {
    const rowBytes = (width + 7) >> 3;
    if (src.length < rowBytes * height) return null;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const i = (y * width + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = bit ? 255 : 0;
        rgba[i + 3] = 255;
      }
    }
  } else {
    return null;
  }
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
}

export function canvasToBytes(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) return reject(new Error("Could not encode an image"));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      type,
      quality
    );
  });
}

export async function getImageObject(page, name) {
  const store = name.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    store.get(name, (obj) => {
      clearTimeout(timer);
      resolve(obj);
    });
  });
}
