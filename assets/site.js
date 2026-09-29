// Shared site-wide behaviors, loaded on every page (not just tool pages):
// theme toggle, mobile nav toggle, back-to-top, scroll progress bar,
// copy-link buttons, the footer year, and the cookie preferences link.
// Every handler no-ops if its target element isn't present on the page.

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

(function navToggle() {
  const btn = document.getElementById("navToggle");
  const nav = document.getElementById("navLinks");
  if (!btn || !nav) return;

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
})();

(function navFlyouts() {
  const nav = document.getElementById("navLinks");
  const index = window.SEARCH_INDEX;
  if (!nav || !Array.isArray(index)) return;

  const CATEGORIES = [
    { href: "/#pdf-tools", category: "PDF Tool", label: "PDF Tools" },
    { href: "/#image-tools", category: "Image Tool", label: "Image Tools" },
    { href: "/#utilities", category: "Utility", label: "Utilities" },
  ];

  // The order task-based groups appear in the flyout (and, matching it, the
  // homepage's sub-headings) — not the order tools happen to sit in
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

  // Shared open/close state so moving between top-level items swaps the
  // panel instantly instead of fading two panels over each other.
  let openWrap = null;
  let closeTimer = null;

  const closeWrap = (w) => {
    w.classList.remove("open");
    w.querySelector("a[aria-haspopup]").setAttribute("aria-expanded", "false");
    if (openWrap === w) openWrap = null;
    if (!openWrap) nav.classList.remove("flyouts-warm");
  };

  // Keep each panel on screen: prefer left-anchored, fall back to
  // right-anchored, and if it fits neither (wide panel + centred nav item)
  // pin it 12px from the viewport's right edge. Queries the panels fresh
  // each call (cheap — there are only a few) rather than caching a
  // NodeList, both because none exist yet the first time this is defined
  // and because re-measuring on every open is what actually keeps this
  // correct: a one-off measurement at load can go stale (e.g. webfonts
  // still loading, so a panel's true width isn't known yet).
  const positionPanels = () => {
    const vw = document.documentElement.clientWidth;
    if (!vw) return;
    nav.querySelectorAll(".nav-flyout").forEach((p) => {
      p.classList.remove("nav-flyout--end");
      p.style.left = "";
      p.style.right = "";
      // Set as an explicit px value, recomputed on every call, rather than
      // relying solely on the stylesheet's `max-width: calc(100vw - 24px)`:
      // a shrink-to-fit flex box nested inside an absolutely-positioned
      // parent (which is what the grouped-columns flyout is) doesn't
      // reliably clamp to that under every browser/layout timing, and an
      // unclamped panel is what was overflowing the viewport here.
      p.style.maxWidth = vw - 24 + "px";
      const itemRect = p.closest(".nav-item").getBoundingClientRect();
      const pw = p.offsetWidth;
      if (itemRect.left + pw <= vw - 12) return; // fits left-anchored
      if (itemRect.right - pw >= 12) { // fits right-anchored
        p.classList.add("nav-flyout--end");
        return;
      }
      // Pin the panel's absolute left edge between 12px and (vw - 12 - pw),
      // then express that relative to the item (what `left` is measured
      // from). Clamping the absolute position first, rather than computing
      // the offset directly, is what stops a panel that's nearly as wide as
      // the viewport from being pushed off the left edge when the item
      // itself sits close to it (as "PDF Tools", the first nav item, does).
      const absLeft = Math.max(12, vw - 12 - pw);
      p.style.left = absLeft - itemRect.left + "px";
      p.style.right = "auto";
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

  CATEGORIES.forEach(({ href, category, label }) => {
    const link = nav.querySelector('a[href="' + href + '"]');
    if (!link) return;
    const items = index.filter((e) => e.category === category);
    if (!items.length) return;

    const wrap = document.createElement("div");
    wrap.className = "nav-item has-flyout";
    link.replaceWith(wrap);
    wrap.appendChild(link);
    link.setAttribute("aria-haspopup", "true");
    link.setAttribute("aria-expanded", "false");

    // Where the data tags items with a task-based group (e.g. PDF Tools'
    // Organise/Convert/Edit & Design/...), lay the flyout out as one labelled
    // column per group. Categories with no group data (Image Tools,
    // Utilities) fall back to the old behaviour: split evenly into 2-4
    // anonymous columns of up to ~10 items each, so they're unaffected.
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
        if (ia === -1 && ib === -1) return 0; // neither listed: keep first-encounter order
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
    all.href = href;
    all.className = "nav-flyout-all";
    all.textContent = "View all " + label + " →";
    panel.appendChild(all);
    wrap.appendChild(panel);

    // Hover-intent: open on enter, close on a short delay so the pointer
    // can cross the gap between the trigger and the detached panel, and
    // so moving to an adjacent item swaps the panel rather than closing.
    wrap.addEventListener("mouseenter", () => openMenu(wrap));
    wrap.addEventListener("mouseleave", () => scheduleClose(wrap));
    wrap.addEventListener("focusin", () => openMenu(wrap));
    wrap.addEventListener("focusout", (e) => {
      if (!wrap.contains(e.relatedTarget)) closeWrap(wrap);
    });
  });

  requestAnimationFrame(positionPanels);
  window.addEventListener("resize", positionPanels);
  // A one-off measurement at load can predate webfonts finishing, which
  // shifts panel widths (this bit us directly: the grouped PDF Tools panel
  // came out much wider than the old flat layout, and a stale pre-font
  // measurement left it overflowing the viewport). openMenu() re-measures
  // on every open regardless, so this is just belt-and-braces for the
  // very first open before that's ever run.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(positionPanels);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const active = document.activeElement;
    const openItem = active && active.closest && active.closest(".nav-item.has-flyout");
    if (!openItem) return;
    const trigger = openItem.querySelector("a[aria-haspopup]");
    if (trigger) trigger.focus();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
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
