// A list of files as cards (picture, name, detail line, buttons) that can be dragged into a new order. For tools where the
// order of the files matters, such as Merge PDF and Images to PDF. Styles are the .file-cards rules in style.css.
//
// `entries` is the tool's own array of { file, canvas, failed }. It is changed in place (move, remove), then onChange() is
// called so the tool can redraw. canvas is the picture; until it arrives the card shows a spinner, and if `failed` is set
// it shows `icon` instead. `extra(entry)`, if given, returns an element (or null) shown between the name and the buttons, such as
// a box for choosing pages. Depends on tools.js (escapeHtml) being loaded first.

let dragFrom = -1; // index of the card being dragged; -1 when the drag came from outside (a file from the desktop)

export function renderFileCards(listEl, entries, { detail, icon = "picture_as_pdf", extra, onChange }) {
  const move = (from, to) => {
    const [item] = entries.splice(from, 1);
    entries.splice(to, 0, item);
    onChange();
  };
  listEl.innerHTML = "";
  entries.forEach((entry, i) => {
    const f = entry.file;
    const li = document.createElement("li");
    li.draggable = true;
    li.innerHTML = `
      <span class="card-num">${i + 1}</span>
      <div class="card-thumb"></div>
      <div class="card-body"><span class="name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span><span class="meta">${escapeHtml(detail(entry))}</span></div>`;
    const thumb = li.querySelector(".card-thumb");
    if (entry.canvas) thumb.appendChild(entry.canvas);
    else thumb.innerHTML = entry.failed
      ? `<span class="material-symbols-outlined" aria-hidden="true">${icon}</span>`
      : '<span class="card-loading" aria-hidden="true"></span>';

    const more = extra ? extra(entry) : null;
    if (more) {
      li.appendChild(more);
      // a card being dragged would swallow the mouse inside a text box, so it stays put while someone is typing in it
      li.addEventListener("focusin", (e) => { if (e.target.matches("input, textarea")) li.draggable = false; });
      li.addEventListener("focusout", () => { li.draggable = true; });
    }

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const button = (label, text, disabled, onClick) => {
      const b = document.createElement("button");
      b.className = "remove";
      b.textContent = text;
      b.setAttribute("aria-label", `${label} ${f.name}`);
      b.disabled = disabled;
      b.addEventListener("click", onClick);
      actions.appendChild(b);
    };
    button("Move earlier:", "←", i === 0, () => move(i, i - 1));
    button("Move later:", "→", i === entries.length - 1, () => move(i, i + 1));
    button("Remove", "✕", false, () => {
      entries.splice(i, 1);
      onChange();
    });
    li.appendChild(actions);

    li.addEventListener("dragstart", (e) => {
      dragFrom = i;
      li.classList.add("dragging");
      e.dataTransfer.setData("text/plain", String(i)); // Firefox will not start a drag without data
      e.dataTransfer.effectAllowed = "move";
    });
    li.addEventListener("dragend", () => {
      dragFrom = -1;
      listEl.querySelectorAll(".dragging, .drop-before, .drop-after").forEach((el) => el.classList.remove("dragging", "drop-before", "drop-after"));
    });
    li.addEventListener("dragover", (e) => {
      if (dragFrom < 0) return; // a file from the desktop goes to the drop area, not onto a card
      e.preventDefault();
      const rect = li.getBoundingClientRect();
      const before = e.clientX - rect.left < rect.width / 2;
      li.classList.toggle("drop-before", before);
      li.classList.toggle("drop-after", !before);
    });
    li.addEventListener("dragleave", () => li.classList.remove("drop-before", "drop-after"));
    li.addEventListener("drop", (e) => {
      if (dragFrom < 0) return;
      e.preventDefault();
      const rect = li.getBoundingClientRect();
      let to = e.clientX - rect.left < rect.width / 2 ? i : i + 1;
      if (dragFrom < to) to--; // removing the dragged card shifts everything after it
      const from = dragFrom;
      dragFrom = -1;
      if (to !== from) move(from, to);
      else onChange();
    });

    listEl.appendChild(li);
  });
}
