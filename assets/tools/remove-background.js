import { FilesetResolver, ImageSegmenter } from "/assets/vendor/mediapipe/vision_bundle.mjs";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const originalImg = document.getElementById("originalImg");
const resultImg = document.getElementById("resultImg");
const downloadBtn = document.getElementById("downloadBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let segmenterPromise = null;
let currentFile = null;
let resultBlob = null;

function getSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = FilesetResolver.forVisionTasks("/assets/vendor/mediapipe/wasm").then((wasmFileset) =>
      ImageSegmenter.createFromOptions(wasmFileset, {
        baseOptions: { modelAssetPath: "/assets/vendor/mediapipe/models/selfie_segmenter.tflite" },
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      })
    );
  }
  return segmenterPromise;
}

async function removeBackground(img) {
  const segmenter = await getSegmenter();
  const result = segmenter.segment(img);
  try {
    const mask = result.confidenceMasks[0];
    const maskData = mask.getAsFloat32Array();
    const maskW = mask.width;
    const maskH = mask.height;

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;

    for (let y = 0; y < canvas.height; y++) {
      const my = Math.min(maskH - 1, Math.floor((y / canvas.height) * maskH));
      for (let x = 0; x < canvas.width; x++) {
        const mx = Math.min(maskW - 1, Math.floor((x / canvas.width) * maskW));
        const alpha = maskData[my * maskW + mx];
        pixels[(y * canvas.width + x) * 4 + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  } finally {
    result.close();
  }
}

initDropzone(dropzone, fileInput, async (files) => {
  const image = files.find((f) => f.type.startsWith("image/"));
  if (!image) return;
  currentFile = image;

  try {
    const dataUrl = await readFileAsDataURL(image);
    const img = await loadImage(dataUrl);
    originalImg.src = dataUrl;
    originalImg.alt = `Original: ${image.name}`;
    editor.style.display = "block";
    resultImg.removeAttribute("src");
    resultBlob = null;

    setStatus(statusEl, "Loading the AI model, this may take a moment the first time…", "");
    statusEl.classList.add("visible");

    const canvas = await removeBackground(img);
    resultBlob = await canvasToBlob(canvas, "image/png");
    resultImg.src = URL.createObjectURL(resultBlob);
    resultImg.alt = `Background removed: ${image.name}`;
    setStatus(statusEl, "Sorted — background removed. Download when you're ready.", "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  }
});

downloadBtn.addEventListener("click", () => {
  if (!resultBlob || !currentFile) return;
  const outName = `${stripExtension(currentFile.name)}-no-bg.png`;
  triggerDownload(resultBlob, outName);
});

clearBtn.addEventListener("click", () => {
  currentFile = null;
  resultBlob = null;
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});
