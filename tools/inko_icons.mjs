/* Every Inko icon from ONE file: inko/icon.svg.
 *
 *   CHROME=<path to chrome> node tools/inko_icons.mjs v3
 *
 * Change inko/icon.svg, then run this with the next version name. It renders
 * every PNG the icon appears as, gives them the new name, rewrites every
 * reference to the old name and deletes the old files. The same rule as
 * tools/dexnote_icons.mjs (Dex, 2026-10-09: change an icon and it changes
 * everywhere).
 *
 * WHERE THE ICON IS USED (keep this list true):
 *   inko/icon.svg                     the AI Lab card (index.html, by path --
 *                                     so it follows the file with no step here)
 *   inko/icon-192-<v>.png             manifest "any"
 *   inko/icon-512-<v>.png             manifest "any maskable"
 *     The phone icons draw the master at 80% on a square of its background:
 *     the S at the scale the app always had (Dex: "the S on the app looks like
 *     a much better scale"), and the ring inside the maskable safe circle, so
 *     a round launcher never cuts it. The card shows the master at 100%.
 *   inko/icon-mono-192-<v>.png        manifest "monochrome": the ring and the S
 *   inko/icon-mono-512-<v>.png        in white on nothing
 *   inko/apple-touch-icon-<v>.png     iOS home screen (inko/index.html)
 * and the names in inko/sw.js (ICONS). assets/icons/apps/inko.png is an OLD
 * mark nothing references; it is not this icon.
 *
 * WHY A NEW NAME: an installed phone app refetches its icon when the manifest
 * names a different file; same name and new bytes may never reach it. */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEXT = process.argv[2];
if (!/^v\d+$/.test(NEXT || '')) throw new Error('usage: node tools/inko_icons.mjs v<N>  (the NEXT version name)');
const CHROME = [process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');

const manifest = readFileSync(join(ROOT, 'inko/manifest.webmanifest'), 'utf8');
/* The first icons had no version: "" stands for that. */
const CUR = (manifest.match(/"icon-192(-v\d+)?\.png"/) || [])[1] ?? (/"icon-192\.png"/.test(manifest) ? '' : null);
if (CUR === null) throw new Error('could not read the current icon name out of inko/manifest.webmanifest');
if (CUR === `-${NEXT}`) throw new Error(`${NEXT} is already the current version; pick the next one`);

const master = readFileSync(join(ROOT, 'inko/icon.svg'), 'utf8');
const vb = master.match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/);
const bg = (master.match(/<circle[^>]*fill="(#[0-9a-fA-F]{3,6})"/) || [])[1];
if (!vb || !bg) throw new Error('the master no longer has a viewBox and a filled <circle>');
const inner = master.slice(master.indexOf('>', master.indexOf('<svg')) + 1, master.lastIndexOf('</svg>'));
/* The square icons: the master on a full-bleed square of its own background,
   at full size or at 80% (`scale`) for the maskable one. */
const [x, y, w] = vb.slice(1, 4).map(Number);
const square = (size, body, fill, scale = 1) => {
  const pad = (w / scale - w) / 2, X = x - pad, Y = y - pad, W = w + 2 * pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${X} ${Y} ${W} ${W}">${fill ? `<rect x="${X}" y="${Y}" width="${W}" height="${W}" fill="${fill}"/>` : ''}${body}</svg>`;
};
/* Monochrome: only the shapes, white. The disc goes hollow (the ring stays),
   the S's gradient layers become one white fill. */
const mono = inner
  .replace(/<circle([^>]*?)fill="#[0-9a-fA-F]{3,6}"([^>]*?)stroke="url\(#[^)]+\)"/, '<circle$1fill="none"$2stroke="#fff"')
  .replace(/fill="url\(#(warmGlow|coolGlow)\)"/g, 'fill="none"')
  .replace(/fill="url\(#sGradient\)"/, 'fill="#fff"');
if (!/stroke="#fff"/.test(mono) || !/fill="#fff"/.test(mono)) throw new Error('the master no longer has the ring and S this script expects');

const OUT = [
  [`inko/icon-512-${NEXT}.png`, square(512, inner, bg, 0.8), 512, false],
  [`inko/icon-192-${NEXT}.png`, square(192, inner, bg, 0.8), 192, false],
  [`inko/apple-touch-icon-${NEXT}.png`, square(180, inner, bg, 0.8), 180, false],
  [`inko/icon-mono-512-${NEXT}.png`, square(512, mono, null, 0.8), 512, true],
  [`inko/icon-mono-192-${NEXT}.png`, square(192, mono, null, 0.8), 192, true],
];
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
for (const [file, svg, size, clear] of OUT) {
  const p = await b.newPage();
  await p.setViewport({ width: size, height: size });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await p.screenshot({ path: join(ROOT, file), omitBackground: clear, clip: { x: 0, y: 0, width: size, height: size } });
  await p.close();
  console.log(`wrote ${file} (${size}px)`);
}
await b.close();

const REFS = ['inko/manifest.webmanifest', 'inko/sw.js', 'inko/index.html'];
const NAMES = ['icon-192%.png', 'icon-512%.png', 'icon-mono-192%.png', 'icon-mono-512%.png', 'apple-touch-icon%.png'];
let n = 0;
for (const f of REFS) {
  let s = readFileSync(join(ROOT, f), 'utf8');
  for (const name of NAMES) {
    /* Bounded by a quote or a slash so icon-192.png never matches inside icon-mono-192.png. */
    const re = new RegExp(`(["'/])${name.replace('%', CUR).replace(/[.\-]/g, '\\$&')}`, 'g');
    s = s.replace(re, (m, lead) => { n++; return lead + name.replace('%', `-${NEXT}`); });
  }
  writeFileSync(join(ROOT, f), s);
}
for (const name of NAMES) { const old = join(ROOT, 'inko', name.replace('%', CUR)); if (existsSync(old)) unlinkSync(old); }
/* 10 today: 4 in the manifest, 5 in sw.js, 1 in index.html. Fewer means one
   was renamed by hand somewhere. Raise it when you add one. */
const EXPECTED = 10;
if (n < EXPECTED) throw new Error(`only ${n} references to the old names were rewritten; expected ${EXPECTED}`);
console.log(`icons${CUR || ' (unversioned)'} -> -${NEXT}: ${n} references rewritten in ${REFS.length} files, old files removed. Now run tools/inko_check.mjs and commit.`);
