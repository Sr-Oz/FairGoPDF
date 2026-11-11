// Rule-based AI-writing checker. No AI model, no server call, just wordlists
// and regex patterns adapted from the open-source "no-ai-slop" project
// (https://github.com/petergyang/no-ai-slop, MIT licensed) by Peter Yang.
// A handful of its guidelines (sentence rhythm, metaphor quality, verb strength)
// need a human read and aren't included, they can't be checked mechanically
// without a high false-positive rate.

const PHRASE_RULES = [
  {
    id: "banned-words",
    label: "Banned words",
    hint: "Corporate jargon and hype words, cut outright.",
    phrases: [
      "delve", "foster", "leverage", "utilize", "facilitate", "empower",
      "streamline", "robust", "cutting-edge", "paradigm shift", "game changer",
      "this is huge", "this changes everything", "tapestry", "realm", "beacon",
      "multifaceted", "meticulous", "intricate", "paramount", "transformative",
      "elevate", "embark", "supercharge", "harness", "ever-evolving",
    ],
  },
  {
    id: "empty-adverbs",
    label: "Often-empty adverbs",
    hint: "Usually add nothing, cut unless they carry real emphasis or uncertainty.",
    phrases: [
      "just", "literally", "honestly", "simply", "actually", "truly",
      "fundamentally", "importantly", "crucially", "inherently", "inevitably",
    ],
  },
  {
    id: "filler-phrases",
    label: "Filler phrases",
    hint: "Throat-clearing openers that delay the point.",
    phrases: [
      "it's worth noting", "it's important to note", "at the end of the day",
      "when it comes to", "at its core", "in today's world", "in the age of",
      "in the world of", "the reality is", "the truth is", "in terms of",
      "with regard to", "in order to", "going forward", "in this article",
      "let's dive in",
    ],
  },
  {
    id: "throat-clearing",
    label: "Throat-clearing openers",
    hint: "Cut them and state the point.",
    phrases: [
      "here's the thing", "here's what i mean", "let me be clear",
      "i'll be honest", "the uncomfortable truth is",
    ],
  },
  {
    id: "faux-insight",
    label: "Faux-insight setups",
    hint: "Flatters the writer as the lone expert, cut the setup and let the claim stand alone.",
    phrases: [
      "this is the part most people skip", "what most people get wrong",
      "here's what nobody tells you", "the part everyone misses",
    ],
  },
  {
    id: "importance-puffery",
    label: "Importance puffery",
    hint: "State the fact and let the reader judge whether it matters.",
    phrases: [
      "stands as a testament", "marks a pivotal moment", "plays a vital role",
      "solidifies its position", "underscores its significance",
    ],
  },
  {
    id: "interpretive-metadiscourse",
    label: "Interpretive metadiscourse",
    hint: "Tells the reader what to think instead of showing it.",
    phrases: [
      "that last part matters more than it sounds", "the key point is",
      "as you can see", "this distinction matters", "in other words",
    ],
  },
  {
    id: "weasel-attribution",
    label: "Weasel attribution",
    hint: "Name the source or cut the claim.",
    phrases: [
      "experts agree", "industry reports suggest", "many argue",
      "widely regarded as", "studies show",
    ],
  },
  {
    id: "rhetorical-setups",
    label: "Rhetorical setups",
    hint: "Drop the setup and make the point.",
    phrases: ["what if i told you", "think about it:", "plot twist:"],
  },
];

const CUSTOM_RULES = [
  {
    id: "binary-contrast",
    label: "Binary contrast",
    hint: "“It's not X, it's Y”, state Y directly.",
    regex: /\b\w+\s+(?:is not|isn'?t)\b[^.!?\n]{0,60}?\b(?:it'?s|it is)\b/gi,
  },
  {
    id: "negative-listing",
    label: "Negative listing",
    hint: "“Not a X. Not a Y. A Z.”, just say Z.",
    regex: /\bnot\s+(?:a|an|just)?\s*\w+[.,]\s+not\s+(?:a|an|just)?\s*\w+[.,]/gi,
  },
  {
    id: "dramatic-fragmentation",
    label: "Dramatic fragmentation",
    hint: "Use complete sentences instead of stacked punchy fragments.",
    regex: /(that'?s it\.\s*that'?s the whole thing\.)|(\.\s+And\s+\w+\.\s+And\s+\w+\.)/gi,
  },
  {
    id: "summary-recap",
    label: "Summary-recap endings",
    hint: "The reader was just there, end on the last concrete point instead.",
    regex: /\b(in conclusion|to conclude|overall,|ultimately,)/gi,
  },
  {
    id: "colon-reveal",
    label: "Possible colon reveal",
    hint: "A noun phrase, a colon, then a lowercase dramatic reveal, rewrite as a plain sentence.",
    regex: /[a-zA-Z][^:.\n]{3,40}:\s+[a-z][^.\n]{3,80}/g,
  },
  {
    id: "em-dash",
    label: "Em dashes",
    hint: "Overused as a rhythm crutch, one or two per long draft is plenty.",
    regex: /\s—\s|\w—\w/g,
  },
  {
    id: "formatting-emoji-heading",
    label: "Emoji in headings",
    hint: "Format should follow the content, not decorate it.",
    regex: /^#{1,6}\s.*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}].*$/gmu,
  },
  {
    id: "formatting-mid-bold",
    label: "Mid-sentence bold",
    hint: "Bold sprinkled mid-sentence for emphasis reads as decoration.",
    regex: /\S \*\*[^*]{2,40}\*\* \S/g,
  },
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseToRegex(phrase) {
  const escaped = escapeRegex(phrase).replace(/'/g, "['’]");
  return new RegExp(`\\b${escaped}\\b`, "gi");
}

function collectMatches(text, rule) {
  const matches = [];
  const patterns = rule.phrases ? rule.phrases.map(phraseToRegex) : [rule.regex];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      matches.push({ start: m.index, end: m.index + m[0].length, text: m[0], ruleId: rule.id, label: rule.label, hint: rule.hint });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return matches;
}

function resolveOverlaps(matches) {
  const sorted = [...matches].sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const accepted = [];
  for (const m of sorted) {
    if (!accepted.some((a) => m.start < a.end && a.start < m.end)) accepted.push(m);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

function scanText(text) {
  const allRules = [...PHRASE_RULES, ...CUSTOM_RULES];
  let matches = [];
  for (const rule of allRules) matches = matches.concat(collectMatches(text, rule));
  return resolveOverlaps(matches);
}

function renderHighlighted(text, matches) {
  let html = "";
  let cursor = 0;
  for (const m of matches) {
    html += escapeHtml(text.slice(cursor, m.start));
    html += `<mark class="ai-flag" data-rule="${m.ruleId}" title="${escapeHtml(m.label)}">${escapeHtml(text.slice(m.start, m.end))}</mark>`;
    cursor = m.end;
  }
  html += escapeHtml(text.slice(cursor));
  return html;
}

function groupFindings(matches) {
  const order = [];
  const groups = new Map();
  for (const m of matches) {
    if (!groups.has(m.ruleId)) {
      groups.set(m.ruleId, { label: m.label, hint: m.hint, items: new Map() });
      order.push(m.ruleId);
    }
    const group = groups.get(m.ruleId);
    const key = m.text.toLowerCase();
    group.items.set(key, (group.items.get(key) || 0) + 1);
  }
  return order.map((id) => groups.get(id));
}

function renderFindings(matches) {
  const groups = groupFindings(matches);
  return groups
    .map((g) => {
      const chips = Array.from(g.items.entries())
        .map(([snippet, count]) => `<span class="finding-chip">${escapeHtml(snippet)}${count > 1 ? ` ×${count}` : ""}</span>`)
        .join("");
      return `<div class="finding-group"><h4>${escapeHtml(g.label)} (${Array.from(g.items.values()).reduce((a, b) => a + b, 0)})</h4><p class="hint">${escapeHtml(g.hint)}</p>${chips}</div>`;
    })
    .join("");
}

const inputText = document.getElementById("inputText");
const checkBtn = document.getElementById("checkBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const results = document.getElementById("results");
const summaryBox = document.getElementById("summaryBox");
const highlightedOutput = document.getElementById("highlightedOutput");
const findingsList = document.getElementById("findingsList");

checkBtn.addEventListener("click", () => {
  const text = inputText.value;
  if (!text.trim()) {
    setStatus(statusEl, "Paste some text first.", "error");
    results.style.display = "none";
    return;
  }

  const matches = scanText(text);
  highlightedOutput.innerHTML = renderHighlighted(text, matches);

  if (matches.length === 0) {
    summaryBox.textContent = "Sorted, no flagged patterns found. Doesn't mean it's not AI-written, just that it dodged this checklist.";
    findingsList.innerHTML = "";
  } else {
    const categoryCount = groupFindings(matches).length;
    summaryBox.textContent = `Found ${matches.length} flagged spot${matches.length > 1 ? "s" : ""} across ${categoryCount} categor${categoryCount > 1 ? "ies" : "y"}.`;
    findingsList.innerHTML = renderFindings(matches);
  }

  results.style.display = "block";
  clearStatus(statusEl);
});

clearBtn.addEventListener("click", () => {
  inputText.value = "";
  results.style.display = "none";
  highlightedOutput.innerHTML = "";
  findingsList.innerHTML = "";
  clearStatus(statusEl);
});
