// Shared site-wide behaviors, loaded on every page (not just tool pages):
// theme toggle, mobile nav toggle, back-to-top, scroll progress bar,
// copy-link buttons, the footer year, and the cookie preferences link.
// Every handler no-ops if its target element isn't present on the page.

(function heroHeaderScroll() {
  // Only the homepage has a .hero; everywhere else this is a no-op. See the
  // body:has(.hero) rules in style.css for the transparent-over-video state
  // this toggles away from once scrolled.
  if (!document.querySelector(".hero")) return;
  const THRESHOLD = 80;
  function update() {
    document.body.classList.toggle("scrolled", window.scrollY > THRESHOLD);
  }
  update();
  window.addEventListener("scroll", update, { passive: true });
})();

(function themeToggle() {
  const btn = document.getElementById("themeToggle");
  if (!btn) return;
  const icon = btn.querySelector(".material-symbols-outlined");

  function apply(theme) {
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
      if (icon) icon.textContent = "light_mode";
      btn.setAttribute("aria-label", "Switch to light mode");
    } else {
      document.documentElement.removeAttribute("data-theme");
      if (icon) icon.textContent = "dark_mode";
      btn.setAttribute("aria-label", "Switch to dark mode");
    }
  }

  apply(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

  btn.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const next = isDark ? "light" : "dark";
    apply(next);
    try {
      localStorage.setItem("theme", next);
    } catch (e) {
      /* private browsing / storage disabled — theme just won't persist */
    }
  });
})();

(function navMenu() {
  const btn = document.getElementById("navToggle");
  const nav = document.getElementById("navLinks");
  if (!btn || !nav) return;

  // Marks that JS is driving the nav now, so the CSS can turn it from an
  // always-visible stacked list (the no-JS baseline) into a hamburger-
  // toggled dropdown. See the .nav-links rules in style.css.
  document.documentElement.classList.add("nav-js");

  const index = window.SEARCH_INDEX;

  // The order task-based groups appear in (matching the homepage's own
  // sub-headings) — not the order tools happen to sit in search-data.js,
  // which is roughly creation order.
  const GROUP_ORDER = ["Organise", "Convert", "Edit & Design", "Forms & Signatures", "Protect & Privacy", "Fix & Optimise"];

  // Shorter labels used only in this menu (the tool pages/search keep their full names).
  const MENU_LABELS = {
    "/alternate-mix-pages/": "Alternate & Mix",
    "/pdf-background-colour/": "Background Colour",
    "/combine-pages-into-one/": "Combine Into One",
    "/convert-image/": "Convert Image",
    "/round-corners-image/": "Round Corners",
    "/remove-exif-data/": "Remove Metadata",
    "/colour-palette-generator/": "Colour Palette",
    "/hash-generator/": "Hash / Checksum",
    "/colour-picker/": "Colour Picker",
    "/word-counter/": "Word Counter",
    "/handwriting-worksheets/": "Handwriting Sheets",
  };

  function collapseAllPanels() {
    nav.querySelectorAll(".nav-group-panel.open").forEach((p) => p.classList.remove("open"));
    nav.querySelectorAll('.nav-chevron[aria-expanded="true"]').forEach((c) => c.setAttribute("aria-expanded", "false"));
  }

  // Build one expand/collapse accordion panel per category link (PDF
  // Tools/Image Tools/Utilities), inserted right after its .nav-link-row.
  // Grouped categories (PDF Tools has a `group` on each entry) get a
  // sub-heading per group; ungrouped ones (Image Tools, Utilities, which
  // have no group data yet) just get a flat list — no need to fake columns
  // here the way the old hover fly-out did, this is one scrollable column.
  if (Array.isArray(index)) {
    nav.querySelectorAll(".nav-link-row[data-category]").forEach((row) => {
      const category = row.dataset.category;
      const items = index.filter((e) => e.category === category);
      const chevron = row.querySelector(".nav-chevron");
      if (!items.length || !chevron) return;

      const link = row.querySelector("a");
      const panelId = "navPanel-" + category.replace(/\s+/g, "-");
      const panel = document.createElement("div");
      panel.className = "nav-group-panel";
      panel.id = panelId;

      let groups;
      if (items.some((e) => e.group)) {
        const order = [];
        const byGroup = new Map();
        items.forEach((e) => {
          const g = e.group || "";
          if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g); }
          byGroup.get(g).push(e);
        });
        order.sort((a, b) => {
          const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
          if (ia === -1 && ib === -1) return 0;
          if (ia === -1) return 1;
          if (ib === -1) return -1;
          return ia - ib;
        });
        groups = order.map((g) => ({ title: g || null, items: byGroup.get(g) }));
      } else {
        groups = [{ title: null, items }];
      }

      groups.forEach((group) => {
        if (group.title) {
          const h = document.createElement("div");
          h.className = "nav-subgroup-title";
          h.textContent = group.title;
          panel.appendChild(h);
        }
        group.items.forEach((e) => {
          const a = document.createElement("a");
          a.href = e.url;
          a.textContent = MENU_LABELS[e.url] || e.title;
          panel.appendChild(a);
        });
      });

      const all = document.createElement("a");
      all.href = link.getAttribute("href");
      all.className = "nav-view-all";
      all.textContent = "View all " + link.textContent.trim() + " →";
      panel.appendChild(all);

      row.insertAdjacentElement("afterend", panel);
      chevron.setAttribute("aria-controls", panelId);
      chevron.addEventListener("click", () => {
        const open = panel.classList.toggle("open");
        chevron.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });
  }

  btn.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open) collapseAllPanels();
  });

  nav.addEventListener("click", (e) => {
    if (e.target.tagName === "A") {
      nav.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
      collapseAllPanels();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !nav.classList.contains("open")) return;
    nav.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    collapseAllPanels();
    btn.focus();
  });
})();

(function backToTop() {
  const btn = document.getElementById("backToTop");
  if (!btn) return;

  window.addEventListener(
    "scroll",
    () => {
      btn.classList.toggle("visible", window.scrollY > 480);
    },
    { passive: true }
  );

  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();

(function scrollProgress() {
  const bar = document.getElementById("scrollProgress");
  if (!bar) return;

  function update() {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const pct = scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0;
    bar.style.width = Math.min(100, Math.max(0, pct)) + "%";
  }

  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
})();

(function copyLink() {
  document.querySelectorAll(".copy-link-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const url = window.location.href;
      const label = btn.querySelector(".copy-link-label");
      try {
        await navigator.clipboard.writeText(url);
        if (label) {
          const original = label.textContent;
          label.textContent = "Link copied!";
          setTimeout(() => {
            label.textContent = original;
          }, 2000);
        }
      } catch (e) {
        if (label) label.textContent = "Couldn't copy — copy from the address bar";
      }
    });
  });
})();

(function footerYear() {
  const el = document.getElementById("year");
  if (el) el.textContent = new Date().getFullYear();
})();

(function cookiePreferences() {
  const link = document.getElementById("fgpConsentPrefsLink");
  if (!link) return;
  link.addEventListener("click", (e) => {
    e.preventDefault();
    if (typeof window.reopenConsentBar === "function") window.reopenConsentBar();
  });
})();

(function heroVideoMotion() {
  const video = document.querySelector(".hero-bg-video");
  if (!video) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    video.removeAttribute("autoplay");
    video.pause();
  }
})();

(function scrollReveal() {
  const cards = document.querySelectorAll(".tool-grid .tool-card");
  if (!cards.length || !("IntersectionObserver" in window)) return;

  document.documentElement.classList.add("reveal-ready");

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    cards.forEach((card) => card.classList.add("in-view"));
    return;
  }

  cards.forEach((card, i) => {
    card.style.transitionDelay = `${(i % 4) * 70}ms`;
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in-view");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
  );

  cards.forEach((card) => observer.observe(card));
})();
