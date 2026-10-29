// Gate for the hidden workbench page. The page's real content is encrypted (AES-256-GCM, key from the passphrase by PBKDF2) and
// sits in #labPayload; nothing readable is in the page until the right passphrase decrypts it, here in the browser.
(function () {
  const form = document.getElementById("labForm");
  const input = document.getElementById("labKey");
  const status = document.getElementById("labStatus");
  const gate = document.getElementById("labGate");
  const root = document.getElementById("labRoot");
  const payload = JSON.parse(document.getElementById("labPayload").textContent);

  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  async function decrypt(passphrase) {
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: bytes(payload.salt), iterations: payload.iter, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(payload.iv) }, key, bytes(payload.ct));
    return new TextDecoder().decode(plain);
  }

  function open(html) {
    gate.remove(); // first, so the page's own ids never clash with the gate's
    root.innerHTML = html;
    // scripts set through innerHTML do not run, so each one is replaced by a fresh copy that does
    root.querySelectorAll("script").forEach((old) => {
      const fresh = document.createElement("script");
      fresh.textContent = old.textContent;
      old.replaceWith(fresh);
    });
  }

  async function attempt(passphrase, quiet) {
    try {
      open(await decrypt(passphrase));
      try { sessionStorage.setItem("lab", passphrase); } catch (e) { /* the tab just asks again next time */ }
    } catch (e) {
      try { sessionStorage.removeItem("lab"); } catch (err) { /* nothing stored */ }
      if (!quiet) {
        status.textContent = "That passphrase did not open this page.";
        status.className = "status-box visible error";
        setTimeout(() => { input.disabled = false; input.focus(); }, 900); // a short pause between guesses
        return;
      }
    }
    input.disabled = false;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    input.disabled = true;
    status.className = "status-box";
    attempt(input.value, false);
  });

  let saved = null;
  try { saved = sessionStorage.getItem("lab"); } catch (e) { /* storage blocked */ }
  if (saved) attempt(saved, true);
})();
