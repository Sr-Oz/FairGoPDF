// The password and passphrase maths, with no page code in it, so the tests can run it. Every random choice comes from
// crypto.getRandomValues (never Math.random) and is unbiased. Strength is worked out from how a value was built (how many
// equally likely choices went into it), not guessed from the finished text.
//
// The modes, presets and word-count ranges follow the open-source Secure Password Generator by RadMageIRL
// (MIT, https://github.com/RadMageIRL/SecurePasswordGenerator). The passphrase words are the EFF Large Wordlist (CC BY 3.0 US).

// ---------------------------------------------------------------- randomness

// A whole number from 0 up to max - 1. Numbers that would favour small results (modulo bias) are thrown away and redrawn.
export function secureRand(max) {
  if (!Number.isInteger(max) || max < 1 || max > 0x100000000) throw new RangeError("secureRand needs a whole number from 1 to 2^32");
  if (max === 1) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  let v;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return v % max;
}

export function secureShuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = secureRand(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const pick = (items) => items[secureRand(items.length)];
const log2 = Math.log2;

// ---------------------------------------------------------------- characters

export const SETS = {
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lower: "abcdefghijklmnopqrstuvwxyz",
  numbers: "0123456789",
};
export const CUSTOM_SYMBOLS = "!@#$%^&*()-_=+[]{}<>?/|~`:;";

// the five ready-made levels: how long, and which symbols
export const LEVELS = [
  { id: "simple", label: "Simple", length: 12, symbols: "!-+" },
  { id: "medium", label: "Medium", length: 16, symbols: "!@#$%^&*-_+=" },
  { id: "complex", label: "Complex", length: 24, symbols: "!@#$%^&*()-_=+[]{}<>?/|" },
  { id: "extended", label: "Extended", length: 32, symbols: "!@#$%^&*()-_=+[]{}<>?/|~`" },
  { id: "high", label: "High security", length: 64, symbols: CUSTOM_SYMBOLS },
];

// Characters that are easy to mix up when read or typed, and characters that cause trouble in a terminal or config file
const AMBIGUOUS = new Set("01OILlo|/\\ .:;");
const CLI_UNSAFE = new Set("?\"'`$\\|<>& ");

export function applyFilters(chars, filters = {}) {
  const out = [];
  for (const c of new Set(chars)) {
    if (filters.ambiguous && AMBIGUOUS.has(c)) continue;
    if (filters.cli && CLI_UNSAFE.has(c)) continue;
    out.push(c);
  }
  return out.join("");
}

// config: { length, upper, lower, numbers (booleans), symbols (the symbol characters, "" for none),
//           startsWithLetter, noRepeat, minPerClass (0, 1 or 3), filters: { ambiguous, cli } }
export function classesOf(cfg) {
  const f = cfg.filters || {};
  const list = [];
  if (cfg.upper) list.push({ id: "upper", chars: applyFilters(SETS.upper, f) });
  if (cfg.lower) list.push({ id: "lower", chars: applyFilters(SETS.lower, f) });
  if (cfg.numbers) list.push({ id: "numbers", chars: applyFilters(SETS.numbers, f) });
  if (cfg.symbols) list.push({ id: "symbols", chars: applyFilters(cfg.symbols, f) });
  return list.filter((c) => c.chars.length);
}

export const poolOf = (cfg) => classesOf(cfg).map((c) => c.chars).join("");

// The chance that a random string of n characters has at least `min` of every class (worked out position by position).
// shares: each class's share of the pool; firstShares: the same for the first position when it is restricted.
export function probAtLeast(shares, n, min, firstShares) {
  if (!min) return 1;
  const k = shares.length;
  const base = min + 1;
  const size = base ** k;
  let cur = new Float64Array(size);
  cur[0] = 1;
  for (let pos = 0; pos < n; pos++) {
    const p = pos === 0 && firstShares ? firstShares : shares;
    const next = new Float64Array(size);
    for (let s = 0; s < size; s++) {
      const v = cur[s];
      if (!v) continue;
      for (let c = 0; c < k; c++) {
        if (!p[c]) continue;
        const unit = base ** c;
        const digit = Math.floor(s / unit) % base;
        next[s + (Math.min(digit + 1, min) - digit) * unit] += v * p[c];
      }
    }
    cur = next;
  }
  return cur[size - 1];
}

function countsOk(chars, classes, min) {
  if (!min) return true;
  return classes.every((c) => chars.reduce((n, ch) => n + (c.chars.includes(ch) ? 1 : 0), 0) >= min);
}

function constraintsOk(chars, cfg, classes, min, letters) {
  if (cfg.startsWithLetter && letters && !letters.includes(chars[0])) return false;
  if (cfg.noRepeat && chars.some((c, i) => i && c === chars[i - 1])) return false;
  return countsOk(chars, classes, min);
}

function candidate(cfg, pool, letters) {
  const n = cfg.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const set = i === 0 && cfg.startsWithLetter && letters ? letters : pool;
    let c = pick(set);
    if (cfg.noRepeat && i > 0 && set.length > 1) while (c === out[i - 1]) c = pick(set);
    out.push(c);
  }
  return out;
}

// Used only when so many characters of each class are asked for that drawing at random and checking would take too long
function constructed(cfg, classes, pool, min, letters) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const n = cfg.length;
    const out = new Array(n).fill(null);
    const slots = secureShuffle([...Array(n).keys()]);
    let s = 0;
    for (const c of classes) for (let j = 0; j < min; j++) out[slots[s++]] = pick(c.chars);
    for (let i = 0; i < n; i++) if (out[i] === null) out[i] = pick(pool);
    if (cfg.startsWithLetter && letters && !letters.includes(out[0])) {
      const swap = out.findIndex((c) => letters.includes(c));
      if (swap > 0) [out[0], out[swap]] = [out[swap], out[0]];
    }
    if (constraintsOk(out, cfg, classes, min, letters)) return out;
  }
  return null;
}

// -> { value, bits, poolSize } or { error }
export function generateChars(cfg) {
  const classes = classesOf(cfg);
  const pool = classes.map((c) => c.chars).join("");
  const n = Math.max(1, Math.floor(cfg.length));
  if (!pool) return { error: "empty-pool" };
  const letters = classes.filter((c) => c.id === "upper" || c.id === "lower").map((c) => c.chars).join("");
  const min = Math.min(cfg.minPerClass || 0, Math.floor(n / classes.length));
  const run = { ...cfg, length: n };

  const shares = classes.map((c) => c.chars.length / pool.length);
  const firstShares = cfg.startsWithLetter && letters ? classes.map((c) => (c.id === "upper" || c.id === "lower" ? c.chars.length / letters.length : 0)) : null;
  const pValid = probAtLeast(shares, n, min, firstShares);

  let chars = null;
  if (pValid >= 0.001) {
    for (let tries = 0; tries < 4000 && !chars; tries++) {
      const c = candidate(run, pool, letters);
      if (countsOk(c, classes, min)) chars = c;
    }
  }
  if (!chars) chars = constructed(run, classes, pool, min, letters);
  if (!chars) return { error: "cannot-satisfy" };

  const firstBits = cfg.startsWithLetter && letters ? log2(letters.length) : log2(pool.length);
  const restBits = cfg.noRepeat && pool.length > 1 ? log2(pool.length - 1) : log2(pool.length);
  const bits = Math.max(1, Math.floor(firstBits + (n - 1) * restBits + log2(Math.max(pValid, 1e-300))));
  return { value: chars.join(""), bits, poolSize: pool.length };
}

// ---------------------------------------------------------------- the ready-made starting points for Custom
// Starting points, not official rules: check what your own system asks for.
export const PRESETS = [
  { id: "service-account", label: "Service account (Active Directory safe)", length: 28, upper: true, lower: true, numbers: true, symbols: true, cli: true, clean: false, startsWithLetter: true, noRepeat: false, min3: true },
  { id: "cli-secret", label: "Linux or command-line secret", length: 24, upper: true, lower: true, numbers: true, symbols: true, cli: true, clean: false, startsWithLetter: false, noRepeat: false, min3: false },
  { id: "api-key", label: "API key or token", length: 48, upper: true, lower: true, numbers: true, symbols: false, cli: false, clean: false, startsWithLetter: true, noRepeat: false, min3: false },
  { id: "database", label: "Database password", length: 24, upper: true, lower: true, numbers: true, symbols: false, cli: true, clean: false, startsWithLetter: false, noRepeat: false, min3: true },
  { id: "nist", label: "NIST SP 800-63B style", length: 20, upper: true, lower: true, numbers: true, symbols: true, cli: false, clean: true, startsWithLetter: false, noRepeat: false, min3: false },
  { id: "azure", label: "Microsoft Azure AD style", length: 16, upper: true, lower: true, numbers: true, symbols: true, cli: true, clean: false, startsWithLetter: false, noRepeat: false, min3: true },
  { id: "aws", label: "AWS secret style", length: 32, upper: true, lower: true, numbers: true, symbols: false, cli: true, clean: false, startsWithLetter: true, noRepeat: false, min3: false },
  { id: "wpa3", label: "Wi-Fi (WPA3) passphrase", length: 20, upper: true, lower: true, numbers: true, symbols: true, cli: false, clean: true, startsWithLetter: false, noRepeat: false, min3: false },
];

// ---------------------------------------------------------------- passphrases

export const VERBOSITY = {
  simple: [2, 4], // the visitor picks 2, 3 or 4
  default: [3, 4],
  extra: [5, 7],
  advanced: [7, 9],
  maximum: [10, 14],
};
export const POOL_DEPTHS = [1000, 2000, 4000, 7776];
export const EFF_RECOMMENDED_BITS = 77.5; // six words from the full list

const CAPITAL_ODDS = 15; // in 100: how often a word starts with a capital when extra transforms are on
const capitalBits = -(CAPITAL_ODDS / 100) * log2(CAPITAL_ODDS / 100) - (1 - CAPITAL_ODDS / 100) * log2(1 - CAPITAL_ODDS / 100);

// A smaller pool of words that still reaches across the whole alphabet: every few words, not just the first ones
export function wordPool(words, depth) {
  if (depth >= words.length) return words;
  return Array.from({ length: depth }, (_, i) => words[Math.floor((i * words.length) / depth)]);
}

const allowed = (chars, filters = {}) => applyFilters(chars, filters).split("");

// opts: { verbosity, simpleWords, depth, strict, separators (for simple), addNumbers (for simple), syntax, filters }
// data: { words, syntax: { subjects, verbs, objects, adjectives, nouns } }
// -> { value, bits, words }
export function generatePassphrase(opts, data) {
  const f = opts.filters || {};
  const verbosity = VERBOSITY[opts.verbosity] ? opts.verbosity : "extra";
  const [lo, hi] = VERBOSITY[verbosity];
  const count = verbosity === "simple" ? Math.min(4, Math.max(2, opts.simpleWords || 3)) : lo + secureRand(hi - lo + 1);

  // the words, and how many equally likely choices each one was
  let picks;
  if (opts.syntax && data.syntax) {
    const { subjects, verbs, objects, adjectives, nouns } = data.syntax;
    const extra = Math.max(0, count - 3);
    const front = Math.floor(extra / 2);
    const roles = [...Array(front).fill(adjectives), subjects, verbs, ...(count >= 3 ? [objects] : []), ...Array(extra - front).fill(nouns)].slice(0, count);
    picks = roles.map((pool) => ({ word: pick(pool), size: pool.length }));
  } else {
    const pool = wordPool(data.words, opts.depth || data.words.length);
    picks = Array.from({ length: count }, () => ({ word: pick(pool), size: pool.length }));
  }
  let bits = picks.reduce((sum, p) => sum + log2(p.size), 0);
  let words = picks.map((p) => p.word);
  const gaps = Math.max(0, words.length - 1);

  if (verbosity === "simple") {
    if (opts.addNumbers) {
      const digits = allowed(SETS.numbers, f);
      words = words.map((w) => w + pick(digits) + pick(digits));
      bits += words.length * 2 * log2(digits.length);
    }
    let seps = allowed((opts.separators && opts.separators.length ? opts.separators : [" "]).join(""), f);
    if (!seps.length) seps = ["-"];
    bits += gaps * log2(seps.length);
    return { value: words.reduce((acc, w) => acc + pick(seps) + w), bits: Math.floor(bits), words: count };
  }

  if (opts.strict !== false) {
    // plain words in one lower-case row; a dash stands in for the space if a filter takes the space away
    const sep = allowed(" ", f).length ? " " : "-";
    return { value: words.join(sep), bits: Math.floor(bits), words: count };
  }

  // extra transforms: some capitals, and one separator chosen for the whole phrase
  let seps = allowed("-_.", f);
  if (!seps.length) seps = ["-"];
  words = words.map((w) => (secureRand(100) < CAPITAL_ODDS ? w[0].toUpperCase() + w.slice(1) : w));
  bits += words.length * capitalBits + log2(seps.length);
  return { value: words.join(pick(seps)), bits: Math.floor(bits), words: count };
}

// What a phrase made with these settings is worth on average, for the note under the settings
export function averagePassphraseBits(opts, data) {
  const verbosity = VERBOSITY[opts.verbosity] ? opts.verbosity : "extra";
  const [lo, hi] = VERBOSITY[verbosity];
  const counts = verbosity === "simple" ? [opts.simpleWords || 3] : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const perWord = opts.syntax && data.syntax
    ? Object.values(data.syntax).reduce((s, p) => s + log2(p.length), 0) / Object.keys(data.syntax).length
    : log2(wordPool(data.words, opts.depth || data.words.length).length);
  return counts.reduce((s, c) => s + c * perWord, 0) / counts.length;
}

// ---------------------------------------------------------------- how strong, and how long it would take to guess

export const TIERS = [
  { below: 40, id: "weak", label: "Weak" },
  { below: 60, id: "fair", label: "Fair" },
  { below: 80, id: "good", label: "Good" },
  { below: 112, id: "strong", label: "Strong" },
  { below: Infinity, id: "excellent", label: "Excellent" },
];
export const tierOf = (bits) => TIERS.find((t) => bits < t.below);

export const GUESSES_PER_SECOND = 1e12; // a well-funded attacker with a stolen database and fast hardware

// On average an attacker finds it after trying half the possibilities: 2^(bits - 1) guesses.
export function crackTime(bits, rate = GUESSES_PER_SECOND) {
  const log10Seconds = (bits - 1) * Math.log10(2) - Math.log10(rate);
  const log10Years = log10Seconds - Math.log10(365.25 * 86400);
  if (log10Years >= 12) return "more than a trillion years";
  if (log10Years >= 9) return `${Math.round(10 ** (log10Years - 9))} billion years`;
  if (log10Years >= 6) return `${Math.round(10 ** (log10Years - 6))} million years`;
  if (log10Years >= 3) return `${Math.round(10 ** (log10Years - 3))} thousand years`;
  const seconds = 10 ** log10Seconds;
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (seconds < 1) return "less than a second";
  if (seconds < 60) return plural(Math.round(seconds), "second");
  if (seconds < 3600) return plural(Math.round(seconds / 60), "minute");
  if (seconds < 86400) return plural(Math.round(seconds / 3600), "hour");
  if (seconds < 86400 * 30) return plural(Math.round(seconds / 86400), "day");
  if (seconds < 86400 * 365.25) return plural(Math.round(seconds / (86400 * 30.44)), "month");
  return plural(Math.round(seconds / (86400 * 365.25)), "year");
}

// ---------------------------------------------------------------- the exported text file

export function exportText(items, meta) {
  const lines = [
    "Fair Go PDF, Password Generator export",
    `Generated: ${meta.generated}`,
    `Type: ${meta.type}`,
    `Count: ${items.length}`,
    `Filters: ${meta.filters.length ? meta.filters.join(", ") : "none"}`,
    ...(meta.extra || []),
    "-".repeat(60),
    "",
  ];
  items.forEach((item, i) => {
    lines.push(`${String(i + 1).padStart(3, "0")}  ${item.value}`, `     length ${item.value.length}, about ${item.bits} bits, ${tierOf(item.bits).label.toLowerCase()}`, "");
  });
  return lines.join("\n");
}
