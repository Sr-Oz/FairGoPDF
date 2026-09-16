// Consent gate for the two third-party trackers this site uses (Google
// Analytics, Microsoft Clarity). Neither loads until the visitor accepts;
// rejecting is remembered the same way accepting is, so the banner
// doesn't nag on every page. See /privacy-policy/ for what each tool
// collects. This file is intentionally dependency-free so it can run as
// early as the old inline snippets did.
//
// Naming note: deliberately avoids generic "cookie-banner" / "cookie"
// id and class names. Ad blockers with cosmetic-filter lists (Brave
// Shields' "Block Cookie Consent Notices" among them) target exactly
// those common patterns and will silently hide or dead-click a banner
// that uses them.
(function () {
  "use strict";
  var CONSENT_KEY = "cookieConsent"; // "accepted" | "rejected"

  function getConsent() {
    try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; }
  }
  function setConsent(value) {
    try { localStorage.setItem(CONSENT_KEY, value); } catch (e) {}
  }

  function loadGtag() {
    if (window.__gtagLoaded) return;
    window.__gtagLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", "G-KNCQ0MCB30");
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=G-KNCQ0MCB30";
    document.head.appendChild(s);
  }

  function loadClarity() {
    if (window.__clarityLoaded) return;
    window.__clarityLoaded = true;
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = "https://www.clarity.ms/tag/" + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, "clarity", "script", "yj2448l98c");
  }

  function loadTrackers() {
    loadGtag();
    loadClarity();
  }

  function hideBar() {
    var el = document.getElementById("fgpConsentBar");
    if (el) el.remove();
  }

  function buildBar() {
    if (document.getElementById("fgpConsentBar")) return;
    var wrap = document.createElement("div");
    wrap.className = "fgp-consent-bar";
    wrap.id = "fgpConsentBar";
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Analytics consent");
    wrap.innerHTML =
      '<div class="container fgp-consent-bar-inner">' +
        '<p>This site uses cookies for site analytics (Google Analytics) and session recordings (Microsoft Clarity), ' +
        "so we can see how visitors use FairGo PDF. Your files are never affected either way, they're always processed " +
        'locally on your device. See the <a href="/privacy-policy/">Privacy Policy</a> for what each collects.</p>' +
        '<div class="fgp-consent-bar-actions">' +
          '<button type="button" class="btn secondary small" id="fgpConsentReject">Reject</button>' +
          '<button type="button" class="btn small" id="fgpConsentAccept">Accept</button>' +
        "</div>" +
      "</div>";
    document.body.appendChild(wrap);

    document.getElementById("fgpConsentAccept").addEventListener("click", function () {
      setConsent("accepted");
      hideBar();
      loadTrackers();
    });
    document.getElementById("fgpConsentReject").addEventListener("click", function () {
      setConsent("rejected");
      hideBar();
    });
  }

  function showBar() {
    if (document.body) buildBar();
    else document.addEventListener("DOMContentLoaded", buildBar);
  }

  // Lets a "Cookie Preferences" link (in the footer) reopen the bar so a
  // visitor can change their mind later, in either direction.
  window.reopenConsentBar = showBar;

  var consent = getConsent();
  if (consent === "accepted") loadTrackers();
  else if (consent !== "rejected") showBar();
})();
