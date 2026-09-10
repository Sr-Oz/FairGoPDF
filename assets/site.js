// Shared site-wide behaviors, loaded on every page (not just tool pages):
// theme toggle, mobile nav toggle, back-to-top, scroll progress bar,
// copy-link buttons, and the footer year. Every handler no-ops if its
// target element isn't present on the current page.

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

    const panel = document.createElement("div");
    panel.className = "nav-flyout";
    // Enough columns that no column exceeds 10 items (so the panel never
    // needs to scroll), clamped to 2..4.
    panel.style.setProperty("--cols", Math.min(4, Math.max(2, Math.ceil(items.length / 10))));
    items.forEach((e) => {
      const a = document.createElement("a");
      a.href = e.url;
      a.textContent = e.title;
      panel.appendChild(a);
    });
    const all = document.createElement("a");
    all.href = href;
    all.className = "nav-flyout-all";
    all.textContent = "View all " + label + " →";
    panel.appendChild(all);
    wrap.appendChild(panel);

    const setExpanded = (v) => link.setAttribute("aria-expanded", v ? "true" : "false");
    wrap.addEventListener("mouseenter", () => setExpanded(true));
    wrap.addEventListener("mouseleave", () => setExpanded(false));
    wrap.addEventListener("focusin", () => setExpanded(true));
    wrap.addEventListener("focusout", (e) => {
      if (!wrap.contains(e.relatedTarget)) setExpanded(false);
    });
  });

  // Keep each panel on screen: prefer left-anchored, fall back to
  // right-anchored, and if it fits neither (wide panel + centred nav
  // item) pin it 12px from the viewport's right edge.
  const panels = nav.querySelectorAll(".nav-flyout");
  const positionPanels = () => {
    const vw = document.documentElement.clientWidth;
    if (!vw) return;
    panels.forEach((p) => {
      p.classList.remove("nav-flyout--end");
      p.style.left = "";
      p.style.right = "";
      const itemRect = p.closest(".nav-item").getBoundingClientRect();
      const pw = p.offsetWidth;
      if (itemRect.left + pw <= vw - 12) return; // fits left-anchored
      if (itemRect.right - pw >= 12) { // fits right-anchored
        p.classList.add("nav-flyout--end");
        return;
      }
      p.style.left = vw - 12 - pw - itemRect.left + "px"; // pin to right edge
      p.style.right = "auto";
    });
  };
  requestAnimationFrame(positionPanels);
  window.addEventListener("resize", positionPanels);

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
