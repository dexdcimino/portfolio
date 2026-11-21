/* Shared drag and drop for Dex Board cards and list items.
   Pointer based. A dedicated insertion line element shows where the
   item will land, and neighbors ease apart with CSS transforms and
   transitions. No border or outline style is changed on any item at
   any point during a drag, which is what flickered in the mockup.
   Usage: makeSortable(container, { itemSelector, onCommit })
   onCommit receives { order, ids, fromIndex, toIndex, item } where
   order is the array of item elements in their new order and ids is
   the array of their data-id values, falling back to data-tab order
   indexes when an item has no data-id. */

const DRAG_THRESHOLD_PX = 6;

function itemsOf(container, itemSelector) {
  return Array.from(container.querySelectorAll(itemSelector));
}

function isInteractiveTarget(target) {
  if (!target || typeof target.closest !== "function") return false;
  return !!target.closest("button, input, textarea, select, a, [contenteditable], [data-no-drag]");
}

export function makeSortable(container, options) {
  const opts = options || {};
  const itemSelector = opts.itemSelector || "[data-sortable-item]";
  const onCommit = typeof opts.onCommit === "function" ? opts.onCommit : null;

  if (!container) throw new Error("makeSortable needs a container element");

  container.classList.add("board-sortable");

  const line = document.createElement("div");
  line.className = "board-insertion-line";
  line.setAttribute("aria-hidden", "true");
  line.hidden = true;
  container.appendChild(line);

  let destroyed = false;
  let session = null;

  function ensurePositioned() {
    const style = window.getComputedStyle(container);
    if (style.position === "static") container.style.position = "relative";
  }
  ensurePositioned();

  function tagItems() {
    for (const el of itemsOf(container, itemSelector)) {
      el.classList.add("board-dnd-item");
      el.style.touchAction = "none";
    }
  }
  tagItems();

  function clearShifts(except) {
    for (const el of itemsOf(container, itemSelector)) {
      if (el === except) continue;
      el.classList.remove("is-shifting");
      el.style.transform = "";
    }
  }

  function hideLine() {
    line.classList.remove("is-visible");
    line.hidden = true;
  }

  function showLine(horizontal, pos, containerRect) {
    line.hidden = false;
    line.classList.toggle("is-horizontal", horizontal);
    line.classList.toggle("is-vertical", !horizontal);
    if (horizontal) {
      line.style.top = (pos - containerRect.top + container.scrollTop) + "px";
      line.style.left = "";
      line.style.right = "";
      line.style.width = "";
      line.style.height = "";
    } else {
      line.style.left = (pos - containerRect.left + container.scrollLeft) + "px";
      line.style.top = "";
      line.style.bottom = "";
      line.style.width = "";
      line.style.height = "";
    }
    void line.offsetWidth;
    line.classList.add("is-visible");
  }

  function onPointerDown(event) {
    if (destroyed) return;
    if (event.button !== undefined && event.button !== 0) return;
    if (isInteractiveTarget(event.target)) return;
    const item = event.target && typeof event.target.closest === "function"
      ? event.target.closest(itemSelector)
      : null;
    if (!item || !container.contains(item)) return;
    if (item.hasAttribute("data-drag-disabled")) return;

    const items = itemsOf(container, itemSelector);
    const fromIndex = items.indexOf(item);
    if (fromIndex < 0) return;

    session = {
      item,
      items,
      fromIndex,
      toIndex: fromIndex,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      pointerId: event.pointerId,
      horizontal: false,
      itemSize: 0,
      gap: 0,
    };

    try { item.setPointerCapture(event.pointerId); } catch (err) { void err; }
    item.addEventListener("pointermove", onPointerMove);
    item.addEventListener("pointerup", onPointerUp);
    item.addEventListener("pointercancel", onPointerUp);
  }

  function beginDrag() {
    const s = session;
    if (!s || s.active) return;
    s.active = true;
    const rects = s.items.map((el) => el.getBoundingClientRect());
    s.rects = rects;
    const first = rects[0];
    const second = rects[1];
    if (second && Math.abs(second.top - first.top) < Math.min(first.height, second.height) / 2 && Math.abs(second.left - first.left) > 4) {
      s.horizontal = true;
    } else {
      s.horizontal = false;
    }
    const draggedRect = rects[s.fromIndex];
    s.itemSize = s.horizontal ? draggedRect.width : draggedRect.height;
    if (second) {
      const a = rects[s.fromIndex];
      const b = rects[s.fromIndex + 1] || rects[s.fromIndex - 1];
      if (b && a) {
        s.gap = s.horizontal
          ? Math.max(0, Math.abs(b.left - a.left) - s.itemSize)
          : Math.max(0, Math.abs(b.top - a.top) - s.itemSize);
      }
    }
    s.item.classList.add("is-dragging");
  }

  function computeTarget(clientX, clientY) {
    const s = session;
    let target = s.items.length - 1;
    for (let i = 0; i < s.rects.length; i++) {
      if (i === s.fromIndex) continue;
      const r = s.rects[i];
      const center = s.horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
      const pos = s.horizontal ? clientX : clientY;
      if (pos < center) { target = i > s.fromIndex ? i - 1 : i; break; }
      target = i;
    }
    if (clientY !== null && s.rects.length) {
      const last = s.rects[s.rects.length - 1];
      const firstR = s.rects[0];
      const pos = s.horizontal ? clientX : clientY;
      const endEdge = s.horizontal ? last.right : last.bottom;
      const startEdge = s.horizontal ? firstR.left : firstR.top;
      if (pos >= endEdge) target = s.items.length - 1;
      if (pos <= startEdge) target = 0;
    }
    return Math.max(0, Math.min(s.items.length - 1, target));
  }

  function applyPreview(clientX, clientY) {
    const s = session;
    const dx = clientX - s.startX;
    const dy = clientY - s.startY;
    s.item.style.transform = s.horizontal
      ? "translate(" + dx + "px, 0px)"
      : "translate(0px, " + dy + "px)";

    const toIndex = computeTarget(clientX, clientY);
    s.toIndex = toIndex;
    const shift = s.itemSize + s.gap;

    for (let i = 0; i < s.items.length; i++) {
      const el = s.items[i];
      if (el === s.item) continue;
      let offset = 0;
      if (s.fromIndex < toIndex && i > s.fromIndex && i <= toIndex) offset = -shift;
      if (s.fromIndex > toIndex && i < s.fromIndex && i >= toIndex) offset = shift;
      el.classList.add("is-shifting");
      el.style.transform = offset === 0
        ? ""
        : (s.horizontal ? "translate(" + offset + "px, 0px)" : "translate(0px, " + offset + "px)");
    }

    const containerRect = container.getBoundingClientRect();
    let linePos;
    if (toIndex === s.fromIndex) {
      const r = s.rects[s.fromIndex];
      linePos = s.horizontal ? r.left : r.top;
      if (s.horizontal ? (clientX > r.left + r.width / 2) : (clientY > r.top + r.height / 2)) {
        linePos = s.horizontal ? r.right : r.bottom;
      }
    } else if (toIndex < s.fromIndex) {
      const r = s.rects[toIndex];
      linePos = s.horizontal ? r.left - s.gap / 2 : r.top - s.gap / 2;
    } else {
      const r = s.rects[toIndex];
      linePos = s.horizontal ? r.right + s.gap / 2 : r.bottom + s.gap / 2;
    }
    showLine(!s.horizontal, linePos, containerRect);
  }

  function onPointerMove(event) {
    const s = session;
    if (!s || event.pointerId !== s.pointerId) return;
    const dx = event.clientX - s.startX;
    const dy = event.clientY - s.startY;
    if (!s.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      beginDrag();
    }
    event.preventDefault();
    applyPreview(event.clientX, event.clientY);
  }

  function cleanupSession(commit) {
    const s = session;
    if (!s) return;
    const item = s.item;
    item.removeEventListener("pointermove", onPointerMove);
    item.removeEventListener("pointerup", onPointerUp);
    item.removeEventListener("pointercancel", onPointerUp);
    try { item.releasePointerCapture(s.pointerId); } catch (err) { void err; }

    const wasActive = s.active;
    const fromIndex = s.fromIndex;
    const toIndex = s.toIndex;
    item.classList.remove("is-dragging");
    item.style.transform = "";
    clearShifts(item);
    hideLine();
    session = null;

    if (commit && wasActive && toIndex !== fromIndex) {
      const items = itemsOf(container, itemSelector);
      const currentIndex = items.indexOf(item);
      if (currentIndex >= 0) items.splice(currentIndex, 1);
      const clamped = Math.max(0, Math.min(items.length, toIndex > fromIndex ? toIndex : toIndex));
      const reference = items[clamped] || null;
      const insertIndex = reference ? itemsOf(container, itemSelector).indexOf(reference) : -1;
      void insertIndex;
      if (reference) container.insertBefore(item, reference);
      else {
        const lineEl = line;
        if (lineEl && lineEl.parentNode === container) container.insertBefore(item, lineEl);
        else container.appendChild(item);
      }
      if (container.contains(line)) container.appendChild(line);
      const order = itemsOf(container, itemSelector);
      const ids = order.map((el) => el.getAttribute("data-id") || el.id || "");
      if (onCommit) {
        try { onCommit({ order, ids, fromIndex, toIndex, item }); }
        catch (err) { console.warn("board dnd: onCommit threw", err); }
      }
    }
    tagItems();
  }

  function onPointerUp(event) {
    const s = session;
    if (!s || event.pointerId !== s.pointerId) return;
    cleanupSession(true);
  }

  container.addEventListener("pointerdown", onPointerDown);

  return {
    refresh() { tagItems(); },
    destroy() {
      destroyed = true;
      if (session) cleanupSession(false);
      container.removeEventListener("pointerdown", onPointerDown);
      container.classList.remove("board-sortable");
      if (line.parentNode === container) line.remove();
    },
  };
}

export default makeSortable;
