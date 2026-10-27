// Small helpers for building page elements in code, shared by the tools that draw their own forms (QR Code Generator,
// Password Generator). h("button", { class: "x", onclick: fn, text: "Hi" }, child, child) returns the element.
export function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid) node.append(kid);
  return node;
}

export const icon = (name) => h("span", { class: "material-symbols-outlined", "aria-hidden": "true", text: name });
