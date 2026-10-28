// The rules behind the Organise PDF Pages page, kept apart so they can be tested: moving pages around, picking them, and undo.
// Pages are only ever handled here as a list of ids, in page order. No DOM and no PDF library in here.

// Moves the pages in `moving` (a Set of ids) so they sit together, in their current order, just before or after `targetId`.
// Dropping a page on itself, or on another page that is moving too, changes nothing.
export function reorderBlock(order, moving, targetId, after) {
  if (moving.has(targetId) || !order.includes(targetId)) return order;
  const block = order.filter((id) => moving.has(id));
  const rest = order.filter((id) => !moving.has(id));
  const at = rest.indexOf(targetId) + (after ? 1 : 0);
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

// One step earlier (-1) or later (+1) for each chosen page. A group that is already against the edge stays put,
// and pages that are chosen next to each other travel as a group.
export function moveStep(order, ids, delta) {
  const out = [...order];
  if (delta < 0) {
    for (let i = 1; i < out.length; i++) if (ids.has(out[i]) && !ids.has(out[i - 1])) [out[i - 1], out[i]] = [out[i], out[i - 1]];
  } else {
    for (let i = out.length - 2; i >= 0; i--) if (ids.has(out[i]) && !ids.has(out[i + 1])) [out[i + 1], out[i]] = [out[i], out[i + 1]];
  }
  return out;
}

export function moveToEdge(order, ids, toEnd) {
  const block = order.filter((id) => ids.has(id));
  const rest = order.filter((id) => !ids.has(id));
  return toEnd ? [...rest, ...block] : [...block, ...rest];
}

// every page from one id to another, whichever comes first (for shift-click)
export function idsBetween(order, a, b) {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0) return [];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

// kind: all | none | odd | even | invert. Odd and even count by position in the list, since pages move around.
export function pickPages(order, kind, current) {
  const at = (pred) => new Set(order.filter((id, i) => pred(i + 1, id)));
  if (kind === "all") return at(() => true);
  if (kind === "odd") return at((n) => n % 2 === 1);
  if (kind === "even") return at((n) => n % 2 === 0);
  if (kind === "invert") return at((n, id) => !current.has(id));
  return new Set();
}

// puts newIds just after the last chosen page, or at the end when none is chosen
export function insertAfterSelection(order, ids, newIds) {
  let last = -1;
  order.forEach((id, i) => { if (ids.has(id)) last = i; });
  const at = last < 0 ? order.length : last + 1;
  return [...order.slice(0, at), ...newIds, ...order.slice(at)];
}

// a copy of each chosen page straight after it; makeId gives every copy its own id
export function duplicateAfter(order, ids, makeId) {
  const copies = new Map();
  const out = [];
  for (const id of order) {
    out.push(id);
    if (ids.has(id)) {
      const copy = makeId();
      copies.set(id, copy);
      out.push(copy);
    }
  }
  return { order: out, copies };
}

export const turn = (angle, delta) => (((angle + delta) % 360) + 360) % 360;

// Undo and redo over whole states. A state is never changed after it is stored, so keeping many of them is cheap.
export function createHistory(limit = 100) {
  const past = [];
  const future = [];
  return {
    push(state) { past.push(state); if (past.length > limit) past.shift(); future.length = 0; },
    undo(current) { if (!past.length) return null; future.push(current); return past.pop(); },
    redo(current) { if (!future.length) return null; past.push(current); return future.pop(); },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() { past.length = 0; future.length = 0; },
  };
}
