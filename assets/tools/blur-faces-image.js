import { FilesetResolver, FaceDetector } from "/assets/vendor/mediapipe/vision_bundle.mjs";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const editor = document.getElementById("editor");
const canvas = document.getElementById("displayCanvas");
const ctx = canvas.getContext("2d");
const faceCountEl = document.getElementById("faceCount");
const downloadBtn = document.getElementById("downloadBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

let detectorPromise = null;
let currentFile = null;

function getDetector() {
  if (!detectorPromise) {
    detectorPromise = FilesetResolver.forVisionTasks("/assets/vendor/mediapipe/wasm").then((wasmFileset) =>
      FaceDetector.createFromOptions(wasmFileset, {
        baseOptions: { modelAssetPath: "/assets/vendor/mediapipe/models/blaze_face_short_range.tflite" },
      })
    );
  }
  return detectorPromise;
}

async function blurFaces(img) {
  const detector = await getDetector();
  const { detections } = detector.detect(img);

  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0);

  detections.forEach((detection) => {
    const box = detection.boundingBox;
    if (!box) return;
    const pad = Math.round(Math.max(box.width, box.height) * 0.25);
    const sx = Math.max(0, Math.round(box.originX - pad));
    const sy = Math.max(0, Math.round(box.originY - pad));
    const sw = Math.min(canvas.width - sx, Math.round(box.width + pad * 2));
    const sh = Math.min(canvas.height - sy, Math.round(box.height + pad * 2));
    if (sw <= 0 || sh <= 0) return;

    const blurAmount = Math.max(12, Math.round(Math.max(sw, sh) * 0.35));
    ctx.save();
    ctx.filter = `blur(${blurAmount}px)`;
    ctx.drawImage(img, sx, sy, sw, sh, sx, sy, sw, sh);
    ctx.restore();
  });

  return detections.length;
}

initDropzone(dropzone, fileInput, async (files) => {
  const image = files.find((f) => f.type.startsWith("image/"));
  if (!image) return;
  currentFile = image;

  try {
    const dataUrl = await readFileAsDataURL(image);
    const img = await loadImage(dataUrl);
    editor.style.display = "block";
    faceCountEl.textContent = "";

    setStatus(statusEl, "Loading the AI model, this may take a moment the first time…", "");
    statusEl.classList.add("visible");

    const faceCount = await blurFaces(img);
    faceCountEl.textContent = faceCount === 0
      ? "No faces detected, the original image is shown as-is."
      : `Blurred ${faceCount} face${faceCount === 1 ? "" : "s"}.`;
    setStatus(statusEl, "Sorted — download when you're ready.", "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  }
});

downloadBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  const blob = await canvasToBlob(canvas, "image/png");
  const outName = `${stripExtension(currentFile.name)}-blurred.png`;
  triggerDownload(blob, outName);
});

clearBtn.addEventListener("click", () => {
  currentFile = null;
  editor.style.display = "none";
  fileInput.value = "";
  clearStatus(statusEl);
});
