/* ABOUT BREAKOUT — pass 1: the measurement harness.
 *
 * The whole idea stands or falls on one trick: never split the bio paragraph
 * into spans. The real <p> stays one clean text node — for crawlers, for
 * copy-paste, for screen readers — and every glyph's true kerned position is
 * measured per character with Range.getClientRects(), so a canvas overlay can
 * erase and redraw individual letters at exactly the coordinates the browser
 * laid them out at.
 *
 * MEASURED FINDING (2026-08-19, the reason for the architecture below): a
 * canvas twin of the paragraph is position-perfect — a sub-pixel offset scan
 * bottoms out at exactly (0,0) — but Canvas2D rasterises glyphs ~13% brighter
 * than Blink rasterises the same font in the DOM (Blink applies a text-gamma
 * / contrast step fillText does not; lit-pixel luminance 151 vs 134 on this
 * page). Position can be made exact; brightness cannot. So the paragraph is
 * NEVER hidden and never redrawn wholesale. The canvas is transparent and
 * empty while idle — zero pixels change on engage, undetectable by
 * construction. A destroyed letter is erased with an opaque patch of the
 * section's own background colour over its measured cell, and its canvas twin
 * only ever appears IN MOTION (falling, or flying home), where a rasteriser
 * difference on a moving, fading glyph is invisible. The one-frame handoff at
 * detach and at landing is the entire exposure.
 *
 * This file is loaded by dynamic import() on demand — it is not on the
 * critical path and must never run anything at import time.
 *
 * Accessibility is the hard constraint, not a feature: the bio is the
 * most-read text on the site, and it stays in the accessible tree at all
 * times — the <p> is never display:none, never visibility:hidden, never
 * aria-hidden; erasing glyphs is pure paint on an aria-hidden canvas above
 * it. Every failure path lands in restore().
 */

const BLEED = 8;  // px of canvas beyond the paragraph, so nothing ever clips
const PAD = 1.25; // px around a letter cell an erase patch also covers: the
                  // antialiasing fringe. Wider would start nicking neighbours.

/** The wall: the second real bio paragraph (the eyebrow is also a <p>). */
function findParagraph() {
  return document.querySelector('.about-copy > p:last-of-type');
}

/* Walk up from the paragraph to the first opaque background-color — the paint
 * an erase patch must be made of. A translucent layer on the way up means no
 * single colour is the truth, and erasing becomes impossible: fail loudly at
 * engage() rather than glitch quietly at first hit. */
function opaqueBackground(el) {
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    const m = c.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
    if (!m) continue;
    const a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (a === 0) continue;      // transparent layer: keep walking
    if (a === 1) return c;      // first opaque colour wins
    return null;                // translucent: composite, no single answer
  }
  return null;
}

/**
 * Measure every visible character of the paragraph into
 * `{ch, x, y, w, h, baseline}` records in viewport coordinates.
 *
 * Measured AFTER document.fonts.ready, always: rects taken against a fallback
 * font are wrong everywhere once the webfont lands, and the failure is
 * invisible on a warm machine. There is no webfont today — the wait is free —
 * but the day one is added, this line is why nothing breaks.
 */
async function measure(p) {
  await document.fonts.ready;

  const cs = getComputedStyle(p);
  // Canvas font shorthand takes no line-height, and canvas ignores it anyway.
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;

  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const fm = probe.measureText('Mg');
  const ascent = fm.fontBoundingBoxAscent;
  const descent = fm.fontBoundingBoxDescent;

  const letters = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue;
    let i = 0;
    for (const ch of text) {            // code points, so a surrogate pair is one glyph
      const len = ch.length;
      if (!/\s/.test(ch)) {
        range.setStart(node, i);
        range.setEnd(node, i + len);
        const r = range.getBoundingClientRect();
        if (r.width > 0) {
          // The rect is the glyph's ADVANCE cell; its INK can overhang it
          // (f, j, y tails). An erase patch must cover the union of both or
          // a destroyed letter leaves its overhang behind as a ghost fringe.
          const im = probe.measureText(ch);
          letters.push({
            ch,
            x: r.left, y: r.top, w: r.width, h: r.height,
            inkLeft: im.actualBoundingBoxLeft, inkRight: im.actualBoundingBoxRight,
            // Centre the font box in the measured rect, then drop to the
            // baseline. When the rect IS the font box (the usual case) this
            // is exactly rect.top + ascent.
            baseline: r.top + (r.height - (ascent + descent)) / 2 + ascent,
          });
        }
      }
      i += len;
    }
  }
  return { letters, font, color: cs.color };
}

/**
 * Build the overlay and hand back the paint primitives the game is made of.
 *
 * The canvas lives INSIDE .about-copy, the paragraph's own parent, so any
 * ancestor transform (the reveal animation, a future parallax) moves both the
 * real text and the overlay identically. Its position is the difference of
 * two boundingClientRects taken in the same frame, so it is correct whatever
 * coordinate space the ancestors put us in.
 *
 * Handle: `letters` (canvas-local coords), `cover(i)` erases letter i,
 * `twin(i, x?, baseline?)` draws its canvas twin (defaults to home position),
 * `clearPaint()` wipes back to fully transparent, `restore()` tears the whole
 * thing down. A frame is: clearPaint → cover every dead letter → draw
 * whatever moves.
 */
export async function engage() {
  const p = findParagraph();
  if (!p || !p.textContent.trim()) throw new Error('bio paragraph not found');
  const parent = p.parentElement;

  const undo = [];
  const setStyle = (el, prop, value) => {
    undo.push([el, prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
    el.style.setProperty(prop, value);
  };

  let canvas = null;
  let engaged = true;
  const restore = () => {
    if (!engaged) return;                 // idempotent: every failure path calls it
    engaged = false;
    window.removeEventListener('resize', restore);
    document.fonts.removeEventListener('loadingdone', onFontSwap);
    if (canvas) canvas.remove();
    for (const [el, prop, val, prio] of undo.reverse()) {
      if (val) el.style.setProperty(prop, val, prio);
      else el.style.removeProperty(prop);
    }
    undo.length = 0;
  };

  // A font that lands mid-game invalidates every rect. The safe answer is the
  // only answer: put the real text back. (A later pass may re-measure and
  // re-engage instead.)
  const onFontSwap = () => restore();

  try {
    // A shaped ligature would be one glyph across two measured characters.
    // Turning ligatures off BEFORE measuring makes the layout we measure and
    // the glyphs we erase/redraw the same thing. (No ligature pairs exist in
    // the bio today, so this changes nothing visible — it is here for the day
    // the text changes.)
    setStyle(p, 'font-variant-ligatures', 'none');

    const { letters, font, color } = await measure(p);
    if (!letters.length) throw new Error('nothing measured');

    const bg = opaqueBackground(p);
    if (!bg) throw new Error('no opaque background behind the bio — cannot erase letters');

    const pRect = p.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    /* The layout puts the paragraph at fractional viewport coordinates
     * (line-height 1.72 alone guarantees it). A canvas element sitting at a
     * fractional device-pixel position is resampled at composite time — every
     * erase patch edge and every drawn glyph goes soft by the same sub-pixel
     * smear. So the canvas's VIEWPORT position is snapped to the device-pixel
     * grid, and the styled offset inside the parent is whatever fraction
     * makes that true. */
    const vLeft = Math.round((pRect.left - BLEED) * dpr) / dpr;
    const vTop = Math.round((pRect.top - BLEED) * dpr) / dpr;
    const w = pRect.width + BLEED * 2;
    const h = pRect.height + BLEED * 2;

    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    setStyle(canvas, 'position', 'absolute');
    setStyle(canvas, 'left', `${vLeft - parentRect.left}px`);
    setStyle(canvas, 'top', `${vTop - parentRect.top}px`);
    setStyle(canvas, 'width', `${w}px`);
    setStyle(canvas, 'height', `${h}px`);
    setStyle(canvas, 'pointer-events', 'none');

    if (getComputedStyle(parent).position === 'static') {
      setStyle(parent, 'position', 'relative');
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Viewport coords → canvas-local. The baseline is snapped to the device
    // grid like Blink snaps its own, so a twin drawn at home sits on the
    // exact pixels the DOM glyph occupied.
    for (const l of letters) {
      l.x -= vLeft;
      l.y -= vTop;
      l.baseline = Math.round(l.baseline * dpr) / dpr - vTop;
    }

    parent.appendChild(canvas);

    window.addEventListener('resize', restore);
    document.fonts.addEventListener('loadingdone', onFontSwap);

    return {
      restore, letters, canvas, ctx, paragraph: p, background: bg, color, font,
      clearPaint() {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      },
      cover(i) {
        const l = letters[i];
        const left = Math.min(l.x, l.x - l.inkLeft) - PAD;
        const right = Math.max(l.x + l.w, l.x + l.inkRight) + PAD;
        ctx.fillStyle = bg;
        ctx.fillRect(left, l.y - PAD, right - left, l.h + PAD * 2);
      },
      twin(i, x = letters[i].x, baseline = letters[i].baseline) {
        ctx.fillStyle = color;
        ctx.fillText(letters[i].ch, x, baseline);
      },
    };
  } catch (err) {
    restore();
    throw err;
  }
}
