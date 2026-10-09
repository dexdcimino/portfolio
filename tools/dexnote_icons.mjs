/* Every dexnote icon from ONE file: assets/icons/apps/dexnote.svg.
 *
 *   CHROME=<path to chrome> node tools/dexnote_icons.mjs v3
 *
 * Change the colours in that SVG, then run this with the next version name.
 * It renders every PNG the icon appears as, gives the phone app's files the
 * new name and rewrites every reference to the old name, then deletes the old
 * files. Dex, 2026-10-09: "update it everywhere ... on the app that's getting
 * downloaded, on the app that's on my website, on the sign-in modal".
 *
 * WHERE THE ICON IS USED (keep this list true; the script owns all of it):
 *   assets/icons/apps/dexnote.png          AI Lab card (index.html <!-- img -->;
 *                                          the commit hook bakes its derivatives)
 *   dexnote/icons/logo-<v>.svg             the sign-in card (dexnote/account.js),
 *                                          the loader and install sheet
 *                                          (dexnote/main.js), the tab favicon
 *                                          (dexnote/index.html)
 *   dexnote/icons/icon-192-<v>.png         manifest "any"
 *   dexnote/icons/icon-512-<v>.png         manifest "any"
 *   dexnote/icons/icon-maskable-512-<v>.png  manifest "maskable" (mark at 72%)
 *   dexnote/icons/apple-touch-icon-<v>.png iOS home screen (dexnote/index.html)
 *   dexnote/icons/icon-mono-512.png        manifest "monochrome": the SHAPE only,
 *                                          so a colour change leaves it alone
 * and the names in dexnote/sw.js (ICONS) and tools/dexnote_*check.mjs.
 *
 * WHY A NEW NAME AND NOT NEW BYTES: dexnote/sw.js serves /dexnote/icons/
 * cache-first, and an installed phone app only refetches its icon when the
 * manifest names a different file. Same name, new bytes = the old icon forever.
 *
 * NOT this icon: the notes app's own mark beside a session (notes/render.js) is
 * drawn in the session's colour on purpose, and the site's favicon is
 * tools/bake_favicon.py. */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEXT = process.argv[2];
if (!/^v\d+$/.test(NEXT || '')) throw new Error('usage: node tools/dexnote_icons.mjs v<N>  (the NEXT version name)');
const CHROME = [process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');

const manifest = readFileSync(join(ROOT, 'dexnote/manifest.webmanifest'), 'utf8');
const CUR = (manifest.match(/icon-192-(v\d+)\.png/) || [])[1];
if (!CUR) throw new Error('could not read the current version out of dexnote/manifest.webmanifest');
if (CUR === NEXT) throw new Error(`${NEXT} is already the current version; pick the next one`);

const master = readFileSync(join(ROOT, 'assets/icons/apps/dexnote.svg'), 'utf8');
const body = master.slice(master.indexOf('>', master.indexOf('<svg')) + 1, master.lastIndexOf('</svg>'));
/* Square and full-bleed: drop the rounded corners (iOS and Android mask their own). */
const square = body.replace(/(<rect width="128" height="128")[^/]*?(fill=)/, '$1 $2');
/* Maskable: square, mark scaled into the safe circle. */
const maskable = square.replace(/<g fill="([^"]+)">/, '<g fill="$1" transform="translate(64 64) scale(.72) translate(-64 -64)">');
if (square === body || maskable === square) throw new Error('the master no longer has the shape this script expects (a 128 rect, then <g fill=...>)');
const svg = (inner, size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}">${inner}</svg>`;

const OUT = [
  ['assets/icons/apps/dexnote.png', body, 512, true],
  [`dexnote/icons/icon-512-${NEXT}.png`, body, 512, true],
  [`dexnote/icons/icon-192-${NEXT}.png`, body, 192, true],
  [`dexnote/icons/icon-maskable-512-${NEXT}.png`, maskable, 512, false],
  [`dexnote/icons/apple-touch-icon-${NEXT}.png`, square, 180, false],
];
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
for (const [file, inner, size, clear] of OUT) {
  const p = await b.newPage();
  await p.setViewport({ width: size, height: size });
  await p.setContent(`<html><body style="margin:0;background:${clear ? 'transparent' : '#000'}">${svg(inner, size)}</body></html>`);
  await p.screenshot({ path: join(ROOT, file), omitBackground: clear, clip: { x: 0, y: 0, width: size, height: size } });
  await p.close();
  console.log(`wrote ${file} (${size}px)`);
}
await b.close();
writeFileSync(join(ROOT, `dexnote/icons/logo-${NEXT}.svg`), master);
console.log(`wrote dexnote/icons/logo-${NEXT}.svg`);

const REFS = ['dexnote/manifest.webmanifest', 'dexnote/sw.js', 'dexnote/index.html', 'dexnote/main.js', 'dexnote/account.js',
  'tools/dexnote_check.mjs', 'tools/dexnote_phone_check.mjs'];
const NAMES = ['logo-%.svg', 'icon-192-%.png', 'icon-512-%.png', 'icon-maskable-512-%.png', 'apple-touch-icon-%.png'];
let n = 0;
for (const f of REFS) {
  let s = readFileSync(join(ROOT, f), 'utf8');
  for (const name of NAMES) { const [a, z] = [name.replace('%', CUR), name.replace('%', NEXT)]; n += s.split(a).length - 1; s = s.split(a).join(z); }
  writeFileSync(join(ROOT, f), s);
}
for (const name of NAMES) { const old = join(ROOT, 'dexnote/icons', name.replace('%', CUR)); if (existsSync(old)) unlinkSync(old); }
/* 16 today: 5 in sw.js, 3 in the manifest, 2 in index.html, 2 in main.js, 1 in
   account.js, 3 in the checks. Fewer means a reference was renamed by hand
   somewhere -- say so rather than ship half an icon. Raise it when you add one. */
const EXPECTED = 16;
if (n < EXPECTED) throw new Error(`only ${n} references to the ${CUR} names were rewritten; expected ${EXPECTED}`);
console.log(`${CUR} -> ${NEXT}: ${n} references rewritten in ${REFS.length} files, old files removed. Now run the dexnote checks and commit.`);
