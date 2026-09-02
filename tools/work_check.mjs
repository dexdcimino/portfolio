/* Drive the FEATURED WORK section and the work overlay in a real browser.
 *
 *   node tools/work_check.mjs [--shots <dir>]
 *
 * Serves the repo itself and needs nothing running.
 *
 * WHY THIS EXISTS. The overlay broke twice in one session and neither time did
 * anything fail: `.work-stage` is the overlay's PANEL, the featured stage
 * borrowed the same class name, and its `grid-template-columns` flattened the
 * hero to 28x44 while every gate stayed green. Renaming then took the overlay's
 * own rules with it and the hero went to nothing at all. Both were found by Dex
 * opening the page, which is the wrong person to be the check.
 *
 * So the hero is measured here, and a collapsed one is a failure.
 */
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const SHOTS = resolve(arg('--shots', join(ROOT, '.notes-dev/shots')));

const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.webm': 'video/webm',
};
const missing = [];
const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = resolve(join(ROOT, normalize(url === '/' ? '/index.html' : url)));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { missing.push(url); res.writeHead(404).end('404'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const fail = [];
let pass = 0;
const note = (ok, why) => { if (ok) pass++; else fail.push(why); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-first-run', '--no-default-browser-check'],
});
const page = await browser.newPage();
await page.createCDPSession().then(s =>
  s.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {}));
await page.setViewport({ width: 1600, height: 1000 });
page.on('pageerror', e => fail.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') fail.push(`console: ${m.text()}`); });

await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.$eval('#work', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
await page.waitForFunction(
  () => document.querySelectorAll('.work-card .card-dots').length === 8, { timeout: 20000 });

/* ---- 1. the stage keeps the section's full width -------------------------
   FALSELY PASSES IF: only the pagers' own position were checked. They can sit
   outside the content and still be pushing it in — what matters is that the
   video and the thumbnails span the same width as the heading above them. */
{
  const geo = await page.evaluate(() => {
    const b = (s) => { const r = document.querySelector(s).getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) }; };
    return { head: b('.home-featured .section-head'), video: b('.fw-stage .fv'),
             grid: b('.fw-stage .work-grid'),
             pagers: [...document.querySelectorAll('.wk-pager')]
               .map(e => { const r = e.getBoundingClientRect();
                 return { left: Math.round(r.left), right: Math.round(r.right) }; }) };
  });
  console.log(`content ${geo.video.left}-${geo.grid.right} vs heading ` +
              `${geo.head.left}-${geo.head.right}; pagers at ` +
              geo.pagers.map(p => `${p.left}-${p.right}`).join(' and '));
  note(Math.abs(geo.video.left - geo.head.left) <= 2,
       `the content starts at ${geo.video.left}, the heading at ${geo.head.left}`);
  note(Math.abs(geo.grid.right - geo.head.right) <= 2,
       `the content ends at ${geo.grid.right}, the heading at ${geo.head.right}`);
  note(Math.abs(geo.video.w - geo.grid.w) <= 2,
       `video is ${geo.video.w} and the thumbnails ${geo.grid.w}; they should match`);
  note(geo.pagers[0].right <= geo.video.left, 'the left pager overlaps the video');
  note(geo.pagers[1].left >= geo.grid.right, 'the right pager overlaps the thumbnails');
  note(geo.pagers[0].left >= 0, 'the left pager is off the left edge of the window');
}

/* ---- 2. everything sweeps as ONE wave, slowly ----------------------------
   FALSELY PASSES IF: only "something changed" were asserted, or only the cards
   were watched. The complaint was speed, rhythm and the video sitting the wave
   out, so this records WHEN each of the five turns and in what order — the
   video first, then the four cards in reading order.

   The observation window has to outlast HOLD_MS. At a 15s hold a 13s window
   sees nothing at all and reports a perfectly calm stage. */
{
  const seen = await page.evaluate(() => new Promise(done => {
    const cards = [...document.querySelectorAll('.work-page.is-on .work-card')];
    const shown = () => [
      // Index 0 is the video, which leads the wave.
      [...document.querySelectorAll('.fv-item')].findIndex(e => e.classList.contains('is-on')),
      ...cards.map(c => {
        const img = c.querySelector('.card-frame.is-on img');
        return img && img.currentSrc ? img.currentSrc : '';
      }),
    ];
    let last = shown();
    const out = [];
    const t0 = performance.now();
    const id = setInterval(() => {
      const now = shown();
      now.forEach((v, i) => {
        if (v !== last[i]) out.push({ item: i, at: Math.round(performance.now() - t0) });
      });
      last = now;
      if (performance.now() - t0 > 22000) { clearInterval(id); done(out); }
    }, 40);
  }));

  console.log(`sweep: ${seen.map(s => `${s.item === 0 ? 'video' : `card${s.item - 1}`}@${s.at}`).join('  ')}`);
  const first = seen.slice(0, 5);
  note(first.length === 5, `${first.length} items turned in 22s, expected 5`);
  if (first.length === 5) {
    note(first.map(s => s.item).join(',') === '0,1,2,3,4',
         `the wave ran ${first.map(s => s.item).join(',')}, expected video then reading order`);
    const gaps = first.slice(1).map((s, i) => s.at - first[i].at);
    const span = first[4].at - first[0].at;
    console.log(`gaps: ${gaps.join(', ')}ms   whole sweep ${span}ms   first at ${first[0].at}ms`);
    note(gaps.every(g => g >= 90 && g <= 380), `gaps ${gaps.join(', ')}ms, expected ~200`);
    note(span < 1200, `the sweep took ${span}ms end to end, expected under ~1s`);
    /* The overlap is the point: each fade is .55s and they start .2s apart, so
       the whole sweep must be SHORTER than five fades run one after another.
       Without it this is five separate events, which is what it looked like. */
    note(span < 5 * 550, `the sweep is not overlapping — ${span}ms for five .55s fades`);
    note(first[0].at > 10000, `the first turn came at ${first[0].at}ms; the hold is 15s`);
    note(seen.length <= 10, `${seen.length} turns in 22s — the sweep is running too often`);
  }
}

/* ---- 3. both carousels wrap ---------------------------------------------- */
{
  const at = () => page.evaluate(() => ({
    video: [...document.querySelectorAll('.fv-item')].findIndex(e => e.classList.contains('is-on')),
    page: [...document.querySelectorAll('.work-page')].findIndex(e => e.classList.contains('is-on')),
    hiddenTabbable: [...document.querySelectorAll('.work-page:not(.is-on) button')]
      .filter(x => x.getAttribute('tabindex') !== '-1').length,
  }));
  /* Relative to wherever it IS, not to zero: the video now rides the automatic
     sweep, so by the time this runs it has usually moved on. Asserting an
     absolute 0,1,2,0 tests the clock, not the arrows. */
  const seen = [(await at()).video];
  for (let i = 0; i < 3; i++) {
    await page.click('[data-fv="1"]');
    await new Promise(r => setTimeout(r, 620));
    seen.push((await at()).video);
  }
  const want = seen.map((_, i) => (seen[0] + i) % 3);
  console.log(`video carousel: ${seen.join(' -> ')} (expected ${want.join(' -> ')})`);
  note(seen.join(',') === want.join(','),
       `video went ${seen.join(',')}, expected ${want.join(',')} from where it started`);

  await page.click('[data-wg="1"]');
  await new Promise(r => setTimeout(r, 520));
  const second = await at();
  await page.click('[data-wg="1"]');
  await new Promise(r => setTimeout(r, 520));
  const wrapped = await at();
  console.log(`thumbnail pages: 0 -> ${second.page} -> ${wrapped.page}`);
  note(second.page === 1 && wrapped.page === 0, 'the thumbnail pages did not wrap');
  note(second.hiddenTabbable === 0, 'a hidden page still has focusable buttons');
}

/* ---- 4. THE OVERLAY STILL WORKS -----------------------------------------
   The regression that prompted this file. A collapsed hero still reports a
   bounding box and a loaded image, so the SIZE is what has to be asserted --
   it was 28x44 while every other check passed. */
{
  await page.evaluate(() => document.getElementById('viewAllWork').click());
  await page.waitForFunction(() => document.getElementById('workModal')?.open === true,
    { timeout: 15000 });
  await page.waitForFunction(() => {
    const img = document.getElementById('workHeroImg');
    return img && img.currentSrc && img.complete && img.naturalWidth > 0;
  }, { timeout: 20000 });
  const shape = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    const hero = r('workHeroImg');
    const box = r('workHero');
    const panel = document.getElementById('workPanel').getBoundingClientRect();
    return {
      panelDisplay: getComputedStyle(document.getElementById('workPanel')).display,
      panelH: Math.round(panel.height),
      boxW: Math.round(box.width), boxH: Math.round(box.height),
      heroW: Math.round(hero.width), heroH: Math.round(hero.height),
      prevGap: Math.round(box.left - r('workPrev').right),
      nextGap: Math.round(r('workNext').left - box.right),
      thumbs: document.querySelectorAll('.work-thumb').length,
      tabs: document.querySelectorAll('.work-tab').length,
    };
  });
  console.log(`overlay: panel ${shape.panelDisplay} ${shape.panelH}px, frame ` +
              `${shape.boxW}x${shape.boxH}, image ${shape.heroW}x${shape.heroH}, ` +
              `arrows ${shape.prevGap}/${shape.nextGap}px clear, ${shape.thumbs} thumbs`);
  note(shape.panelDisplay === 'grid', `the overlay panel is display:${shape.panelDisplay}`);
  note(shape.boxH > 300, `the hero frame is only ${shape.boxH}px tall — it has collapsed`);
  note(shape.heroW > 200 && shape.heroH > 200,
       `the hero image renders at ${shape.heroW}x${shape.heroH}`);
  note(shape.prevGap >= 0 && shape.nextGap >= 0, 'an arrow overlaps the picture');
  note(shape.tabs === 8, `${shape.tabs} tabs, expected 8`);
  note(shape.thumbs > 10, `${shape.thumbs} filmstrip thumbs`);
  await page.screenshot({ path: join(SHOTS, 'work-overlay.png') });
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: join(SHOTS, 'work-stage.png') });
}

/* ---- 5. a card opens the overlay ON THE PIECE IT IS SHOWING ---------------
   FALSELY PASSES IF: the overlay merely opened on the right CATEGORY, which it
   always did. The bug was landing on item 0 — click Gobbler Fish, arrive at
   Grimshot Rifle — so the card's visible image is compared against the hero's.
   Checked on a card mid-rotation, not on frame 0, or item 0 would be right by
   accident. */
{
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.$eval('#work', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForFunction(
    () => document.querySelectorAll('.work-card .card-dots').length === 8, { timeout: 20000 });

  /* WAIT FOR A REAL TURN rather than flipping the classes by hand. The first
     version of this did the latter and failed honestly: turn() is what
     publishes data-work-index, so a hand-flipped frame leaves the card
     advertising its first piece and the check reported a bug that was its own.
     One sweep is HOLD_MS away, hence the long timeout. */
  const card = await page.evaluateHandle(() =>
    document.querySelector('.work-page.is-on .work-card[data-work-cat="props"]'));
  await page.waitForFunction(() => {
    const el = document.querySelector('.work-card[data-work-cat="props"]');
    return el && el.dataset.workIndex && el.dataset.workIndex !== '0';
  }, { timeout: 25000 });
  await new Promise(r => setTimeout(r, 300));

  const showing = await page.evaluate((el) => {
    const img = el.querySelector('.card-frame.is-on img');
    return { stem: (img && img.currentSrc || '').split('/').pop().replace(/-\d+\.(avif|webp).*$/, ''),
             index: el.dataset.workIndex };
  }, card);
  await page.evaluate((el) => el.click(), card);
  await page.waitForFunction(() => document.getElementById('workModal')?.open === true,
    { timeout: 15000 });
  await page.waitForFunction(() => {
    const img = document.getElementById('workHeroImg');
    return img && img.currentSrc && img.complete && img.naturalWidth > 0;
  }, { timeout: 20000 });
  const landed = await page.evaluate(() => ({
    hero: (document.getElementById('workHeroImg').currentSrc || '')
      .split('/').pop().replace(/-\d+\.(avif|webp).*$/, ''),
    index: document.getElementById('workCapIndex').textContent.trim(),
    tab: document.querySelector('.work-tab[aria-selected="true"]')?.textContent || '',
  }));
  console.log(`card showed "${showing.stem}" (index ${showing.index}) -> overlay opened on ` +
              `"${landed.hero}" at ${landed.index}`);
  note(!!showing.index && showing.index !== '0',
       'the test card was still on its first frame, so this proves nothing');
  note(landed.hero === showing.stem,
       `the card showed ${showing.stem} and the overlay opened on ${landed.hero}`);
  note(/PROPS/.test(landed.tab), `the overlay opened on the ${landed.tab} tab`);
}

/* ---- 6. a very tall piece fills the width and scrolls --------------------
   FALSELY PASSES IF: only the class were checked. A 400x1600 sheet fitted to a
   3:2 box still "renders" — it just renders 16% of the frame wide. So this
   measures the rendered width against the frame, and asks the container
   whether it can actually scroll. */
{
  const tall = await page.evaluate(() => {
    const strip = [...document.querySelectorAll('.work-thumb')];
    return strip.findIndex(t => { const i = t.querySelector('img');
      return i && i.naturalWidth && i.naturalWidth / i.naturalHeight < 0.5; });
  });
  await page.evaluate(() => {
    // Characters holds the tallest sheets in the set.
    document.querySelector('.work-tab').click();
  });
  await new Promise(r => setTimeout(r, 500));
  const found = await page.evaluate(async () => {
    const strip = [...document.querySelectorAll('.work-thumb')];
    for (let i = 0; i < strip.length; i++) {
      strip[i].click();
      await new Promise(r => setTimeout(r, 260));
      const img = document.getElementById('workHeroImg');
      if (img.naturalWidth && img.naturalWidth / img.naturalHeight < 0.5) {
        const hero = document.getElementById('workHero');
        const box = hero.getBoundingClientRect();
        const pic = img.getBoundingClientRect();
        return {
          i, ratio: +(img.naturalWidth / img.naturalHeight).toFixed(2),
          isTall: hero.classList.contains('is-tall'),
          widthShare: Math.round(pic.width / box.width * 100),
          scrollable: hero.scrollHeight > hero.clientHeight + 4,
          atTop: hero.scrollTop === 0,
        };
      }
    }
    return null;
  });
  if (!found) {
    fail.push('no piece under 0.5 w/h found in Characters to test the tall path');
  } else {
    console.log(`tall piece: ratio ${found.ratio}, is-tall=${found.isTall}, ` +
                `${found.widthShare}% of the frame width, scrollable=${found.scrollable}, ` +
                `at top=${found.atTop}`);
    note(found.isTall, 'a very tall piece did not get the is-tall treatment');
    note(found.widthShare >= 98, `the tall piece uses ${found.widthShare}% of the frame width`);
    note(found.scrollable, 'the tall piece does not scroll, so most of it cannot be seen');
    note(found.atTop, 'the tall piece did not start at its top');
  }
  await page.screenshot({ path: join(SHOTS, 'work-tall.png') });
}

note(missing.length === 0, `404s: ${[...new Set(missing)].slice(0, 5).join(', ')}`);

await browser.close();
server.close();
console.log(`\n${pass} checks passed`);
console.log(fail.length ? `FAIL (${fail.length}):\n  ${fail.join('\n  ')}`
                        : 'PASS — featured work and the overlay both hold');
process.exit(fail.length ? 1 : 0);
