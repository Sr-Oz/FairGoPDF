// The settings card's groups as an accordion: one group open at a time, and each closed row says what is chosen in it,
// so every group is on screen at once and nobody has to scroll to find that an option exists.
//
// Markup: <details class="acc" data-key="image" data-empty="All pages"><summary><span class="acc-name">Image</span>
// <span class="acc-value"></span></summary><div class="acc-body">…fields…</div></details>
//
// The words after the name are made from the group's own fields. A page that needs different words for a group calls
// FGPAcc.set("key", (details) => "text"); FGPAcc.refresh() redraws them after the page changes a field by script.
(function () {
  "use strict";
  var custom = {};

  // a field inside something hidden does not count, and a closed group hides all its fields without being "hidden"
  var skipped = function (el) { return !!el.closest('[hidden], [style*="display: none"], [style*="display:none"]'); };

  function labelOf(el) {
    var l = el.id && document.querySelector('label[for="' + el.id + '"]');
    return l ? l.textContent.replace(/\s+/g, " ").trim() : "";
  }

  function generic(d) {
    var parts = [];
    var chosen = d.querySelector('.qr-type[aria-pressed="true"]');
    if (chosen && !skipped(chosen)) parts.push(chosen.textContent.trim());
    d.querySelectorAll("select, input[type=text], input[type=number], input[type=range]").forEach(function (el) {
      if (skipped(el)) return;
      var v;
      if (el.tagName === "SELECT") v = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text.split(",")[0].trim() : ""; // "150 DPI, recommended" is "150 DPI"
      else if (el.type === "range") v = (/\(([^)]*)\)/.exec(labelOf(el)) || [])[1] || el.value; // the label carries the value, such as "Quality (90%)"
      else v = el.value.trim();
      if (!v) return;
      // "None" alone says nothing, so it keeps its label: "Blank pages: none"
      if (el.tagName === "SELECT" && /^(none|nothing|off)$/i.test(v)) v = labelOf(el).replace(/\s*\(.*$/, "") + ": " + v.toLowerCase();
      // "500" followed by "KB" reads better as one thing
      var last = parts.length - 1;
      if (el.tagName === "SELECT" && last >= 0 && /^[\d.,]+$/.test(parts[last]) && v.length <= 4) parts[last] += " " + v;
      else parts.push(v);
    });
    // ticked boxes that have a short name
    var named = Array.prototype.filter.call(d.querySelectorAll("input[type=checkbox][data-short]"), function (b) { return !skipped(b) && b.checked; });
    named.forEach(function (b) { parts.push(b.getAttribute("data-short")); });
    var limit = parseInt(d.getAttribute("data-parts"), 10);
    if (limit) parts = parts.slice(0, limit);
    if (!parts.length && !d.querySelector("input[type=checkbox][data-short]")) {
      var boxes = Array.prototype.filter.call(d.querySelectorAll("input[type=checkbox]"), function (b) { return !skipped(b); });
      if (boxes.length) parts.push(boxes.filter(function (b) { return b.checked; }).length + " of " + boxes.length + " on");
    }
    return parts.filter(function (p, i) { return parts.indexOf(p) === i; }).join(", ");
  }

  function summary(d) {
    var key = d.getAttribute("data-key");
    var text = custom[key] ? custom[key](d) : generic(d);
    return text || d.getAttribute("data-empty") || "";
  }

  function refresh(root) {
    (root || document).querySelectorAll(".acc").forEach(function (d) {
      var out = d.querySelector(".acc-value");
      var text = summary(d);
      if (out && out.textContent !== text) out.textContent = text;
    });
  }

  function init() {
    document.querySelectorAll(".side-settings").forEach(function (card) {
      var rows = card.querySelectorAll(".acc");
      rows.forEach(function (d) {
        // opening one closes the others
        d.addEventListener("toggle", function () {
          if (!d.open) return;
          rows.forEach(function (o) { if (o !== d) o.open = false; });
        });
      });
      ["input", "change", "click"].forEach(function (ev) { card.addEventListener(ev, function () { refresh(card); }); });
    });
    refresh();
    // pages fill in fields as files arrive and settings change by script, which raises no event
    setInterval(function () { if (!document.hidden) refresh(); }, 500);
  }

  window.FGPAcc = { set: function (key, fn) { custom[key] = fn; refresh(); }, refresh: refresh };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
