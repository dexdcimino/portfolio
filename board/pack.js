/* Masonry packing for the board's blocks.

   Every .board-grid / .board-grid-dense inside a tab is packed: the blocks
   (.board-card children) are placed absolutely, each in the column that is
   currently shortest, so the canvas has no dead columns and no block is
   stretched to a neighbour's height. Order is kept as far as a masonry can
   keep it (left to right, top down by arrival).

   A block may ask for more width: data-span="2" (two columns), data-span="3",
   or data-span="full". A span never exceeds the columns there are.

   Column count comes from the grid's own width and the minimum column width,
   so the same code fills 1280px and 2560px, and a phone gets one column.
   Heights are re-measured by a ResizeObserver on every block, so a block that
   grows (a row added, "Show all" pressed, an image loaded) pushes the blocks
   under it down on the next frame instead of overlapping them.

   attachPacker(root, { minCol }) watches root for grids appearing or being
   replaced (tab modules re-render with replaceChildren) and returns
   { repack(), setMinCol(px), destroy() }. */

const GAP_FALLBACK = 16;

function gapOf(grid) {
  const v = parseFloat(getComputedStyle(grid).getPropertyValue("--gap"));
  return Number.isFinite(v) ? v : GAP_FALLBACK;
}

function blocksOf(grid) {
  return Array.from(grid.children).filter((c) => c.classList && c.classList.contains("board-card") && !c.hidden && c.style.display !== "none");
}

function spanOf(card, cols) {
  const raw = card.dataset.span;
  if (raw === "full") return cols;
  const n = parseInt(raw, 10);
  return Math.max(1, Math.min(cols, Number.isFinite(n) ? n : 1));
}

export function packGrid(grid, minCol) {
  const width = grid.clientWidth;
  if (!width) return;
  const gap = gapOf(grid);
  const blocks = blocksOf(grid);
  /* Never more columns than there are blocks to fill them: a tab with four
     blocks on a 2560 screen gets four wide columns, not five with one empty. */
  const fit = Math.max(1, Math.floor((width + gap) / (minCol + gap)));
  const want = blocks.reduce((n, b) => n + Math.max(1, parseInt(b.dataset.span, 10) || 1), 0);
  const cols = Math.max(1, Math.min(fit, want || 1));
  const colW = (width - gap * (cols - 1)) / cols;
  grid.classList.add("is-packed");
  /* Hidden blocks (filtered out) take no room. */
  for (const c of Array.from(grid.children)) {
    if (c.classList && c.classList.contains("board-card") && !blocks.includes(c)) { c.style.top = ""; c.style.left = ""; }
  }
  /* Pass 1: widths, so pass 2 reads heights at the final width. */
  const spans = blocks.map((b) => spanOf(b, cols));
  blocks.forEach((b, i) => { b.style.width = (colW * spans[i] + gap * (spans[i] - 1)) + "px"; });
  const heights = blocks.map((b) => b.offsetHeight);
  /* Pass 2: shortest column (or shortest run of columns for a span). */
  const colH = new Array(cols).fill(0);
  blocks.forEach((b, i) => {
    const span = spans[i];
    let best = 0;
    let bestTop = Infinity;
    for (let c = 0; c + span <= cols; c += 1) {
      const top = Math.max(...colH.slice(c, c + span));
      if (top < bestTop - 0.5) { bestTop = top; best = c; }
    }
    b.style.left = (best * (colW + gap)) + "px";
    b.style.top = bestTop + "px";
    for (let c = best; c < best + span; c += 1) colH[c] = bestTop + heights[i] + gap;
  });
  const total = Math.max(0, ...colH) - (blocks.length ? gap : 0);
  grid.style.height = Math.max(0, total) + "px";
  grid.dataset.cols = String(cols);
  /* Only animate moves after the first placement, so a tab never opens with
     its blocks flying in from the corner. */
  if (!grid.classList.contains("is-settled")) requestAnimationFrame(() => grid.classList.add("is-settled"));
}

export function attachPacker(root, options) {
  let minCol = (options && options.minCol) || 340;
  let frame = 0;
  let destroyed = false;
  const watched = new WeakSet();
  const onPacked = options && typeof options.onPacked === "function" ? options.onPacked : null;

  const ro = new ResizeObserver(() => schedule());

  function grids() {
    return Array.from(root.querySelectorAll(".board-grid, .board-grid-dense"));
  }

  function observeAll() {
    for (const g of grids()) {
      if (!watched.has(g)) { watched.add(g); ro.observe(g); }
      for (const b of blocksOf(g)) {
        if (!watched.has(b)) { watched.add(b); ro.observe(b); }
      }
    }
  }

  function repack() {
    frame = 0;
    if (destroyed) return;
    observeAll();
    for (const g of grids()) {
      /* A grid inside a hidden panel has no width; it packs when shown. */
      if (g.offsetParent === null && getComputedStyle(g).position !== "fixed") continue;
      packGrid(g, minCol);
    }
    if (onPacked) onPacked();
  }

  function schedule() {
    if (frame || destroyed) return;
    frame = requestAnimationFrame(repack);
  }

  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "childList") { schedule(); return; }
      if (r.type === "attributes" && r.target.classList && r.target.classList.contains("board-card")) { schedule(); return; }
    }
  });
  mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "data-span"] });
  schedule();

  return {
    repack() { if (frame) cancelAnimationFrame(frame); repack(); },
    schedule,
    setMinCol(px) { if (px && px !== minCol) { minCol = px; schedule(); } },
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
    },
  };
}
