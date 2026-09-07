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

export function contrastOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255; const g = ((n >> 8) & 255) / 255; const b = (n & 255) / 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 0.55 ? '#000000' : '#ffffff';
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
