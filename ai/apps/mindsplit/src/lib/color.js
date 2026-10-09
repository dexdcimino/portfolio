/* Colour maths. Every surface in the app is mix()ed from a hex, and every
   piece of text on a coloured surface takes its colour from inkOn(), which
   picks near-black or near-white by WCAG contrast. Never write
   hsl(hue, sat, lowLightness): that is what turned orange into brown and
   yellow into olive the first time round. */

export const INK = "#0D0B13";
export const PAPER = "#FFFFFF";

export const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const rgb2hex = (r) => "#" + r.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
export const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A.map((v, i) => v + (B[i] - v) * t)); };
export const lum = (h) => {
  const f = (c) => { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); };
  const [r, g, b] = hex2rgb(h);
  return .2126 * f(r) + .7152 * f(g) + .0722 * f(b);
};
export const ratio = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
const L_INK = lum(INK), L_PAPER = lum(PAPER);
export const inkOn = (bg) => (ratio(lum(bg), L_INK) >= ratio(lum(bg), L_PAPER) ? INK : "#FBFAFE");
export const rgba = (h, a) => { const [r, g, b] = hex2rgb(h); return `rgba(${r},${g},${b},${a})`; };
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
