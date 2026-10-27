// How a QR code looks: colours, shapes, icon, templates, and the options handed to qr-code-styling (MIT, bundled in
// /assets/vendor). No page code in here, so the tests can run it.
// The shape names and the choice of three colours (dots, corner squares, corner dots) follow the open-source QRcodly
// project (MIT, https://github.com/FloB95/qrcodly). The built-in icons are drawn from Feather icons (MIT, https://feathericons.com).

export const DOT_TYPES = [
  ["square", "Square"], ["rounded", "Rounded"], ["extra-rounded", "Extra rounded"],
  ["dots", "Dots"], ["classy", "Classy"], ["classy-rounded", "Classy rounded"],
];
export const CORNER_SQUARE_TYPES = [["square", "Square"], ["extra-rounded", "Rounded"], ["dot", "Circle"]];
export const CORNER_DOT_TYPES = [["square", "Square"], ["dot", "Dot"]];

export const DEFAULT_STYLE = {
  dotsType: "square", dotsColour: "#000000", dotsGradient: null,
  cornersSquareType: "square", cornersSquareColour: "#000000", cornersSquareGradient: null,
  cornersDotType: "square", cornersDotColour: "#000000", cornersDotGradient: null,
  background: "#ffffff",
  icon: { kind: "none", id: "", dataUrl: "" }, // kind: none | builtin | upload
  iconSize: 0.3, // share of the code's width, 0.1 to 0.4
  errorLevel: "M",
};

// Looks that fill in the three colours, the shapes and the background. They carry no logos: the Facebook, YouTube and
// Instagram marks are trademarks, so a template stays a colour and shape scheme and a logo is the visitor's own to add.
const g = (a, b, rotation = Math.PI / 4) => ({ colours: [a, b], rotation });
// The first look is the one the page starts with: Fair Go teal, in the brand colours (#004D40 and the darker #00332B).
// Gold is left out of the code itself on purpose: pale gold on white is too faint for a phone to scan.
export const TEMPLATES = [
  { id: "fairgo", name: "Fair Go teal", style: { dotsType: "rounded", dotsColour: "#004D40", cornersSquareType: "extra-rounded", cornersSquareColour: "#004D40", cornersDotType: "dot", cornersDotColour: "#00332B", background: "#ffffff" } },
  { id: "modern", name: "Modern", style: { dotsType: "rounded", dotsColour: "#000000", cornersSquareType: "extra-rounded", cornersSquareColour: "#000000", cornersDotType: "dot", cornersDotColour: "#000000", background: "#ffffff" } },
  { id: "classic", name: "Classic", style: { dotsType: "square", dotsColour: "#000000", cornersSquareType: "square", cornersSquareColour: "#000000", cornersDotType: "square", cornersDotColour: "#000000", background: "#ffffff" } },
  { id: "ocean", name: "Ocean", style: { dotsType: "dots", dotsColour: "#1d4ed8", dotsGradient: g("#1d4ed8", "#0369a1"), cornersSquareType: "extra-rounded", cornersSquareColour: "#1e3a8a", cornersDotType: "dot", cornersDotColour: "#1e3a8a", background: "#ffffff" } },
  { id: "sunset", name: "Sunset", style: { dotsType: "classy-rounded", dotsColour: "#c2410c", dotsGradient: g("#c2410c", "#be185d"), cornersSquareType: "extra-rounded", cornersSquareColour: "#9f1239", cornersDotType: "dot", cornersDotColour: "#9f1239", background: "#ffffff" } },
  { id: "forest", name: "Forest", style: { dotsType: "classy", dotsColour: "#166534", cornersSquareType: "square", cornersSquareColour: "#14532d", cornersDotType: "square", cornersDotColour: "#14532d", background: "#ffffff" } },
  { id: "berry", name: "Berry", style: { dotsType: "extra-rounded", dotsColour: "#6d28d9", cornersSquareType: "dot", cornersSquareColour: "#4c1d95", cornersDotType: "dot", cornersDotColour: "#4c1d95", background: "#ffffff" } },
  { id: "cream", name: "Ink on cream", style: { dotsType: "classy", dotsColour: "#1c1b1b", cornersSquareType: "square", cornersSquareColour: "#1c1b1b", cornersDotType: "dot", cornersDotColour: "#1c1b1b", background: "#f6efdd" } },
];

// Icons, 24 x 24, drawn as strokes in the colour they are given
const ICON_PATHS = {
  link: '<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/>',
  wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><path d="M12 20h.01"/>',
  mail: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  location: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
};
export const ICONS = [
  ["link", "Link"], ["wifi", "Wi-Fi"], ["mail", "Email"], ["phone", "Phone"], ["location", "Place"],
  ["calendar", "Calendar"], ["user", "Person"], ["star", "Star"], ["heart", "Heart"],
];

export function iconDataUrl(id, colour) {
  const body = ICON_PATHS[id];
  if (!body) return "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="240" height="240" fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ---- colours ----

export function normaliseHex(value) {
  const v = String(value || "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(v)) return `#${v.split("").map((c) => c + c).join("")}`.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(v)) return `#${v}`.toLowerCase();
  return null;
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// What could stop a code scanning: pale colours on the background, or a dark background behind pale marks
export function scanWarnings(style) {
  const out = [];
  const parts = [["dots", style.dotsColour, style.dotsGradient], ["corner squares", style.cornersSquareColour, style.cornersSquareGradient], ["corner dots", style.cornersDotColour, style.cornersDotGradient]];
  for (const [name, colour, gradient] of parts) {
    const colours = gradient ? gradient.colours : [colour];
    const worst = Math.min(...colours.map((c) => contrastRatio(c, style.background)));
    if (worst < 3) out.push(`The ${name} are too close to the background colour (contrast ${worst.toFixed(1)}:1). Phones may not scan this code. Aim for at least 3:1.`);
  }
  if (!out.length && luminance(style.dotsColour) > luminance(style.background)) {
    out.push("The dots are lighter than the background. Some older scanners can't read a code like that, so dark dots on a light background is the safest.");
  }
  return out;
}

// ---- the options for qr-code-styling ----

const paint = (colour, gradient) => gradient
  ? { gradient: { type: "linear", rotation: gradient.rotation ?? 0, colorStops: [{ offset: 0, color: gradient.colours[0] }, { offset: 1, color: gradient.colours[1] }] } }
  : { color: colour };

// qr-code-styling writes each character of the text as one byte (Latin-1), so a macron, an accent or an emoji would come out as
// rubbish. Giving it the text as UTF-8 bytes, one per character, is what phones read.
export function utf8AsBytes(text) {
  let out = "";
  for (const byte of new TextEncoder().encode(text)) out += String.fromCharCode(byte);
  return out;
}

export function toOptions(style, text, size, type = "svg") {
  const hasIcon = style.icon.kind !== "none" && (style.icon.kind === "builtin" || style.icon.dataUrl);
  const image = !hasIcon ? undefined : style.icon.kind === "builtin" ? iconDataUrl(style.icon.id, style.dotsColour) : style.icon.dataUrl;
  return {
    type,
    width: size,
    height: size,
    margin: Math.round(size * 0.06), // the blank border scanners like to see around a code
    data: utf8AsBytes(text),
    image,
    qrOptions: { mode: "Byte", errorCorrectionLevel: hasIcon ? "H" : style.errorLevel }, // an icon covers part of the code, so correct more
    // saveAsBlob: false because the library would otherwise fetch() the image, which the page's content policy (rightly) blocks for data: URLs; it is already embedded
    imageOptions: { saveAsBlob: false, hideBackgroundDots: true, imageSize: style.iconSize, margin: Math.round(size * 0.012), crossOrigin: "anonymous" },
    dotsOptions: { type: style.dotsType, ...paint(style.dotsColour, style.dotsGradient) },
    cornersSquareOptions: { type: style.cornersSquareType, ...paint(style.cornersSquareColour, style.cornersSquareGradient) },
    cornersDotOptions: { type: style.cornersDotType, ...paint(style.cornersDotColour, style.cornersDotGradient) },
    backgroundOptions: { color: style.background },
  };
}

export function applyTemplate(style, template) {
  return {
    ...style,
    dotsGradient: null, cornersSquareGradient: null, cornersDotGradient: null,
    ...template.style,
  };
}
