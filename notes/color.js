/* The colour picker: a saturation/brightness field, H/S/B sliders, a hex
 * input, and sixteen custom slots that follow the document between devices.
 *
 * The maths is the old app's, kept because it was right. What is gone is the
 * lock/select machinery on the slots: a slot is filled by clicking it while
 * empty, applied by clicking it while full, and cleared from its own menu.
 */

import { el } from './dom.js';
import { panel, closePanel, toast, ICON } from './ui.js';

let ctx = null;
export function initColor(context) { ctx = context; }

export function hsbToHex(h, s, b) {
  s /= 100; b /= 100;
  const k = (n) => (n + h / 60) % 6;
  const f = (n) => b - b * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  const c = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${c(f(5))}${c(f(3))}${c(f(1))}`;
}

export function hexToHsb(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255; const g = ((n >> 8) & 255) / 255; const b = (n & 255) / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: Math.round(h * 360), s: Math.round(max ? (d / max) * 100 : 0), b: Math.round(max * 100) };
}

function relLum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a, b) {
  const la = relLum(a);
  const lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* Black or white on a fill of `hex`, whichever is actually more readable.
 * The old weighted-average-over-0.55 rule is a rule of thumb and it gets
 * mid-tones wrong: a light blue came out white-on-blue, which is what the
 * plus in the New category button looked like. This measures both. */
export function contrastOn(hex) {
  return contrast(hex, '#000000') >= contrast(hex, '#ffffff') ? '#000000' : '#ffffff';
}


/* ---- what a colour becomes ------------------------------------------------
 *
 * A category's colour is the whole category: its surfaces AND its text.
 *
 * THE SURFACE. One of them: the title strip. It is a FAINT wash of the
 * colour, a step from the field under it rather than a statement -- enough to
 * say which category the bar belongs to, not enough to compete with the name
 * printed on it. `headHi` is that strip under the pointer, and the strip is
 * the only thing that lights when a category is hovered: the text field is
 * not what you are pointing at when you point at a category.
 *
 * THE TEXT, as a hierarchy of three:
 *
 *   title  the category's name, its sidebar row, its rail letter. THE COLOUR
 *          ITSELF -- the whole point of choosing one is to see it on the
 *          name. It moves only if it would not be readable where it sits.
 *   bold   bold text and headings: duller, and one step further from the box.
 *   body   the lines being read: dullest, and one step further again.
 *
 * The hierarchy is carried by SATURATION, not by brightness. A paragraph in a
 * fully saturated colour is tiring to read and competes with the name above
 * it; this leaves the reading text nearly neutral and still unmistakably this
 * category's, and puts all of the colour where the eye is meant to land.
 *
 * "One step further from the box" is lighter on the dark theme and darker on
 * the light one -- on the light theme the step is spent on saturation alone,
 * because the tiers must all stay dark enough to read on a pale ground.
 *
 * EVERY TIER IS THEN PUSHED UNTIL IT IS ACTUALLY READABLE on every surface it
 * appears on. Without that, picking a dark navy paints its own notes
 * invisible -- and the picker is a free-form HSB field, so that is one drag
 * away, not a hypothetical. The title is floored against three grounds
 * because it appears on three: its own strip, the canvas, and the sidebar.
 */

/* The grounds a tier can land on, with the light values already composited
 * over their background -- contrast maths cannot see through alpha.
 *
 * THE BOX IS NEUTRAL AND STAYS NEUTRAL. A tinted note box was tried and taken
 * back out: a wash of the category's colour behind a whole screen of text is
 * a lot of colour to read on, and it left the app looking like a set of
 * coloured cards rather than a set of notes. The colour lives on the title
 * strip and in the text; the field the words sit on is the theme's.
 *
 * darkBox is --bg3 rather than --bg2 -- the LIGHTER of the two states the box
 * can be in, which is the harder one for light text to be read on. */
const GROUND = {
  darkBox: '#1a1e26', darkPage: '#0b0d11', darkSide: '#11141a',
  lightBox: '#d3d7dc', lightPage: '#c8ccd3', lightSide: '#c9ced5',
};

/* One step away from the background. Brightness first; once that is spent,
 * saturation -- because "lighter" past full brightness means toward white,
 * and a fully-bright colour has nowhere else to go. */
function step(h, s, b, amount, dark) {
  if (dark) {
    const room = 100 - b;
    const use = Math.min(amount, room);
    return { h, s: Math.max(0, s - (amount - use) * 1.6), b: b + use };
  }
  const room = b;
  const use = Math.min(amount, room);
  return { h, s: Math.min(100, s + (amount - use)), b: b - use };
}

/* Walk away from every ground until the contrast target is met on all of
 * them, or until there is nowhere left to walk.
 *
 * `exact` is the hex as it was PICKED, and it is the first candidate tried.
 * Without it the first candidate is a round trip through HSB, which loses a
 * unit in a channel -- #ff3bd0 came back as #ff3bd1 -- and "the title is the
 * colour you chose" has to be true to the byte or it is not true. */
function floor(h, s, b, grounds, target, dark, exact) {
  let cur = { h, s, b };
  for (let i = 0; i < 70; i++) {
    const hex = i === 0 && exact ? exact : hsbToHex(cur.h, cur.s, cur.b);
    if (grounds.every((g) => contrast(hex, g) >= target)) return hex;
    const next = step(cur.h, cur.s, cur.b, 2, dark);
    if (next.s === cur.s && next.b === cur.b) return hex;
    cur = next;
  }
  return hsbToHex(cur.h, cur.s, cur.b);
}

export function tints(hex, dark) {
  const { h, s, b } = hexToHsb(hex);
  const page = dark ? GROUND.darkPage : GROUND.lightPage;
  const side = dark ? GROUND.darkSide : GROUND.lightSide;

  const box = dark ? GROUND.darkBox : GROUND.lightBox;
  /* The strip. Saturation is CAPPED rather than merely scaled: at the picked
     saturation a pastel would come out grey and a neon would come out as a
     colour in its own right rather than as a wash of one. The cap is low --
     this is a tint under a title, and the title is the thing to be read. */
  const head = dark ? hsbToHex(h, Math.min(40, s * 0.5), 14)
    : hsbToHex(h, Math.min(26, s * 0.26), 90);
  const headHi = dark ? hsbToHex(h, Math.min(38, s * 0.48), 20)
    : hsbToHex(h, Math.min(30, s * 0.3), 84);

  /* The selection behind the words, and the caret between them. A selection
   * is the one place the colour is a BACKGROUND, so it goes the other way:
   * deep on the dark theme, pale on the light one, always far enough from the
   * body text to leave it legible. */
  const sel = dark ? hsbToHex(h, Math.min(100, s * 0.95), 30) : hsbToHex(h, Math.min(100, s * 0.5), 84);

  /* Each tier keeps a FLOOR of saturation. Running the lower tiers through
     step() alone spent the whole difference on saturation whenever the pick
     was already at full brightness -- which is most picks -- and the reading
     text came out plain white with no trace of the category in it. The floor
     is capped at the picked saturation, so a deliberately grey pick still
     yields grey text rather than being tinted up to meet a minimum. */
  const dull = (mult, min) => Math.min(s, Math.max(min, s * mult));
  const lift = (amount) => (dark ? Math.min(100, b + amount) : b);
  /* THE TITLE IS THE HEX, verbatim, whenever it is readable where it lands.
     That is the whole contract of picking a colour: the session's name, its
     badge letter, every category name and every sidebar row wear the value
     you chose, not a derivation of it. It moves only for a pick that would be
     invisible -- and on the light theme, where a pastel on a pale ground has
     to darken to be read at all. */
  const title = floor(h, s, b, [head, page, side], 5, dark, hex);
  const bold = floor(h, dull(0.58, 24), lift(6), [box], 5.2, dark);
  const body = floor(h, dull(0.30, 15), lift(14), [box], 5.4, dark);

  /* If the pick leaves the words too close to their own highlight, push the
   * highlight rather than the words: what is being read must not change
   * colour because some of it is selected. */
  let selection = sel;
  for (let i = 0; i < 24 && contrast(body, selection) < 3; i++) {
    const c = hexToHsb(selection);
    selection = hsbToHex(c.h, Math.max(0, c.s - 3), dark ? Math.max(0, c.b - 3) : Math.min(100, c.b + 3));
  }
  return { body, bold, title, head, headHi, sel: selection, on: contrastOn(hex) };
}

const HEX = /^#?([0-9a-f]{6})$/i;
const SHORT = /^#?([0-9a-f]{3})$/i;
function parseHex(s) {
  const m = HEX.exec(String(s).trim());
  if (m) return `#${m[1].toLowerCase()}`;
  const k = SHORT.exec(String(s).trim());
  if (k) return `#${[...k[1]].map((c) => c + c).join('').toLowerCase()}`;
  return null;
}

/* open(anchor, { title, value, onChange(hex), onClear() }) */
export function openColor(anchor, { title, value, onChange, onClear }) {
  let { h, s, b } = hexToHsb(value || '#5cc8ff');
  let current = value || hsbToHex(h, s, b);

  const field = el('div', { class: 'nt-clr-field' });
  const canvas = el('canvas', { width: '224', height: '140' });
  const cursor = el('div', { class: 'nt-clr-cursor' });
  field.append(canvas, cursor);
  const sliders = {};
  const row = (key, max) => {
    const input = el('input', { type: 'range', min: '0', max: String(max), class: `nt-clr-slider is-${key}` });
    sliders[key] = input;
    input.addEventListener('input', () => {
      if (key === 'h') h = Number(input.value); else if (key === 's') s = Number(input.value); else b = Number(input.value);
      apply(hsbToHex(h, s, b));
    });
    return el('div', { class: 'nt-clr-row' }, el('span', { class: 'nt-clr-label', text: key.toUpperCase() }), input);
  };
  const hex = el('input', { type: 'text', class: 'nt-input nt-clr-hex', maxlength: '7', spellcheck: 'false', autocomplete: 'off' });
  hex.addEventListener('input', () => { const p = parseHex(hex.value); if (p && hex.value.replace('#', '').length === 6) { ({ h, s, b } = hexToHsb(p)); apply(p, true); } });
  hex.addEventListener('change', () => { const p = parseHex(hex.value); if (p) { ({ h, s, b } = hexToHsb(p)); apply(p); } else hex.value = current; });
  hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); closePanel(); } });
  const swatch = el('span', { class: 'nt-clr-swatch' });
  const copy = el('button', { type: 'button', class: 'nt-icon-btn', 'data-tip': 'Copy hex', html: ICON.copy, onclick: () => navigator.clipboard.writeText(current).then(() => toast(`Copied ${current}`)) });
  const eye = window.EyeDropper ? el('button', { type: 'button', class: 'nt-icon-btn', 'data-tip': 'Pick from screen', html: ICON.eye, onclick: async () => {
    try { const r = await new window.EyeDropper().open(); const p = parseHex(r.sRGBHex); if (p) { ({ h, s, b } = hexToHsb(p)); apply(p); } } catch { /* cancelled */ }
  } }) : null;

  const slots = el('div', { class: 'nt-clr-slots' });
  const drawSlots = () => {
    slots.replaceChildren(...ctx.doc.ui.slots.map((c, i) => {
      const sl = el('button', { type: 'button', class: `nt-clr-slot ${c ? 'is-full' : ''}`, 'data-tip': c || 'Save current colour here', html: c ? '' : ICON.plus });
      if (c) sl.style.background = c;
      sl.addEventListener('click', () => {
        if (c) { ({ h, s, b } = hexToHsb(c)); apply(c); }
        else { ctx.doc.ui.slots[i] = current; ctx.uiChanged(); drawSlots(); }
      });
      sl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!c) return;
        ctx.doc.ui.slots[i] = '';
        ctx.uiChanged();
        drawSlots();
      });
      return sl;
    }));
  };
  drawSlots();

  const clear = onClear ? el('button', { type: 'button', class: 'nt-btn is-small', text: 'Use default', onclick: () => { onClear(); closePanel(); } }) : null;
  const box = el('div', { class: 'nt-clr' },
    el('div', { class: 'nt-clr-head' }, el('span', { class: 'nt-clr-title', text: title || 'Colour' }), clear),
    field, row('h', 360), row('s', 100), row('b', 100),
    el('div', { class: 'nt-clr-hexrow' }, el('span', { class: 'nt-clr-hash', text: '#' }), hex, copy, eye, swatch),
    slots,
    el('p', { class: 'nt-clr-hint', text: 'Click an empty slot to save the colour. Right-click a slot to clear it.' }));

  const draw = () => {
    const g = canvas.getContext('2d');
    g.fillStyle = hsbToHex(h, 100, 100);
    g.fillRect(0, 0, canvas.width, canvas.height);
    const white = g.createLinearGradient(0, 0, canvas.width, 0);
    white.addColorStop(0, 'rgba(255,255,255,1)'); white.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = white; g.fillRect(0, 0, canvas.width, canvas.height);
    const black = g.createLinearGradient(0, 0, 0, canvas.height);
    black.addColorStop(0, 'rgba(0,0,0,0)'); black.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = black; g.fillRect(0, 0, canvas.width, canvas.height);
    cursor.style.left = `${(s / 100) * 100}%`;
    cursor.style.top = `${(1 - b / 100) * 100}%`;
    cursor.style.background = current;
    sliders.h.value = h; sliders.s.value = s; sliders.b.value = b;
    sliders.s.style.background = `linear-gradient(to right, ${hsbToHex(h, 0, b)}, ${hsbToHex(h, 100, b)})`;
    sliders.b.style.background = `linear-gradient(to right, #000, ${hsbToHex(h, s, 100)})`;
    swatch.style.background = current;
  };
  const apply = (val, fromHex) => {
    current = val;
    if (!fromHex) hex.value = val.slice(1);
    draw();
    onChange(val);
  };

  let down = false;
  const pickAt = (e) => {
    const r = field.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    s = Math.round(x * 100); b = Math.round((1 - y) * 100);
    apply(hsbToHex(h, s, b));
  };
  field.addEventListener('pointerdown', (e) => { down = true; field.setPointerCapture(e.pointerId); pickAt(e); e.preventDefault(); });
  field.addEventListener('pointermove', (e) => { if (down) pickAt(e); });
  field.addEventListener('pointerup', () => { down = false; });
  field.addEventListener('pointercancel', () => { down = false; });

  panel({ className: 'nt-clr-panel', content: box, anchor, align: 'left', keepFocus: false });
  hex.value = current.slice(1);
  draw();
  setTimeout(() => { hex.focus(); hex.select(); }, 0);
}
