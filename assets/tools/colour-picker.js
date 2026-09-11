const swatch = document.getElementById("swatch");
const colorPicker = document.getElementById("colorPicker");
const hexInput = document.getElementById("hexInput");
const rInput = document.getElementById("rInput");
const gInput = document.getElementById("gInput");
const bInput = document.getElementById("bInput");
const rVal = document.getElementById("rVal");
const gVal = document.getElementById("gVal");
const bVal = document.getElementById("bVal");
const rgbOut = document.getElementById("rgbOut");
const hInput = document.getElementById("hInput");
const sInput = document.getElementById("sInput");
const lInput = document.getElementById("lInput");
const hVal = document.getElementById("hVal");
const sVal = document.getElementById("sVal");
const lVal = document.getElementById("lVal");
const hslOut = document.getElementById("hslOut");
const eyedropperField = document.getElementById("eyedropperField");
const eyedropperBtn = document.getElementById("eyedropperBtn");
const statusEl = document.getElementById("status");

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function hexToRgb(hex) {
  const clean = hex.replace(/^#/, "").trim();
  let full = clean;
  if (clean.length === 3) full = clean.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgb(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function updateFromRgb(r, g, b, skip) {
  r = Math.min(255, Math.max(0, r));
  g = Math.min(255, Math.max(0, g));
  b = Math.min(255, Math.max(0, b));
  const hex = rgbToHex(r, g, b);
  const hsl = rgbToHsl(r, g, b);

  swatch.style.background = hex;
  if (skip !== "picker") colorPicker.value = hex;
  if (skip !== "hex") hexInput.value = hex;
  if (skip !== "rgb") {
    rInput.value = r; gInput.value = g; bInput.value = b;
  }
  rVal.textContent = r; gVal.textContent = g; bVal.textContent = b;
  rgbOut.value = `rgb(${r}, ${g}, ${b})`;

  if (skip !== "hsl") {
    hInput.value = hsl.h; sInput.value = hsl.s; lInput.value = hsl.l;
  }
  hVal.textContent = hsl.h; sVal.textContent = hsl.s; lVal.textContent = hsl.l;
  hslOut.value = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
}

colorPicker.addEventListener("input", () => {
  const rgb = hexToRgb(colorPicker.value);
  if (rgb) updateFromRgb(rgb.r, rgb.g, rgb.b, "picker");
});

hexInput.addEventListener("input", () => {
  const rgb = hexToRgb(hexInput.value);
  if (rgb) {
    updateFromRgb(rgb.r, rgb.g, rgb.b, "hex");
    clearStatus(statusEl);
  } else {
    setStatus(statusEl, "That doesn't look like a valid HEX colour (e.g. #004D40 or #0D4).", "error");
  }
});

[rInput, gInput, bInput].forEach((el) => {
  el.addEventListener("input", () => {
    updateFromRgb(Number(rInput.value), Number(gInput.value), Number(bInput.value), "rgb");
  });
});

[hInput, sInput, lInput].forEach((el) => {
  el.addEventListener("input", () => {
    const rgb = hslToRgb(Number(hInput.value), Number(sInput.value), Number(lInput.value));
    updateFromRgb(rgb.r, rgb.g, rgb.b, "hsl");
  });
});

if (window.EyeDropper) {
  eyedropperField.style.display = "block";
  eyedropperBtn.addEventListener("click", async () => {
    try {
      const result = await new EyeDropper().open();
      const rgb = hexToRgb(result.sRGBHex);
      if (rgb) updateFromRgb(rgb.r, rgb.g, rgb.b);
    } catch (err) {
      // User cancelled the picker, nothing to do.
    }
  });
}

document.querySelectorAll(".copy-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const target = document.getElementById(btn.dataset.target);
    try {
      await navigator.clipboard.writeText(target.value);
      setStatus(statusEl, "Copied to clipboard.", "success");
    } catch (err) {
      target.select();
      setStatus(statusEl, "Couldn't access the clipboard automatically, the text is selected, press Ctrl/Cmd+C to copy.", "error");
    }
  });
});

updateFromRgb(0, 77, 64);
