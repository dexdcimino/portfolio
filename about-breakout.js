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

import { createAudioSettings, buildAudioPanel, createBusGraph }
  from './games/_shared/audio-panel.js';

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
export async function engage({ top, bottom } = {}) {
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

    // `let`, not `const`: the erase colour is re-resolved while the game runs
    // (via refreshBackground below), so a future accent/theme state that
    // repaints under the paragraph updates the patches instead of leaving
    // stale rectangles in the old colour.
    let bg = opaqueBackground(p);
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
    // The caller may extend the box vertically (viewport-Y values) — the game
    // needs the overlay to reach from under the first paragraph down to the
    // ball's floor, not just cover the text.
    const boxTop = top ?? pRect.top - BLEED;
    const boxBottom = bottom ?? pRect.bottom + BLEED;
    const vLeft = Math.round((pRect.left - BLEED) * dpr) / dpr;
    const vTop = Math.round(boxTop * dpr) / dpr;
    const w = pRect.width + BLEED * 2;
    const h = boxBottom - boxTop;

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
      restore, letters, canvas, ctx, paragraph: p, color, font,
      origin: { x: vLeft, y: vTop },   // canvas-local 0,0 in viewport coords at engage time
      get background() { return bg; },
      /* Re-resolve the erase colour against the live computed styles. Returns
       * the colour, or null if the background stopped being a single opaque
       * colour — the caller must treat null as "erasing is no longer
       * possible" and shut down. */
      refreshBackground() {
        bg = opaqueBackground(p);
        return bg;
      },
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

/* ========================================================================
 * PASS 2 — the game: loop, paddle, ball.
 *
 * A twenty-second toy, not a game: no lives, no score, no fail state. The
 * only difficulty is a gentle speed ramp as the wall empties, and the only
 * agency is paddle aim — the bounce angle comes from the contact point,
 * because with nothing to lose, aiming is the whole game.
 * ======================================================================== */

const BALL_R = 5;
const PADDLE_W = 68;
const PADDLE_H = 6;
const BASE_SPEED = 340;      // px/s before the ramp
const RAMP = 0.35;           // full wall cleared -> +35% speed
const PADDLE_SPEED = 560;    // keyboard px/s
const MAX_AIM = 1.05;        // rad from vertical at the paddle's very edge
const MIN_VY = 0.25;         // min |vy| as a fraction of speed: no horizontal skims
const STEP = 4;              // px of ball travel per collision substep
const MIN_TRAVEL = 56;       // px of clear air the ball needs under the bio
const GRAVITY = 1100;        // px/s^2 on a falling letter
const FADE = 0.85;           // s for a falling letter to fade out — always
                             // gone before it lands, so there is no pile-up
                             // and no pile collision to write

/* ---- audio ---------------------------------------------------------------
 * The shared Clayweld panel (games/_shared/audio-panel.js) owns settings,
 * persistence ('about-breakout-audio') and the panel UI; this wires it to a
 * lazily created AudioContext and synthesises the handful of blips the toy
 * needs — no samples, nothing fetched. Sound must never break the game:
 * every entry point swallows its own failures.
 */
function createAudio() {
  let ctx = null;
  let graph = null;
  const settings = createAudioSettings('about-breakout',
    (levels) => graph?.apply(levels));

  const ensure = () => {
    if (!ctx) {
      ctx = new AudioContext();
      graph = createBusGraph(ctx);
      graph.apply({
        master: settings.level('master'),
        music: settings.level('music'),
        fx: settings.level('fx'),
      });
    }
    // Created on the Play click, so this resolves; harness-driven starts
    // without a gesture just stay suspended and the blips are silent no-ops.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  };

  const blip = (freq, dur, { type = 'triangle', peak = 0.5, slideTo = 0 } = {}) => {
    try {
      if (!settings.isOn('master') || !settings.isOn('fx')) return;
      const c = ensure();
      const t = c.currentTime;
      const osc = c.createOscillator();
      const env = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      env.gain.setValueAtTime(peak, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(env).connect(graph.fx);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch { /* no audio is never an error worth surfacing */ }
  };

  return {
    settings,
    // Narrow letters ring higher — the wall plays a scatter of pitches
    // instead of one repeated click.
    letter: (w) => blip(920 - Math.min(16, w) * 22 + Math.random() * 40, 0.09, { peak: 0.45 }),
    paddle: (offset) => blip(200 + 90 * Math.abs(offset), 0.07, { type: 'sine', peak: 0.5 }),
    wall: () => blip(340, 0.045, { type: 'sine', peak: 0.28 }),
    ceiling: () => blip(540, 0.06, { type: 'sine', peak: 0.34 }),
    lost: () => blip(300, 0.22, { type: 'sine', peak: 0.3, slideTo: 120 }),
    mountPanel: (root) => buildAudioPanel(root, settings),
    running: () => (ctx ? ctx.state : 'none'),
    close: () => { try { ctx?.close(); } catch { } ctx = null; graph = null; },
  };
}

/**
 * Can the game be offered here at all? The Play button's gate: a fine
 * pointer, motion allowed, the About layout recognisable, and enough dead
 * space under the bio for the ball to travel in. Cheap enough to re-run on
 * every resize.
 */
export function canPlay() {
  if (!matchMedia('(pointer: fine)').matches) return false;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const p = findParagraph();
  const copy = p?.parentElement;
  if (!copy || !copy.querySelector('h2') || !copy.querySelector('p:not(.eyebrow)')) return false;
  const photo = document.querySelector('.about-photo');
  const sub = document.querySelector('.about-sub');
  const floorY = Math.min(
    photo ? photo.getBoundingClientRect().bottom : Infinity,
    sub ? sub.getBoundingClientRect().top - 10 : Infinity);
  return floorY - p.getBoundingClientRect().bottom >= MIN_TRAVEL;
}

/**
 * Start the game. Engages the overlay, runs the loop, returns a controller
 * with stop() (idempotent — also wired to Escape, to scrolling the section
 * off screen, and to every failure path; engage()'s own resize/font-swap
 * restore is caught by the isConnected check in the frame loop).
 */
export async function start() {
  const copy = findParagraph()?.parentElement;
  if (!copy) throw new Error('about copy not found');
  const h2 = copy.querySelector('h2');
  const p1 = copy.querySelector('p:not(.eyebrow)');
  const photo = document.querySelector('.about-photo');
  if (!h2 || !p1) throw new Error('about layout not recognised');

  /* The playfield, in viewport Y: ceiling just under paragraph one (the ball
   * must never enter it), floor level with the portrait's bottom — that dead
   * space is the ball travel. The floor is hard-capped above the toolkit
   * subsection: at narrow desktop widths the copy column outgrows the
   * portrait and the "dead space" the layout has at 1440+ simply does not
   * exist — the game declines to start rather than play on top of the
   * toolkit (measured 2026-08-19: portrait hangs 65-114px below the bio at
   * 1440-1700, sits ABOVE its bottom at <=1200). */
  const p1Rect = p1.getBoundingClientRect();
  const pRect = findParagraph().getBoundingClientRect();
  const ceilingY = p1Rect.bottom + 2;
  const sub = document.querySelector('.about-sub');
  const subTop = sub ? sub.getBoundingClientRect().top : Infinity;
  const floorY = Math.min(
    photo ? photo.getBoundingClientRect().bottom : Infinity, subTop - 10);
  if (!(floorY - pRect.bottom >= MIN_TRAVEL)) {
    throw new Error('not enough room under the bio for the ball at this layout');
  }

  const h = await engage({ top: ceilingY, bottom: Math.min(floorY + 26, subTop - 8) });

  // Canvas-local playfield bounds.
  const left = pRect.left - h.origin.x;
  const right = left + pRect.width;
  const ceiling = ceilingY - h.origin.y;
  const floor = floorY - h.origin.y;

  const total = h.letters.length;
  const alive = new Array(total).fill(true);
  let destroyed = 0;
  /* A hit letter detaches: covered in the DOM, twinned on the canvas with the
   * ball's momentum, gravity and a little spin, fading out before it can
   * land. Entries: {i, x, y, rot, vx, vy, om, alpha} with x/y the CELL
   * CENTRE. */
  const falling = [];
  const audio = createAudio();

  const paddle = { x: (left + right) / 2, y: floor - 14, w: PADDLE_W, h: PADDLE_H };
  const ball = { x: paddle.x, y: paddle.y - BALL_R - 1, vx: 0, vy: 0, attached: true, timer: 0.5 };
  let launches = 0;
  const events = { paddleHits: 0, ceilingHits: 0, wallHits: 0, respawns: 0, breaks: 0 };
  const state = {
    ball, paddle, alive, events, falling,
    bounds: { left, right, ceiling, floor },
    get destroyed() { return destroyed; }, total,
    running: true, won: false,
  };

  const speed = () => BASE_SPEED * (1 + RAMP * (destroyed / total));

  const root = document.documentElement;
  let accent = getComputedStyle(root).getPropertyValue('--accent').trim() || '#9dff20';
  const h2Color = getComputedStyle(h2).color;

  // One line, and it keeps the ball out of the first paragraph. Throttled:
  // a ball riding the ceiling along the ragged right edge of the wall would
  // otherwise strobe the title several times a second.
  let lastFlash = 0;
  const flashCeiling = () => {
    const now = performance.now();
    if (now - lastFlash < 350) return;
    lastFlash = now;
    h2.animate({ color: [accent, h2Color] }, { duration: 280, easing: 'ease-out' });
  };

  /* ---- input ---------------------------------------------------------- */
  const keys = { left: false, right: false };
  let mouseX = null;                      // canvas-local; last input wins
  const editable = (t) => t && (t.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const onKey = (down) => (e) => {
    if (editable(e.target)) return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { keys.left = down; mouseX = null; }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { keys.right = down; mouseX = null; }
    else if (k === 'Escape' && down) { stop(); return; }
    else return;
    // The arrows must not scroll the page while they steer the paddle.
    if (k.startsWith('Arrow')) e.preventDefault();
  };
  const onKeyDown = onKey(true);
  const onKeyUp = onKey(false);
  const onPointer = (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    mouseX = e.clientX - h.canvas.getBoundingClientRect().left;
  };

  /* ---- physics -------------------------------------------------------- */
  const clampAngle = () => {
    // A bounce that leaves the ball skimming horizontally stalls the game:
    // enforce a minimum vertical component, preserving speed and direction.
    const s = Math.hypot(ball.vx, ball.vy) || 1;
    const min = MIN_VY * s;
    if (Math.abs(ball.vy) < min) {
      ball.vy = (ball.vy < 0 || (ball.vy === 0 && Math.random() < 0.5) ? -1 : 1) * min;
      ball.vx = Math.sign(ball.vx || 1) * Math.sqrt(Math.max(0, s * s - min * min));
    }
  };

  const launch = () => {
    ball.attached = false;
    const a = 0.3 * (launches++ % 2 ? 1 : -1);   // alternate slight angles
    const s = speed();
    ball.vx = s * Math.sin(a);
    ball.vy = -s * Math.cos(a);
  };

  const respawn = () => {
    events.respawns++;
    audio.lost();
    ball.attached = true;
    ball.timer = 0.6;
    ball.vx = ball.vy = 0;
  };

  const collideLetters = () => {
    for (let i = 0; i < total; i++) {
      if (!alive[i]) continue;
      const l = h.letters[i];
      const qx = Math.max(l.x, Math.min(ball.x, l.x + l.w));
      const qy = Math.max(l.y, Math.min(ball.y, l.y + l.h));
      const dx = ball.x - qx, dy = ball.y - qy;
      if (dx * dx + dy * dy > BALL_R * BALL_R) continue;
      alive[i] = false;
      destroyed++;
      events.breaks++;
      falling.push({
        i, x: l.x + l.w / 2, y: l.y + l.h / 2, rot: 0,
        // a fraction of the ball's momentum plus a small upward pop — the
        // letter is knocked off, not dropped
        vx: ball.vx * 0.18 + (Math.random() - 0.5) * 60,
        vy: Math.min(0, ball.vy * 0.15) - 30 - Math.random() * 60,
        om: (Math.random() - 0.5) * 7,
        alpha: 1,
      });
      audio.letter(l.w);
      // Reflect off the shallower penetration axis and push out of it.
      const ox = BALL_R + l.w / 2 - Math.abs(ball.x - (l.x + l.w / 2));
      const oy = BALL_R + l.h / 2 - Math.abs(ball.y - (l.y + l.h / 2));
      if (ox < oy) { ball.vx = -ball.vx; ball.x += Math.sign(dx || ball.vx) * ox; }
      else { ball.vy = -ball.vy; ball.y += Math.sign(dy || ball.vy) * oy; }
      clampAngle();
      return;                              // one brick per substep
    }
  };

  const updateFalling = (dt) => {
    for (let k = falling.length - 1; k >= 0; k--) {
      const f = falling[k];
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += GRAVITY * dt;
      f.rot += f.om * dt;
      f.alpha -= dt / FADE;
      // Faded, fallen out, or drifted out of the canvas: gone. No pile-up.
      if (f.alpha <= 0 || f.y > floor + 30) falling.splice(k, 1);
    }
  };

  const update = (dt) => {
    updateFalling(dt);
    // paddle
    if (mouseX !== null) paddle.x = mouseX;
    else paddle.x += ((keys.right ? 1 : 0) - (keys.left ? 1 : 0)) * PADDLE_SPEED * dt;
    paddle.x = Math.max(left + paddle.w / 2, Math.min(right - paddle.w / 2, paddle.x));

    if (ball.attached) {
      ball.x = paddle.x;
      ball.y = paddle.y - BALL_R - 1;
      ball.timer -= dt;
      if (ball.timer <= 0) launch();
      return;
    }

    // ball, in substeps small enough that no letter cell can be tunnelled
    let dist = Math.hypot(ball.vx, ball.vy) * dt;
    while (dist > 0) {
      const step = Math.min(STEP, dist);
      dist -= step;
      const s = Math.hypot(ball.vx, ball.vy) || 1;
      ball.x += (ball.vx / s) * step;
      ball.y += (ball.vy / s) * step;

      if (ball.x - BALL_R < left) { ball.x = left + BALL_R; ball.vx = Math.abs(ball.vx); events.wallHits++; audio.wall(); clampAngle(); }
      else if (ball.x + BALL_R > right) { ball.x = right - BALL_R; ball.vx = -Math.abs(ball.vx); events.wallHits++; audio.wall(); clampAngle(); }
      if (ball.y - BALL_R < ceiling) {
        ball.y = ceiling + BALL_R; ball.vy = Math.abs(ball.vy);
        events.ceilingHits++; flashCeiling(); audio.ceiling(); clampAngle();
      }

      // paddle: only a descending ball, only from above
      if (ball.vy > 0 &&
          ball.y + BALL_R >= paddle.y && ball.y + BALL_R <= paddle.y + paddle.h + 8 &&
          Math.abs(ball.x - paddle.x) <= paddle.w / 2 + BALL_R) {
        events.paddleHits++;
        const offset = Math.max(-1, Math.min(1, (ball.x - paddle.x) / (paddle.w / 2)));
        audio.paddle(offset);
        const a = offset * MAX_AIM;
        const sp = speed();
        ball.vx = sp * Math.sin(a);
        ball.vy = -sp * Math.cos(a);
        ball.y = paddle.y - BALL_R;
      }

      collideLetters();

      if (ball.y - BALL_R > floor + 22) { respawn(); return; }
    }
  };

  /* ---- render --------------------------------------------------------- */
  let frameCount = 0;
  const render = () => {
    h.clearPaint();
    const ctx = h.ctx;
    for (let i = 0; i < total; i++) if (!alive[i]) h.cover(i);
    for (const f of falling) {
      const l = h.letters[f.i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, f.alpha);
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.fillStyle = h.color;
      // fillText anchors on the baseline; place it relative to the cell
      // centre the twin is rotating around.
      ctx.fillText(l.ch, -l.w / 2, l.baseline - (l.y + l.h / 2));
      ctx.restore();
    }
    ctx.fillStyle = accent;
    const pr = new Path2D();
    pr.roundRect(paddle.x - paddle.w / 2, paddle.y, paddle.w, paddle.h, 3);
    ctx.fill(pr);
    if (!ball.attached || ball.timer < 0.25) {
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  /* ---- lifecycle ------------------------------------------------------ */
  let raf = 0;
  let last = performance.now();

  const io = new IntersectionObserver((entries) => {
    // A half-destroyed bio someone scrolls back to reads as a broken site:
    // leaving the section restores the text, always.
    for (const e of entries) if (!e.isIntersecting) stop();
  }, { threshold: 0 });
  io.observe(copy);

  const stop = () => {
    if (!state.running) return;
    state.running = false;
    cancelAnimationFrame(raf);
    io.disconnect();
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('pointermove', onPointer);
    audio.close();
    h.restore();
  };

  const frame = (now) => {
    try {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      // engage() restores itself on resize and font swap; the canvas leaving
      // the DOM is the one signal that covers every such path.
      if (!h.canvas.isConnected) { stop(); return; }
      if (++frameCount % 20 === 0) {
        if (!h.refreshBackground()) { stop(); return; }   // bg went translucent
        accent = getComputedStyle(root).getPropertyValue('--accent').trim() || accent;
        // A layout shift with no resize event (content above the section
        // growing, a font engage missed) moves the text out from under the
        // measured coordinates. Scroll cancels out — both rects are viewport.
        const cr = h.canvas.getBoundingClientRect();
        const pr = h.paragraph.getBoundingClientRect();
        if (Math.abs(pr.left - cr.left - left) > 1 ||
            Math.abs(pr.top - cr.top - (pRect.top - ceilingY)) > 1) { stop(); return; }
      }
      update(dt);
      if (state.running && destroyed === total) {
        // Pass 4 replaces this with the reassembly payoff; until then the
        // win simply hands the untouched paragraph back.
        state.won = true;
        stop();
        return;
      }
      if (!state.running) return;
      render();
      raf = requestAnimationFrame(frame);
    } catch (err) {
      stop();
      throw err;
    }
  };

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('pointermove', onPointer);
  raf = requestAnimationFrame(frame);

  return { stop, state, handle: h, audio };
}
