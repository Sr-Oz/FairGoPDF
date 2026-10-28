// Blog index: filter the cards by group (Privacy, Industries, PDF guides). Without script every card shows and the filter buttons stay hidden.
(function () {
  const bar = document.querySelector(".blog-filters");
  if (!bar) return;
  const cards = Array.from(document.querySelectorAll(".blog-card"));
  const buttons = Array.from(bar.querySelectorAll(".blog-filter"));
  const status = document.getElementById("blogStatus");
  const groups = buttons.map((b) => b.dataset.group);
  document.documentElement.classList.add("blog-js");

  const show = (group) => {
    let shown = 0;
    cards.forEach((card) => {
      const on = group === "all" || card.dataset.group === group;
      card.hidden = !on;
      if (on) shown++;
    });
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.group === group)));
    status.textContent = group === "all" ? "" : `Showing ${shown} of ${cards.length} guides`;
  };

  const fromHash = () => {
    const h = location.hash.slice(1);
    show(groups.includes(h) ? h : "all");
  };

  bar.addEventListener("click", (e) => {
    const b = e.target.closest(".blog-filter");
    if (!b) return;
    show(b.dataset.group);
    history.replaceState(null, "", b.dataset.group === "all" ? location.pathname : "#" + b.dataset.group); // a filtered view can be shared
  });
  window.addEventListener("hashchange", fromHash);
  fromHash();
})();
