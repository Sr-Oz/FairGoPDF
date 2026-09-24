/* Round carousel: turns each .tool-grid marked with [data-round-carousel] into
   a rotating 3D ring of its tool cards. Progressive enhancement: with no JS, or
   when the visitor prefers reduced motion, the plain grid is left untouched.
   Speed is in on-screen px/s at the front of the ring (so big and small rings
   feel the same); tilt is a small fixed -1.5deg so front cards read as straight.
   Override with data-speed / data-tilt / data-spacing / data-direction. */
(function () {
  "use strict";

  if (!window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  function num(v, fallback) {
    var n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }
  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }
  function wrap(deg) {
    return ((((deg + 180) % 360) + 360) % 360) - 180;
  }

  function init(root) {
    var cards = Array.prototype.filter.call(root.children, function (n) {
      return n.matches("a.tool-card");
    });
    var N = cards.length;
    if (N < 4) return;

    var SPEED = num(root.getAttribute("data-speed"), 55);
    var DIR = root.getAttribute("data-direction") === "right" ? 1 : -1;
    var TILT_ATTR = root.getAttribute("data-tilt");
    var SPACING = num(root.getAttribute("data-spacing"), 1.3);
    var GRIP = 1.2;
    var ANGLE = 360 / N;

    var stage = el("div", "rc");
    stage.setAttribute("role", "group");
    stage.setAttribute("aria-roledescription", "carousel");
    stage.setAttribute("aria-label", root.getAttribute("data-label") || "Tools");
    var ring = el("div", "rc-ring");
    var probe = el("div", "rc-probe");
    probe.setAttribute("aria-hidden", "true");

    var slots = cards.map(function (a) {
      var slot = el("div", "rc-slot");
      var back = a.cloneNode(true);
      var ghost = a.cloneNode(true);
      ghost.className = "tool-card";
      ghost.removeAttribute("href");
      probe.appendChild(ghost);

      a.classList.add("rc-face", "rc-front");
      back.classList.add("rc-face", "rc-back");
      back.setAttribute("aria-hidden", "true");
      back.tabIndex = -1;

      slot.appendChild(a);
      slot.appendChild(back);
      ring.appendChild(slot);
      return slot;
    });
    stage.appendChild(ring);

    root.classList.remove("tool-grid");
    root.classList.add("rc-host");
    root.appendChild(stage);
    root.appendChild(probe);

    var R = 0;
    var tilt = 0;
    var omega = 0;
    var rot = 0;
    var vel = 0;
    var auto = 0;
    var snap = null;
    var hoverPaused = false;
    var focusPaused = false;
    var visible = true;
    var dragging = false;
    var suppressClick = false;
    var press = null;
    var raf = 0;
    var last = 0;

    function apply() {
      ring.style.transform =
        "translateZ(" + -R + "px) rotateX(" + tilt + "deg) rotateY(" + rot + "deg)";
    }

    function layout() {
      var cw = stage.clientWidth < 560 ? 210 : 250;
      probe.style.width = cw + "px";
      var ch = 0;
      Array.prototype.forEach.call(probe.children, function (g) {
        ch = Math.max(ch, g.offsetHeight);
      });
      R = Math.round((cw * SPACING) / (2 * Math.tan(Math.PI / N)));
      omega = ((SPEED / R) * 180) / Math.PI;
      tilt = num(TILT_ATTR, -1.5);
      stage.style.setProperty("--rc-w", cw + "px");
      stage.style.setProperty("--rc-h", ch + "px");
      stage.style.height = Math.round(ch + 150) + "px";
      slots.forEach(function (s, i) {
        s.style.transform = "rotateY(" + i * ANGLE + "deg) translateZ(" + R + "px)";
      });
      apply();
    }

    function frame(now) {
      raf = 0;
      var dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;

      var held = hoverPaused || focusPaused;
      auto += ((held ? 0 : omega * DIR) - auto) * Math.min(1, dt * 3);

      if (!dragging) {
        if (snap !== null) {
          var d = snap - rot;
          rot += d * Math.min(1, dt * 7);
          if (Math.abs(d) < 0.05) {
            rot = snap;
            snap = null;
          }
        } else if (Math.abs(vel) > 0.5) {
          rot += vel * dt;
          vel *= Math.pow(0.03, dt);
        } else {
          vel = 0;
          rot += auto * dt;
        }
      }
      apply();

      var idle =
        held && Math.abs(auto) < 0.01 && snap === null && Math.abs(vel) <= 0.5 && !dragging;
      if (visible && !idle) raf = requestAnimationFrame(frame);
      else last = 0;
    }

    function wake() {
      if (!raf && visible) raf = requestAnimationFrame(frame);
    }

    stage.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      press = { id: e.pointerId, x0: e.clientX, x: e.clientX, t: e.timeStamp };
      vel = 0;
      snap = null;
      wake();
    });

    stage.addEventListener("pointermove", function (e) {
      if (!press || e.pointerId !== press.id) return;
      if (!dragging) {
        if (Math.abs(e.clientX - press.x0) < 6) return;
        dragging = true;
        stage.classList.add("is-dragging");
        try {
          stage.setPointerCapture(e.pointerId);
        } catch (err) {}
        press.x = e.clientX;
        press.t = e.timeStamp;
        return;
      }
      var dt = Math.max((e.timeStamp - press.t) / 1000, 0.008);
      var deg = ((e.clientX - press.x) / R) * (180 / Math.PI) * GRIP;
      rot += deg;
      vel = Math.max(-360, Math.min(360, vel * 0.5 + (deg / dt) * 0.5));
      press.x = e.clientX;
      press.t = e.timeStamp;
      wake();
    });

    function endPress(e) {
      if (!press || e.pointerId !== press.id) return;
      if (dragging) {
        suppressClick = true;
        setTimeout(function () {
          suppressClick = false;
        }, 50);
        try {
          stage.releasePointerCapture(e.pointerId);
        } catch (err) {}
        if (e.timeStamp - press.t > 80) vel = 0;
      }
      dragging = false;
      press = null;
      stage.classList.remove("is-dragging");
      wake();
    }
    stage.addEventListener("pointerup", endPress);
    stage.addEventListener("pointercancel", endPress);

    stage.addEventListener(
      "click",
      function (e) {
        if (suppressClick) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true
    );
    stage.addEventListener("dragstart", function (e) {
      e.preventDefault();
    });

    stage.addEventListener("pointerenter", function (e) {
      if (e.pointerType === "mouse") hoverPaused = true;
    });
    stage.addEventListener("pointerleave", function (e) {
      if (e.pointerType !== "mouse") return;
      hoverPaused = false;
      wake();
    });

    stage.addEventListener("focusin", function (e) {
      var a = e.target.closest && e.target.closest(".rc-front");
      if (!a) return;
      focusPaused = true;
      var keyboard = true;
      try {
        keyboard = a.matches(":focus-visible");
      } catch (err) {}
      if (keyboard) {
        snap = rot + wrap(-cards.indexOf(a) * ANGLE - rot);
        vel = 0;
      }
      wake();
    });
    stage.addEventListener("focusout", function () {
      focusPaused = false;
      wake();
    });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) wake();
      }).observe(stage);
    }

    var resizeTimer;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(layout, 120);
    }
    if ("ResizeObserver" in window) new ResizeObserver(onResize).observe(stage);
    else window.addEventListener("resize", onResize);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

    layout();
    wake();
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-round-carousel]"), init);
})();
