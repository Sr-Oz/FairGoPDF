// FAQ-only search box. Deliberately separate from the site-wide search
// (search.js): its own index (faq-data.js), its own markup, no shared state and
// no keyboard shortcut, so it can never surface tools or blog posts.
(function faqSearch() {
  const data = window.FAQ_DATA || [];
  const input = document.getElementById("faqSearch");
  const list = document.getElementById("faqResults");
  if (!input || !list || !data.length) return;

  const MAX_RESULTS = 6;
  let active = -1;

  function tokens(query) {
    return query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1)
      .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
  }

  function score(item, toks) {
    const q = item.q.toLowerCase();
    const a = item.a.toLowerCase();
    const c = item.cat.toLowerCase();
    const k = (item.k || "").toLowerCase();
    let total = 0;
    for (const t of toks) {
      let hit = 0;
      if (q.includes(t)) hit += 5;
      if (c.includes(t)) hit += 2;
      if (k.includes(t)) hit += 3;
      if (a.includes(t)) hit += 1;
      if (!hit) return 0;
      total += hit;
    }
    return total;
  }

  function render(results, hasQuery) {
    list.innerHTML = "";
    active = -1;
    if (!hasQuery) {
      close();
      return;
    }
    if (!results.length) {
      const li = document.createElement("li");
      li.className = "faq-results-empty";
      li.innerHTML = 'No matching questions. Try other words, or <a href="/contact/">get in touch</a>.';
      list.appendChild(li);
    } else {
      results.forEach((item, i) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.id = "faqResult" + i;
        const a = document.createElement("a");
        a.href = item.url;
        const t = document.createElement("span");
        t.className = "t";
        t.textContent = item.q;
        const c = document.createElement("span");
        c.className = "c";
        c.textContent = item.cat;
        a.append(t, c);
        li.appendChild(a);
        list.appendChild(li);
      });
    }
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function close() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function run() {
    const toks = tokens(input.value);
    if (!toks.length) return render([], false);
    const results = data
      .map((item, i) => ({ item, i, s: score(item, toks) }))
      .filter((r) => r.s > 0)
      .sort((x, y) => y.s - x.s || x.i - y.i)
      .slice(0, MAX_RESULTS)
      .map((r) => r.item);
    render(results, true);
  }

  function setActive(next) {
    const opts = list.querySelectorAll("[role=option]");
    if (!opts.length) return;
    active = (next + opts.length) % opts.length;
    opts.forEach((o, i) => o.classList.toggle("active", i === active));
    input.setAttribute("aria-activedescendant", opts[active].id);
    opts[active].scrollIntoView({ block: "nearest" });
  }

  input.form.addEventListener("submit", (e) => e.preventDefault());
  input.addEventListener("input", run);
  input.addEventListener("focus", () => { if (input.value.trim()) run(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Enter") {
      const opts = list.querySelectorAll("[role=option] a");
      const target = opts[active] || opts[0];
      if (target) { e.preventDefault(); location.href = target.href; }
    } else if (e.key === "Escape") {
      if (!list.hidden) { close(); } else { input.value = ""; }
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".faq-search")) close();
  });

  document.querySelectorAll("[data-faq-search]").forEach((btn) => {
    btn.addEventListener("click", () => {
      input.value = btn.dataset.faqSearch;
      input.focus();
      run();
    });
  });
})();
