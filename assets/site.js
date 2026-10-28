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

  // Marks that JS is driving the menu now, so the CSS can turn the plain list of links
  // (the no-JS baseline) into the full-screen panel. See the .nav-links rules in style.css.
  document.documentElement.classList.add("nav-js");

  const index = window.SEARCH_INDEX;

  // The order task-based groups appear in a category's panel (matching the
  // homepage's own sub-headings), not the order tools happen to sit in
  // search-data.js, which is roughly creation order.
  const GROUP_ORDER = ["Organise", "Convert", "Fix & Optimise", "Edit & Design", "Forms & Signatures", "Protect & Privacy"];

  // Tool order inside each group: the homepage's popularity order
  // (index.html tile order). Anything not listed sorts to the end, in
  // search-data.js order, so a new tool still appears before it's ranked.
  const NAV_ORDER = [
    "/merge-pdf/", "/split-pdf/", "/organise-pdf/", "/rotate-pdf-freely/", "/crop-pdf/",
    "/resize-pdf-pages/", "/remove-blank-pages/", "/combine-pages-into-one/", "/divide-pdf-pages/",
    "/alternate-mix-pages/", "/n-up-pdf/", "/pdf-booklet/", "/posterise-pdf/", "/pdf-to-word/",
    "/word-to-pdf/", "/images-to-pdf/", "/pdf-to-images/", "/heic-to-pdf/", "/ocr-pdf/", "/pdf-scanner/",
    "/extract-pdf-text/", "/excel-to-pdf/", "/text-to-pdf/", "/extract-pdf-images/", "/markdown-to-pdf/",
    "/csv-to-pdf/", "/rtf-to-pdf/", "/epub-to-pdf/", "/cbz-to-pdf/", "/compress-pdf/", "/repair-pdf/",
    "/compare-pdfs/", "/pdf-accessibility-checker/", "/tag-pdf/", "/pdf-editor/", "/add-page-numbers/",
    "/watermark-pdf/", "/pdf-annotator/", "/pdf-header-footer/", "/add-stamps/", "/add-links-to-pdf/",
    "/pdf-background-colour/", "/pdf-colour-filters/", "/sign-pdf/", "/fill-pdf-form/", "/flatten-pdf/",
    "/pdf-form-builder/", "/protect-pdf/", "/unlock-pdf/", "/redact-pdf/", "/sanitise-pdf/",
    "/pdf-metadata/", "/remove-annotations/", "/compress-image/", "/convert-image/", "/heic-to-jpg/",
    "/resize-image/", "/crop-rotate-image/", "/collage-studio/",
    "/watermark-image/", "/social-media-cropper/", "/remove-exif-data/", "/add-border-to-image/",
    "/round-corners-image/", "/image-colour-filters/", "/colour-palette-generator/", "/qr-code-generator/",
    "/password-generator/", "/word-counter/", "/case-converter/", "/json-formatter/",
    "/convert-to-markdown/", "/read-aloud/", "/colour-picker/", "/hash-generator/", "/uuid-generator/",
    "/ai-writing-checker/", "/calendar-generator/", "/handwriting-worksheets/"
  ];
  const navRank = (e) => {
    const i = NAV_ORDER.indexOf(e.url);
    return i === -1 ? NAV_ORDER.length : i;
  };

  // Shorter labels used only in the menu (the tool pages/search keep their full names).
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

  // Pages that are not tools, listed small under the big rows (the same ones the footer links to).
  const MORE_LINKS = [["FAQ", "/faq/"], ["Support Us", "/support/"], ["Partner With Us", "/partnerships/"], ["Contact Us", "/contact/"]];

  // Wide screens with a mouse: hovering or focusing a row shows its tools beside the rows.
  // A phone, or a touch screen of any width: tapping a row opens its tools under it, like an accordion.
  const accordion = window.matchMedia("(max-width: 899.98px), (hover: none)");
  const wide = window.matchMedia("(min-width: 900px)");

  const entries = []; // { link, panel } for each row that has tools to show
  let active = null;

  const activate = (entry) => {
    active = entry;
    entries.forEach((e) => {
      const on = e === entry;
      e.row.classList.toggle("is-active", on);
      e.link.setAttribute("aria-expanded", String(on));
    });
  };

  // What a fresh open looks like: the first category's tools beside the rows on a wide screen, every row shut otherwise.
  const resetPanels = () => activate(wide.matches && entries.length ? entries[0] : null);

  // The tools of one category as labelled columns: grouped when the index says how (PDF Tools),
  // otherwise one run of links that flows across the columns.
  const buildGroups = (items) => {
    const byGroup = new Map();
    items.forEach((e) => {
      const g = e.group || "";
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(e);
    });
    const order = [...byGroup.keys()].sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return 0;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    const wrap = document.createElement("div");
    wrap.className = "menu-groups";
    order.forEach((g) => {
      const group = document.createElement("div");
      group.className = g ? "menu-group" : "menu-group menu-group--flow";
      if (g) {
        const h = document.createElement("p");
        h.className = "menu-group-title";
        h.textContent = g;
        group.appendChild(h);
      }
      byGroup.get(g).forEach((e) => {
        const a = document.createElement("a");
        a.className = "menu-tool";
        a.href = e.url;
        if (e.icon) {
          const ic = document.createElement("span");
          ic.className = "material-symbols-outlined menu-tool-icon";
          ic.setAttribute("aria-hidden", "true");
          ic.textContent = e.icon;
          a.appendChild(ic);
        }
        a.appendChild(document.createTextNode(MENU_LABELS[e.url] || e.title));
        group.appendChild(a);
      });
      wrap.appendChild(group);
    });
    return wrap;
  };

  // Turn each link already in the nav into a big row; the three tool categories also get a panel of tools,
  // built from SEARCH_INDEX. The links keep their own hrefs, so the markup stays the one source of truth.
  const grid = document.createElement("div");
  grid.className = "menu-grid";
  Array.from(nav.children).forEach((link, n) => {
    if (link.tagName !== "A") return;
    const row = document.createElement("div");
    row.className = "menu-row";
    link.classList.add("menu-link");
    const name = link.textContent.trim();
    const items = Array.isArray(index) && link.dataset.category
      ? index.filter((e) => e.category === link.dataset.category).sort((a, b) => navRank(a) - navRank(b))
      : [];
    row.appendChild(link);
    grid.appendChild(row);
    if (!items.length) return;

    const count = document.createElement("span");
    count.className = "menu-count";
    count.textContent = items.length + " tools";
    link.appendChild(count);

    const panel = document.createElement("div");
    panel.className = "menu-panel";
    panel.id = "menuPanel" + n;
    const all = document.createElement("a");
    all.className = "menu-all";
    all.href = link.getAttribute("href");
    all.textContent = "See all " + name;
    panel.appendChild(all);
    panel.appendChild(buildGroups(items));
    row.appendChild(panel);

    link.setAttribute("aria-expanded", "false");
    link.setAttribute("aria-controls", panel.id);
    const entry = { row, link, panel };
    entries.push(entry);

    const show = () => { if (!accordion.matches) activate(entry); };
    link.addEventListener("mouseenter", show);
    link.addEventListener("focus", show);
    link.addEventListener("click", (e) => {
      if (!accordion.matches) return; // a mouse click follows the link to its section
      e.preventDefault();
      activate(active === entry ? null : entry);
    });
  });

  const more = document.createElement("div");
  more.className = "menu-more";
  MORE_LINKS.forEach(([text, href]) => {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = text;
    more.appendChild(a);
  });
  grid.appendChild(more);
  grid.style.setProperty("--menu-rows", String(grid.querySelectorAll(".menu-link").length + 1)); // the rows and the small links
  nav.appendChild(grid);
  if (!nav.hasAttribute("aria-label")) nav.setAttribute("aria-label", "Main");

  // The toggle is just an icon: the menu bars, then a cross while the panel is open.
  const icon = btn.querySelector(".material-symbols-outlined");

  // Everything but the header goes inert while the panel is up, so neither Tab nor a click reaches the page behind it.
  const header = btn.closest(".site-header");
  const behind = () => Array.from(document.body.children).filter((el) => el !== header && el.tagName !== "SCRIPT");

  let used = false; // false for the first, silent call that sets the closed state
  const setOpen = (open) => {
    if (used) nav.classList.add("anim");
    used = true;
    nav.classList.toggle("open", open);
    document.documentElement.classList.toggle("nav-open", open);
    btn.setAttribute("aria-expanded", String(open));
    btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    if (icon) icon.textContent = open ? "close" : "menu";
    behind().forEach((el) => { el.inert = open; });
    if (open) {
      resetPanels();
      const first = nav.querySelector(".menu-link");
      if (first) first.focus({ preventScroll: true });
    }
  };
  setOpen(false);

  btn.addEventListener("click", () => setOpen(!nav.classList.contains("open")));

  // Following any link in the panel closes it; the next page, or the same page's section, takes over.
  nav.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (a && !e.defaultPrevented) setOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !nav.classList.contains("open")) return;
    setOpen(false);
    btn.focus();
  });

  // Search opens its own overlay on top, so the menu steps aside first.
  const searchBtn = document.getElementById("searchToggle");
  if (searchBtn) searchBtn.addEventListener("click", () => { if (nav.classList.contains("open")) setOpen(false); });

  // Going back to this page from the browser history must not bring the panel back up.
  window.addEventListener("pageshow", () => { if (nav.classList.contains("open")) setOpen(false); });

  // Crossing between the wide and the phone layout starts the panels afresh.
  const onLayoutChange = () => { if (nav.classList.contains("open")) resetPanels(); };
  if (wide.addEventListener) { wide.addEventListener("change", onLayoutChange); accordion.addEventListener("change", onLayoutChange); }
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

// Keep it sorted (keep-sorted.js) leaves a produced file in IndexedDB for 10 minutes. Drop it on any page load once it has
// expired, so a file nobody picked up doesn't linger. Names and the age limit must match keep-sorted.js.
// shortcut: browsers without indexedDB.databases() skip this and rely on the tool pages' own expiry check.
(function expireStash() {
  if (!window.indexedDB || !indexedDB.databases) return;
  indexedDB.databases().then((dbs) => {
    if (!dbs.some((d) => d.name === "fgp-workspace")) return; // opening would create an empty one
    const req = indexedDB.open("fgp-workspace", 1);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("stash")) return db.close();
      const tx = db.transaction("stash", "readwrite");
      const store = tx.objectStore("stash");
      const get = store.get("current");
      get.onsuccess = () => {
        if (get.result && Date.now() - get.result.ts > 10 * 60 * 1000) store.delete("current");
      };
      tx.oncomplete = tx.onerror = tx.onabort = () => db.close();
    };
  }).catch(() => {});
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
        const card = entry.target;
        card.classList.add("in-view");
        // the stagger delay would also hold back the hover tilt; the fade (up to 210 ms delay + 500 ms) is over by then
        setTimeout(() => (card.style.transitionDelay = ""), 800);
        observer.unobserve(card);
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
  );

  cards.forEach((card) => observer.observe(card));
})();

(function premiumShineCards() {
  // Hover effect (glow + flickering tile grid + grid-line accents),
  // scoped to .tool-grid--shine only — currently just the Utilities
  // section, while we try it out. Markup/sizes/delays follow
  // https://codepen.io/aaroniker/pen/yLEPJXj (colours swapped for the
  // site's own --brand token). Built here rather than hand-authored in
  // HTML so a card falls back to the plain .tool-card look if this
  // never runs, and so rolling this out to (or back out of) other
  // sections later is a one-line class change, not an HTML rewrite
  // across every tool card.
  const cards = document.querySelectorAll(".tool-grid--shine .tool-card");
  if (!cards.length) return;

  cards.forEach((card) => {
    const frag = document.createDocumentFragment();

    const shine = document.createElement("span");
    shine.className = "shine";
    shine.setAttribute("aria-hidden", "true");
    frag.appendChild(shine);

    const background = document.createElement("span");
    background.className = "background";
    background.setAttribute("aria-hidden", "true");

    const tiles = document.createElement("span");
    tiles.className = "tiles";
    for (let i = 1; i <= 10; i++) {
      tiles.appendChild(document.createElement("span")).className = `tile tile-${i}`;
    }
    background.appendChild(tiles);

    for (let i = 1; i <= 3; i++) {
      background.appendChild(document.createElement("span")).className = `line line-${i}`;
    }
    frag.appendChild(background);

    card.prepend(frag);
  });
})();

(function toolGroups() {
  // The homepage's tool groups are <details> rows. Fill each row's small preview tags with its first tool names, and open the
  // row a link points at (/#image-tools, /#utilities) so the cards are there when the page lands.
  const groups = document.querySelectorAll("details.tool-group");
  if (!groups.length) return;

  groups.forEach((group) => {
    const tags = group.querySelector(".tool-group-tags");
    if (!tags) return;
    [...group.querySelectorAll(".tool-card h3")].slice(0, 4).forEach((h) => {
      const li = document.createElement("li");
      li.textContent = h.textContent;
      tags.appendChild(li);
    });
  });

  const openFromHash = () => {
    const target = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    const group = target && target.closest("details.tool-group");
    if (group) group.open = true;
  };
  openFromHash();
  window.addEventListener("hashchange", openFromHash);
})();
