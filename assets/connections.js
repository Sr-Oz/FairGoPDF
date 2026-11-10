// Shows, on /connections/, the security policy this page carries and the addresses it actually loaded files from,
// so the claim can be checked without opening developer tools.
(function () {
  const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  const policy = document.getElementById("connCsp");
  if (meta && policy) policy.textContent = meta.content.split(";").map((s) => s.trim()).filter(Boolean).join(";\n");

  const list = document.getElementById("connHosts");
  if (!list) return;
  function show() {
    const hosts = new Set([location.host]);
    performance.getEntriesByType("resource").forEach((e) => {
      try { hosts.add(new URL(e.name).host); } catch (_) {}
    });
    list.textContent = "";
    [...hosts].forEach((h) => {
      const li = document.createElement("li");
      li.textContent = h;
      list.appendChild(li);
    });
  }
  if (document.readyState === "complete") show();
  else window.addEventListener("load", show);
})();
