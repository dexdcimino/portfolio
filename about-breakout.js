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

import { createAudioSettings, createBusGraph }
  from './games/_shared/audio-panel.js';

const BLEED = 8;  // px of canvas beyond the paragraph, so nothing ever clips
const PAD = 1.25; // px around a letter cell an erase patch also covers: the
                  // antialiasing fringe. Wider would start nicking neighbours.

/** Anchor paragraph (the second one): background walks and drift checks. */
function findParagraph() {
  return document.querySelector('.about-copy > p:last-of-type');
}

/** The wall: BOTH real bio paragraphs, in reading order (the eyebrow is
 * also a <p> and is not part of the game). */
function findWall() {
  return [...document.querySelectorAll('.about-copy > p:not(.eyebrow)')];
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
async function measure(paras) {
  await document.fonts.ready;

  // Both paragraphs share the same rules; the first one's computed style is
  // everyone's computed style.
  const cs = getComputedStyle(paras[0]);
  // Canvas font shorthand takes no line-height, and canvas ignores it anyway.
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;

  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const fm = probe.measureText('Mg');
  const ascent = fm.fontBoundingBoxAscent;
  const descent = fm.fontBoundingBoxDescent;

  const letters = [];
  const range = document.createRange();
  for (const p of paras) {
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
  }
  return { letters, font, color: cs.color, fontFamily: cs.fontFamily };
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
  const wall = findWall();
  if (!p || !wall.length || !p.textContent.trim()) throw new Error('bio paragraphs not found');
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
    for (const para of wall) setStyle(para, 'font-variant-ligatures', 'none');

    const { letters, font, color, fontFamily } = await measure(wall);
    if (!letters.length) throw new Error('nothing measured');

    // `let`, not `const`: the erase colour is re-resolved while the game runs
    // (via refreshBackground below), so a future accent/theme state that
    // repaints under the paragraph updates the patches instead of leaving
    // stale rectangles in the old colour.
    let bg = opaqueBackground(p);
    if (!bg) throw new Error('no opaque background behind the bio — cannot erase letters');

    // The box spans the union of both wall paragraphs (same column, so this
    // is really "p1's top to p2's bottom" plus the caller's extensions).
    const rects = wall.map((el) => el.getBoundingClientRect());
    const pRect = {
      left: Math.min(...rects.map((r) => r.left)),
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
      width: Math.max(...rects.map((r) => r.width)),
    };
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
      restore, letters, canvas, ctx, paragraph: p, color, font, fontFamily,
      size: { w, h },                  // canvas box in CSS px
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
const BALL_R_MAX = 11;       // radius at a fully cleared wall
const FATTEN_AT = 0.6;       // progress where the ball starts growing. The
                             // end-game is hunting scattered survivors, and
                             // that tail is what made a full clear take
                             // minutes: a fatter ball sweeps wider channels,
                             // rewards progress visibly, and keeps ONE ball —
                             // a second one would double the physics for a
                             // toy that should not have any more of it.
const PADDLE_W = 68;
const PADDLE_H = 6;
const BASE_SPEED = 340;      // px/s before the ramp
const RAMP = 0.55;           // full wall cleared -> +55% speed. Steeper than
                             // pass 4's 0.35 because BOTH paragraphs are the
                             // wall now — more bricks earn pace, not fewer
                             // letters
const PADDLE_SPEED = 560;    // keyboard px/s
const MAX_AIM = 1.05;        // rad from vertical at the paddle's very edge

/* `Path2D.roundRect` is Safari 16.4 and Firefox 112, and an engine without it
   does not draw square corners — it THROWS, out of the middle of the draw, so
   the paddle, the ball, the bomb and the veil all vanish together and the toy
   reads as broken rather than as unrounded. One helper so the fallback is in
   one place; a plain rect is the right degradation, since the rounding is the
   only thing being given up. */
const CAN_ROUND = typeof Path2D !== 'undefined'
  && typeof Path2D.prototype.roundRect === 'function';
function roundedRect(path, x, y, w, h, r) {
  if (CAN_ROUND) path.roundRect(x, y, w, h, r);
  else path.rect(x, y, w, h);
}
const MIN_VY = 0.25;         // min |vy| as a fraction of speed: no horizontal skims
const STEP = 4;              // px of ball travel per collision substep
const MIN_TRAVEL = 56;       // px of clear air the ball needs under the bio
const SECOND_BALL_AT = 0.15; // progress where the second ball joins (max two).
                             // 0.3 for one round; the back half of a run was
                             // already the easy half by the time it arrived
                             // (Dex, 2026-08-26)
const DROP_EVERY = 0.05;     // a bomb drop falls every 5% of letters cleared
const DROP_SPEED = 130;      // px/s — readable, catchable
const DROP_SIZE = 13;        // the flashing drop's edge
const BOMB_RADIUS = 52;      // px around an armed hit that goes up with it
/* The other two powerups, both ONE-SHOTS at a fixed mark rather than on the
 * bomb's rolling schedule: the turret is the thing you get, and rapid fire is
 * the thing that makes it matter twice. Only one drop is ever in flight, so
 * these take priority over a bomb when the marks collide — the rare one
 * should not be the one that waits. */
const TURRET_AT = 0.10;      // progress where the turret drop falls, once
const RAPID_AT = [0.5, 0.95];// and the two rapid-fire drops, once each
const TURRET_PERIOD = 1.0;   // s between volleys; rapid divides it by 1+rapid,
                             // so the three rates are 1x, 2x and 3x
const BULLET_SPEED = 620;    // px/s, straight up
const BULLET_W = 3;
const BULLET_H = 9;
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
  // First-run music level is the shared default of 30% — the round-two 50%
  // seed proved loud in place, and 30 needs no override at all. A stored
  // preference always wins, exactly as createAudioSettings already works.
  const settings = createAudioSettings('about-breakout',
    (levels) => graph?.apply(levels));

  // Whether the GAME asked for silence (pause): a scheduled note landing
  // mid-pause must not resume the context the pause just suspended.
  let gamePaused = false;
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
    if (ctx.state === 'suspended' && !gamePaused) ctx.resume().catch(() => {});
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

  /* ---- music: Juhani Junkala's Title Screen chiptune (CC0 — see
   * assets/audio/CREDITS.md) ----
   * A WebAudio buffer loop rather than an <audio> element: loopStart/loopEnd
   * are set past the MP3 encoder's padding silence, which is the only way a
   * compressed loop is actually seamless, and it decodes everywhere (Safari
   * cannot decode ogg-vorbis). Fetched on first start — nothing loads before
   * the first click. Pause is ctx.suspend(): the whole toy goes quiet and
   * resumes mid-note, which is what "paused" should sound like. */
  let musicBuffer = null;
  let musicSource = null;
  let musicOn = false;
  const trimPoints = (buf) => {
    const d = buf.getChannelData(0);
    const EPS = 1e-3;
    let a = 0, b = d.length - 1;
    while (a < b && Math.abs(d[a]) < EPS) a++;
    while (b > a && Math.abs(d[b]) < EPS) b--;
    return { start: a / buf.sampleRate, end: (b + 1) / buf.sampleRate };
  };
  const startMusic = async () => {
    try {
      const c = ensure();
      if (!musicBuffer) {
        const res = await fetch('assets/audio/breakout-loop.mp3');
        musicBuffer = await c.decodeAudioData(await res.arrayBuffer());
      }
      if (musicSource || !musicOn) return;   // stopped while fetching
      const { start, end } = trimPoints(musicBuffer);
      musicSource = c.createBufferSource();
      musicSource.buffer = musicBuffer;
      musicSource.loop = true;
      musicSource.loopStart = start;
      musicSource.loopEnd = end;
      musicSource.connect(graph.music);
      musicSource.start(0, start);
    } catch { musicSource = null; /* a silent game is still a game */ }
  };

  // With two balls live the letter blips arrive twice as fast; a short
  // refractory window keeps a burst reading as distinct pitched hits
  // instead of a rattle. Walls, paddle and the rest stay untouched.
  let lastLetterBlip = 0;
  const letterBlip = (w) => {
    const now = performance.now();
    if (now - lastLetterBlip < 35) return;
    lastLetterBlip = now;
    blip(920 - Math.min(16, w) * 22 + Math.random() * 40, 0.09, { peak: 0.45 });
  };

  return {
    settings,
    music: {
      start() { if (!musicOn) { musicOn = true; startMusic(); } },
      stop() {
        musicOn = false;
        try { musicSource?.stop(); } catch { }
        try { musicSource?.disconnect(); } catch { }
        musicSource = null;
      },
      // "Playing" in the MediaBus sense: a live loop in a running context.
      get playing() { return musicOn && !!ctx && ctx.state === 'running'; },
      // Loop points, for the harness: seamless means a real trimmed window.
      get loop() {
        return musicSource
          ? { start: musicSource.loopStart, end: musicSource.loopEnd }
          : null;
      },
    },
    // The paused world: everything through the one context stops mid-note.
    pauseAll: () => { gamePaused = true; try { ctx?.suspend(); } catch { } },
    resumeAll: () => { gamePaused = false; try { ctx?.resume(); } catch { } },
    // Narrow letters ring higher — the wall plays a scatter of pitches
    // instead of one repeated click.
    letter: letterBlip,
    paddle: (offset) => blip(200 + 90 * Math.abs(offset), 0.07, { type: 'sine', peak: 0.5 }),
    wall: () => blip(340, 0.045, { type: 'sine', peak: 0.28 }),
    ceiling: () => blip(540, 0.06, { type: 'sine', peak: 0.34 }),
    lost: () => blip(300, 0.22, { type: 'sine', peak: 0.3, slideTo: 120 }),
    /* The victory: synthesised, not sourced — same voice and bus as every
     * other sound the toy makes, so it sits WITH the game's language
     * instead of fighting it, needs no file and no fetch. A rising run,
     * three chord stabs landing on a held chord, then a sparkle tail that
     * rings over the letters flying home (~4s, the reassembly's length). */
    win: () => {
      [440, 554, 660, 880].forEach((f, i) =>
        setTimeout(() => blip(f, 0.11, { peak: 0.38 }), i * 85));
      [0, 210, 420].forEach((d, k) => setTimeout(() => {
        const dur = k === 2 ? 0.6 : 0.14;
        blip(440, dur, { peak: 0.22 });
        blip(554, dur, { peak: 0.22 });
        blip(660, dur, { peak: 0.22 });
        if (k === 2) blip(880, 0.7, { peak: 0.28 });
      }, 430 + d));
      const sparkle = [1108, 1318, 1760, 1318];
      for (let i = 0; i < 12; i++) {
        setTimeout(() => blip(sparkle[i % 4] + Math.random() * 30, 0.09, { peak: 0.15 }),
          1450 + i * 210);
      }
    },
    // Bomb pickup: a bright little two-note "got it".
    arm: () => { blip(660, 0.06, { peak: 0.35 });
      setTimeout(() => blip(990, 0.08, { peak: 0.35 }), 70); },
    /* A turret volley. Up to three a second with both rapid pickups, so it
     * has to sit UNDER the letter blip rather than compete with it: short,
     * quiet, and high enough to stay out of the bomb's register. One tick per
     * VOLLEY, not per barrel — two shots leave together and a doubled tick is
     * just a thicker tick. */
    shot: () => blip(1250, 0.035, { type: 'square', peak: 0.12 }),
    /* The bomb. Synthesised like everything else, through the same fx bus.
     *
     * THE FIRST VERSION WAS A THUD AND DEX COULD NOT HEAR IT (2026-08-26).
     * Rendered offline against a letter blip it measured peak x1.68, a 100ms
     * tail, and — the actual fault — LESS high-frequency energy than the blip
     * it lands on top of: 900Hz lowpass over 0.3s is a dull knock, and a dull
     * knock under a music bed at the same instant as a bright tick is not an
     * explosion, it is nothing.
     *
     * So it is three parts now, and the CRACK is the one that matters: the
     * same noise buffer taken through a highpass for 120ms is what the ear
     * reads as a detonation. Under it a lowpass sweeping 1800 -> 90Hz gives
     * the rumble, and two detuned sine drops give the body a pitch. Nearly a
     * second long, against 0.3.
     *
     * One buffer, three chains: noise is noise, and generating it once and
     * filtering it twice is both cheaper and more coherent than two sources.
     *
     * The levels are set for HEADROOM, not for maximum: rendered offline it
     * peaks about 0.65 against the letter blip's 0.145, which leaves room for
     * the music bed underneath without the destination clipping. An earlier
     * pass at 0.85 was louder and measurably better on every axis except that
     * one, and clipping is not a trade worth making. */
    explosion: () => {
      try {
        if (!settings.isOn('master') || !settings.isOn('fx')) return;
        const c = ensure();
        const t = c.currentTime;
        const len = Math.floor(c.sampleRate * 0.9);
        const buf = c.createBuffer(1, len, c.sampleRate);
        const d = buf.getChannelData(0);
        // 1.6, not 2: a squarer decay keeps energy in the tail so the rumble
        // outlives the crack instead of both ending together.
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.6);
        const src = c.createBufferSource();
        src.buffer = buf;

        // the rumble
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1800, t);
        lp.frequency.exponentialRampToValueAtTime(90, t + 0.7);
        const body = c.createGain();
        body.gain.setValueAtTime(0.85, t);
        body.gain.exponentialRampToValueAtTime(0.001, t + 0.85);

        // the crack — short, bright, and the reason this reads as a bomb
        const hp = c.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(2400, t);
        const crack = c.createGain();
        crack.gain.setValueAtTime(0.8, t);
        crack.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

        src.connect(lp).connect(body).connect(graph.fx);
        src.connect(hp).connect(crack).connect(graph.fx);
        src.start(t);
      } catch { }
      // the body: two sine drops, detuned against each other so the pitch
      // slides rather than beeps
      blip(130, 0.45, { type: 'sine', peak: 0.72, slideTo: 34 });
      blip(78, 0.55, { type: 'sine', peak: 0.45, slideTo: 26 });
    },
    running: () => (ctx ? ctx.state : 'none'),
    // Suspended between games, not closed: the popover panel and the next
    // start() keep working against the same context and settings instance.
    suspend: () => { try { ctx?.suspend(); } catch { } },
    close: () => { try { ctx?.close(); } catch { } ctx = null; graph = null; },
  };
}

/* One audio instance for the page. The popover's panel and the running game
 * must share a settings object, or a slider dragged mid-game would only
 * write localStorage and never reach the live bus graph. */
let sharedAudio = null;
export function getAudio() {
  return (sharedAudio ??= createAudio());
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
export async function start({ onStop, onPauseChange } = {}) {
  const copy = findParagraph()?.parentElement;
  if (!copy) throw new Error('about copy not found');
  const h2 = copy.querySelector('h2');
  const p1 = copy.querySelector('p:not(.eyebrow)');
  const photo = document.querySelector('.about-photo');
  if (!h2 || !p1) throw new Error('about layout not recognised');

  /* The playfield, in viewport Y: BOTH paragraphs are the wall now, so the
   * ceiling is the h2's underside (it flashes accent on contact); floor
   * level with the portrait's bottom — that dead space is the ball travel.
   * The floor is hard-capped above the toolkit subsection: at narrow desktop
   * widths the copy column outgrows the portrait and the "dead space" the
   * layout has at 1440+ simply does not exist — the game declines to start
   * rather than play on top of the toolkit (measured 2026-08-19: portrait
   * hangs 65-114px below the bio at 1440-1700, sits ABOVE its bottom at
   * <=1200). */
  const pRect = findParagraph().getBoundingClientRect();
  const ceilingY = h2.getBoundingClientRect().bottom + 4;
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
  const audio = getAudio();
  /* Win choreography. 'play' -> (wall empty, last fall faded) ->
   * 'reassemble': every letter flies home from scatter below the floor,
   * staggered in text order, and is uncovered the frame it lands — the
   * handoff back to real text is per letter, a cascade, and needs no final
   * swap at all. -> 'done' -> stop(). */
  let phase = 'play';
  let flights = null;
  let reassembleT = 0;

  const paddle = { x: (left + right) / 2, y: floor - 14, w: PADDLE_W, h: PADDLE_H };
  /* Balls, plural: one below SECOND_BALL_AT cleared, two from there on —
   * never three (the spawn only fires while length < 2, and a missed ball
   * respawns rather than dying). This deliberately reverses the round-two
   * one-ball call (Dex, 2026-08-20): two balls halve the clear time
   * honestly, and they compound with the fatten so the back half of a run
   * falls apart in the player's favour. */
  const makeBall = () => ({
    x: paddle.x, y: paddle.y - BALL_R - 1, r: BALL_R,
    vx: 0, vy: 0, attached: true, timer: 0.5,
  });
  const balls = [makeBall()];
  let launches = 0;
  /* The bomb powerup: every DROP_EVERY of the wall cleared, a drop falls
   * from the letter that was just broken — one in flight at a time, missed
   * is gone. Caught with the paddle it arms the next ball the paddle
   * serves; that ball's next letter hit explodes a BOMB_RADIUS. */
  let drop = null;
  let nextDropAt = DROP_EVERY;
  let gotTurret = false;
  const gotRapid = RAPID_AT.map(() => false);
  let turrets = false;   // the turret drop has been caught
  let rapid = 0;         // 0, 1 or 2 rapid-fire pickups
  let fireT = 0;         // s until the next volley
  const bullets = [];
  const events = { paddleHits: 0, ceilingHits: 0, wallHits: 0, respawns: 0, breaks: 0, drops: 0, bombs: 0, volleys: 0 };
  let paused = false;
  const state = {
    balls, paddle, alive, events, falling,
    get ball() { return balls[0]; },   // the harnesses' single-ball view
    bounds: { left, right, ceiling, floor },
    get destroyed() { return destroyed; }, total,
    get paused() { return paused; },
    get drop() { return drop; },
    get armedBalls() { return balls.filter(b => b.armed).length; },
    get turrets() { return turrets; },
    get rapid() { return rapid; },
    get bulletCount() { return bullets.length; },
    get particleCount() { return particles.length; },
    time: 0,                           // sim seconds actually played
    running: true, won: false,
  };

  /* The game cursor: the pointer becomes part of the toy while the ball is
   * live — an accent arrow in the site cursor's own construction (a dark
   * casing stroke UNDER the accent stroke, which is what keeps it readable
   * over any ground; the wallpaper lightbox cursor is built the same way).
   * Applied to the whole page because the paddle steers from anywhere, and
   * cleared on pause and on EVERY exit — stop() is the single funnel all
   * error paths already drain into, so a stuck page-wide cursor cannot
   * happen without the game itself being stuck. */
  const cursorFor = (hex) => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>` +
      `<g fill='none' stroke='#000' stroke-opacity='.55' stroke-width='4.5' stroke-linejoin='round' stroke-linecap='round'>` +
      `<path d='M6 4l10 20 2.5-8.5L27 13z'/></g>` +
      `<g fill='none' stroke='${hex}' stroke-width='2' stroke-linejoin='round' stroke-linecap='round'>` +
      `<path d='M6 4l10 20 2.5-8.5L27 13z'/></g></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 6 4, auto`;
  };
  let cursorApplied = null;
  const applyCursor = () => {
    let want = null;
    if (state.running && !paused) {
      want = pointerInField ? 'none' : cursorFor(accent);
    }
    if (want === cursorApplied) return;
    cursorApplied = want;
    if (want) document.documentElement.style.cursor = want;
    else document.documentElement.style.removeProperty('cursor');
  };

  /* Pause is a real state, not a stopped clock: updates freeze, the render
   * keeps running so the paused frame is always current, and the whole
   * audio context suspends — the music halts mid-note, which is what paused
   * should sound like. onPauseChange is how the page's controls (and its
   * MediaBus registration) follow along. */
  const pause = () => {
    if (!state.running || paused) return;
    paused = true;
    audio.pauseAll();
    applyCursor();
    try { onPauseChange?.(true); } catch { }
  };
  const resume = () => {
    if (!state.running || !paused) return;
    paused = false;
    audio.resumeAll();
    applyCursor();
    try { onPauseChange?.(false); } catch { }
  };
  const togglePause = () => (paused ? resume() : pause());

  // A hidden tab pauses the game along with its music: coming back to a ball
  // that carried on without you is worse than a paused one.
  const onVisibility = () => { if (document.hidden) pause(); };

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
  let pointerY = null;                    // canvas-local, for the field dot
  let pointerInField = false;             // above the paddle line, over the canvas
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
    const r = h.canvas.getBoundingClientRect();
    mouseX = e.clientX - r.left;
    pointerY = e.clientY - r.top;
    /* Above the paddle line the OS pointer would slide over the letters —
     * a true repel is impossible without Pointer Lock, which is far too
     * heavy for a toy. So the field rejects it: the real cursor hides and
     * a faint accent dot (drawn in render) marks the position instead.
     * Below the line and outside the canvas the game cursor returns. */
    pointerInField = e.clientX >= r.left && e.clientX <= r.right &&
      pointerY >= 0 && pointerY < paddle.y;
    applyCursor();
  };

  /* ---- physics (all per-ball: b is whichever ball is being stepped) ---- */
  const clampAngle = (b) => {
    // A bounce that leaves a ball skimming horizontally stalls the game:
    // enforce a minimum vertical component, preserving speed and direction.
    const s = Math.hypot(b.vx, b.vy) || 1;
    const min = MIN_VY * s;
    if (Math.abs(b.vy) < min) {
      b.vy = (b.vy < 0 || (b.vy === 0 && Math.random() < 0.5) ? -1 : 1) * min;
      b.vx = Math.sign(b.vx || 1) * Math.sqrt(Math.max(0, s * s - min * min));
    }
  };

  const launch = (b) => {
    b.attached = false;
    const a = 0.3 * (launches++ % 2 ? 1 : -1);   // alternate slight angles
    const s = speed();
    b.vx = s * Math.sin(a);
    b.vy = -s * Math.cos(a);
  };

  /* One letter leaves the wall. THREE things break letters now — a ball, a
   * blast, a turret round — and they differ only in the velocity and spin they
   * hand the falling glyph, so that is all they pass and the bookkeeping is
   * written once instead of three times. */
  const breakLetter = (i, vx, vy, om = (Math.random() - 0.5) * 7) => {
    const l = h.letters[i];
    alive[i] = false;
    destroyed++;
    events.breaks++;
    falling.push({ i, x: l.x + l.w / 2, y: l.y + l.h / 2, rot: 0, vx, vy, om, alpha: 1 });
  };

  /* An armed hit takes the neighbourhood with it: every living letter in
   * BOMB_RADIUS goes, thrown radially off the blast rather than falling. */
  const explode = (cx, cy) => {
    events.bombs++;
    audio.explosion();
    for (let i = 0; i < total; i++) {
      if (!alive[i]) continue;
      const l = h.letters[i];
      const lx = l.x + l.w / 2, ly = l.y + l.h / 2;
      const dx = lx - cx, dy = ly - cy;
      if (dx * dx + dy * dy > BOMB_RADIUS * BOMB_RADIUS) continue;
      const d = Math.hypot(dx, dy) || 1;
      breakLetter(i, (dx / d) * (120 + Math.random() * 90),
                     (dy / d) * (120 + Math.random() * 90) - 40,
                     (Math.random() - 0.5) * 9);
    }
  };

  const spawnDrop = (l, kind) => {
    drop = { x: l.x + l.w / 2, y: l.y + l.h / 2, t: 0, kind };
    events.drops++;
  };

  const maybeDrop = (l) => {
    // One in flight at a time; a threshold crossed while one falls waits
    // for the NEXT broken letter after it resolves.
    if (drop || phase !== 'play') return;
    const p = destroyed / total;
    // The one-shots first — see the note on TURRET_AT.
    if (!gotTurret && p >= TURRET_AT) { gotTurret = true; spawnDrop(l, 'turret'); return; }
    for (let k = 0; k < RAPID_AT.length; k++) {
      if (!gotRapid[k] && p >= RAPID_AT[k]) { gotRapid[k] = true; spawnDrop(l, 'rapid'); return; }
    }
    if (p < nextDropAt) return;
    spawnDrop(l, 'bomb');
    // A bomb can jump several thresholds at once; re-anchor to the next one.
    nextDropAt = (Math.floor(p / DROP_EVERY) + 1) * DROP_EVERY;
  };

  /* A round from a turret: the same wall and the same bookkeeping as a ball
   * hit, arriving from below and dying on contact. */
  const hitLetterWithBullet = (s) => {
    for (let i = 0; i < total; i++) {
      if (!alive[i]) continue;
      const l = h.letters[i];
      if (s.x < l.x || s.x > l.x + l.w) continue;
      if (s.y < l.y || s.y - BULLET_H > l.y + l.h) continue;
      breakLetter(i, (Math.random() - 0.5) * 50, -120 - Math.random() * 60);
      audio.letter(l.w);
      maybeDrop(l);
      return true;
    }
    return false;
  };

  /* A miss costs the ball's position, not its charge: `armed` is deliberately
   * NOT cleared here (Dex, 2026-08-26). Losing a bomb you already caught to a
   * paddle miss is a second punishment for the same mistake, and the pickup is
   * rare enough that it would read as the powerup being broken. */
  const respawn = (b) => {
    events.respawns++;
    audio.lost();
    b.attached = true;
    b.timer = 0.6;
    b.vx = b.vy = 0;
  };

  const collideLetters = (b) => {
    // The wall is SHARED: alive[] is the one source of truth, and the balls
    // are stepped sequentially, so a letter broken by the first ball is
    // already gone when the second one is tested in the same frame.
    for (let i = 0; i < total; i++) {
      if (!alive[i]) continue;
      const l = h.letters[i];
      const qx = Math.max(l.x, Math.min(b.x, l.x + l.w));
      const qy = Math.max(l.y, Math.min(b.y, l.y + l.h));
      const dx = b.x - qx, dy = b.y - qy;
      if (dx * dx + dy * dy > b.r * b.r) continue;
      // a fraction of the ball's momentum plus a small upward pop — the letter
      // is knocked off, not dropped
      breakLetter(i, b.vx * 0.18 + (Math.random() - 0.5) * 60,
                     Math.min(0, b.vy * 0.15) - 30 - Math.random() * 60);
      /* An armed hit is an explosion, not a tap. The letter blip used to fire
       * first and then the bomb went off in the same millisecond, so the one
       * sound that should own the moment arrived underneath a bright tick.
       * Exclusive: one event, one sound. The letters the blast takes are
       * covered by the explosion too — none of them blips. */
      if (b.armed) { b.armed = false; explode(l.x + l.w / 2, l.y + l.h / 2); }
      else audio.letter(l.w);
      maybeDrop(l);
      // Reflect off the shallower penetration axis and push out of it.
      const ox = b.r + l.w / 2 - Math.abs(b.x - (l.x + l.w / 2));
      const oy = b.r + l.h / 2 - Math.abs(b.y - (l.y + l.h / 2));
      if (ox < oy) { b.vx = -b.vx; b.x += Math.sign(dx || b.vx) * ox; }
      else { b.vy = -b.vy; b.y += Math.sign(dy || b.vy) * oy; }
      clampAngle(b);
      return;                              // one brick per substep
    }
  };

  /* The celebration: accent firework bursts WHILE the letters fly home —
   * the payoff and the restore are one moment. Pure canvas paint, so it can
   * leave nothing behind by construction; the canvas outlives the last
   * landing only long enough for the final sparks to die (under a second,
   * and every letter has already handed off to real text by then). Reduced
   * motion gets the reassembly and the sound, not the fireworks. */
  const particles = [];
  let celebrate = false;
  let nextBurst = 0;
  let confettiAcc = 0;
  let victorySize = 0;

  const burst = () => {
    const bx = left + 30 + Math.random() * (right - left - 60);
    const by = ceiling + 30 + Math.random() * (floor - ceiling - 110);
    const n = 14 + (Math.random() * 6 | 0);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 70 + Math.random() * 190;
      particles.push({
        kind: 's', x: bx, y: by,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.55 + Math.random() * 0.35, max: 0.9,
        size: 1.6 + Math.random() * 1.4,
      });
    }
  };

  const beginReassembly = () => {
    phase = 'reassemble';
    reassembleT = 0;
    celebrate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    nextBurst = 0.15;
    confettiAcc = 0;
    // VICTORY at ~half the container width: fit once, draw many.
    h.ctx.font = `900 100px ${h.fontFamily}`;
    victorySize = Math.floor(100 * (h.size.w * 0.5) / h.ctx.measureText('VICTORY').width);
    h.ctx.font = h.font;
    audio.win();
    flights = h.letters.map((l, i) => ({
      i, landed: false,
      delay: 0.35 + i * 0.011 + Math.random() * 0.05,
      dur: 0.5,
      fromX: l.x + l.w / 2 + (Math.random() - 0.5) * 220,
      fromY: floor + 30 + Math.random() * 70,
      fromRot: (Math.random() - 0.5) * 2.4,
    }));
  };

  const updateReassembly = (dt) => {
    reassembleT += dt;
    let allLanded = true;
    for (const f of flights) {
      if (f.landed) continue;
      if (reassembleT >= f.delay + f.dur) {
        f.landed = true;
        alive[f.i] = true;         // uncovered: the real glyph takes over
      } else allLanded = false;
    }
    if (celebrate) {
      if (!allLanded) {
        nextBurst -= dt;
        if (nextBurst <= 0) { burst(); nextBurst = 0.22 + Math.random() * 0.26; }
        // a steady confetti fall the whole length of the reassembly
        confettiAcc += dt;
        while (confettiAcc > 0.045 && particles.length < 450) {
          confettiAcc -= 0.045;
          particles.push({
            kind: 'c',
            x: left + Math.random() * (right - left), y: 2,
            vx: 0, vy: 70 + Math.random() * 90,
            life: 1.1 + Math.random() * 0.35, max: 1.4,
            size: 3 + Math.random() * 3,
            rot: Math.random() * Math.PI, om: (Math.random() - 0.5) * 8,
            phase: Math.random() * Math.PI * 2,
          });
        }
      }
      for (let k = particles.length - 1; k >= 0; k--) {
        const p = particles[k];
        if (p.kind === 'c') {
          p.x += Math.sin(p.life * 6 + p.phase) * 40 * dt;   // sway down
          p.y += p.vy * dt;
          p.rot += p.om * dt;
        } else {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += 260 * dt;        // sparks arc, not drift
        }
        p.life -= dt;
        if (p.life <= 0) particles.splice(k, 1);
      }
    }
    if (allLanded && particles.length === 0) {
      phase = 'done';
      state.won = true;
      stop();
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

  const stepBall = (b, dt, idx) => {
    if (b.attached) {
      // Two balls can wait on the paddle at once; a small offset keeps them
      // both visible instead of stacked into one.
      b.x = paddle.x + (balls.length > 1 ? (idx === 0 ? -12 : 12) : 0);
      b.y = paddle.y - b.r - 1;
      b.timer -= dt;
      if (b.timer <= 0) launch(b);
      return;
    }

    // substeps small enough that no letter cell can be tunnelled
    let dist = Math.hypot(b.vx, b.vy) * dt;
    while (dist > 0) {
      const step = Math.min(STEP, dist);
      dist -= step;
      const s = Math.hypot(b.vx, b.vy) || 1;
      b.x += (b.vx / s) * step;
      b.y += (b.vy / s) * step;

      if (b.x - b.r < left) { b.x = left + b.r; b.vx = Math.abs(b.vx); events.wallHits++; audio.wall(); clampAngle(b); }
      else if (b.x + b.r > right) { b.x = right - b.r; b.vx = -Math.abs(b.vx); events.wallHits++; audio.wall(); clampAngle(b); }
      if (b.y - b.r < ceiling) {
        b.y = ceiling + b.r; b.vy = Math.abs(b.vy);
        events.ceilingHits++; flashCeiling(); audio.ceiling(); clampAngle(b);
      }

      // paddle: only a descending ball, only from above — the contact-point
      // aim serves whichever ball arrives
      if (b.vy > 0 &&
          b.y + b.r >= paddle.y && b.y + b.r <= paddle.y + paddle.h + 8 &&
          Math.abs(b.x - paddle.x) <= paddle.w / 2 + b.r) {
        events.paddleHits++;
        let offset = Math.max(-1, Math.min(1, (b.x - paddle.x) / (paddle.w / 2)));
        // A dead-centre catch would send the ball exactly vertical, and a
        // vertical ball in its own cleared channel returns to the same spot
        // forever — the vertical twin of the horizontal skim the angle clamp
        // already prevents. Give perfect catches a slight angle.
        if (Math.abs(offset) < 0.05) offset = Math.random() < 0.5 ? -0.05 : 0.05;
        audio.paddle(offset);
        const a = offset * MAX_AIM;
        const sp = speed();
        b.vx = sp * Math.sin(a);
        b.vy = -sp * Math.cos(a);
        b.y = paddle.y - b.r;
      }

      collideLetters(b);

      if (b.y - b.r > floor + 22) { respawn(b); return; }
    }
  };

  const update = (dt) => {
    state.time += dt;
    updateFalling(dt);
    // The two progress levers, compounding on purpose: a second ball from
    // SECOND_BALL_AT, and past FATTEN_AT every ball grows toward BALL_R_MAX
    // so the last scattered letters stop being a minutes-long hunt.
    if (destroyed / total >= SECOND_BALL_AT && balls.length < 2) {
      const nb = makeBall();
      nb.timer = 0.6;                 // the same delay a miss uses
      balls.push(nb);
    }
    const r = BALL_R + (BALL_R_MAX - BALL_R) *
      Math.max(0, destroyed / total - FATTEN_AT) / (1 - FATTEN_AT);
    for (const b of balls) b.r = r;
    // paddle
    if (mouseX !== null) paddle.x = mouseX;
    else paddle.x += ((keys.right ? 1 : 0) - (keys.left ? 1 : 0)) * PADDLE_SPEED * dt;
    paddle.x = Math.max(left + paddle.w / 2, Math.min(right - paddle.w / 2, paddle.x));

    // the falling bomb drop: caught by the paddle, or gone past it
    if (drop) {
      drop.t += dt;
      drop.y += DROP_SPEED * dt;
      const half = DROP_SIZE / 2;
      if (drop.y + half >= paddle.y && drop.y - half <= paddle.y + paddle.h + 6 &&
          Math.abs(drop.x - paddle.x) <= paddle.w / 2 + half) {
        const kind = drop.kind;
        drop = null;
        if (kind === 'turret') {
          turrets = true;
          fireT = 0.3;                 // first volley almost at once
        } else if (kind === 'rapid') {
          rapid = Math.min(RAPID_AT.length, rapid + 1);
          // Rapid fire with no gun is nothing, and the turret drop can be
          // missed. A rapid pickup brings the turrets with it rather than
          // being a powerup that silently does not apply.
          if (!turrets) { turrets = true; fireT = 0.3; }
        } else {
          /* EVERY ball, right now. It used to set a pendingArm flag that the
           * next paddle contact spent on ONE ball, so catching a bomb did
           * nothing visible until that ball came back down — and with two
           * balls live, the other one never got it at all. */
          for (const b of balls) b.armed = true;
        }
        audio.arm();
      } else if (drop.y - half > floor + 20) {
        drop = null;               // missed: no bounce, no second chance
      }
    }

    /* The turrets: one volley from both barrels on a fixed period, divided by
     * 1 + rapid. `fireT +=` rather than `=` keeps the cadence steady across a
     * long frame; dt is clamped upstream, so it can never fire twice in one. */
    if (turrets) {
      fireT -= dt;
      if (fireT <= 0) {
        fireT += TURRET_PERIOD / (1 + rapid);
        const bx = paddle.w / 2 - 2;
        bullets.push({ x: paddle.x - bx, y: paddle.y - 2 },
                     { x: paddle.x + bx, y: paddle.y - 2 });
        events.volleys++;
        audio.shot();
      }
    }
    for (let i = bullets.length - 1; i >= 0; i--) {
      const s = bullets[i];
      s.y -= BULLET_SPEED * dt;
      if (s.y - BULLET_H < ceiling || hitLetterWithBullet(s)) bullets.splice(i, 1);
    }

    for (let i = 0; i < balls.length; i++) stepBall(balls[i], dt, i);
  };

  /* ---- render --------------------------------------------------------- */
  let frameCount = 0;
  /* Pause must LOOK paused, or a frozen ball over a half-eaten bio reads as
   * the site having broken. A small centred block says so — a full dark wash
   * across the container read as a crash, so the playfield behind only dims
   * slightly and the outlined panel is what carries the message. */
  // The dim behind the pause block rounds to the same radius the About
  // section's own rounded container uses (the portrait frame's --radius-art),
  // read from the live style rather than duplicated here.
  const veilRadius = photo ? parseFloat(getComputedStyle(photo).borderRadius) || 0 : 0;
  const drawVeil = () => {
    if (!paused) return;
    const ctx = h.ctx;
    ctx.fillStyle = 'rgba(5, 7, 9, 0.2)';
    const veil = new Path2D();
    roundedRect(veil, 0, 0, h.size.w, h.size.h, veilRadius);
    ctx.fill(veil);
    // Just the word, centred — the controls sit right there, and the block
    // is obviously a pause state; a hint line only pushed PAUSED off-centre.
    const cx = h.size.w / 2;
    const cy = h.size.h / 2;
    const titleFont = `800 24px ${h.fontFamily}`;
    ctx.font = titleFont;
    const bw = Math.max(150, ctx.measureText('PAUSED').width + 64);
    const bh = 64;
    const panel = new Path2D();
    roundedRect(panel, cx - bw / 2, cy - bh / 2, bw, bh, 14);
    ctx.fillStyle = '#101418';
    ctx.fill(panel);
    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    ctx.stroke(panel);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = accent;
    ctx.fillText('PAUSED', cx, cy + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = h.font;
  };
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
    if (phase === 'reassemble') {
      // Letters fly home, straightening as they arrive; each is drawn only
      // once its stagger delay passes, so the cascade sweeps through the
      // paragraph in reading order. No paddle, no ball — the game is over.
      for (const f of flights) {
        if (f.landed) continue;
        const p = (reassembleT - f.delay) / f.dur;
        if (p <= 0) continue;
        const e = 1 - Math.pow(1 - Math.min(1, p), 3);
        const l = h.letters[f.i];
        const hx = l.x + l.w / 2, hy = l.y + l.h / 2;
        ctx.save();
        ctx.translate(f.fromX + (hx - f.fromX) * e, f.fromY + (hy - f.fromY) * e);
        ctx.rotate(f.fromRot * (1 - e));
        ctx.fillStyle = h.color;
        ctx.fillText(l.ch, -l.w / 2, l.baseline - hy);
        ctx.restore();
      }
      // sparks and confetti over the flying letters, in the accent
      ctx.fillStyle = accent;
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
        if (p.kind === 'c') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      /* VICTORY: half the container wide, scaling up as it arrives, then
       * flashing outline-to-fill at a deliberately chunky frame rate — an
       * arcade cabinet, not a CSS fade. Skipped entirely under reduced
       * motion (it flashes by nature); the reassembly and sound carry it. */
      if (celebrate) {
        const grow = 1 - Math.pow(1 - Math.min(1, reassembleT / 0.45), 3);
        ctx.save();
        ctx.translate(h.size.w / 2, h.size.h / 2);
        ctx.scale(grow, grow);
        ctx.font = `900 ${victorySize}px ${h.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (Math.floor(reassembleT / 0.28) % 2) {
          ctx.fillStyle = accent;
          ctx.fillText('VICTORY', 0, 0);
        } else {
          ctx.lineWidth = 3;
          ctx.strokeStyle = accent;
          ctx.strokeText('VICTORY', 0, 0);
        }
        ctx.restore();
        ctx.font = h.font;
        ctx.textBaseline = 'alphabetic';
      }
      drawVeil();
      return;
    }
    ctx.fillStyle = accent;
    const pr = new Path2D();
    roundedRect(pr, paddle.x - paddle.w / 2, paddle.y, paddle.w, paddle.h, 3);
    ctx.fill(pr);
    /* The drop, flashing at a chunky rate. SHAPE tells the three apart, not
     * colour: the field paints in the one accent over live text, so a second
     * hue is not available and a dark punch-out would be wrong over a
     * transparent canvas. A bomb is a block; a turret is one arrow up; rapid
     * fire is two. */
    if (drop) {
      const on = (drop.t % 0.32) < 0.2;
      ctx.globalAlpha = on ? 1 : 0.35;
      const dp = new Path2D();
      const half = DROP_SIZE / 2;
      if (drop.kind === 'bomb') {
        roundedRect(dp, drop.x - half, drop.y - half, DROP_SIZE, DROP_SIZE, 4);
      } else {
        const tri = (cy, h2) => {
          dp.moveTo(drop.x - half, cy + h2);
          dp.lineTo(drop.x, cy - h2);
          dp.lineTo(drop.x + half, cy + h2);
          dp.closePath();
        };
        if (drop.kind === 'turret') tri(drop.y, half);
        else { tri(drop.y - 4, 3.5); tri(drop.y + 4, 3.5); }
      }
      ctx.fill(dp);
      ctx.globalAlpha = 1;
    }
    /* The guns, on the paddle's ends, and their rounds. The barrels grow with
     * rapid fire — the only readout the rate has, and it sits on the thing
     * doing the firing rather than in a corner. */
    if (turrets) {
      const bx = paddle.w / 2 - 2;
      const bh = 6 + rapid * 2;
      for (const side of [-1, 1]) {
        const tp = new Path2D();
        roundedRect(tp, paddle.x + side * bx - 2, paddle.y - bh, 4, bh, 1.5);
        ctx.fill(tp);
      }
    }
    for (const s of bullets) {
      const sp = new Path2D();
      roundedRect(sp, s.x - BULLET_W / 2, s.y - BULLET_H, BULLET_W, BULLET_H, 1.5);
      ctx.fill(sp);
    }
    for (const b of balls) {
      if (!b.attached || b.timer < 0.25) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        if (b.armed) {
          // the armed ball wears a pulsing ring until it spends the bomb
          ctx.globalAlpha = 0.45 + 0.4 * Math.sin(state.time * 12);
          ctx.lineWidth = 2;
          ctx.strokeStyle = accent;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r + 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
    // the field's own pointer: the OS cursor is hidden up here, a faint
    // accent dot marks it instead
    if (pointerInField && !paused && mouseX !== null) {
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(mouseX, pointerY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    drawVeil();
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
    applyCursor();            // the page's own pointer, back on every exit
    cancelAnimationFrame(raf);
    io.disconnect();
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('pointermove', onPointer);
    document.removeEventListener('visibilitychange', onVisibility);
    audio.music.stop();
    audio.suspend();          // shared instance: quiet, not gone
    h.restore();
    try { onStop?.(state); } catch { /* the page's problem, not the game's */ }
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
        applyCursor();                                    // accent swap recolours it
        // A layout shift with no resize event (content above the section
        // growing, a font engage missed) moves the text out from under the
        // measured coordinates. Scroll cancels out — both rects are viewport.
        const cr = h.canvas.getBoundingClientRect();
        const pr = h.paragraph.getBoundingClientRect();
        if (Math.abs(pr.left - cr.left - left) > 1 ||
            Math.abs(pr.top - cr.top - (pRect.top - ceilingY)) > 1) { stop(); return; }
      }
      if (!paused) {
        if (phase === 'play') {
          update(dt);
          // The wall is empty and the last falling letter has faded: payoff.
          if (state.running && destroyed === total && falling.length === 0) beginReassembly();
        } else if (phase === 'reassemble') {
          updateReassembly(dt);
        }
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
  document.addEventListener('visibilitychange', onVisibility);

  /* Clicking the playfield pauses (and clicking it again resumes). The
   * canvas takes pointer events only while the game runs; the controls sit
   * outside it, so their clicks never land here. */
  h.canvas.style.pointerEvents = 'auto';
  h.canvas.addEventListener('click', () => {
    if (state.running && phase !== 'done') togglePause();
  });

  audio.music.start();
  applyCursor();
  raf = requestAnimationFrame(frame);

  return {
    stop, state, handle: h, audio, pause, resume, toggle: togglePause,
    debug: {
      /* Test hook: empty the wall so the frame loop's own win detection and
       * reassembly run for real — clearing 194 letters by physics takes
       * minutes a harness does not have. */
      winNow() {
        for (let i = 0; i < total; i++) if (alive[i]) { alive[i] = false; destroyed++; }
        falling.length = 0;
      },
      /* Test hook: jump the clear fraction so the fatten curve and the
       * end-game it exists for can be exercised without minutes of play. */
      clear(fraction) {
        const target = Math.floor(total * fraction);
        for (let i = 0; i < total && destroyed < target; i++) {
          if (alive[i]) { alive[i] = false; destroyed++; }
        }
        falling.length = 0;
      },
    },
  };
}
