// The password maths: randomness, the rules each mode follows, and the strength figures. A strength number that is
// quietly wrong is worse than none, so the answers below are worked out by hand.
import test from "node:test";
import assert from "node:assert/strict";
import {
  secureRand, applyFilters, classesOf, poolOf, generateChars, probAtLeast, LEVELS, PRESETS, CUSTOM_SYMBOLS,
  wordPool, generatePassphrase, averagePassphraseBits, VERBOSITY, tierOf, crackTime, exportText,
} from "../assets/tools/password-core.js";
import { EFF_WORDS } from "../assets/vendor/eff-large-wordlist.js";
import { SYNTAX_WORDS } from "../assets/tools/password-syntax-words.js";

const DATA = { words: EFF_WORDS, syntax: SYNTAX_WORDS };
const level = (id, filters) => {
  const l = LEVELS.find((x) => x.id === id);
  return { length: l.length, upper: true, lower: true, numbers: true, symbols: l.symbols, minPerClass: 1, filters };
};
const run = (n, fn) => Array.from({ length: n }, fn);

test("secureRand: stays in range, is even, refuses bad input", () => {
  const counts = new Array(7).fill(0);
  for (let i = 0; i < 70000; i++) counts[secureRand(7)]++;
  for (const c of counts) assert.ok(c > 9400 && c < 10600, `uneven count ${c}`); // 10,000 each, give or take
  assert.equal(secureRand(1), 0);
  for (const bad of [0, -1, 1.5, NaN, 2 ** 33]) assert.throws(() => secureRand(bad), RangeError);
});

test("secureRand: no modulo bias, even when the range is a large share of 2^32", () => {
  // With a plain "% max", the low 30% of results would turn up about 40% more often than the rest
  const max = 3_000_000_000;
  let low = 0;
  const draws = 20000;
  for (let i = 0; i < draws; i++) if (secureRand(max) < 1_000_000_000) low++;
  const share = low / draws; // fair share: 1/3
  assert.ok(share > 0.32 && share < 0.35, `low third came up ${(share * 100).toFixed(1)}% of the time`);
});

test("filters remove look-alike and command-line-unsafe characters", () => {
  assert.equal(applyFilters("0O1lI|abc", { ambiguous: true }), "abc");
  assert.equal(applyFilters("a$b'c d", { cli: true }), "abcd");
  assert.equal(applyFilters("aab", {}), "ab", "no repeats in a pool");
});

test("the five levels: right length, every kind of character, only their own symbols", () => {
  for (const l of LEVELS) {
    for (const r of run(150, () => generateChars(level(l.id)))) {
      assert.equal(r.value.length, l.length);
      assert.ok(/[A-Z]/.test(r.value) && /[a-z]/.test(r.value) && /[0-9]/.test(r.value), l.id);
      assert.ok([...r.value].some((c) => l.symbols.includes(c)), `${l.id} has a symbol`);
      assert.ok([...r.value].every((c) => (SETS_ALL + l.symbols).includes(c)), `${l.id} stays in its pool`);
    }
  }
});
const SETS_ALL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

test("strength: a Simple password is about 12 x log2(65), a little less for the one-of-each rule", () => {
  const { bits, poolSize } = generateChars(level("simple"));
  assert.equal(poolSize, 65);
  assert.ok(bits >= 68 && bits <= 72, `bits ${bits}`);
  const free = generateChars({ length: 20, upper: true, lower: true, numbers: false, symbols: "", minPerClass: 0 });
  assert.equal(free.bits, Math.floor(20 * Math.log2(52)), "no rules, no deduction");
});

test("probAtLeast: hand-worked cases", () => {
  assert.ok(Math.abs(probAtLeast([0.5, 0.5], 2, 1) - 0.5) < 1e-12);
  assert.ok(Math.abs(probAtLeast([0.5, 0.5], 3, 1) - 0.75) < 1e-12);
  assert.ok(Math.abs(probAtLeast([0.5, 0.5], 4, 2) - 0.375) < 1e-12);
  assert.equal(probAtLeast([0.5, 0.5], 3, 2), 0, "two of each is impossible in three characters");
  assert.equal(probAtLeast([1], 5, 0), 1);
});

test("custom rules: starts with a letter, no repeats, at least three of each kind", () => {
  const cfg = { length: 24, upper: true, lower: true, numbers: true, symbols: CUSTOM_SYMBOLS, startsWithLetter: true, noRepeat: true, minPerClass: 3 };
  for (const { value } of run(200, () => generateChars(cfg))) {
    assert.ok(/^[A-Za-z]/.test(value), "starts with a letter");
    assert.ok(![...value].some((c, i) => i && c === value[i - 1]), "no adjacent repeat");
    assert.ok((value.match(/[A-Z]/g) || []).length >= 3 && (value.match(/[a-z]/g) || []).length >= 3 && (value.match(/[0-9]/g) || []).length >= 3, "three of each");
    assert.ok([...value].filter((c) => CUSTOM_SYMBOLS.includes(c)).length >= 3, "three symbols, which the reference tool did not check");
  }
});

test("custom rules that are very tight are still met, and the length shrinks the minimum when it must", () => {
  const tight = { length: 12, upper: true, lower: true, numbers: true, symbols: CUSTOM_SYMBOLS, minPerClass: 3 };
  for (const { value } of run(40, () => generateChars(tight))) {
    assert.equal([...value].filter((c) => CUSTOM_SYMBOLS.includes(c)).length >= 3, true);
  }
  const short = generateChars({ length: 4, upper: true, lower: true, numbers: true, symbols: "!", minPerClass: 3 });
  assert.equal(short.value.length, 4, "asking for three of each in four characters just gives one of each");
});

test("filters hold: no look-alikes, nothing a shell dislikes", () => {
  for (const { value } of run(200, () => generateChars(level("complex", { ambiguous: true, cli: true })))) {
    assert.ok(!/[01OIlo|/\\ .:;?"'`$<>&]/.test(value), value);
  }
  assert.deepEqual(classesOf({ upper: true, symbols: "?\"'`$\\|<>& ", filters: { cli: true } }).map((c) => c.id), ["upper"], "a class with nothing left is dropped");
  assert.equal(generateChars({ length: 8, upper: false, lower: false, numbers: false, symbols: "" }).error, "empty-pool");
});

test("every preset makes a password that follows its own rules", () => {
  for (const p of PRESETS) {
    const cfg = { length: p.length, upper: p.upper, lower: p.lower, numbers: p.numbers, symbols: p.symbols ? CUSTOM_SYMBOLS : "", startsWithLetter: p.startsWithLetter, noRepeat: p.noRepeat, minPerClass: p.min3 ? 3 : 0, filters: { cli: p.cli, ambiguous: p.clean } };
    const r = generateChars(cfg);
    assert.equal(r.value.length, p.length, p.id);
    if (p.startsWithLetter) assert.ok(/^[A-Za-z]/.test(r.value), p.id);
    assert.ok(r.bits > 60, `${p.id} ${r.bits}`);
  }
});

test("word pools: the full list, and smaller ones that still reach across the alphabet", () => {
  assert.equal(EFF_WORDS.length, 7776);
  assert.equal(new Set(EFF_WORDS).size, 7776);
  const small = wordPool(EFF_WORDS, 1000);
  assert.equal(small.length, 1000);
  assert.equal(new Set(small).size, 1000);
  assert.ok(small[0] === "abacus" && small[999] > "y", "first and last come from opposite ends of the alphabet");
  assert.equal(wordPool(EFF_WORDS, 7776), EFF_WORDS);
  for (const [role, list] of Object.entries(SYNTAX_WORDS)) assert.equal(new Set(list).size, list.length, `${role} has no repeats`);
});

test("passphrase: strict words from the list, exact strength, word count within the range", () => {
  for (const verbosity of ["default", "extra", "advanced", "maximum"]) {
    const [lo, hi] = VERBOSITY[verbosity];
    for (const r of run(80, () => generatePassphrase({ verbosity, depth: 7776 }, DATA))) {
      const parts = r.value.split(" ");
      assert.ok(parts.length >= lo && parts.length <= hi, `${verbosity}: ${parts.length} words`);
      assert.equal(r.words, parts.length);
      assert.ok(parts.every((w) => EFF_WORDS.includes(w)));
      assert.equal(r.bits, Math.floor(parts.length * Math.log2(7776)));
    }
  }
  const six = run(2000, () => generatePassphrase({ verbosity: "extra", depth: 7776 }, DATA)).find((r) => r.words === 6);
  assert.equal(six.bits, 77, "six words is the EFF's 77-bit recommendation");
});

test("passphrase: a smaller pool means fewer bits per word", () => {
  const r = generatePassphrase({ verbosity: "simple", simpleWords: 4, depth: 1000, separators: ["."] }, DATA);
  assert.equal(r.bits, Math.floor(4 * Math.log2(1000)), "one separator is no choice at all");
  const small = new Set(wordPool(EFF_WORDS, 1000));
  assert.ok(r.value.split(".").every((w) => small.has(w)), "every word comes from the 1,000-word pool");
});

test("passphrase: simple style with several separators and number suffixes counts every choice", () => {
  const r = generatePassphrase({ verbosity: "simple", simpleWords: 3, depth: 7776, separators: ["-", "_", "."], addNumbers: true }, DATA);
  assert.match(r.value, /^[a-z-]+\d\d[-_.][a-z-]+\d\d[-_.][a-z-]+\d\d$/);
  assert.equal(r.bits, Math.floor(3 * Math.log2(7776) + 6 * Math.log2(10) + 2 * Math.log2(3)));
});

test("passphrase: filters take away the space, the look-alike digits and the risky separators", () => {
  const dash = generatePassphrase({ verbosity: "extra", depth: 7776, filters: { cli: true } }, DATA);
  assert.ok(!dash.value.includes(" ") && dash.value.includes("-"), "a dash replaces the space");
  const digits = generatePassphrase({ verbosity: "simple", simpleWords: 2, depth: 7776, addNumbers: true, separators: [".", "-"], filters: { ambiguous: true } }, DATA);
  assert.ok(!/[01.]/.test(digits.value.replace(/[a-z]/gi, "")), "no 0, 1 or full stops");
});

test("passphrase: extra separators and capitals add what they are worth, and nothing more", () => {
  const strict = averagePassphraseBits({ verbosity: "extra", depth: 7776, strict: true }, DATA);
  const r = generatePassphrase({ verbosity: "extra", strict: false, depth: 7776 }, DATA);
  assert.ok(!r.value.includes(" ") && /[-_.]/.test(r.value), "joined by one of - _ .");
  const plain = r.words * Math.log2(7776);
  assert.ok(r.bits > Math.floor(plain) && r.bits < plain + r.words * 0.7 + 1.6 + 1, "a few extra bits");
  assert.ok(strict > 60 && strict < 95);
});

test("passphrase: the sentence style reads subject, verb, object and tallies each pool separately", () => {
  const { subjects, verbs, objects, adjectives, nouns } = SYNTAX_WORDS;
  const r = generatePassphrase({ verbosity: "default", syntax: true, strict: true }, DATA);
  const w = r.value.split(" ");
  assert.ok(subjects.includes(w[0]) && verbs.includes(w[1]) && objects.includes(w[2]), r.value);
  assert.equal(r.bits, Math.floor(Math.log2(subjects.length) + Math.log2(verbs.length) + Math.log2(objects.length) + (w.length === 4 ? Math.log2(nouns.length) : 0)));
  const long = generatePassphrase({ verbosity: "maximum", syntax: true, strict: true }, DATA).value.split(" ");
  assert.ok(adjectives.includes(long[0]) && nouns.includes(long.at(-1)), "adjectives lead and nouns follow");
});

test("strength tiers", () => {
  assert.deepEqual([30, 45, 70, 100, 130].map((b) => tierOf(b).id), ["weak", "fair", "good", "strong", "excellent"]);
  assert.equal(tierOf(40).id, "fair");
  assert.equal(tierOf(112).id, "excellent");
});

test("time to guess: worked out from the bits, at a trillion guesses a second", () => {
  assert.equal(crackTime(40), "less than a second"); // 2^39 / 1e12 = 0.55 s
  assert.equal(crackTime(56), "10 hours"); // 2^55 / 1e12 = 36,029 s
  assert.equal(crackTime(72), "75 years"); // 2^71 / 1e12 = 2.36e9 s
  assert.equal(crackTime(100), "20 billion years");
  assert.equal(crackTime(128), "more than a trillion years");
  assert.equal(crackTime(1500), "more than a trillion years", "huge numbers do not overflow");
  assert.equal(crackTime(60), "7 days"); // 2^59 / 1e12 = 5.76e5 s
  assert.equal(crackTime(64), "4 months");
});

test("export: a plain text list with a header", () => {
  const text = exportText([{ value: "abc", bits: 30 }, { value: "defghij", bits: 90 }], { generated: "2026-10-27T00:00:00Z", type: "Simple", filters: ["non-ambiguous"], extra: ["Length: 12"] });
  const lines = text.split("\n");
  assert.equal(lines[0], "Fair Go PDF, Password Generator export");
  assert.ok(lines.includes("Filters: non-ambiguous") && lines.includes("Length: 12") && lines.includes("Count: 2"));
  assert.ok(lines.includes("001  abc") && lines.includes("002  defghij"));
  assert.ok(lines.includes("     length 7, about 90 bits, strong"));
});
