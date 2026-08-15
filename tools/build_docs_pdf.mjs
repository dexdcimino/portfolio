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
 * TWO FILES, DEFAULT ACCENT — the per-accent variants (14 files under
 * assets/about/pdf/) were rolled back by MD: the artifacts are exactly
 * Dex_Cimino_Resume.pdf and Dex_Cimino_Cover.pdf, printed in the site's
 * default accent. The overlay-print machinery is unchanged, so restoring
 * variants later is re-adding the accent loop, nothing more.
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
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { argv, exit } from 'node:process';
import puppeteer from 'puppeteer-core';

const BASE = argv.find(a => a.startsWith('http')) || 'http://127.0.0.1:8784';
const CHECK = argv.includes('--check');
const SHEET_PX = 1056;              // 11in at 96dpi — .resume-page's own height

const DOCS = [
  { tab: 'tab-resume', panel: 'panel-resume', out: 'assets/about/Dex_Cimino_Resume.pdf' },
  { tab: 'tab-cover', panel: 'panel-cover', out: 'assets/about/Dex_Cimino_Cover.pdf' },
];

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

if (CHECK) {
  const want = sourceHash();
  const have = existsSync(STAMP) ? readFileSync(STAMP, 'utf8').trim() : '(none)';
  const missing = DOCS.map(d => d.out).filter(f => !existsSync(f));
  if (missing.length || want !== have) {
    if (missing.length) console.log('build_docs_pdf --check: missing ' + missing.join(', '));
    if (want !== have) console.log(`build_docs_pdf --check: letter markup changed (${have} -> ${want})`);
    console.log('Run: node tools/build_docs_pdf.mjs');
    exit(1);
  }
  console.log(`build_docs_pdf --check: ${DOCS.length} PDFs present and current with the markup`);
  exit(0);
}

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: { width: 1600, height: 1000 } });

{
  const page = await browser.newPage();
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

    // Fit factor, measured UNDER PRINT MEDIA and converged, not computed once.
    // Two lessons are baked in here. Screen and print reflow the panel a few
    // px differently, so the measurement must happen in the media the PDF
    // renders in. And the content's height CHANGES with the zoom it is
    // measured under — 1237px at zoom 1 became 1241px at zoom 0.8536 from
    // line-box rounding, and a factor derived from the zoom-1 height left the
    // page 3px long, which in print is not 3px long but a second page. So:
    // apply the factor, re-measure the actual zoomed box, tighten, repeat
    // until the box genuinely fits the sheet.
    await page.emulateMediaType('print');
    const fit = await page.evaluate(async (p, sheet) => {
      const el = document.getElementById(p);
      const root = document.documentElement;
      const settle = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      // The print sheet couples the page's layout width to 1/fit, so any fit
      // fills the sheet edge to edge; the only question is the LARGEST fit
      // whose reflowed content still fits one sheet tall. Shrinking the fit
      // widens the measure and shortens the content, so fitness is monotonic
      // and the answer is found by bisection against the real rendered box —
      // the box is re-measured every probe precisely because content height
      // changes under both the zoom and the width it is laid out at.
      const fits = async f => {
        root.style.setProperty('--print-fit', String(f));
        await settle();
        return el.getBoundingClientRect().height <= sheet + 0.01;
      };
      root.style.setProperty('--print-fit', '1');
      await settle();
      const h = el.scrollHeight;
      if (h <= sheet) return { h, f: 1, box: +el.getBoundingClientRect().height.toFixed(1) };
      let lo = Math.floor((sheet / h) * 1e4) / 1e4;   // fits: narrower measure already did
      let hi = 1;                                     // does not fit
      for (let i = 0; i < 10; i++) {
        const mid = Math.floor(((lo + hi) / 2) * 1e4) / 1e4;
        if (mid === lo || mid === hi) break;
        if (await fits(mid)) lo = mid; else hi = mid;
      }
      if (!(await fits(lo))) return { h, f: lo, box: -1 };
      return { h, f: lo, box: +el.getBoundingClientRect().height.toFixed(1) };
    }, doc.panel, SHEET_PX);
    if (fit.box === -1) throw new Error(`${doc.panel}: fit did not converge`);

    const out = doc.out;
    await page.pdf({ path: out, printBackground: true, preferCSSPageSize: true });
    await page.emulateMediaType('screen');
    const note = fit.f < 1 ? `${fit.h}px fitted at ${(fit.f * 100).toFixed(1)}%, box ${fit.box}` : 'fits at 100%';
    console.log(`  ${out}  (${note})`);

    // Close so the next document goes through the real open path too.
    await page.evaluate(() => document.getElementById('resumeClose').click());
    await page.waitForFunction(() => !document.getElementById('resumeModal').open);
  }
  await page.close();
}

await browser.disconnect();
writeFileSync(STAMP, sourceHash() + String.fromCharCode(10));
console.log('build_docs_pdf: done — the downloads are prints of the live overlay');
