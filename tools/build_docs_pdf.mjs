/**
 * Generate the downloadable PDFs by printing the REAL documents overlay.
 *
 * WHY THIS SHAPE
 * Two generations of this tool extracted the panel markup and rebuilt it
 * against a template — first its own white "document" sheet (shipped as a
 * two-page black-and-white file), then an inlined copy of styles.css (dark,
 * but still a reconstruction that could drift). Per MD, reconstruction is
 * retired entirely: this drives the site's actual overlay — the same route,
 * DOM state, stylesheet, fonts and accent a visitor sees — and calls the
 * browser's native PDF export on it. The print mapping itself lives in
 * styles.css (@media print), so a visitor hitting Ctrl+P on the open overlay
 * gets the same document, and any future style change flows through with no
 * work here.
 *
 * ACCENT
 * The accent is per-visitor state (localStorage 'dex-accent-name'), so one
 * static PDF cannot match everyone. Every accent is rendered — 2 documents x
 * every entry in script.js's ACCENTS — and script.js aims the download link at
 * the visitor's own variant. The accent list is read out of script.js rather
 * than restated here, so adding an accent adds its PDFs on the next build.
 * The two legacy paths (assets/about/Dex_Cimino_*.pdf) stay as copies of the
 * default-accent files so existing external links keep resolving.
 *
 * FIT
 * .resume-page is 816x1056 CSS px — exactly US Letter at 96dpi — so @page
 * Letter with zero margins maps it 1:1. Content taller than one sheet (the
 * resume, currently) is shrunk uniformly via --print-fit rather than
 * paginated, and the shrink is reported: past a point that is a
 * content-length problem, not a rendering one.
 *
 *   node tools/build_docs_pdf.mjs [baseUrl]      default http://127.0.0.1:8784
 *
 * Needs Chrome listening on --remote-debugging-port=9333 (the same instance
 * the rest of the tooling uses) and the site served at baseUrl. Verify with
 * --check, which fails if any variant is missing or the panel markup changed
 * since the last build.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { argv, exit } from 'node:process';
import puppeteer from 'puppeteer-core';

const BASE = argv.find(a => a.startsWith('http')) || 'http://127.0.0.1:8784';
const CHECK = argv.includes('--check');
const SHEET_PX = 1056;              // 11in at 96dpi — .resume-page's own height
const OUT_DIR = 'assets/about/pdf';

const DOCS = [
  { tab: 'tab-resume', panel: 'panel-resume', stem: 'Dex_Cimino_Resume', legacy: 'assets/about/Dex_Cimino_Resume.pdf' },
  { tab: 'tab-cover', panel: 'panel-cover', stem: 'Dex_Cimino_Cover', legacy: 'assets/about/Dex_Cimino_Cover.pdf' },
];

/* One source of truth for the accent list: the site's own ACCENTS table. */
function accentNames() {
  const js = readFileSync('script.js', 'utf8');
  const block = js.slice(js.indexOf('const ACCENTS = ['), js.indexOf('];', js.indexOf('const ACCENTS = [')));
  const names = [...block.matchAll(/name:\s*'([a-z]+)'/g)].map(m => m[1]);
  if (names.length < 2) throw new Error('could not read ACCENTS out of script.js');
  return names;
}
const DEFAULT_ACCENT = 'lime';

/* Staleness is judged on the SOURCE MARKUP, not file times — Chrome stamps a
   creation date into every PDF, so bytes differ on identical content. */
const STAMP = 'tools/.docs-source-hash';

function sourceHash() {
  const html = readFileSync('index.html', 'utf8');
  const parts = DOCS.map(d => {
    const i = html.indexOf('id="' + d.panel + '"');
    if (i === -1) throw new Error('could not find ' + d.panel + ' in index.html');
    const j = html.indexOf('</article>', i);
    if (j === -1) throw new Error('unterminated ' + d.panel + ' panel');
    return html.slice(i, j);
  });
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

const variants = () => DOCS.flatMap(d => accentNames().map(a => `${OUT_DIR}/${d.stem}-${a}.pdf`));

if (CHECK) {
  const want = sourceHash();
  const have = existsSync(STAMP) ? readFileSync(STAMP, 'utf8').trim() : '(none)';
  const missing = [...variants(), ...DOCS.map(d => d.legacy)].filter(f => !existsSync(f));
  if (missing.length || want !== have) {
    if (missing.length) console.log('build_docs_pdf --check: missing ' + missing.join(', '));
    if (want !== have) console.log(`build_docs_pdf --check: letter markup changed (${have} -> ${want})`);
    console.log('Run: node tools/build_docs_pdf.mjs');
    exit(1);
  }
  console.log(`build_docs_pdf --check: ${variants().length + DOCS.length} PDFs present and current with the markup`);
  exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: { width: 1600, height: 1000 } });

for (const accent of accentNames()) {
  const page = await browser.newPage();
  // The accent has to be in place before the site's boot script reads it —
  // this is exactly the state a returning visitor's browser is in.
  await page.evaluateOnNewDocument(a => localStorage.setItem('dex-accent-name', a), accent);
  await page.goto(`${BASE}/?pdf=${Date.now()}`, { waitUntil: 'load' });

  for (const doc of DOCS) {
    // The real open path, then the app's own readiness signals: the dialog's
    // open state is the overlay's "rendered" flag (there is no later event to
    // wait for — the panels are static text), fonts.ready covers type, and
    // two rAFs let layout commit. No fixed timeouts.
    await page.click('[data-resume-open]');
    await page.waitForFunction(() => document.getElementById('resumeModal').open);
    await page.click(`#${doc.tab}`);
    await page.waitForFunction(
      t => document.getElementById(t).getAttribute('aria-selected') === 'true', {}, doc.tab);
    await page.waitForFunction(p => {
      const el = document.getElementById(p);
      return !el.hidden && el.offsetHeight > 0;
    }, {}, doc.panel);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    });

    // Fit factor, measured UNDER PRINT MEDIA. Screen and print reflow the
    // panel a few px differently (1237 vs 1241 on the current resume), and a
    // factor computed from the screen height came out 3px long — which in
    // print is not "3px long" but a second page. Measure in the same media
    // the PDF renders in and the factor is exact by construction.
    await page.emulateMediaType('print');
    const fit = await page.evaluate((p, sheet) => {
      document.documentElement.style.setProperty('--print-fit', '1');
      const el = document.getElementById(p);
      const h = el.scrollHeight;                       // print zoom is 1 now
      const f = Math.min(1, Math.floor((sheet / h) * 1e4) / 1e4);
      document.documentElement.style.setProperty('--print-fit', String(f));
      return { h, f };
    }, doc.panel, SHEET_PX);

    const out = `${OUT_DIR}/${doc.stem}-${accent}.pdf`;
    await page.pdf({ path: out, printBackground: true, preferCSSPageSize: true });
    await page.emulateMediaType('screen');
    const note = fit.f < 1 ? `${fit.h}px fitted at ${(fit.f * 100).toFixed(1)}%` : 'fits at 100%';
    console.log(`  ${out}  (${note})`);

    // Close so the next document goes through the real open path too.
    await page.evaluate(() => document.getElementById('resumeClose').click());
    await page.waitForFunction(() => !document.getElementById('resumeModal').open);
  }
  await page.close();
}

for (const doc of DOCS) copyFileSync(`${OUT_DIR}/${doc.stem}-${DEFAULT_ACCENT}.pdf`, doc.legacy);
console.log(`  legacy paths refreshed from the ${DEFAULT_ACCENT} variants`);

await browser.disconnect();
writeFileSync(STAMP, sourceHash() + String.fromCharCode(10));
console.log('build_docs_pdf: done — the downloads are prints of the live overlay');
