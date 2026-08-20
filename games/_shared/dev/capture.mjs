// The gallery capture kit — shared by all four games.
//
// dev/cdp.mjs beside this file is the browser: it launches Chrome, serves the
// repo and evaluates expressions. This file is everything ABOVE that which
// every game's gallery run needs and none of which is about any one game:
// driving real input, waiting for a frame that has actually settled, writing a
// PNG, and laying the candidates out as a contact sheet.
//
// It exists because the shot list is the same shape for all four — several
// deliberately-varied candidates per named shot, a sheet, then a human picks —
// and because none of that is worth writing three more times.
//
// WHAT IT DELIBERATELY DOES NOT DO: decide whether a frame is any good. It
// cannot, and neither can the session driving it. Every function here is about
// reaching a real moment and photographing it honestly; which of the six
// candidates is THE one is a question for the sheet.
//
// EVERY CDP CALL IN HERE HAS A DEADLINE, and that is not defensive
// programming — it is a bug that cost two runs. A gallery harness drives a
// game hard: it boosts a boat past what the terrain streamer can keep up with,
// it swaps worlds, and it holds a key down at a death screen on a game that
// answers any keypress there with location.reload(). All three leave the
// renderer unable to produce a frame, and `Page.captureScreenshot` waits for a
// frame — so it does not fail, it simply never answers. Twice a run sat
// silent for twenty-five minutes on a step that takes under one.
// A screenshot that cannot be taken in thirty seconds is a screenshot of a
// wedged renderer, which is not a screenshot worth having. Failing loudly
// means the shot is reported missing and the other eleven still get taken.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate, wait } from './cdp.mjs';

/* Deadlines. Generous enough that a slow but working step passes on the
   software rasteriser, short enough that a wedged one is noticed the same
   minute rather than the same hour. */
const T_INPUT = 10_000;    // a key or mouse event: instant, or something is wrong
const T_SHOT = 30_000;     // a screenshot: waits for a frame, so it gets longer
const T_EVAL = 90_000;     // an in-page loop that may legitimately wait on the world

// ── input ────────────────────────────────────────────────────────────────
// Real CDP input, not synthesised KeyboardEvents. The difference matters:
// a dispatched event is trusted, reaches pointer lock, and goes through the
// same path a player's keypress does — which is the whole claim a gameplay
// screenshot is making. All four games read `e.code`; Stickland also reads
// `e.key`, so both are always sent.

/* Chrome wants a Windows virtual key code for anything that is not a plain
   character, and gets the modifier state wrong without one. Only the keys the
   gallery runs actually press are listed — this is not a keyboard map. */
const VK = {
  KeyA: 65, KeyB: 66, KeyC: 67, KeyD: 68, KeyE: 69, KeyF: 70, KeyG: 71,
  KeyH: 72, KeyI: 73, KeyJ: 74, KeyK: 75, KeyL: 76, KeyM: 77, KeyN: 78,
  KeyO: 79, KeyP: 80, KeyQ: 81, KeyR: 82, KeyS: 83, KeyT: 84, KeyU: 85,
  KeyV: 86, KeyW: 87, KeyX: 88, KeyY: 89, KeyZ: 90,
  Digit1: 49, Digit2: 50, Digit3: 51, Digit4: 52, Digit5: 53,
  Digit6: 54, Digit7: 55, Digit8: 56, Digit9: 57, Digit0: 48,
  Space: 32, Enter: 13, Escape: 27, Tab: 9, ShiftLeft: 16, ControlLeft: 17,
  ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
};

const KEYNAME = {
  Space: ' ', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab',
  ShiftLeft: 'Shift', ControlLeft: 'Control',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
};

const keyOf = (code) => KEYNAME[code]
  || (code.startsWith('Key') ? code.slice(3).toLowerCase() : '')
  || (code.startsWith('Digit') ? code.slice(5) : '');

/* MODIFIERS ARE A BITFIELD CHROME WILL NOT INFER. A dispatched ShiftLeft
   keydown does not put Chrome into a shifted state, so a sprint that is
   `e.shiftKey` rather than `keys.ShiftLeft` never fires unless the modifier
   rides on every event sent while the key is down. Tracked here rather than
   asked of the caller, which is what makes hold('ShiftLeft') + hold('KeyW')
   compose. */
const MOD = { ShiftLeft: 8, ControlLeft: 2 };

export function createInput(page) {
  let mods = 0;
  let mouseX = 0, mouseY = 0;

  const send = (type, code, extra = {}) => page.send('Input.dispatchKeyEvent', {
    type,
    code,
    key: keyOf(code),
    windowsVirtualKeyCode: VK[code] ?? 0,
    nativeVirtualKeyCode: VK[code] ?? 0,
    modifiers: mods,
    ...extra,
  }, T_INPUT);

  const api = {
    async down(code) {
      if (MOD[code]) mods |= MOD[code];
      /* rawKeyDown, not keyDown: keyDown additionally emits a `char` event and
         Chrome refuses it for keys with no text. Games read keydown. */
      await send('rawKeyDown', code);
    },
    async up(code) {
      await send('keyUp', code);
      if (MOD[code]) mods &= ~MOD[code];
    },
    /** Press and release, with the key genuinely held for `ms`. */
    async tap(code, ms = 40) {
      await api.down(code);
      await wait(ms);
      await api.up(code);
    },
    /**
     * Hold a set of keys while `ms` of game time passes.
     *
     * Takes a list because holding W and D is one action, not two: released in
     * sequence they produce a frame of pure-forward at the end, and a craft
     * that was banking is suddenly level in the photograph.
     */
    async hold(codes, ms) {
      const list = [].concat(codes);
      for (const c of list) await api.down(c);
      await wait(ms);
      for (const c of list) await api.up(c);
    },

    /** Where the pointer is, for games that read clientX/clientY (Stickland). */
    async moveTo(x, y) {
      mouseX = x; mouseY = y;
      await page.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x, y, modifiers: mods, buttons: 0,
      }, T_INPUT);
    },
    /**
     * A relative aim, which is what a pointer-locked game reads.
     *
     * movementX/movementY are the ONLY thing a locked page gets — x/y are
     * frozen at the lock point — so a harness that only moves x/y turns the
     * camera in Stickland and does nothing at all in Arena 1. Both are sent.
     */
    async aim(dx, dy, steps = 12) {
      for (let i = 0; i < steps; i++) {
        mouseX += dx / steps; mouseY += dy / steps;
        await page.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: Math.round(mouseX), y: Math.round(mouseY),
          movementX: dx / steps, movementY: dy / steps,
          modifiers: mods, buttons: 0,
        }, T_INPUT);
        await wait(16);
      }
    },
    async click(x, y, button = 'left') {
      mouseX = x; mouseY = y;
      const base = { x, y, button, clickCount: 1, buttons: button === 'left' ? 1 : 2, modifiers: mods };
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base }, T_INPUT);
      await wait(50);
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 }, T_INPUT);
    },
    /** Mouse held down for `ms` — firing, drawing a bow, chomping. */
    async hold1(x, y, ms, button = 'left') {
      mouseX = x; mouseY = y;
      const base = { x, y, button, clickCount: 1, buttons: button === 'left' ? 1 : 2, modifiers: mods };
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base }, T_INPUT);
      await wait(ms);
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 }, T_INPUT);
    },
  };
  return api;
}

// ── settling ─────────────────────────────────────────────────────────────

/**
 * Wait for `n` rendered frames.
 *
 * rAF rather than a sleep because a sleep measures the harness's patience and
 * this measures the page's progress: under SwiftShader a "200ms settle" can be
 * three frames, and three frames is a chase camera still lerping.
 */
export const frames = (page, n = 30) => evaluate(page, `(async () => {
  const f = () => new Promise((r) => requestAnimationFrame(r));
  for (let i = 0; i < ${n}; i++) await f();
  return true;
})()`, T_EVAL);

/**
 * Wait until the picture stops changing, then hold still.
 *
 * THE ONE THING EVERY GALLERY SHOT NEEDS AND NO GAME PROVIDES. Streaming
 * terrain, a texture still decoding and a camera still easing all produce
 * frames that are technically gameplay and look broken, and none of them are
 * visible to a frame counter. So this samples the canvas itself: a small
 * downscale of the framebuffer, compared frame to frame, and the picture is
 * settled when consecutive samples stop differing by more than `tol`.
 *
 * `moving` is the escape hatch for a shot that is SUPPOSED to be in motion —
 * a tank driving, a jetpack climbing. There the picture never stops changing,
 * so the wait is on the frame budget alone and the caller says so out loud.
 *
 * Returns what it saw, so a run that photographed a half-built world says so
 * in the log rather than in the sheet.
 */
export async function settle(page, { canvas = 'canvas', tol = 0.004, need = 8,
                                     maxMs = 30000, moving = false } = {}) {
  if (moving) { await frames(page, 40); return { settled: false, moving: true }; }
  return evaluate(page, `(async () => {
    const f = () => new Promise((r) => requestAnimationFrame(r));
    const src = document.querySelector(${JSON.stringify(canvas)});
    if (!src) return { settled: false, err: 'no canvas' };
    /* 64x36 is enough to see terrain pop in and cheap enough to run every
       frame. Any larger and the sampling itself costs a frame under
       SwiftShader, which is the thing being measured. */
    const s = document.createElement('canvas');
    s.width = 64; s.height = 36;
    const g = s.getContext('2d', { willReadFrequently: true });
    let prev = null, stable = 0, worst = 1;
    const t0 = performance.now();
    while (performance.now() - t0 < ${maxMs}) {
      await f();
      /* WebGL canvases are only readable during the frame that drew them when
         preserveDrawingBuffer is false — which it is in all four games. Inside
         a rAF callback drawImage still gets the composited result, and if it
         ever comes back blank the diff pins at 0 and the loop would exit
         early on a black frame, so a wholly-black sample is not counted. */
      g.drawImage(src, 0, 0, 64, 36);
      const cur = g.getImageData(0, 0, 64, 36).data;
      let lit = 0;
      for (let i = 0; i < cur.length; i += 4) lit += cur[i] + cur[i + 1] + cur[i + 2];
      if (lit === 0) { prev = null; stable = 0; continue; }
      if (prev) {
        let d = 0;
        for (let i = 0; i < cur.length; i += 4) {
          d += Math.abs(cur[i] - prev[i]) + Math.abs(cur[i + 1] - prev[i + 1])
             + Math.abs(cur[i + 2] - prev[i + 2]);
        }
        d /= (64 * 36 * 3 * 255);
        worst = Math.min(worst, d);
        if (d < ${tol}) { if (++stable >= ${need}) {
          return { settled: true, ms: Math.round(performance.now() - t0), diff: +d.toFixed(5) };
        } } else stable = 0;
      }
      prev = cur;
    }
    return { settled: false, ms: ${maxMs}, best: +worst.toFixed(5) };
  })()`, maxMs + T_SHOT);
}

// ── capture ──────────────────────────────────────────────────────────────

/**
 * One PNG.
 *
 * captureBeyondViewport is off on purpose: the viewport IS the shot, and
 * turning it on gets you a full-page capture that includes whatever the HUD
 * has overflowing off-screen.
 */
export async function shoot(page, file) {
  const shot = await page.send('Page.captureScreenshot', { format: 'png' }, T_SHOT);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return file;
}

/** Collector for a run: names the files, keeps the notes, writes the sheet. */
export function createRoll(outDir, { width, height }) {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const shots = [];
  return {
    dir: outDir,
    /**
     * Photograph the page and file it under a named shot.
     *
     * `shot` is the line from the brief ("a tank driving through the forest"),
     * `variant` is what makes this candidate different from the others under
     * it (distance, moment, angle). Keeping them apart is what lets the sheet
     * group candidates under their shot instead of listing twelve PNGs.
     *
     * `repro` is the seed and the input stream, carried into the sheet, so a
     * frame Dex keeps can be recaptured at another size later.
     */
    async take(page, { shot, variant, note = '', repro = null }) {
      const stem = `${shot}--${variant}`.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
      const file = join(outDir, stem + '.png');
      await shoot(page, file);
      shots.push({ shot, variant, note, repro, file: stem + '.png' });
      return file;
    },
    list: () => shots,
    /**
     * The contact sheet: an HTML page, grouped by named shot, screenshotted
     * from the same Chrome so it is one image Dex can look at.
     *
     * HTML rather than a canvas montage because the captions carry the repro
     * data, and a caption that cannot be copied out of the image is a caption
     * that gets retyped wrong.
     */
    write(title) {
      const groups = new Map();
      for (const s of shots) {
        if (!groups.has(s.shot)) groups.set(s.shot, []);
        groups.get(s.shot).push(s);
      }
      const sections = [...groups].map(([name, list]) => {
        const cells = list.map((s) => `      <figure>
        <img src="${s.file}" alt="${s.variant}" width="${width}" height="${height}">
        <figcaption><b>${s.variant}</b>${s.note ? ` — ${s.note}` : ''}${
          s.repro ? `<span class="repro">${s.repro}</span>` : ''}</figcaption>
      </figure>`).join('\n');
        return `    <section>\n      <h2>${name}</h2>\n${cells}\n    </section>`;
      }).join('\n');
      const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="sheet.css"></head>
<body>
  <h1>${title}</h1>
  <main>
${sections}
  </main>
</body></html>
`;
      writeFileSync(join(outDir, 'sheet.html'), html);
      writeFileSync(join(outDir, 'sheet.css'), SHEET_CSS);
      return join(outDir, 'sheet.html');
    },
  };
}

/* Dark, because every one of these games is dark and a white sheet makes every
   candidate look murkier than it is. Two per row at 1920 wide: one per row is
   a scroll and three is too small to judge. */
const SHEET_CSS = `*{box-sizing:border-box}
body{margin:0;padding:28px 32px 60px;background:#0d1014;color:#e7ecf1;
  font:14px/1.5 ui-sans-serif,system-ui,"Segoe UI",sans-serif}
h1{font-size:20px;letter-spacing:.14em;text-transform:uppercase;margin:0 0 6px;font-weight:700}
section{margin:34px 0 0}
h2{font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#8fd23f;
  margin:0 0 12px;padding-bottom:8px;border-bottom:1px solid #232a32}
main{display:block}
section{display:grid;grid-template-columns:repeat(2,1fr);gap:18px 20px}
section h2{grid-column:1/-1}
figure{margin:0;background:#141a20;border:1px solid #232a32;border-radius:8px;overflow:hidden}
img{display:block;width:100%;height:auto}
figcaption{padding:9px 12px 11px;font-size:13px;color:#aab4bf}
figcaption b{color:#e7ecf1;font-weight:600}
.repro{display:block;margin-top:5px;font:11px/1.45 ui-monospace,Consolas,monospace;color:#6f7c88;
  word-break:break-all}
`;

export { evaluate, wait };
