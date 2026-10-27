// Password Generator page. The picking and the maths live in password-core.js; the word lists load only when the Passphrase
// tab is first used. Passwords are made and shown in the browser and never sent, saved or logged anywhere.
import { h, icon } from "/assets/tools/dom-helpers.js";
import {
  LEVELS, PRESETS, VERBOSITY, POOL_DEPTHS, EFF_RECOMMENDED_BITS,
  generateChars, generatePassphrase, averagePassphraseBits, tierOf, crackTime, exportText,
} from "/assets/tools/password-core.js";

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const noteEl = $("pwNote");
const CLEAR_AFTER_MS = 30000;

const state = {
  tab: "password",
  count: 1,
  reveal: false, // whether new results start unmasked
  autoClear: false,
  level: "medium",
  password: { length: 16, ambiguous: false, cli: false },
  custom: { preset: "", length: 20, upper: true, lower: true, numbers: true, symbols: true, symbolChars: LEVELS[1].symbols, startsWithLetter: false, noRepeat: false, min: 0, ambiguous: false, cli: false },
  phrase: { verbosity: "extra", simpleWords: 3, separators: "-", addNumbers: false, depth: POOL_DEPTHS[POOL_DEPTHS.length - 1], syntax: false, capitals: false, ambiguous: false, cli: false },
  items: [],
  meta: null,
  stale: false,
};

const ERRORS = {
  "empty-pool": "Choose at least one kind of character.",
  "cannot-satisfy": "Those rules cannot all be met together. Try a longer length or fewer rules.",
};

// Only the symbols on a standard keyboard (and the space), so every character is one unit long and the maths stays honest
const cleanSymbols = (text) => [...new Set([...text].filter((ch) => /[ -/:-@[-`{-~]/.test(ch)))].join("");

// ---------------------------------------------------------------- word lists (loaded on first use)

let data = null;
let dataPromise = null;
function ensureData() {
  dataPromise ??= Promise.all([import("/assets/vendor/eff-large-wordlist.js"), import("/assets/tools/password-syntax-words.js")])
    .then(([eff, syntax]) => (data = { words: eff.EFF_WORDS, syntax: syntax.SYNTAX_WORDS }));
  dataPromise.catch(() => { dataPromise = null; });
  return dataPromise;
}

// ---------------------------------------------------------------- what each tab makes

const filterNames = (f) => [f.ambiguous && "avoids look-alike characters", f.cli && "command-line safe"].filter(Boolean);

function specFor(tab) {
  if (tab === "password") {
    const p = state.password;
    const level = LEVELS.find((l) => l.id === state.level);
    const filters = { ambiguous: p.ambiguous, cli: p.cli };
    const cfg = { length: p.length, upper: true, lower: true, numbers: true, symbols: level.symbols, minPerClass: 1, filters };
    return { tab, label: `Password, ${level.label} level`, filters: filterNames(filters), make: () => generateChars(cfg) };
  }
  if (tab === "custom") {
    const c = state.custom;
    const filters = { ambiguous: c.ambiguous, cli: c.cli };
    const cfg = { length: c.length, upper: c.upper, lower: c.lower, numbers: c.numbers, symbols: c.symbols ? cleanSymbols(c.symbolChars) : "", startsWithLetter: c.startsWithLetter, noRepeat: c.noRepeat, minPerClass: c.min, filters };
    const preset = PRESETS.find((p) => p.id === c.preset);
    return { tab, label: preset ? `Custom, ${preset.label}` : "Custom", filters: filterNames(filters), make: () => generateChars(cfg) };
  }
  const q = state.phrase;
  const filters = { ambiguous: q.ambiguous, cli: q.cli };
  const opts = { verbosity: q.verbosity, simpleWords: q.simpleWords, depth: q.depth, strict: !q.capitals, separators: [...cleanSymbols(q.separators)], addNumbers: q.addNumbers, syntax: q.syntax, filters };
  return { tab, label: "Passphrase", filters: filterNames(filters), opts, make: () => generatePassphrase(opts, data) };
}

// ---------------------------------------------------------------- the estimate under each panel

function describe(bits) {
  return `About ${bits} bits, ${tierOf(bits).label.toLowerCase()}. At a trillion guesses a second it would take ${crackTime(bits)} to crack, on average.`;
}

async function refreshEstimate() {
  const tab = state.tab;
  const el = $(`est-${tab}`);
  if (!el) return;
  if (tab === "passphrase") {
    try { await ensureData(); } catch { el.textContent = "The word list could not be loaded."; return; }
    if (state.tab !== tab) return;
    const spec = specFor(tab);
    const bits = Math.floor(averagePassphraseBits(spec.opts, data));
    const advice = bits < EFF_RECOMMENDED_BITS ? ` The EFF suggests about ${EFF_RECOMMENDED_BITS} bits or more for a master password.` : "";
    el.textContent = `On average ${describe(bits).replace("About ", "about ")}${advice}`;
    return;
  }
  const r = specFor(tab).make();
  el.textContent = r.error ? ERRORS[r.error] : describe(r.bits);
}

function changed() {
  if (state.items.length) markStale();
  refreshEstimate();
}

function markStale() {
  state.stale = true;
  $("pwStale").hidden = false;
}

// ---------------------------------------------------------------- form pieces

const check = (id, label, checked, onchange) => h("div", { class: "qr-field qr-check" },
  h("input", { type: "checkbox", id, checked, onchange: (e) => onchange(e.target.checked) }),
  h("label", { for: id, text: label }));

const select = (id, label, options, value, onchange, extra = {}) => h("div", { class: `qr-field ${extra.wide ? "qr-wide" : ""}`, id: extra.wrapId, hidden: extra.hidden },
  h("label", { for: id, text: label }),
  h("select", { id, onchange: (e) => onchange(e.target.value) },
    options.map(([v, t]) => h("option", { value: v, text: t, selected: String(v) === String(value) }))));

function slider(id, label, unit, min, max, value, oninput) {
  const shown = h("span", { text: String(value) });
  return h("div", { class: "qr-field qr-wide" },
    h("label", { for: id }, `${label} (`, shown, ` ${unit})`),
    h("input", { type: "range", id, min, max, step: 1, value, oninput: (e) => { shown.textContent = e.target.value; oninput(Number(e.target.value)); } }));
}

const filterChecks = (prefix, obj, set, labels) => [
  check(`${prefix}Ambiguous`, labels[0], obj.ambiguous, (v) => set("ambiguous", v)),
  check(`${prefix}Cli`, labels[1], obj.cli, (v) => set("cli", v)),
];

const estimate = (tab) => h("p", { class: "help-text pw-estimate", id: `est-${tab}`, role: "status" });

// ---------------------------------------------------------------- Password tab

function renderPassword() {
  const p = state.password;
  const set = (key, v) => { p[key] = v; changed(); };
  $("panel-password").replaceChildren(
    h("fieldset", { class: "qr-group" },
      h("legend", { text: "Level" }),
      h("div", { class: "qr-types", role: "group", "aria-label": "Password level" }, LEVELS.map((l) => h("button", {
        type: "button", class: "qr-type", "aria-pressed": String(l.id === state.level), "data-level": l.id,
        onclick: () => { state.level = l.id; p.length = l.length; renderPassword(); $("panel-password").querySelector(`[data-level="${l.id}"]`).focus(); changed(); },
      }, h("span", { text: `${l.label}, ${l.length}` })))),
      h("div", { class: "qr-form" }, slider("pwLength", "Length", "characters", 8, 128, p.length, (v) => set("length", v))),
      h("p", { class: "help-text", text: "Every level uses upper and lower case letters, numbers and symbols, with at least one of each. The levels change the length and how many symbols are in the mix." })),
    h("fieldset", { class: "qr-group" },
      h("legend", { text: "Characters to leave out" }),
      h("div", { class: "qr-form" }, filterChecks("pw", p, set, ["Look-alikes (0 O 1 l I and similar), easier to read out or type", "Ones a command line treats specially (quotes, $, backslash, spaces and similar)"]))),
    estimate("password"));
}

// ---------------------------------------------------------------- Custom tab

function renderCustom() {
  const c = state.custom;
  const set = (key, v) => {
    c[key] = v;
    if (c.preset) { c.preset = ""; $("pwPreset").value = ""; }
    changed();
  };
  const usePreset = (id) => {
    const p = PRESETS.find((x) => x.id === id);
    if (p) Object.assign(c, { preset: id, length: p.length, upper: p.upper, lower: p.lower, numbers: p.numbers, symbols: p.symbols, symbolChars: LEVELS[1].symbols, startsWithLetter: p.startsWithLetter, noRepeat: p.noRepeat, min: p.min3 ? 3 : 0, ambiguous: p.clean, cli: p.cli });
    else c.preset = "";
    renderCustom();
    $("pwPreset").focus();
    changed();
  };
  $("panel-custom").replaceChildren(
    h("fieldset", { class: "qr-group" },
      h("legend", { text: "Start from" }),
      h("div", { class: "qr-form" },
        select("pwPreset", "Ready-made settings", [["", "My own settings"], ...PRESETS.map((p) => [p.id, p.label])], c.preset, usePreset, { wide: true }),
        slider("pwCustomLength", "Length", "characters", 4, 128, c.length, (v) => set("length", v))),
      h("p", { class: "help-text", text: "These are common starting points, not official rules. Check what your own system asks for." })),
    h("fieldset", { class: "qr-group" },
      h("legend", { text: "Characters" }),
      h("div", { class: "qr-form" },
        check("pwUpper", "Capital letters (A to Z)", c.upper, (v) => set("upper", v)),
        check("pwLower", "Lower case letters (a to z)", c.lower, (v) => set("lower", v)),
        check("pwNumbers", "Numbers (0 to 9)", c.numbers, (v) => set("numbers", v)),
        check("pwSymbolsOn", "Symbols", c.symbols, (v) => { $("pwSymbols").disabled = !v; set("symbols", v); }),
        h("div", { class: "qr-field qr-wide" },
          h("label", { for: "pwSymbols", text: "Symbols to use" }),
          h("input", { type: "text", id: "pwSymbols", value: c.symbolChars, disabled: !c.symbols, autocomplete: "off", spellcheck: "false", oninput: (e) => set("symbolChars", e.target.value) })))),
    h("fieldset", { class: "qr-group" },
      h("legend", { text: "Rules" }),
      h("div", { class: "qr-form" },
        check("pwStartLetter", "Start with a letter", c.startsWithLetter, (v) => set("startsWithLetter", v)),
        check("pwNoRepeat", "No character twice in a row", c.noRepeat, (v) => set("noRepeat", v)),
        select("pwMin", "Minimum of each type", [[0, "No minimum"], [1, "At least 1 of each type"], [3, "At least 3 of each type"]], c.min, (v) => set("min", Number(v)), { wide: true }))),
    h("fieldset", { class: "qr-group" },
      h("legend", { text: "Characters to leave out" }),
      h("div", { class: "qr-form" }, filterChecks("pwc", c, set, ["Look-alikes (0 O 1 l I and similar)", "Ones a command line treats specially (quotes, $, backslash, spaces and similar)"]))),
    estimate("custom"));
}

// ---------------------------------------------------------------- Passphrase tab

const VERBOSITY_LABELS = {
  simple: "Simple (2 to 4 words, your choice)",
  default: "Standard (3 or 4 words)",
  extra: "Extra (5 to 7 words, recommended)",
  advanced: "Advanced (7 to 9 words)",
  maximum: "Maximum (10 to 14 words)",
};
const DEPTH_LABELS = { 1000: "Everyday words (1,000)", 2000: "A wider mix (2,000)", 4000: "A wide mix (4,000)", 7776: "The full list (7,776)" };

function renderPassphrase() {
  const q = state.phrase;
  const set = (key, v) => { q[key] = v; syncPhrase(); changed(); };
  const simple = q.verbosity === "simple";
  $("panel-passphrase").replaceChildren(
    h("fieldset", { class: "qr-group" },
      h("legend", { text: "Length" }),
      h("div", { class: "qr-form" },
        select("pwVerbosity", "How many words", Object.keys(VERBOSITY).map((k) => [k, VERBOSITY_LABELS[k]]), q.verbosity, (v) => set("verbosity", v), { wide: true }),
        select("pwWords", "Words", [[2, "2"], [3, "3"], [4, "4"]], q.simpleWords, (v) => set("simpleWords", Number(v)), { wrapId: "pwWordsField", hidden: !simple }),
        h("div", { class: "qr-field", id: "pwSepField", hidden: !simple },
          h("label", { for: "pwSeparators", text: "Separators to choose from" }),
          h("input", { type: "text", id: "pwSeparators", value: q.separators, autocomplete: "off", spellcheck: "false", oninput: (e) => set("separators", e.target.value) })),
        h("div", { class: "qr-wide", id: "pwNumField", hidden: !simple }, check("pwAddNumbers", "Add two digits to each word", q.addNumbers, (v) => set("addNumbers", v))),
        h("div", { class: "qr-wide", id: "pwCapField", hidden: simple }, check("pwCapitals", "Add some capitals and a dash, dot or underscore between words", q.capitals, (v) => set("capitals", v))))),
    h("fieldset", { class: "qr-group" },
      h("legend", { text: "Words" }),
      h("div", { class: "qr-form" },
        h("div", { class: "qr-wide" }, check("pwSyntax", "Read like a sentence (a subject, a verb, an object and a few more words)", q.syntax, (v) => set("syntax", v))),
        select("pwDepth", "Word list", POOL_DEPTHS.map((d) => [d, DEPTH_LABELS[d]]), q.depth, (v) => set("depth", Number(v)), { wide: true })),
      h("p", { class: "help-text", id: "pwSyntaxNote", hidden: !q.syntax, text: "Sentence style draws from short lists of about 130 to 190 words for each part, so it needs more words than the plain style to be as strong. The estimate below accounts for that." }),
      h("p", { class: "help-text", text: "Plain style uses the EFF Large Wordlist, 7,776 easy-to-spell words. A smaller list is easier to read but needs more words for the same strength." })),
    h("fieldset", { class: "qr-group" },
      h("legend", { text: "Characters to leave out" }),
      h("div", { class: "qr-form" }, filterChecks("pwp", q, set, ["Look-alikes in numbers and separators", "Dashes instead of spaces, and no characters a command line treats specially"]))),
    estimate("passphrase"));
  syncPhrase();
}

// shows only the controls that apply to the chosen length and style
function syncPhrase() {
  const q = state.phrase;
  const simple = q.verbosity === "simple";
  for (const [id, on] of [["pwWordsField", simple], ["pwSepField", simple], ["pwNumField", simple], ["pwCapField", !simple], ["pwSyntaxNote", q.syntax]]) {
    const el = $(id);
    if (el) el.hidden = !on;
  }
  const depth = $("pwDepth");
  if (depth) depth.disabled = q.syntax;
}

// ---------------------------------------------------------------- tabs

const TAB_IDS = ["password", "custom", "passphrase"];
function showTab(id, focus = false) {
  state.tab = id;
  for (const t of TAB_IDS) {
    const tab = $(`tab-${t}`), panel = $(`panel-${t}`);
    const on = t === id;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    panel.hidden = !on;
    if (on && focus) tab.focus();
  }
  if (id === "passphrase") ensureData().catch(() => {});
  if (state.items.length && state.items[0].tab !== id) markStale();
  refreshEstimate();
}
TAB_IDS.forEach((t, i) => {
  $(`tab-${t}`).addEventListener("click", () => showTab(t));
  $(`tab-${t}`).addEventListener("keydown", (e) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step) { e.preventDefault(); showTab(TAB_IDS[(i + step + TAB_IDS.length) % TAB_IDS.length], true); }
  });
});

// ---------------------------------------------------------------- results

const TIER_FILL = 128; // a result holding this many bits fills the bar

function say(message, warning = false) {
  noteEl.textContent = message;
  noteEl.classList.toggle("is-warning", warning);
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let clearTimer = null;
async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    say("The browser would not let this page use the clipboard. Select the text and copy it yourself.", true);
    return;
  }
  clearTimeout(clearTimer);
  if (state.autoClear) {
    clearTimer = setTimeout(() => navigator.clipboard.writeText("").catch(() => {}), CLEAR_AFTER_MS);
    say(`${what} copied. The clipboard will be cleared in 30 seconds.`);
  } else {
    say(`${what} copied.`);
  }
}

const MASK = "•";
const shown = (item) => (item.revealed ? item.value : MASK.repeat(item.value.length));

function iconButton(name, label, onclick) {
  return h("button", { type: "button", class: "pw-icon-btn", "aria-label": label, title: label, onclick }, icon(name));
}

function card(item, index) {
  const tier = tierOf(item.bits);
  const hashLine = h("div", { class: "pw-hash", hidden: !item.hash, text: item.hash ? `SHA-256 ${item.hash}` : "" });
  const value = h("div", { class: "pw-value" });
  const eye = h("button", { type: "button", class: "pw-icon-btn", onclick: () => { item.revealed = !item.revealed; paint(); syncShowAll(); } }, icon("visibility"));
  // masked text is not selectable and is announced as hidden, so a stray copy or a screen reader cannot leak it
  const paint = () => {
    value.textContent = shown(item);
    value.classList.toggle("is-masked", !item.revealed);
    if (item.revealed) { value.removeAttribute("role"); value.removeAttribute("aria-label"); } else { value.setAttribute("role", "img"); value.setAttribute("aria-label", `Hidden password, ${item.value.length} characters`); }
    const label = item.revealed ? "Hide this password" : "Show this password";
    eye.setAttribute("aria-label", label);
    eye.title = label;
    eye.setAttribute("aria-pressed", String(item.revealed));
    eye.firstChild.textContent = item.revealed ? "visibility_off" : "visibility";
  };
  paint();
  return h("li", { class: "pw-item" },
    value,
    h("div", { class: "pw-meter", role: "img", "aria-label": `${tier.label}, about ${item.bits} bits` },
      h("span", { class: `pw-fill pw-tier-${tier.id}`, style: `width:${Math.min(100, (item.bits / TIER_FILL) * 100)}%` })),
    h("div", { class: "pw-meta", text: `${tier.label}, about ${item.bits} bits, ${item.value.length} characters. About ${crackTime(item.bits)} to crack.` }),
    h("div", { class: "pw-actions" },
      eye,
      iconButton("content_copy", "Copy this one", () => copyText(item.value, "Password")),
      iconButton("refresh", "Make a new one like this", () => replace(index)),
      iconButton("tag", "Show the SHA-256 hash", async () => {
        item.hash ??= await sha256(item.value);
        hashLine.textContent = `SHA-256 ${item.hash}`;
        hashLine.hidden = !hashLine.hidden;
      })),
    hashLine);
}

function renderList() {
  const list = $("pwList");
  const top = list.scrollTop;
  list.replaceChildren(...state.items.map(card));
  list.scrollTop = top;
  $("pwBulk").hidden = !state.items.length;
  $("pwStale").hidden = !state.stale;
  $("pwCopyAll").hidden = state.items.length < 2;
  syncShowAll();
}

function syncShowAll() {
  $("pwShowAll").checked = state.items.length > 0 && state.items.every((i) => i.revealed);
}

function replace(index) {
  const old = state.items[index];
  const r = old.make();
  if (r.error) return;
  state.items[index] = { ...r, make: old.make, tab: old.tab, revealed: old.revealed };
  renderList();
}

async function generate() {
  const spec = specFor(state.tab);
  clearStatus(statusEl);
  say("");
  if (state.tab === "passphrase") {
    try { await ensureData(); } catch {
      setStatus(statusEl, "The word list could not be loaded. Check your connection to this site and try again.", "error");
      return;
    }
  }
  const items = [];
  for (let i = 0; i < state.count; i++) {
    const r = spec.make();
    if (r.error) { setStatus(statusEl, ERRORS[r.error], "error"); return; }
    items.push({ ...r, make: spec.make, tab: spec.tab, revealed: state.reveal });
  }
  state.items = items;
  state.meta = spec;
  state.stale = false;
  renderList();
}

function clearAll() {
  state.items = [];
  state.meta = null;
  state.stale = false;
  $("pwPrintArea").replaceChildren();
  renderList();
  say("Cleared.");
}

function exportFile() {
  const text = exportText(state.items, { generated: new Date().toLocaleString("en-AU"), type: state.meta.label, filters: state.meta.filters });
  triggerDownload(new Blob([text], { type: "text/plain;charset=utf-8" }), brandFilename("password-generator", "passwords", "txt"));
}

// The list is put into a print-only block, printed, then taken out again so it does not linger on the page
function printList() {
  const area = $("pwPrintArea");
  area.replaceChildren(
    h("h2", { text: "Fair Go PDF, Password Generator" }),
    h("p", { text: `${state.meta.label}, made ${new Date().toLocaleString("en-AU")}` }),
    h("ol", {}, state.items.map((item) => h("li", {}, h("code", { text: item.value })))));
  document.body.classList.add("pw-printing");
  window.addEventListener("afterprint", () => { document.body.classList.remove("pw-printing"); area.replaceChildren(); }, { once: true });
  window.print();
}

$("pwGenerate").addEventListener("click", generate);
$("pwCount").addEventListener("change", (e) => { state.count = Number(e.target.value); });
$("pwShowAll").addEventListener("change", (e) => {
  state.reveal = e.target.checked;
  state.items.forEach((i) => { i.revealed = state.reveal; });
  renderList();
});
$("pwAutoClear").addEventListener("change", (e) => { state.autoClear = e.target.checked; });
$("pwCopyAll").addEventListener("click", () => copyText(state.items.map((i) => i.value).join("\n"), "All copied"));
$("pwExport").addEventListener("click", exportFile);
$("pwPrint").addEventListener("click", printList);
$("pwClear").addEventListener("click", clearAll);

renderPassword();
renderCustom();
renderPassphrase();
showTab("password");
generate();
