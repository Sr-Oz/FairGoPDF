import { PDFLib } from "/assets/tools/pdf-common.js";
import { warpQuadToCanvas, enhanceCanvas } from "/assets/tools/perspective-warp.js";

const useCameraBtn = document.getElementById("useCameraBtn");
const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("fileInput");
const cameraWrap = document.getElementById("cameraWrap");
const cameraVideo = document.getElementById("cameraVideo");
const snapBtn = document.getElementById("snapBtn");
const stopCameraBtn = document.getElementById("stopCameraBtn");

const captureStep = document.getElementById("captureStep");
const captureCanvas = document.getElementById("captureCanvas");
const adjustStep = document.getElementById("adjustStep");
const adjustStage = document.getElementById("adjustStage");
const adjustPreview = document.getElementById("adjustPreview");
const adjustOverlay = document.getElementById("adjustOverlay");
const enhanceToggle = document.getElementById("enhanceToggle");
const usePageBtn = document.getElementById("usePageBtn");
const cancelAdjustBtn = document.getElementById("cancelAdjustBtn");

const pageList = document.getElementById("pageList");
const buildControls = document.getElementById("buildControls");
const pageSizeSelect = document.getElementById("pageSize");
const actionsRow = document.getElementById("actionsRow");
const runBtn = document.getElementById("runBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
const PAGE_MARGIN = 24;

let stream = null;
let corners = null; // [[x,y] x4] in captureCanvas natural pixel space
let idCounter = 0;
let pages = []; // { id, canvas }

// --- Camera ---

useCameraBtn.addEventListener("click", async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    cameraVideo.srcObject = stream;
    cameraWrap.style.display = "block";
    useCameraBtn.style.display = "none";
    uploadBtn.style.display = "none";
    clearStatus(statusEl);
  } catch (err) {
    console.error(err);
    setStatus(statusEl, "Couldn't access the camera (denied, or none available). Try “Upload a Photo” instead.", "error");
    statusEl.classList.add("visible");
  }
});

function stopCamera() {
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  cameraVideo.srcObject = null;
  cameraWrap.style.display = "none";
  useCameraBtn.style.display = "";
  uploadBtn.style.display = "";
}
stopCameraBtn.addEventListener("click", stopCamera);

snapBtn.addEventListener("click", () => {
  const w = cameraVideo.videoWidth, h = cameraVideo.videoHeight;
  if (!w || !h) return;
  captureCanvas.width = w;
  captureCanvas.height = h;
  captureCanvas.getContext("2d").drawImage(cameraVideo, 0, 0, w, h);
  stopCamera();
  startAdjust();
});

// --- Upload ---

uploadBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files && fileInput.files[0];
  fileInput.value = "";
  if (!file) return;
  try {
    const dataUrl = URL.createObjectURL(file);
    const img = await loadImage(dataUrl);
    URL.revokeObjectURL(dataUrl);
    captureCanvas.width = img.naturalWidth;
    captureCanvas.height = img.naturalHeight;
    captureCanvas.getContext("2d").drawImage(img, 0, 0);
    startAdjust();
  } catch (err) {
    console.error(err);
    setStatus(statusEl, "Could not read that image.", "error");
    statusEl.classList.add("visible");
  }
});

// --- Corner adjustment ---

function startAdjust() {
  const w = captureCanvas.width, h = captureCanvas.height;
  adjustPreview.width = w;
  adjustPreview.height = h;
  adjustPreview.getContext("2d").drawImage(captureCanvas, 0, 0);
  adjustOverlay.setAttribute("viewBox", `0 0 ${w} ${h}`);

  const mx = w * 0.08, my = h * 0.08;
  corners = [[mx, my], [w - mx, my], [w - mx, h - my], [mx, h - my]];

  const r = Math.max(w, h) * 0.02;
  adjustOverlay.innerHTML = `<polygon points="" /> ${corners.map((_, i) => `<circle data-i="${i}" r="${r}" />`).join("")}`;
  redrawQuad();

  adjustOverlay.querySelectorAll("circle").forEach((circle) => {
    const i = Number(circle.dataset.i);
    let dragging = false;
    circle.addEventListener("pointerdown", (e) => {
      dragging = true;
      try { circle.setPointerCapture(e.pointerId); } catch (_) { /* no active pointer to capture, safe to ignore */ }
      e.preventDefault();
    });
    circle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const pt = adjustOverlay.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgPt = pt.matrixTransform(adjustOverlay.getScreenCTM().inverse());
      corners[i] = [Math.max(0, Math.min(w, svgPt.x)), Math.max(0, Math.min(h, svgPt.y))];
      redrawQuad();
    });
    circle.addEventListener("pointerup", () => { dragging = false; });
    circle.addEventListener("pointercancel", () => { dragging = false; });
  });

  captureStep.style.display = "none";
  adjustStep.style.display = "block";
  clearStatus(statusEl);
}

function redrawQuad() {
  adjustOverlay.querySelector("polygon").setAttribute("points", corners.map((c) => c.join(",")).join(" "));
  adjustOverlay.querySelectorAll("circle").forEach((circle) => {
    const [x, y] = corners[Number(circle.dataset.i)];
    circle.setAttribute("cx", x);
    circle.setAttribute("cy", y);
  });
}

cancelAdjustBtn.addEventListener("click", () => {
  adjustStep.style.display = "none";
  captureStep.style.display = "block";
});

usePageBtn.addEventListener("click", () => {
  try {
    const resultCanvas = warpQuadToCanvas(captureCanvas, corners, 2200);
    if (enhanceToggle.checked) enhanceCanvas(resultCanvas);
    pages.push({ id: ++idCounter, canvas: resultCanvas });
    renderPageList();
    adjustStep.style.display = "none";
    captureStep.style.display = "block";
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Could not process that page: ${err.message || "unknown error"}`, "error");
    statusEl.classList.add("visible");
  }
});

// --- Page list ---

function renderPageList() {
  pageList.innerHTML = "";
  pages.forEach((p, i) => {
    const li = document.createElement("li");
    const thumb = document.createElement("img");
    thumb.className = "thumb";
    thumb.src = p.canvas.toDataURL("image/jpeg", 0.7);
    thumb.alt = `Page ${i + 1} preview`;
    li.appendChild(thumb);

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = `Page ${i + 1}`;
    li.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${p.canvas.width}×${p.canvas.height}`;
    li.appendChild(meta);

    const upBtn = document.createElement("button");
    upBtn.className = "remove";
    upBtn.textContent = "↑";
    upBtn.disabled = i === 0;
    upBtn.addEventListener("click", () => { [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; renderPageList(); });

    const downBtn = document.createElement("button");
    downBtn.className = "remove";
    downBtn.textContent = "↓";
    downBtn.disabled = i === pages.length - 1;
    downBtn.addEventListener("click", () => { [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]]; renderPageList(); });

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => { pages.splice(i, 1); renderPageList(); });

    li.appendChild(upBtn);
    li.appendChild(downBtn);
    li.appendChild(removeBtn);
    pageList.appendChild(li);
  });
  const hasPages = pages.length > 0;
  buildControls.style.display = hasPages ? "flex" : "none";
  actionsRow.style.display = hasPages ? "flex" : "none";
  clearStatus(statusEl);
}

clearBtn.addEventListener("click", () => {
  stopCamera();
  pages = [];
  corners = null;
  renderPageList();
  adjustStep.style.display = "none";
  captureStep.style.display = "block";
  clearStatus(statusEl);
});

// --- Build PDF ---

runBtn.addEventListener("click", async () => {
  if (!pages.length) return;
  runBtn.disabled = true;
  setStatus(statusEl, `Building PDF from ${pages.length} page${pages.length > 1 ? "s" : ""}…`, "");
  statusEl.classList.add("visible");

  try {
    const doc = await PDFLib.PDFDocument.create();
    const mode = pageSizeSelect.value;

    for (const p of pages) {
      const blob = await canvasToBlob(p.canvas, "image/jpeg", 0.9);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const image = await doc.embedJpg(bytes);
      const { width: imgW, height: imgH } = image;

      if (mode === "fit") {
        const pw = imgW * 0.75, ph = imgH * 0.75; // 96 CSS px/in -> 72pt/in
        const page = doc.addPage([pw, ph]);
        page.drawImage(image, { x: 0, y: 0, width: pw, height: ph });
      } else {
        const [pw, ph] = PAGE_SIZES[mode];
        const page = doc.addPage([pw, ph]);
        const availW = pw - PAGE_MARGIN * 2, availH = ph - PAGE_MARGIN * 2;
        const scale = Math.min(availW / imgW, availH / imgH);
        const drawW = imgW * scale, drawH = imgH * scale;
        page.drawImage(image, { x: (pw - drawW) / 2, y: (ph - drawH) / 2, width: drawW, height: drawH });
      }
    }

    const bytes = await doc.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    triggerDownload(blob, "scan.pdf");
    setStatus(statusEl, `Sorted — created a ${formatBytes(blob.size)} PDF with ${pages.length} page${pages.length > 1 ? "s" : ""}.`, "success");
  } catch (err) {
    console.error(err);
    setStatus(statusEl, `Something went wrong: ${err.message || "unknown error"}`, "error");
  } finally {
    runBtn.disabled = false;
  }
});
