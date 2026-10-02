// "Keep it sorted": lets a visitor carry the file they just produced into the
// next tool instead of downloading and re-uploading it. Everything here stays
// in IndexedDB, same-origin, never transmitted anywhere — this only ever
// moves a file between two pages of this same site inside the visitor's own
// browser. Depends on tools.js (escapeHtml, formatBytes) and
// keep-sorted-data.js being loaded first.

(function () {
  const DB_NAME = "fgp-workspace";
  const STORE_NAME = "stash";
  const STASH_KEY = "current";
  const STASH_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes — stale after this, cleared not shown

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function stashFile(blob, name, kind, fromTool) {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ blob, name, kind, fromTool, ts: Date.now() }, STASH_KEY);
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.error("Keep it sorted: could not stash file", e);
    }
  }

  async function getStash() {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, "readonly");
      const entry = await new Promise((resolve, reject) => {
        const req = tx.objectStore(STORE_NAME).get(STASH_KEY);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (!entry) return null;
      if (Date.now() - entry.ts > STASH_MAX_AGE_MS) {
        await clearStash();
        return null;
      }
      return entry;
    } catch (e) {
      console.error("Keep it sorted: could not read stash", e);
      return null;
    }
  }

  async function clearStash() {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(STASH_KEY);
    } catch (e) {
      console.error("Keep it sorted: could not clear stash", e);
    }
  }

  function pickSuggestions(currentTool, outputKind) {
    const tools = window.KEEP_SORTED_TOOLS || {};
    const curated = (window.KEEP_SORTED_SUGGESTIONS || {})[currentTool];
    const list = curated
      ? curated.slice()
      : (((window.KEEP_SORTED_DEFAULT_POOL || {})[outputKind] || []).map((tool) => ({ tool })));
    return list
      .filter((s) => s.tool !== currentTool && tools[s.tool])
      .slice(0, 4);
  }

  // Call after a tool successfully produces exactly one output file.
  // opts: { currentTool, blob, filename, els: { section, list, resetLink },
  //         relatedSection, onResume(file) }
  async function offer(opts) {
    const { currentTool, blob, filename, els, relatedSection } = opts;
    const meta = (window.KEEP_SORTED_TOOLS || {})[currentTool];
    if (!meta || !meta.outputKind || !els) return;

    const suggestions = pickSuggestions(currentTool, meta.outputKind);
    if (!suggestions.length) return;

    els.list.innerHTML = "";
    suggestions.forEach(({ tool, reason }) => {
      const dest = window.KEEP_SORTED_TOOLS[tool];
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = `/${tool}/`;
      a.className = "keep-sorted-item";
      a.innerHTML = `
        <span class="icon"><span class="material-symbols-outlined" aria-hidden="true">${escapeHtml(dest.icon)}</span></span>
        <span class="label">
          <span class="name">${escapeHtml(dest.title)}</span>
          ${reason ? `<span class="reason">${escapeHtml(reason)}</span>` : ""}
        </span>
        <span class="material-symbols-outlined chevron" aria-hidden="true">chevron_right</span>
      `;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        stashFile(blob, filename, meta.outputKind, currentTool).then(() => {
          window.location.href = a.href;
        });
      });
      li.appendChild(a);
      els.list.appendChild(li);
    });

    els.section.style.display = "block";
    if (relatedSection) relatedSection.style.display = "none";

    if (els.resetLink) {
      els.resetLink.addEventListener("click", (e) => {
        e.preventDefault();
        els.section.style.display = "none";
        if (relatedSection) relatedSection.style.display = "";
      }, { once: true });
    }
  }

  // Call once per tool page, right after the dropzone/fileInput are set up.
  // opts: { currentTool, dropzone, onFiles }
  // Injects a "Continue with <file>?" prompt above the dropzone if a
  // compatible stashed file exists. Fires onFiles([file]) on acceptance,
  // the exact same callback the tool's own drop/choose flow already uses.
  async function init(opts) {
    const { currentTool, dropzone, onFiles } = opts;
    const meta = (window.KEEP_SORTED_TOOLS || {})[currentTool];
    if (!meta || !meta.acceptsKind || !dropzone) return;

    const entry = await getStash();
    if (!entry || entry.kind !== meta.acceptsKind) return;

    const bar = document.createElement("div");
    bar.className = "keep-sorted-resume";
    bar.innerHTML = `
      <span class="material-symbols-outlined" aria-hidden="true">history</span>
      <span class="text">Continue with <strong>${escapeHtml(entry.name)}</strong> (${formatBytes(entry.blob.size)})?</span>
      <button type="button" class="btn small">Use this file</button>
      <button type="button" class="btn secondary small">No thanks</button>
    `;
    dropzone.parentNode.insertBefore(bar, dropzone);

    const [useBtn, noBtn] = bar.querySelectorAll("button");
    useBtn.addEventListener("click", () => {
      const file = new File([entry.blob], entry.name, { type: entry.blob.type });
      clearStash();
      bar.remove();
      onFiles([file]);
    });
    noBtn.addEventListener("click", () => {
      clearStash();
      bar.remove();
    });
  }

  window.KeepSorted = { init, offer, stashFile, getStash, clearStash };
})();
