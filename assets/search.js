// Site-wide search modal: press "/" or Ctrl/Cmd+K, or click the search icon
// in the header. Filters assets/search-data.js entirely client-side, no
// network request, no backend. Every handler no-ops if its target isn't
// present on the current page.
(function siteSearch() {
  const toggleBtn = document.getElementById("searchToggle");
  const index = window.SEARCH_INDEX || [];
  if (!toggleBtn || !index.length) return;

  let overlay, panel, input, resultsEl, emptyEl;
  let activeIndex = -1;
  let currentResults = [];

  function buildModal() {
    overlay = document.createElement("div");
    overlay.className = "search-overlay";
    overlay.innerHTML = `
      <div class="search-panel" role="dialog" aria-modal="true" aria-label="Search FairGo PDF">
        <div class="search-input-row">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input type="text" id="searchInput" placeholder="Search tools and guides…" autocomplete="off" spellcheck="false">
          <button type="button" class="search-close-btn" aria-label="Close search">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <ul class="search-results" id="searchResults"></ul>
        <p class="search-empty" id="searchEmpty">Type to search ${index.length}+ tools and guides.</p>
      </div>
    `;
    document.body.appendChild(overlay);

    panel = overlay.querySelector(".search-panel");
    input = overlay.querySelector("#searchInput");
    resultsEl = overlay.querySelector("#searchResults");
    emptyEl = overlay.querySelector("#searchEmpty");

    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) closeModal();
    });
    overlay.querySelector(".search-close-btn").addEventListener("click", closeModal);
    input.addEventListener("input", () => runSearch(input.value));
    input.addEventListener("keydown", onInputKeydown);
  }

  function categoryClass(category) {
    return "search-tag search-tag-" + category.toLowerCase().replace(/[^a-z]+/g, "-");
  }

  function runSearch(query) {
    const q = query.trim().toLowerCase();
    activeIndex = -1;

    if (!q) {
      currentResults = [];
      resultsEl.innerHTML = "";
      emptyEl.textContent = `Type to search ${index.length}+ tools and guides.`;
      emptyEl.style.display = "block";
      return;
    }

    const scored = [];
    for (const entry of index) {
      const title = entry.title.toLowerCase();
      const desc = entry.desc.toLowerCase();
      const alt = (entry.alt || "").toLowerCase();
      let score = -1;
      if (title.startsWith(q)) score = 3;
      else if (title.includes(q) || alt.includes(q)) score = 2;
      else if (desc.includes(q) || entry.category.toLowerCase().includes(q)) score = 1;
      if (score > 0) scored.push({ entry, score });
    }
    scored.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
    currentResults = scored.slice(0, 8).map((s) => s.entry);

    if (!currentResults.length) {
      resultsEl.innerHTML = "";
      emptyEl.textContent = `No matches for "${query.trim()}".`;
      emptyEl.style.display = "block";
      return;
    }

    emptyEl.style.display = "none";
    resultsEl.innerHTML = currentResults
      .map(
        (r, i) => `
        <li>
          <a href="${r.url}" class="search-result" data-index="${i}">
            <span class="${categoryClass(r.category)}">${r.category}</span>
            <span class="search-result-body">
              <span class="search-result-title">${escapeHtml(r.title)}</span>
              <span class="search-result-desc">${escapeHtml(r.desc)}</span>
            </span>
          </a>
        </li>`
      )
      .join("");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function setActive(i) {
    const items = resultsEl.querySelectorAll(".search-result");
    items.forEach((el) => el.classList.remove("active"));
    if (i >= 0 && i < items.length) {
      items[i].classList.add("active");
      items[i].scrollIntoView({ block: "nearest" });
    }
    activeIndex = i;
  }

  function onInputKeydown(e) {
    const items = resultsEl.querySelectorAll(".search-result");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length) setActive((activeIndex + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length) setActive((activeIndex - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = activeIndex >= 0 ? currentResults[activeIndex] : currentResults[0];
      if (target) window.location.href = target.url;
    } else if (e.key === "Escape") {
      closeModal();
    }
  }

  function openModal() {
    if (!overlay) buildModal();
    overlay.classList.add("open");
    document.body.classList.add("search-open");
    input.value = "";
    runSearch("");
    setTimeout(() => input.focus(), 0);
  }

  function closeModal() {
    if (!overlay) return;
    overlay.classList.remove("open");
    document.body.classList.remove("search-open");
    input.blur();
  }

  toggleBtn.addEventListener("click", openModal);

  document.addEventListener("keydown", (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    const typing = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;

    if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      openModal();
      return;
    }
    if (e.key === "/" && !typing) {
      e.preventDefault();
      openModal();
      return;
    }
    if (e.key === "Escape" && overlay && overlay.classList.contains("open")) {
      closeModal();
    }
  });
})();
