// Consent gate for Google Analytics, the only third-party analytics this
// site uses. It doesn't load until the visitor accepts; rejecting is
// remembered the same way accepting is, so the banner doesn't nag on
// every page. See /privacy-policy/ for exactly what it collects. This
// file is intentionally dependency-free so it can run as early as the
// old inline snippet did.
//
// Naming note: deliberately avoids generic "cookie-banner" / "cookie" id
// and class names. Ad blockers with cosmetic-filter lists (Brave
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

  function loadTrackers() {
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
        "<p>We respect your privacy. This site doesn't track you or record your sessions, " +
        "the only thing it optionally uses is Google Analytics, for website improvement purposes only " +
        "(which pages get used, so we know what to fix or build next). Your files are never affected " +
        'either way, they\'re always processed locally on your device. See the ' +
        '<a href="/privacy-policy/">Privacy Policy</a> for details.</p>' +
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
