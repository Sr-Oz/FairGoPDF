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
  // always-visible stacked list (the no-JS baseline) into a small
  // hamburger-toggled box. See the .nav-links rules in style.css.
  document.documentElement.classList.add("nav-js");

  const index = window.SEARCH_INDEX;

  // The order task-based groups appear in the fly-out (matching the
  // homepage's own sub-headings) — not the order tools happen to sit in
  // search-data.js, which is roughly creation order.
  const GROUP_ORDER = ["Organise", "Convert", "Edit & Design", "Forms & Signatures", "Protect & Privacy", "Fix & Optimise"];

  // Shorter labels used only in the fly-out (the tool pages/search keep their full names).
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

  // Shared open/close state so moving between rows swaps the panel
  // instantly instead of fading two panels over each other.
  let openWrap = null;
  let closeTimer = null;

  const closeWrap = (w) => {
    w.classList.remove("open");
    w.querySelector("a[aria-haspopup]").setAttribute("aria-expanded", "false");
    if (openWrap === w) openWrap = null;
    if (!openWrap) nav.classList.remove("flyouts-warm");
  };

  // Keep each panel on screen: prefer opening to the row's left (the
  // hamburger box sits at the header's right edge, so that's normally the
  // only side with room), fall back to the right, and clamp vertically too
  // — unlike the old always-visible bar (where every trigger sat on the
  // same row, right under the header), triggers are now stacked rows in a
  // box, so a panel anchored to a lower row can run off the bottom.
  const positionPanels = () => {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (!vw || !vh) return;
    nav.querySelectorAll(".nav-flyout").forEach((p) => {
      p.classList.remove("nav-flyout--end");
      p.style.left = "";
      p.style.right = "";
      p.style.top = "";
      p.style.maxWidth = vw - 24 + "px";
      const itemRect = p.closest(".nav-item").getBoundingClientRect();
      const pw = p.offsetWidth;
      const ph = p.offsetHeight;

      const fitsLeft = itemRect.left - pw - 10 >= 12;
      const fitsRight = itemRect.right + pw + 10 <= vw - 12;
      if (!fitsLeft) {
        // Doesn't fit to the left: open to the right instead.
        p.classList.add("nav-flyout--end");
      }
      if (!fitsLeft && !fitsRight) {
        // Wide panel (e.g. PDF Tools' 6 columns), doesn't fit either side of
        // this small box: clamp it within the viewport instead of letting
        // it run off-screen. Absolute position first, then expressed
        // relative to the item (what left/right are measured from).
        const absLeft = Math.max(12, Math.min(itemRect.left, vw - 12 - pw));
        p.style.left = absLeft - itemRect.left + "px";
        p.style.right = "auto";
      }

      const absTop = Math.max(12, Math.min(itemRect.top, vh - 12 - ph));
      p.style.top = absTop - itemRect.top + "px";
    });
  };

  const openMenu = (w) => {
    clearTimeout(closeTimer);
    if (openWrap && openWrap !== w) {
      // Another menu is already up: drop it now (no fade-out) and keep
      // the nav "warm" so the new panel appears without the slide-in.
      openWrap.classList.remove("open");
      openWrap.querySelector("a[aria-haspopup]").setAttribute("aria-expanded", "false");
    }
    positionPanels();
    nav.classList.add("flyouts-warm");
    w.classList.add("open");
    w.querySelector("a[aria-haspopup]").setAttribute("aria-expanded", "true");
    openWrap = w;
  };

  const scheduleClose = (w) => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => closeWrap(w), 220);
  };

  // Wrap each category row (PDF Tools/Image Tools/Utilities) with its
  // fly-out sub-menu, built from SEARCH_INDEX. Grouped categories (PDF
  // Tools has a `group` on each entry) get one labelled column per group;
  // ungrouped ones (Image Tools, Utilities, no group data yet) split
  // evenly into 2-4 anonymous columns of up to ~10 items, same as before.
  if (Array.isArray(index)) {
    nav.querySelectorAll("a[data-category]").forEach((link) => {
      const category = link.dataset.category;
      const items = index.filter((e) => e.category === category);
      if (!items.length) return;

      const wrap = document.createElement("div");
      wrap.className = "nav-item has-flyout";
      link.replaceWith(wrap);
      wrap.appendChild(link);
      link.setAttribute("aria-haspopup", "true");
      link.setAttribute("aria-expanded", "false");

      let blocks;
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
        blocks = order.map((g) => ({ title: g || null, items: byGroup.get(g) }));
      } else {
        const numCols = Math.min(4, Math.max(2, Math.ceil(items.length / 10)));
        const perCol = Math.ceil(items.length / numCols);
        blocks = [];
        for (let c = 0; c < numCols; c++) {
          blocks.push({ title: null, items: items.slice(c * perCol, c * perCol + perCol) });
        }
      }

      const panel = document.createElement("div");
      panel.className = "nav-flyout";
      const groupsWrap = document.createElement("div");
      groupsWrap.className = "nav-flyout-groups";
      blocks.forEach((block) => {
        if (!block.items.length) return;
        const col = document.createElement("div");
        col.className = "nav-flyout-group";
        if (block.title) {
          const h = document.createElement("div");
          h.className = "nav-flyout-group-title";
          h.textContent = block.title;
          col.appendChild(h);
        }
        block.items.forEach((e) => {
          const a = document.createElement("a");
          a.href = e.url;
          if (e.icon) {
            const ic = document.createElement("span");
            ic.className = "material-symbols-outlined nav-flyout-icon";
            ic.setAttribute("aria-hidden", "true");
            ic.textContent = e.icon;
            a.appendChild(ic);
          }
          a.appendChild(document.createTextNode(MENU_LABELS[e.url] || e.title));
          col.appendChild(a);
        });
        groupsWrap.appendChild(col);
      });
      panel.appendChild(groupsWrap);
      const all = document.createElement("a");
      all.href = link.getAttribute("href");
      all.className = "nav-flyout-all";
      all.textContent = "View all " + link.textContent.trim() + " →";
      panel.appendChild(all);
      wrap.appendChild(panel);

      // Hover-intent: open on enter, close on a short delay so the pointer
      // can cross the gap between the trigger and the detached panel, and
      // so moving to an adjacent row swaps the panel rather than closing.
      wrap.addEventListener("mouseenter", () => openMenu(wrap));
      wrap.addEventListener("mouseleave", () => scheduleClose(wrap));
      wrap.addEventListener("focusin", () => openMenu(wrap));
      wrap.addEventListener("focusout", (e) => {
        if (!wrap.contains(e.relatedTarget)) closeWrap(wrap);
      });
    });

    window.addEventListener("resize", positionPanels);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(positionPanels);
  }

  btn.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });

  nav.addEventListener("click", (e) => {
    if (e.target.tagName === "A") {
      nav.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const active = document.activeElement;
    // Only back out to the trigger when focus is inside the flyout panel
    // itself — if focus is already on the trigger, closest(".nav-item")
    // would match forever and Escape could never reach the nav below.
    const insideFlyout = active && active.closest && active.closest(".nav-flyout");
    if (insideFlyout) {
      const trigger = insideFlyout.closest(".nav-item").querySelector("a[aria-haspopup]");
      if (trigger) trigger.focus();
      return;
    }
    if (nav.classList.contains("open")) {
      nav.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
      btn.focus();
    }
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
