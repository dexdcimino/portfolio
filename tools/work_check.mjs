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
 *
 * It has since grown to cover the rest of this page's stateful chrome —
 * the code prompt, the games stack and the AI Lab list — for the same
 * reason: they are all states of one page, they all only exist once the
 * browser has run the script, and a second harness would have to boot the
 * same page a second time to look at them.
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
  /* .mjs BY NAME. A module script is refused outright on the wrong MIME type
     -- "Expected a JavaScript-or-Wasm module script" -- so a server that falls
     back to application/octet-stream serves a page whose modules never load,
     which is how this file first met the chess overlay. */
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.webm': 'video/webm',
  // Mobius 3D's Draco and KTX2 decoders.
  '.wasm': 'application/wasm',
};
const missing = [];
const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  /* THE NOTES PASSWORD, ANSWERED AS PRODUCTION ANSWERS A WRONG ONE. Both
     keypads now try any five-character code as a notes password too (see
     verify in initVault and the tilde keypad, efca229 and before it), so
     every wrong code this harness types is a POST here. With no API behind
     this server those were five 404s a run, failing the check on a
     behaviour that is working as built. 401 is what /api/notes/unlock says
     to a password it refuses. */
  if (url === '/api/notes/unlock') {
    res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"wrong"}');
    return;
  }
  /* A FOLDER URL SERVES ITS index.html, as Vercel does. Without it /mobius/
     -- the Mobius 3D preview -- was a 404 inside an overlay that opened
     perfectly, which reads as a broken app rather than a harness gap. */
  const file = resolve(join(ROOT, normalize(url.endsWith('/') ? `${url}index.html` : url)));
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
/* The featured video streams from Bunny, which this harness must not need: a
   sandbox with no route out logs a refused fetch per range request and fails
   the run on the network, not the page. Bunny is answered here with an empty
   body, so the slot behaves as a video that has not arrived yet. */
await page.setRequestInterception(true);
let bunny = 0;
/* GitHub's release API, answered here with the real 0.6.2 asset sizes: the
   Mobius download tips read the installer's size off it (initMobiusDownload),
   and this harness must not need the network. Counted, so a tip that never
   asked cannot pass on the markup's own words. */
let releaseAsks = 0;
const RELEASE = { tag_name: 'v0.6.2', assets: [
  { name: 'Mobius-3D-Setup-x64.exe', size: 112855489 }, { name: 'Mobius-3D-mac.dmg', size: 237977695 },
  { name: 'Mobius-3D-x86_64.AppImage', size: 127571858 }] };
page.on('request', r => {
  const u = new URL(r.url());
  if (u.hostname.endsWith('.b-cdn.net')) { bunny++; r.respond({ status: 204, body: '' }); }
  else if (u.hostname === 'api.github.com' && u.pathname === '/repos/dexdcimino/mobius-3d/releases/latest') {
    releaseAsks++;
    r.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(RELEASE) });
  }
  else r.continue();
});
/* The browser logs every refused fetch as a console error with no way for the
   page to silence it; the notes-password 401 above is the one this harness
   answers ON PURPOSE, and is matched by its URL, so nothing else can hide. */
page.on('console', m => {
  if (m.type() !== 'error') return;
  if (/status of 401/.test(m.text()) && /\/api\/notes\/unlock$/.test(m.location()?.url || '')) return;
  fail.push(`console: ${m.text()}`);
});

await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle2', timeout: 60000 });
// The Mobius slot has its link now, so its first range request is how we know it is wired.
note(bunny > 0, `the featured video asked Bunny for nothing (${bunny} requests)`);
console.log(`bunny: ${bunny} request(s) answered locally`);
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

/* ---- 2. everything sweeps as ONE wave, in THREE COLUMNS -------------------
   FALSELY PASSES IF: only "something changed" were asserted, or only the cards
   were watched, or the five turns were merely counted. The stage is three
   vertical bands and the wave crosses them left to right: the video, then the
   LEFT pair of thumbnails together, then the RIGHT pair together. Five separate
   events in reading order would satisfy any count and is exactly the rhythm
   this replaced, so what is asserted is the GROUPING — three groups sized
   1, 2, 2 — and not just the timing.

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
    /* Group by when, not by index: two turns in the same column are two
       setTimeouts at the same delay, so they land in one poll tick. */
    const groups = [];
    for (const turn of first) {
      const last = groups[groups.length - 1];
      if (last && turn.at - last[0].at < 120) last.push(turn);
      else groups.push([turn]);
    }
    const shape = groups.map(g => g.length).join(',');
    const items = groups.map(g => g.map(t => t.item).join('+')).join(' -> ');
    console.log(`columns: ${items}   shape ${shape}`);
    note(shape === '1,2,2', `the wave ran in groups of ${shape}, expected 1,2,2`);
    /* Cards 1 and 3 are the LEFT pair (top-left, bottom-left) and 2 and 4 the
       right: the four are in DOM reading order, so a column is every other one. */
    note(items === '0 -> 1+3 -> 2+4',
         `the wave ran ${items}, expected video, then the left pair, then the right`);
    const gaps = groups.slice(1).map((g, i) => g[0].at - groups[i][0].at);
    const span = groups[groups.length - 1][0].at - first[0].at;
    console.log(`gaps: ${gaps.join(', ')}ms   whole sweep ${span}ms   first at ${first[0].at}ms`);
    note(gaps.every(g => g >= 180 && g <= 460), `gaps ${gaps.join(', ')}ms, expected ~300`);
    note(span >= 400 && span <= 1500,
         `the sweep took ${span}ms end to end, expected roughly 600ms and under 1.5s`);
    /* The overlap is the point: each cross-fade is .85s and the columns start
       .3s apart, so the whole thing must be far SHORTER than three fades run one
       after another. Without this it is three separate events again. */
    note(span < 3 * 850, `the sweep is not overlapping - ${span}ms for three .85s fades`);
    note(first[0].at > 10000, `the first turn came at ${first[0].at}ms; the hold is 15s`);
    note(seen.length <= 10, `${seen.length} turns in 22s - the sweep is running too often`);
  }
}

/* ---- 2b. the cross-fade never shows the panel through both frames ---------
   FALSELY PASSES IF: the classes alone were read, or the two opacities were
   ADDED. Stacked layers composite as 1-(1-a)(1-b), and the sum of a matched
   pair of ease curves is exactly 1.0 at every point - so a sum reports perfect
   cover for the broken case as confidently as for the fixed one. The real cover
   at the midpoint of the old crossfade was 0.75, and that quarter of panel
   showing through is the flicker.

   Measured off a FROZEN clock: Chrome only paints on demand headless, so
   stepping getAnimations is the only way to see the middle of a transition.
   Runs TWICE - once as it ships, once with is-leaving withheld - because a
   number that never moves proves nothing about what it would refuse. */
{
  const measure = (leaving) => page.evaluate(async (useLeaving) => {
    const card = document.querySelector('.work-page.is-on .work-card');
    const frames = [...card.querySelectorAll('.card-frame')];
    const at = frames.findIndex(f => f.classList.contains('is-on'));
    const next = (at + 1) % frames.length;
    frames[at].classList.remove('is-on');
    if (useLeaving) frames[at].classList.add('is-leaving');
    frames[next].classList.add('is-on');
    let low = 1, when = 0;
    const anims = card.getAnimations({ subtree: true });
    anims.forEach(a => a.pause());
    for (let t = 0; t <= 850; t += 50) {
      anims.forEach(a => { a.currentTime = t; });
      await new Promise(r => requestAnimationFrame(r));
      // What the eye gets: one minus the light that makes it through both.
      const cover = 1 - frames.reduce(
        (n, f) => n * (1 - parseFloat(getComputedStyle(f).opacity)), 1);
      if (cover < low) { low = cover; when = t; }
    }
    anims.forEach(a => a.cancel());
    frames.forEach(f => f.classList.remove('is-leaving'));
    return { low: +low.toFixed(3), when, count: anims.length };
  }, leaving);

  const shipped = await measure(true);
  const without = await measure(false);
  console.log(`cross-fade: ${shipped.count} animation(s), thinnest cover ${shipped.low} ` +
              `at ${shipped.when}ms; without is-leaving ${without.low} at ${without.when}ms`);
  note(shipped.count > 0, 'no transition was running, so nothing was measured');
  note(shipped.low >= 0.995,
       `the frames only covered ${shipped.low} of the panel at ${shipped.when}ms into the fade`);
  note(without.low <= 0.9,
       `withholding is-leaving still measured ${without.low} cover - this check cannot refuse`);
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
  // Two pages since 2026-10-08: Mobius 3D, then the one placeholder.
  const pages = await page.evaluate(() => document.querySelectorAll('.fv-item').length);
  note(pages === 2, `the featured column has ${pages} pages, expected 2`);
  const seen = [(await at()).video];
  for (let i = 0; i < 3; i++) {
    await page.click('[data-fv="1"]');
    await new Promise(r => setTimeout(r, 620));
    seen.push((await at()).video);
  }
  const want = seen.map((_, i) => (seen[0] + i) % pages);
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

/* ---- 3b. an arrow press holds the stage for TWO sweeps, then rejoins ------
   FALSELY PASSES IF: the window were shorter than two holds (a stage that
   never turns again passes "nothing moved"), or only the video were watched.
   So the window runs past the third sweep and asserts BOTH halves: nothing
   turned for two holds after the press, and then the video and the cards
   turned again in the one wave. Dex: a press a moment before a sweep was
   being answered by the stage flipping straight back. */
{
  await page.$eval('.fw-stage', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.click('[data-fv="1"]');
  await page.mouse.move(5, 5);              // a pointer on the stage defers the sweep
  const seen = await page.evaluate(() => new Promise(done => {
    const shown = () => [
      [...document.querySelectorAll('.fv-item')].findIndex(e => e.classList.contains('is-on')),
      ...[...document.querySelectorAll('.work-page.is-on .work-card')].map(c =>
        c.querySelector('.card-frame.is-on img')?.currentSrc || ''),
    ];
    let last = shown();
    const out = [];
    const t0 = performance.now();
    const id = setInterval(() => {
      const now = shown();
      now.forEach((v, i) => { if (v !== last[i]) out.push({ item: i, at: Math.round(performance.now() - t0) }); });
      last = now;
      if (performance.now() - t0 > 47000) { clearInterval(id); done({ out, items: now.length }); }
    }, 40);
  }));
  const first = seen.out[0];
  console.log(`after an arrow: ${seen.out.length} turns in 47s over ${seen.items} items, ` +
              `first at ${first ? first.at : '-'}ms`);
  note(seen.items === 5, `watched ${seen.items} items, expected the video and four cards`);
  note(!!first && first.at > 29000,
       `the stage turned ${first ? first.at : '-'}ms after an arrow press; two 15s sweeps should be skipped`);
  const turned = new Set(seen.out.map(t => t.item));
  note(turned.size === 5, `${turned.size} of 5 items turned again after the skips - the stage did not rejoin the wave`);
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
      thumbs: document.querySelectorAll('.work-thumb').length,
      tabs: document.querySelectorAll('.work-tab').length,
    };
  });
  console.log(`overlay: panel ${shape.panelDisplay} ${shape.panelH}px, frame ` +
              `${shape.boxW}x${shape.boxH}, image ${shape.heroW}x${shape.heroH}, ${shape.thumbs} thumbs`);
  note(shape.panelDisplay === 'grid', `the overlay panel is display:${shape.panelDisplay}`);
  note(shape.boxH > 300, `the hero frame is only ${shape.boxH}px tall — it has collapsed`);
  note(shape.heroW > 200 && shape.heroH > 200,
       `the hero image renders at ${shape.heroW}x${shape.heroH}`);
  note(shape.tabs === 8, `${shape.tabs} tabs, expected 8`);
  note(shape.thumbs > 10, `${shape.thumbs} filmstrip thumbs`);
  await page.screenshot({ path: join(SHOTS, 'work-overlay.png') });

  /* ---- 4b. THE WALLPAPER LIGHTBOX'S LAYOUT (Dex, 2026-10-09) ------------
     No panel and no hatched matte; the picture's box IS the picture, with
     the title on it at the top left; the tabs centred on the screen; the X
     in the dead space right of the picture, centred in it, at the enlarged
     Mobius video's 52px; no BROWSE / ESC CLOSE line; eight thumbnails a page
     with the strip centred and the count just right of it; arrows on the
     picture only while the pointer is on it.
     FALSELY PASSES IF: the box were measured instead of the picture (it is
     asserted that they are the same box, within a pixel, off the image's
     own aspect), or the arrows' rest state were read off a class (it is the
     computed opacity, with the pointer parked off the picture). */
  await page.mouse.move(3, 3);
  await new Promise(r => setTimeout(r, 400));
  const lay = await page.evaluate(() => {
    const r = (el) => (typeof el === 'string' ? document.querySelector(el) : el).getBoundingClientRect();
    const img = document.getElementById('workHeroImg');
    const hero = r('#workHero'), title = r('#workCapTitle'), x = r('#workClose');
    const strip = r('#workStrip'), count = r('#workCapIndex'), tabs = r('#workTabs');
    const shown = [...document.querySelectorAll('#workStrip .work-thumb')]
      .filter(t => { const b = t.getBoundingClientRect(); return b.right > strip.left + 1 && b.left < strip.right - 1; });
    const shell = getComputedStyle(document.querySelector('.work-shell'));
    const heroBg = getComputedStyle(document.getElementById('workHero')).backgroundImage;
    return {
      vw: document.documentElement.clientWidth,
      tall: document.getElementById('workHero').classList.contains('is-tall'),
      boxAr: hero.width / hero.height, imgAr: img.naturalWidth / img.naturalHeight,
      shellBg: shell.backgroundImage + ' ' + shell.backgroundColor, heroBg,
      titleIn: title.left >= hero.left && title.top >= hero.top && title.left - hero.left < 40 && title.top - hero.top < 40,
      titleText: document.getElementById('workCapTitle').textContent,
      shadow: getComputedStyle(document.getElementById('workCapTitle')).textShadow,
      tabsMid: Math.round(tabs.left + tabs.width / 2),
      x: { w: Math.round(x.width), cx: x.left + x.width / 2, cy: x.top + x.height / 2 },
      hero: { right: hero.right, cy: hero.top + hero.height / 2 },
      stageRight: r('#workPanel').right,
      hint: !!document.querySelector('.work-hint'),
      shown: shown.length, all: document.querySelectorAll('#workStrip .work-thumb').length,
      stripMid: Math.round(strip.left + strip.width / 2), countGap: Math.round(count.left - strip.right),
      arrowOp: getComputedStyle(document.getElementById('workNext').parentElement).opacity,
      index: document.getElementById('workCapIndex').textContent,
      indexColor: getComputedStyle(document.querySelector('#workCapIndex b')).color,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    };
  });
  console.log(`layout: box ${lay.boxAr.toFixed(3)} vs image ${lay.imgAr.toFixed(3)}, title "${lay.titleText}" in=${lay.titleIn}, ` +
              `X ${lay.x.w}px at ${Math.round(lay.x.cx)} (gutter centre ${Math.round((lay.stageRight + lay.vw) / 2)}), ` +
              `${lay.shown}/${lay.all} thumbs shown, strip centre ${lay.stripMid}, count ${lay.countGap}px right of it, arrows at ${lay.arrowOp}`);
  note(lay.tall || Math.abs(lay.boxAr - lay.imgAr) < 0.01, `the picture's box is ${lay.boxAr.toFixed(3)} wide for a ${lay.imgAr.toFixed(3)} image -- a matte is back`);
  note(!/repeating-linear-gradient/.test(lay.heroBg) && lay.heroBg === 'none', `the hero still paints ${lay.heroBg}`);
  note(/none/.test(lay.shellBg) && /rgba\(0, 0, 0, 0\)/.test(lay.shellBg), `the overlay has a panel fill again: ${lay.shellBg}`);
  note(lay.titleIn && lay.titleText.length > 0, 'the title is not on the picture at its top left');
  note(lay.shadow !== 'none', 'the title on the picture has no shadow to read on light art');
  note(Math.abs(lay.tabsMid - lay.vw / 2) <= 2, `the tabs are centred at ${lay.tabsMid} of ${lay.vw}`);
  note(lay.x.w === 52, `the X is ${lay.x.w}px, not the enlarged Mobius video's 52`);
  /* Centred in the right GUTTER, not in whatever gap this picture leaves:
     the box follows each piece's shape, and an X that followed it would
     move on every arrow press. */
  note(lay.x.cx > lay.hero.right + 26 && Math.abs(lay.x.cx - (lay.stageRight + lay.vw) / 2) <= 1,
       `the X is not centred in the space right of the picture (${Math.round(lay.x.cx)} against ${Math.round(lay.stageRight)}..${lay.vw})`);
  note(Math.abs(lay.x.cy - lay.hero.cy) <= 2, `the X is ${Math.round(lay.x.cy - lay.hero.cy)}px off the picture's middle`);
  note(!lay.hint, 'the BROWSE / ESC CLOSE line is still there');
  note(lay.shown === 8 && lay.all > 8, `${lay.shown} of ${lay.all} thumbnails are in the strip's window, not a page of eight`);
  note(Math.abs(lay.stripMid - lay.vw / 2) <= 2, `the strip is centred at ${lay.stripMid} of ${lay.vw} -- the count pulled it over`);
  note(lay.countGap > 0, 'the count is not to the right of the strip');
  note(/^01 \/ \d\d$/.test(lay.index), `the count reads "${lay.index}"`);
  note(lay.arrowOp === '0', `with the pointer off the picture its arrows are at opacity ${lay.arrowOp}`);

  // The page follows the selection: the ninth piece slides the next eight in.
  const paged = await page.evaluate(async () => {
    document.querySelectorAll('#workStrip .work-thumb')[8].click();
    await new Promise(r => setTimeout(r, 700));
    const strip = document.getElementById('workStrip').getBoundingClientRect();
    const t = document.querySelectorAll('#workStrip .work-thumb')[8].getBoundingClientRect();
    return { inside: t.left >= strip.left - 1 && t.right <= strip.right + 1,
             index: document.getElementById('workCapIndex').textContent };
  });
  note(paged.inside && /^09 \//.test(paged.index), `the ninth piece did not page the strip: ${JSON.stringify(paged)}`);

  /* A hover on a thumbnail previews it in the big picture and leaving puts
     the selection back, with the count never moving -- under a REAL pointer. */
  const thumbAt = await page.evaluate(() => { const b = document.querySelectorAll('#workStrip .work-thumb')[10].getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  const titleOf = () => page.evaluate(() => [document.getElementById('workCapTitle').textContent, document.getElementById('workCapIndex').textContent]);
  const before = await titleOf();
  await page.mouse.move(thumbAt.x, thumbAt.y, { steps: 4 });
  await new Promise(r => setTimeout(r, 900));
  const during = await page.evaluate(() => { const stemOf = u => (u || '').split('/').pop().split('?')[0].replace(/(-\d{3,4})?\.(avif|webp|png|jpe?g)$/i, ''); return [document.getElementById('workCapTitle').textContent, document.getElementById('workCapIndex').textContent,
    stemOf(document.getElementById('workHeroImg').currentSrc), stemOf(document.querySelectorAll('#workStrip .work-thumb')[10].querySelector('img').src)]; });
  await page.mouse.move(3, 3, { steps: 4 });
  await new Promise(r => setTimeout(r, 900));
  const after = await titleOf();
  note(during[2] === during[3] && during[1] === before[1], `hovering thumbnail 11 showed ${during[2]} (wanted ${during[3]}) and the count read ${during[1]}`);
  note(after[0] === before[0] && after[1] === before[1], `leaving the strip left ${JSON.stringify(after)} up, not ${JSON.stringify(before)}`);

  // THE WHEEL: one piece a tick, forward and back.
  const mid = await page.evaluate(() => { const b = document.getElementById('workHero').getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, tall: document.getElementById('workHero').classList.contains('is-tall') }; });
  const at = async () => page.evaluate(() => parseInt(document.getElementById('workCapIndex').textContent, 10));
  // Over the right gutter, above the X: nothing tall can claim the wheel there.
  const gutterAt = await page.evaluate(() => { const b = document.querySelector('.work-close').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top - 40 }; });
  const w0 = await at();
  await page.mouse.move(gutterAt.x, gutterAt.y);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel({ deltaY: 100 }); await new Promise(r => setTimeout(r, 160)); }
  const w3 = await at();
  await page.mouse.wheel({ deltaY: -100 }); await new Promise(r => setTimeout(r, 160));
  const w2 = await at();
  note(w3 === w0 + 3 && w2 === w0 + 2, `three wheel ticks down and one up went ${w0} -> ${w3} -> ${w2}`);

  // A click in the dark beside the picture closes, as round a wallpaper.
  await page.mouse.click(Math.round(mid.x), 3 + Math.round((await page.evaluate(() => document.querySelector('.work-head').getBoundingClientRect().bottom))));
  await new Promise(r => setTimeout(r, 400));
  const closedByDark = await page.evaluate(() => !document.getElementById('workModal').open);
  note(closedByDark, 'a click in the dark between the tabs and the picture did not close the gallery');
  console.log(`work layout: paged ${paged.index}, hover ${during[2]}, wheel ${w0}->${w3}->${w2}, dark click closes=${closedByDark}`);

  /* THE WALLPAPER LIGHTBOX SHOWS EVERY WALLPAPER (Dex, 2026-10-09: "not all
     of the wallpapers are showing"). Five a page hid three of the eight.
     Counted against the figures in the markup, so a ninth wallpaper makes
     this the paging case rather than a silent pass. */
  const wp = await page.evaluate(async () => {
    document.getElementById('wpFrame').click();
    await new Promise(r => setTimeout(r, 900));
    const strip = document.getElementById('wpFullThumbs').getBoundingClientRect();
    const thumbs = [...document.querySelectorAll('#wpFullThumbs .wp-thumb')];
    const shown = thumbs.filter(t => { const b = t.getBoundingClientRect(); return b.width > 40 && b.right <= strip.right + 1 && b.left >= strip.left - 1; });
    const out = { open: document.getElementById('wpModal').open, figures: document.querySelectorAll('#wallpapers .wp-item').length,
      thumbs: thumbs.length, shown: shown.length, w: Math.round(thumbs[0]?.getBoundingClientRect().width || 0) };
    document.getElementById('wpModal').close();
    return out;
  });
  console.log(`wallpaper lightbox: ${wp.shown} of ${wp.thumbs} thumbnails shown (${wp.figures} wallpapers), ${wp.w}px each`);
  note(wp.open, 'the wallpaper lightbox did not open');
  note(wp.figures >= 8 && wp.thumbs === wp.figures, `${wp.thumbs} thumbnails for ${wp.figures} wallpapers`);
  note(wp.shown === Math.min(8, wp.figures), `the wallpaper lightbox shows ${wp.shown} of its ${wp.figures} wallpapers`);
  note(wp.w >= 100, `the wallpaper thumbnails are ${wp.w}px wide`);

  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
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
  // The pointer is parked wherever the last check left it, and a pointer over
  // the stage DEFERS the sweep -- so waiting for a turn with the mouse resting
  // on an arrow waits forever, correctly.
  await page.mouse.move(5, 5);
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

/* ---- 7. the tilde code modal -------------------------------------------
   FALSELY PASSES IF: only the open were driven. The shortcut used to be one
   way - tilde opened it and nothing but Escape or a click outside put it away,
   which for a keypad that takes focus is a trap. And the modal's own boxes are
   inputs, so the guard that stops the key firing while typing is the same guard
   that would stop it closing: the toggle has to be checked WITH the keypad
   focused, which is where it always is.

   The chrome is measured, not read off the class list: a border that is still
   declared somewhere else, or a background the shell inherits rather than sets,
   both look right in the CSS and wrong on the screen. */
{
  /* Case 6 left the work overlay open. The shortcut reaches over an overlay
     now (see 7b), so this closes it to measure the keypad's own chrome
     against the page rather than against another dialog's backdrop. */
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 5000 });

  await page.keyboard.press('Backquote');
  await page.waitForFunction(() => document.getElementById('codeModal')?.open === true,
    { timeout: 5000 });
  const chrome = await page.evaluate(() => {
    const shell = document.querySelector('#codeModal .code-shell');
    const cs = getComputedStyle(shell);
    const box = shell.getBoundingClientRect();
    const x = document.getElementById('codeClose');
    const xb = x ? x.getBoundingClientRect() : null;
    return {
      radius: parseFloat(cs.borderTopLeftRadius),
      border: parseFloat(cs.borderTopWidth) + parseFloat(cs.borderRightWidth),
      outline: cs.outlineStyle === 'none' ? 0 : parseFloat(cs.outlineWidth),
      gradient: /gradient/.test(cs.backgroundImage),
      bg: cs.backgroundColor,
      hint: !!document.querySelector('#codeModal .code-hint'),
      focused: document.activeElement && document.activeElement.closest('#codeModal') !== null,
      // Top RIGHT corner, and actually the thing under that point - a button
      // positioned correctly but painted under something is the bug that got
      // through on the notes overlay.
      xTop: xb ? Math.round(xb.top - box.top) : null,
      xRight: xb ? Math.round(box.right - xb.right) : null,
      xHit: xb ? document.elementFromPoint(
        (xb.left + xb.right) / 2, (xb.top + xb.bottom) / 2)?.closest('#codeClose') !== null : false,
      /* THE KEY THAT OPENS IT, DRAWN ON IT, mirroring the X on the other
         corner. The mask is what proves the art arrived: a data-icon nothing
         was baked for resolves to no --icon at all and paints an empty box
         that measures exactly like a full one. */
      tilde: (() => {
        const t = document.querySelector('.code-tilde');
        if (!t || !xb) return null;
        const r = t.getBoundingClientRect();
        const s = getComputedStyle(t);
        const ink = (s.maskSize || s.webkitMaskSize || '').split(' ').map(parseFloat);
        return {
          left: Math.round(r.left - box.left), top: Math.round(r.top - box.top),
          w: Math.round(r.width), h: Math.round(r.height),
          mask: (s.maskImage || s.webkitMaskImage || '').slice(0, 12),
          /* THE MIRROR, asserted as a mirror. Same box, same inset from its own
             corner, and the two centres on one line -- an eyeballed "looks
             about right" is what put a 34px mark in a corner beside a 17px
             one. The INK is measured separately from the box, because a mask
             painted `contain` fills whatever box it is given: sizing the
             element alone is exactly how the first version came out twice the
             weight of the X it was supposed to mirror. */
          boxMatchesX: Math.round(r.width) === Math.round(xb.width)
                    && Math.round(r.height) === Math.round(xb.height),
          insetMatchesX: Math.round(r.left - box.left) === Math.round(box.right - xb.right)
                      && Math.round(r.top - box.top) === Math.round(xb.top - box.top),
          level: Math.round((r.top + r.bottom) / 2) === Math.round((xb.top + xb.bottom) / 2),
          inkW: ink[0] || 0,
          paint: s.backgroundColor,
        };
      })(),
      /* ...and the words appear ONCE. The status line under the boxes used to
         rest on the same three words the eyebrow above them carries. */
      labels: [...shell.querySelectorAll('*')]
        .filter(e => !e.children.length && /enter\s*code/i.test(e.textContent || '')).length,
      statusH: Math.round(document.getElementById('codeStatus').getBoundingClientRect().height),
    };
  });
  console.log(`code modal: radius ${chrome.radius}px, border ${chrome.border}, ` +
              `outline ${chrome.outline}, bg ${chrome.bg}, gradient ${chrome.gradient}, ` +
              `X at ${chrome.xTop}/${chrome.xRight} hittable=${chrome.xHit}`);
  note(chrome.radius >= 20, `the shell's corners are ${chrome.radius}px, expected more rounded`);
  note(chrome.border === 0 && chrome.outline === 0,
       `the shell still draws a border/outline (${chrome.border}/${chrome.outline})`);
  note(!chrome.gradient && /rgba?\(/.test(chrome.bg) && !/, 0\)$/.test(chrome.bg),
       `the shell's background is ${chrome.gradient ? 'a gradient' : chrome.bg}, expected one solid colour`);
  note(!chrome.hint, 'the "ESC to close" line is still there');
  note(chrome.xTop !== null && chrome.xTop < 24 && chrome.xRight < 24,
       `the X sits ${chrome.xTop}/${chrome.xRight} from the top right corner`);
  note(chrome.xHit, 'the X is positioned but something else is painted over it');
  note(chrome.focused, 'the keypad did not take focus, so the toggle below proves nothing');
  note(!!chrome.tilde, 'the code prompt does not wear the tilde that opens it');
  note(chrome.tilde && chrome.tilde.mask.startsWith('url('),
       `the tilde has no mask (${chrome.tilde && chrome.tilde.mask}) — the icon was never baked`);
  note(chrome.tilde && chrome.tilde.boxMatchesX,
       `the tilde's box is ${chrome.tilde && chrome.tilde.w}x${chrome.tilde && chrome.tilde.h}, the X's is different`);
  note(chrome.tilde && chrome.tilde.insetMatchesX,
       `the tilde sits ${chrome.tilde && chrome.tilde.left}/${chrome.tilde && chrome.tilde.top} from its corner and the X does not mirror it`);
  note(chrome.tilde && chrome.tilde.level, 'the tilde and the X are not on the same centre line');
  /* The INK, and it is the assertion that actually failed the first time: a
     mark 2.3x wider than it is tall reads far heavier than an X of the same
     box, so it is drawn at about the X's own 17px rather than at the box's. */
  note(chrome.tilde && chrome.tilde.inkW >= 14 && chrome.tilde.inkW <= 22,
       `the tilde's ink is ${chrome.tilde && chrome.tilde.inkW}px wide against the X's ${chrome.xInk || 17} — wanted about the same`);
  note(chrome.labels === 1, `"ENTER CODE" appears ${chrome.labels} times on a panel with five boxes on it`);
  /* Blank but still holding its line: filling it in on a refusal must not move
     the boxes someone is typing into. */
  note(chrome.statusH >= 14, `the status line collapsed to ${chrome.statusH}px — a refusal would move the boxes`);
  console.log(`tilde mark: ${chrome.tilde && chrome.tilde.inkW}px of ink in a ${chrome.tilde && chrome.tilde.w}px box `
              + `at ${chrome.tilde && chrome.tilde.left}/${chrome.tilde && chrome.tilde.top}, `
              + `${chrome.labels} label, status ${chrome.statusH}px`);

  // Tilde again, from inside the keypad, closes it.
  await page.keyboard.press('Backquote');
  await new Promise(r => setTimeout(r, 400));
  const closed = await page.evaluate(() => ({
    open: document.getElementById('codeModal').open,
    typed: document.getElementById('codepad')?.value || '',
  }));
  note(closed.open === false, 'tilde did not close the modal it opened');
  note(closed.typed === '', `the tilde leaked into the keypad as "${closed.typed}"`);

  // ...and the X does too.
  await page.keyboard.press('Backquote');
  await page.waitForFunction(() => document.getElementById('codeModal')?.open === true,
    { timeout: 5000 });
  await page.click('#codeClose');
  await new Promise(r => setTimeout(r, 400));
  note(await page.evaluate(() => document.getElementById('codeModal').open) === false,
       'the X did not close the modal');

  /* AND ON THE VAULT'S OWN KEYPAD, which is the same lock and the same codes,
     so it wears the same mark. No corners to mirror down there -- it sits at
     the head of the row of boxes, scaled to them and centred against them.

     LAST IN THIS BLOCK, and it blurs on the way. Closing the code modal parks
     focus in the vault's first box (see relock/keypad.reset), so a check that
     scrolled down here and then pressed ` would be pressing it into a field --
     which the shortcut correctly refuses. It cost a run to find, in the two
     checks above that were here first. */
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.evaluate(() => document.getElementById('codes').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await new Promise(r => setTimeout(r, 600));
  const vt = await page.evaluate(() => {
    const t = document.querySelector('.vault-tilde');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const p = document.querySelector('#vaultPins .vault-pin').getBoundingClientRect();
    const s = getComputedStyle(t);
    return { w: Math.round(r.width), h: Math.round(r.height), pin: Math.round(p.width),
             gap: Math.round(p.left - r.right),
             level: Math.abs(Math.round((r.top + r.bottom) / 2) - Math.round((p.top + p.bottom) / 2)) <= 1,
             leftOf: r.right <= p.left,
             mask: (s.maskImage || s.webkitMaskImage || '').slice(0, 12),
             pins: document.querySelectorAll('#vaultPins .vault-pin').length };
  });
  note(!!vt, 'the Idea Vault keypad does not wear the tilde');
  note(vt && vt.pins === 5, `the vault keypad has ${vt && vt.pins} pins — the mark was counted as one of them`);
  note(vt && vt.leftOf, 'the vault tilde is not to the left of the boxes');
  note(vt && vt.level, 'the vault tilde is not centred against the row of boxes');
  note(vt && vt.mask.startsWith('url('), 'the vault tilde has no mask — the icon was never baked');
  /* SCALED TO THE PINS, AND ABOUT HALF OF ONE. Scaled is right -- it has to
     hold its proportion at every step of their clamp -- but the first version
     was scaled 1:1, which made a solid accent mark exactly as wide as an empty
     outlined box. A filled shape at the same span as an outline reads far
     heavier than it, and it came back as "way wayyy too big". So the ratio is
     what is asserted, not just that it tracks. */
  const ratio = vt ? vt.w / vt.pin : 0;
  note(ratio > 0.28 && ratio < 0.5,
       `the vault tilde is ${vt && vt.w}px against a ${vt && vt.pin}px box (${Math.round(ratio * 100)}%) — wanted about two fifths`);
  note(vt && vt.gap > 12, `the vault tilde is ${vt && vt.gap}px from the first box — too close to read as separate from the row`);
  console.log(`vault tilde: ${vt && vt.w}x${vt && vt.h} (${Math.round(ratio * 100)}% of a ${vt && vt.pin}px box), ${vt && vt.gap}px gap`);

  /* AND THE LINE UNDER THE BOXES IS CENTRED ON THE BOXES (Dex, 2026-10-02:
     "it's not perfectly centered underneath the like third text field box").
     The mark is the first thing in the pins row, so the row is wider on its
     left than the five boxes are and justify-items centres BOTH the row and
     this line on the same column -- which put every answer a mark and a gap
     left of the middle box. 20px at this width, and plainly visible.

     MEASURED OFF THE TEXT, NOT THE <p>: the correction is padding on the
     element, so its own box is deliberately not centred and reading its rect
     would assert nothing. A Range over the text node is what the eye sees.
     The tolerance is 4px rather than 1 because the line is tracked out at
     .18em and that trailing space after the last letter is still in the rect;
     the fault it has to catch is five times that. */
  const centred = async () => page.evaluate(() => {
    const p = document.getElementById('vaultStatus');
    const r = document.createRange();
    r.selectNodeContents(p);
    const t = r.getBoundingClientRect();
    const mid = document.querySelectorAll('#vaultPins .vault-pin')[2].getBoundingClientRect();
    return { text: p.textContent.trim(),
             off: Math.round(((t.left + t.right) / 2 - (mid.left + mid.right) / 2) * 10) / 10 };
  });
  const rest = await centred();
  console.log(`vault status: "${rest.text}" sits ${rest.off}px off the middle box`);
  note(Math.abs(rest.off) <= 4, `"${rest.text}" is ${rest.off}px off the centre of the middle box`);

  /* THE ANSWER TOO, which is a bigger font on the same line -- 17px against
     the prompt's 14 -- and was reported in the same breath ("whether it says
     checking, nope, or yep, none of those texts are centered"). One wrong
     code, not three: the third starts a lockout and replaces the answer. */
  await page.focus('#vaultPins .vault-pin');
  for (const c of 'ZZZZZ') { await page.keyboard.type(c); await new Promise(r => setTimeout(r, 40)); }
  /* WAITED FOR, NOT SLEPT THROUGH. This lock derives a key per sealed blob on
     the main thread, so CHECKING can stand for several seconds here -- a fixed
     delay measured the wrong word and read as a centring failure. Then past
     the shake, which moves the row being measured against. */
  await page.waitForFunction(
    () => document.getElementById('vaultStatus').textContent.trim() === 'NOPE',
    { timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 600));
  const answer = await centred();
  console.log(`vault status: "${answer.text}" sits ${answer.off}px off the middle box`);
  note(answer.text === 'NOPE', `a wrong code said "${answer.text}"`);
  note(Math.abs(answer.off) <= 4, `"${answer.text}" is ${answer.off}px off the centre of the middle box`);
  /* Focus OUT of the boxes before anything else runs: ` is refused while
     something is being typed into, and 7b and 11 both press it. */
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
}

/* ---- 7b. tilde reaches over an overlay ----------------------------------
   THE ASK (Dex, 2026-09-09): the code prompt from anywhere, including from on
   top of something else -- "if I'm already on music I still want to hit tilde
   and go somewhere else". It used to stand down whenever any dialog was open,
   which made "reachable from anywhere" untrue exactly where it was most
   useful.

   FALSELY PASSES IF: only the open were checked. It has to open OVER the
   overlay and not instead of it, or backing out of a code you decided not to
   type costs you the thing you were reading -- so the overlay underneath is
   asserted still open, and Escape is driven to prove it is still there
   afterwards. And the one exception has to survive: a backtick meant as a
   character, in a field, is still a character. */
{
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 5000 });
  await page.evaluate(() => document.querySelector('.work-page.is-on .work-card').click());
  await page.waitForFunction(() => document.getElementById('workModal')?.open === true, { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));

  await page.keyboard.press('Backquote');
  await page.waitForFunction(() => document.getElementById('codeModal')?.open === true, { timeout: 5000 })
    .then(() => note(true, ''))
    .catch(() => note(false, 'tilde did nothing with an overlay open'));
  const over = await page.evaluate(() => ({
    code: document.getElementById('codeModal').open,
    under: document.getElementById('workModal').open,
    /* Both in the top layer, and the keypad on top of it -- a dialog that is
       "open" underneath another is only useful if it is still THERE. */
    onTop: (() => {
      const s = document.querySelector('#codeModal .code-shell').getBoundingClientRect();
      const el = document.elementFromPoint((s.left + s.right) / 2, s.top + 6);
      return !!el && !!el.closest('#codeModal');
    })(),
    focused: !!(document.activeElement && document.activeElement.closest('#codeModal')),
  }));
  note(over.code, 'the code prompt did not open over the work overlay');
  note(over.under, 'the code prompt closed the overlay it opened over — backing out would lose it');
  note(over.onTop, 'the code prompt is open but painted under the overlay it opened over');
  note(over.focused, 'the code prompt opened over an overlay without taking focus');

  // Escape closes the topmost and leaves what was underneath.
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 400));
  const backed = await page.evaluate(() => ({
    code: document.getElementById('codeModal').open,
    under: document.getElementById('workModal').open,
  }));
  note(!backed.code, 'Escape did not close the code prompt');
  note(backed.under, 'Escape took the overlay underneath with it — the stack did not hold');

  /* THE ONE EXCEPTION. A backtick typed into a field is a backtick. The work
     overlay has no text field, so this uses the notes gate's pins, which are
     inputs and are reachable without a password. */
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 5000 });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('notes:open', { detail: {} })));
  await page.waitForFunction(() => document.getElementById('notesModal')?.open === true, { timeout: 5000 });
  await page.waitForFunction(() => document.getElementById('notesGate')?.hidden === false, { timeout: 8000 })
    .catch(() => {});
  await page.evaluate(() => document.querySelector('#notesPins .vault-pin').focus());
  await new Promise(r => setTimeout(r, 200));
  const typingIn = await page.evaluate(() =>
    !!(document.activeElement && document.activeElement.closest('#notesPins')));
  note(typingIn, 'could not put the caret in a field — the exception below proves nothing');
  await page.keyboard.press('Backquote');
  await new Promise(r => setTimeout(r, 400));
  note(await page.evaluate(() => document.getElementById('codeModal').open) === false,
       'tilde opened the code prompt while a field had the caret');
  console.log('tilde: opens over an overlay, Escape leaves the overlay, refused in a field');
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 5000 });
}

/* ---- 8. every card still says what it is ---------------------------------
   FALSELY PASSES IF: the elements were merely found, or their text read. The
   caption did not move, empty or disappear -- it was PAINTED OVER. Giving the
   reel's frames a z-index for the cross-fade put them above three siblings that
   had none, and all eight titles went dark while the DOM, the text and every
   computed style except the stacking stayed exactly as before. So this asks the
   document what is actually on top at the caption's own coordinates. */
{
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.$eval('#work', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForFunction(
    () => document.querySelectorAll('.work-card .card-dots').length === 8, { timeout: 20000 });
  const caps = await page.evaluate(() => [...document.querySelectorAll('.work-card')].map(card => {
    const strong = card.querySelector('.card-meta strong');
    const small = card.querySelector('.card-meta small');
    const r = strong.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + 3, r.top + r.height / 2);
    return {
      cat: card.dataset.workCat || '(video)',
      text: (small?.textContent || '').trim() + ' / ' + (strong.textContent || '').trim(),
      onTop: !!(hit && hit.closest('.card-meta')),
      covered: hit ? `${hit.tagName}.${(hit.className || '').toString().split(' ')[0]}` : 'nothing',
    };
  }));
  console.log(`captions: ${caps.length} cards, on top: ${caps.filter(c => c.onTop).length}` +
              (caps.some(c => !c.onTop) ? `, covered by ${caps.find(c => !c.onTop).covered}` : ''));
  note(caps.length === 8, `${caps.length} work cards, expected 8`);
  note(caps.every(c => c.text.length > 4), 'a card caption is empty');
  note(caps.every(c => c.onTop),
       `the caption is painted over on ${caps.filter(c => !c.onTop).map(c => c.cat).join(', ')}`);
}

/* ---- 9. the card crop can be TIGHTENED, and only on the card -------------
   FALSELY PASSES IF: work.json were read instead of the page. The manifest
   carrying a zoom proves nothing about whether anything applies it, and writing
   it into `transform` -- the obvious way -- would be replaced by the card's own
   hover rule, so the crop would spring back the moment the pointer arrived.
   Read off the live element, and checked against the aim it is supposed to
   tighten around. */
{
  const shown = await page.evaluate(() => {
    const card = document.querySelector('.work-card[data-work-cat="character"]');
    const img = [...card.querySelectorAll('.card-frame img')]
      .find(i => (i.currentSrc || i.src || '').includes('bone-archer-1'));
    if (!img) return null;
    const cs = getComputedStyle(img);
    // transform-origin computes to px and object-position to %, so the two are
    // compared through the element's own box rather than as strings.
    // offsetWidth/Height, not the bounding rect: the rect is the box AFTER the
    // zoom, so measuring against it compares the origin to a box 1.9x too big.
    const px = cs.transformOrigin.split(' ').map(parseFloat);
    const pc = cs.objectPosition.split(' ').map(parseFloat);
    return { scale: cs.scale, origin: cs.transformOrigin, pos: cs.objectPosition,
             offBy: [Math.abs(px[0] - img.offsetWidth * pc[0] / 100),
                     Math.abs(px[1] - img.offsetHeight * pc[1] / 100)] };
  });
  if (!shown) {
    // Frames are primed one turn ahead; on a cold page the zoomed one may not
    // be fetched yet. Saying so is the honest outcome, not a silent skip.
    fail.push('bone-archer-1 was not among the character card frames');
  } else {
    console.log(`zoom: scale ${shown.scale}, origin ${shown.origin}, object-position ${shown.pos}`);
    note(parseFloat(shown.scale) > 1.5, `the card zoom did not apply (scale ${shown.scale})`);
    note(Math.max(...shown.offBy) < 2,
         `the zoom happens around ${shown.origin} but the crop aims at ${shown.pos} ` +
         `(${shown.offBy.map(n => n.toFixed(1)).join('/')}px apart)`);
  }
  const inStrip = await page.evaluate(async () => {
    document.querySelector('.work-card[data-work-cat="character"]').click();
    await new Promise(r => setTimeout(r, 900));
    const thumb = [...document.querySelectorAll('.work-thumb img')]
      .find(i => (i.currentSrc || i.src || '').includes('bone-archer-1'));
    return thumb ? getComputedStyle(thumb).scale : 'no thumb';
  });
  console.log(`the same piece in the filmstrip: scale ${inStrip}`);
  note(inStrip === 'none' || parseFloat(inStrip) === 1,
       `the zoom leaked into the filmstrip thumb (scale ${inStrip})`);

  /* knights-of-edengale-3 is TWO renders stacked in one file, and the card was
     landing on the seam -- the lower shot's blue sky through the middle of the
     thumbnail. Its zoom exists to keep the card inside the upper render, so
     what is asserted is the arithmetic that does it: cover shows h/w scaled to
     the box, and the visible band must end above the seam at 0.545. */
  const band = await page.evaluate(async () => {
    const res = await fetch('assets/work/work.json');
    const data = await res.json();
    const cat = data.categories.find(c => c.id === 'environment');
    const item = cat.items.find(i => i.stem === 'knights-of-edengale-3');
    if (!item || !item.zoom) return null;
    const card = document.querySelector('.work-card[data-work-cat="environment"]');
    const box = card.getBoundingClientRect();
    const boxRatio = box.width / box.height;
    const imgRatio = item.w / item.h;
    // Cover on a picture narrower than the box fills the width; this is the
    // fraction of the picture's HEIGHT that survives, before the zoom.
    const visible = imgRatio / boxRatio;
    const top = parseFloat((item.zoom.pos || '50% 50%').split(' ')[1]) / 100;
    const shown = visible / item.zoom.scale;
    return { scale: item.zoom.scale, top, from: top * (1 - visible), to: top * (1 - visible) + shown };
  });
  if (!band) fail.push('knights-of-edengale-3 carries no zoom, so the card sits on the seam');
  else {
    console.log(`knights-of-edengale-3: ${band.scale}x from the top, shows ` +
                `${band.from.toFixed(3)}-${band.to.toFixed(3)} of the picture (seam at 0.545)`);
    note(band.to <= 0.545,
         `the card reaches ${band.to.toFixed(3)} down, past the seam between the two renders`);
    note(band.to > 0.40, `the card only reaches ${band.to.toFixed(3)}; the upper render is wasted`);
  }
}

/* ---- 10. a piece exactly at the threshold fills the width ----------------
   FALSELY PASSES IF: a comfortably tall piece were used. osseous-2 is 1200x1600
   -- w/h of exactly 0.75, exactly half the frame -- and the comparison was `<`
   while the rule it implements reads "half or less", so it sat on the wrong
   side of its own boundary and letterboxed with half the frame empty. A
   boundary case is the only case that tests a boundary. */
{
  const at = await page.evaluate(async () => {
    const thumbs = [...document.querySelectorAll('.work-thumb')];
    /* currentSrc OR src: a thumb below the strip's lazy horizon has no
       currentSrc at all, so matching on it alone finds nothing the moment the
       piece moves further down the category -- which is what reordering the
       projects did. src is set by paintPicture whether or not it has loaded. */
    const i = thumbs.findIndex(t => {
      const img = t.querySelector('img');
      return img && (img.currentSrc || img.src || '').includes('osseous-2');
    });
    if (i < 0) return null;
    thumbs[i].click();
    await new Promise(r => setTimeout(r, 900));
    const hero = document.getElementById('workHero');
    const img = document.getElementById('workHeroImg');
    const box = hero.getBoundingClientRect(), pic = img.getBoundingClientRect();
    return { ratio: +(img.naturalWidth / img.naturalHeight).toFixed(4),
             isTall: hero.classList.contains('is-tall'),
             widthShare: Math.round(pic.width / box.width * 100),
             scrollable: hero.scrollHeight > hero.clientHeight + 4 };
  });
  if (!at) fail.push('osseous-2 was not in the Characters filmstrip');
  else {
    console.log(`threshold piece osseous-2: ratio ${at.ratio}, is-tall=${at.isTall}, ` +
                `${at.widthShare}% of the frame width, scrollable=${at.scrollable}`);
    note(at.ratio === 0.75, `osseous-2 is ${at.ratio}, not the 0.75 boundary this tests`);
    note(at.isTall, 'a piece exactly at TALL_RATIO was fitted instead of filled');
    note(at.widthShare >= 98, `it uses ${at.widthShare}% of the frame width`);
    note(at.scrollable, 'it fills the width but cannot be scrolled');
  }
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
}

/* ---- 11. the lockout countdown, and what it must not do ------------------
   FALSELY PASSES IF: only the number were checked. Two separate faults, both
   only visible while it counts: it hung out of flow exactly where the eyebrow
   sits, printing over "ENTER CODE" and its padlock; and the per-second pop
   scales it 1.35x, which on a full-width number escaped the <dialog> and gave
   it a horizontal scrollbar that flickered under the panel on every tick.
   Overflow is sampled ACROSS a whole tick, since the pop lasts 900ms of it. */
{
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 5000 });
  await page.keyboard.press('Backquote');
  await page.waitForFunction(() => document.getElementById('codeModal')?.open === true,
    { timeout: 5000 });
  const tries = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const began = Date.now();
    await page.evaluate(() =>
      document.querySelectorAll('#codePins .vault-pin').forEach(p => { p.value = ''; }));
    await page.focus('#codePins .vault-pin');
    for (const c of 'ZZZZZ') { await page.keyboard.type(c); await new Promise(r => setTimeout(r, 40)); }
    /* WAIT FOR THE REFUSAL ITSELF -- the only thing that proves the attempt was
       counted. The boxes are DISABLED while the key derivation runs and a
       second attempt is refused outright while one is in flight, so a fixed
       delay the scrypt outlasts means the next two codes go nowhere: no third
       failure, no countdown, and a red in a check about something else. Three
       of these take about 6.5 seconds on this machine, and the 500ms sleep this
       replaces covered one of them.

       "Not CHECKING" is not enough either: it is already true in the moment
       between the last keystroke and the attempt starting, which is how the
       first of the three used to be skipped in 306ms. The first character typed
       clears the previous NOPE (see clearFail), so a stale one cannot satisfy
       this. */
    await page.waitForFunction(() => {
      const said = document.getElementById('codeStatus').textContent.trim();
      return said === 'NOPE' || said === 'TOO MANY TRIES';
    }, { timeout: 30000 }).catch(() => {});
    tries.push(Date.now() - began);
  }
  /* PRINTED, because the window that has to hold them is 15 SECONDS and each
     one of these is a key derivation on the main thread. Three attempts slower
     than five seconds each cannot lock out at all -- the first failure ages out
     of the window before the third arrives -- and that reads as a dead lockout
     rather than as a slow machine. */
  console.log(`three wrong codes took ${tries.join(' + ')}ms = ${tries.reduce((a, b) => a + b, 0)}ms (the window is 15000ms)`);
  const locked = await page.waitForFunction(
    () => !document.getElementById('codeTimer').hidden, { timeout: 12000 })
    .then(() => true).catch(() => false);
  note(locked, 'three wrong codes did not start the countdown');
  if (locked) {
    const state = await page.evaluate(() => {
      const t = document.getElementById('codeTimer'), e = document.querySelector('.code-eyebrow');
      const tb = t.getBoundingClientRect(), eb = e.getBoundingClientRect();
      return {
        number: t.textContent.trim(),
        width: Math.round(tb.width),
        eyebrow: getComputedStyle(e).visibility,
        /* The eyebrow keeps its BOX on purpose -- visibility, not display, so
           the panel does not change height for fifteen seconds and back. What
           must not be true is that both are legible in the same place. */
        bothVisible: getComputedStyle(e).visibility === 'visible' &&
          !(tb.right < eb.left || tb.left > eb.right || tb.bottom < eb.top || tb.top > eb.bottom),
      };
    });
    let peak = 0;
    for (let i = 0; i < 26; i++) {
      peak = Math.max(peak, await page.evaluate(() => {
        const d = document.getElementById('codeModal');
        return Math.max(d.scrollWidth - d.clientWidth, d.scrollHeight - d.clientHeight);
      }));
      await new Promise(r => setTimeout(r, 90));
    }
    console.log(`lockout: "${state.number}" ${state.width}px wide, eyebrow ${state.eyebrow}, ` +
                `dialog overflow peak ${peak}px`);
    note(/^[0-9]+$/.test(state.number), `the countdown reads "${state.number}"`);
    note(!state.bothVisible, 'the countdown is printing over the ENTER CODE line');
    note(state.width < 160, `the countdown is ${state.width}px wide; the pop scales it 1.35x`);
    note(peak === 0, `the dialog gained ${peak}px of scrollable overflow during the countdown`);
  }
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
}

/* ---- 12. the video card: caption, fade and title -------------------------
   FALSELY PASSES IF: the z-index values were read instead of the paint. The
   shared .card-shade rule lifted the fade to 4 to clear the reel's frames on a
   work card; inside the video item the caption and the download button carry an
   explicit 3, so the fade landed on TOP of both -- a dark gradient over the two
   things it exists to make readable, with every element present and correct. */
{
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.$eval('#work', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForFunction(
    () => document.querySelectorAll('.work-card .card-dots').length === 8, { timeout: 20000 });
  const card = await page.evaluate(() => {
    const item = document.querySelector('.fv-item.is-on') || document.querySelector('.fv-item');
    const hitOf = (el, dx, dy) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width * dx, r.top + r.height * dy);
      return hit ? `${hit.tagName}.${(hit.className || '').toString().split(' ')[0]}` : 'nothing';
    };
    const strong = item.querySelector('.card-meta strong');
    return {
      title: strong.textContent.trim(),
      strongPx: parseFloat(getComputedStyle(strong).fontSize),
      onTitle: hitOf(strong, 0.1, 0.5),
      // Mobius 3D's slot has the AI Lab pair (.fv-get, .fv-eye) in place of the
      // placeholder's .fv-dl; either is "the download button".
      onDownload: hitOf(item.querySelector('.fv-dl, .fv-get'), 0.5, 0.5),
    };
  });
  console.log(`video card: "${card.title}" at ${card.strongPx}px; ` +
              `over the title ${card.onTitle}, over the download ${card.onDownload}`);
  note(card.title === 'Mobius 3D', `the video card reads "${card.title}"`);
  note(card.strongPx < 42 && card.strongPx > 24,
       `the caption is ${card.strongPx}px; it was 47.6 and came down a fifth`);
  note(!card.onTitle.includes('card-shade'), 'the fade is painted over the caption');
  note(!card.onDownload.includes('card-shade'), 'the fade is painted over the download button');

  /* The info popover sits BESIDE its icon. Measured against the hazard strip's
     TAPE, not against .fv-soon's box: that box is 44% of the frame tall and
     mostly empty at the top, so a box-to-box test calls a clean layout a
     collision. What the complaint was about is ink on ink. */
  /* THE PITCH ON THE CARD (Dex, 2026-10-09): Mobius 3D's info button sits in
     its title, on the title's bottom line, and a REAL hover on it swaps it for
     the pitch -- the same words as the AI Lab card -- between the title and
     the download, staying while the pointer moves onto the card and folding
     when it leaves both. FALSELY PASSES IF: the hover were a synthetic event
     (the handlers read pointerType), or the card were measured while still
     scaled up from the button. Proto Isles' old-style popover follows. */
  {
    const c = await page.$eval('.fv-has-video', el => { const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 3 }; });
    await page.mouse.move(c.x, c.y);
    await new Promise(r => setTimeout(r, 700));
    const btn = await page.$eval('.fv-has-video .fv-pitch-btn', el => { const r = el.getBoundingClientRect();
      const t = el.closest('strong'); const range = document.createRange(); range.selectNodeContents(t.firstChild);
      const tr = range.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, gap: Math.round(r.left - tr.right),
               bottomOff: Math.round(r.bottom - tr.bottom), op: +getComputedStyle(el).opacity }; });
    note(btn.op > 0.9, `the Mobius info button is at opacity ${btn.op} on a hovered card`);
    note(btn.gap >= 0 && btn.gap < 30, `the info button is ${btn.gap}px right of "Mobius 3D"`);
    note(Math.abs(btn.bottomOff) <= 6, `the info button's bottom is ${btn.bottomOff}px off the title's`);
    await page.mouse.move(btn.x, btn.y);
    await new Promise(r => setTimeout(r, 500));
    const pop = await page.evaluate(() => {
      const item = document.querySelector('.fv-has-video');
      const p = item.querySelector('.fv-pitch-pop'), b = item.querySelector('.fv-pitch-btn');
      const pr = p.getBoundingClientRect(), dl = item.querySelector('.fv-get').getBoundingClientRect();
      return { open: item.classList.contains('is-pitched') && b.getAttribute('aria-expanded') === 'true',
               op: +getComputedStyle(p).opacity, btnOp: +getComputedStyle(b).opacity,
               lead: p.querySelector('.fv-about-lead')?.textContent.trim() || '',
               head: p.querySelector('.fv-about-head')?.textContent.trim() || '',
               card: document.getElementById('mobiusCard').dataset.descLead,
               clearOfDownload: pr.right <= dl.left, width: Math.round(pr.width),
               cx: pr.left + pr.width / 2, cy: pr.top + 20 };
    });
    console.log(`card pitch: open=${pop.open}, "${pop.head}", ${pop.width}px wide, clear of the download=${pop.clearOfDownload}`);
    note(pop.open && pop.op > 0.9 && pop.btnOp < 0.1, 'hovering the info button did not swap it for the pitch');
    note(pop.lead === pop.card && pop.head === 'The pitch', `the card's pitch reads "${pop.head}: ${pop.lead}"`);
    note(pop.clearOfDownload && pop.width >= 200, `the card's pitch is ${pop.width}px wide and over the download`);
    await page.mouse.move(pop.cx, pop.cy, { steps: 6 });
    await new Promise(r => setTimeout(r, 500));
    const held = await page.$eval('.fv-has-video', el => el.classList.contains('is-pitched'));
    note(held, 'the pitch folded while the pointer was on it');
    await page.mouse.move(5, 5);
    await new Promise(r => setTimeout(r, 600));
    const folded = await page.$eval('.fv-has-video', el => !el.classList.contains('is-pitched')
      && el.querySelector('.fv-pitch-btn').getAttribute('aria-expanded') === 'false');
    note(folded, 'the pitch stayed open after the pointer left it');
  }
  await page.evaluate(() => document.querySelector('[data-fv="1"]').click());
  await page.waitForFunction(() => document.querySelector('.fv-gallery')?.classList.contains('is-on'), { timeout: 5000 });
  await new Promise(r => setTimeout(r, 600));
  await page.hover('.fv-item.is-on .fv-info');
  await new Promise(r => setTimeout(r, 420));
  const desc = await page.evaluate(() => {
    const item = document.querySelector('.fv-item.is-on');
    const d = item.querySelector('.fv-desc');
    const i = item.querySelector('.fv-info');
    const tape = [...item.querySelectorAll('.fv-soon .collab-soon-tape, .fv-soon strong')];
    const db = d.getBoundingClientRect(), ib = i.getBoundingClientRect();
    const hits = (a, b) => !(a.right < b.left || a.left > b.right ||
                             a.bottom < b.top || a.top > b.bottom);
    return {
      open: d.classList.contains('is-open'),
      opacity: +getComputedStyle(d).opacity,
      rightOfIcon: Math.round(db.left - ib.right),
      offCentre: Math.round((db.top + db.bottom) / 2 - (ib.top + ib.bottom) / 2),
      // A real description wraps; then it is level with the icon's TOP, not its middle.
      wraps: db.height > ib.height + 4,
      offTop: Math.round(db.top - ib.top),
      onTape: tape.some(t => hits(db, t.getBoundingClientRect())),
      widthShare: Math.round(db.width / item.getBoundingClientRect().width * 100),
      texts: [...document.querySelectorAll('.fv-desc')].map(p => p.textContent.trim()),
    };
  });
  console.log(`info popover: ${desc.rightOfIcon}px right of the icon, ${desc.offCentre}px off ` +
              `its centre, ${desc.widthShare}% of the frame, over the tape=${desc.onTape}`);
  note(desc.open && desc.opacity > 0.9, 'hovering the info icon did not raise the description');
  note(desc.rightOfIcon >= 0 && desc.rightOfIcon < 30,
       `the description starts ${desc.rightOfIcon}px from the icon`);
  note(desc.wraps ? Math.abs(desc.offTop) <= 3 : Math.abs(desc.offCentre) <= 3,
       desc.wraps ? `the wrapped description starts ${desc.offTop}px off the icon's top`
                  : `the description is ${desc.offCentre}px off the icon's centre line`);
  note(!desc.onTape, 'the description is printed over the UNDER CONSTRUCTION strip');
  note(desc.widthShare < 70, `the description spans ${desc.widthShare}% of the frame`);
  // One description left on the small cards: Proto Isles'.
  note(desc.texts.length === 1 && /game I am building/.test(desc.texts[0]),
       `the small cards' descriptions read ${JSON.stringify(desc.texts)}`);
  await page.mouse.move(5, 5);
  await page.evaluate(() => document.querySelector('[data-fv="-1"]').click());
  await page.waitForFunction(() => document.querySelector('.fv-has-video')?.classList.contains('is-on'), { timeout: 5000 });
  await new Promise(r => setTimeout(r, 600));
}

/* ---- 12b. the enlarged Mobius video: the pitch, and its sound -----------
   FALSELY PASSES IF: the panel were found in the DOM but never shown (it is
   display:none until placeAbout() says it fits), shown but inside the video,
   or shown with no words because #mobiusCard's data-desc-* were not read.
   The sound half: enlarging unmutes it, and a visitor who mutes by hand is
   not unmuted by the NEXT enlarge -- driven with a real double click on the
   picture and a real click on the button, not by calling the function. */
{
  const vp = page.viewport();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluate(() => { try { localStorage.removeItem('fv-sound-by-hand'); } catch {} });
  await page.$eval('#featVideo', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await new Promise(r => setTimeout(r, 500));
  const mid = await page.$eval('.fv-has-video', el => { const r = el.getBoundingClientRect();
    return { x: r.left + r.width * .3, y: r.top + r.height * .4 }; });
  await page.mouse.click(mid.x, mid.y, { count: 2 });   // a real double click: two clicks, then dblclick
  await page.waitForFunction(() => document.querySelector('.fv-has-video')?.matches(':popover-open'), { timeout: 5000 });
  await new Promise(r => setTimeout(r, 400));
  const big = await page.evaluate(() => {
    const item = document.querySelector('.fv-has-video');
    const a = item.querySelector('.fv-about'), head = a.querySelector('.fv-about-head');
    const lead = a.querySelector('.fv-about-lead');
    const ab = a.getBoundingClientRect(), vb = item.getBoundingClientRect();
    const dl = item.querySelector('.fv-get').getBoundingClientRect();
    const px = el => parseFloat(getComputedStyle(el).fontSize);
    return {
      shown: getComputedStyle(a).display !== 'none' && ab.width > 0,
      outside: ab.left >= vb.right, below: Math.round(ab.top - dl.bottom),
      bottomOff: Math.round(ab.bottom - vb.bottom),
      offCentre: Math.round((ab.left + ab.right) / 2 - (dl.left + dl.right) / 2),
      portrait: ab.height > ab.width, inView: ab.bottom <= innerHeight && ab.right <= innerWidth,
      head: head.textContent.trim(), headPx: px(head), textPx: px(lead),
      headWeight: +getComputedStyle(head).fontWeight,
      headAccent: (() => { const p = document.createElement('i'); p.style.color = 'var(--accent)';
        document.body.append(p); const c = getComputedStyle(p).color; p.remove();
        return getComputedStyle(head).color === c; })(),
      lead: lead?.textContent.trim() || '',
      card: document.getElementById('mobiusCard').dataset.descLead,
      muted: item.querySelector('.fv-video').muted,
    };
  });
  console.log(`enlarged: the pitch ${big.shown ? 'shown' : 'NOT shown'}, ${big.below}px under the download, bottom ${big.bottomOff}px off the video's, ` +
              `${big.offCentre}px off its centre, head "${big.head}" ${big.headPx}px over ${big.textPx}px; muted=${big.muted}`);
  note(big.shown, 'the enlarged video shows no pitch at 1440x900');
  note(big.outside, 'the pitch is inside the video');
  note(big.below > 0, `the pitch is ${big.below}px under the download`);
  note(Math.abs(big.bottomOff) <= 1, `the pitch's bottom is ${big.bottomOff}px off the video's bottom edge`);
  note(Math.abs(big.offCentre) <= 2, `the pitch is ${big.offCentre}px off the column's centre`);
  note(big.portrait && big.inView, 'the pitch is not a portrait card on screen');
  note(big.head.length > 0 && big.head.split(/\s+/).length <= 3, `the pitch's head reads "${big.head}"`);
  note(big.headPx - big.textPx === 2 && big.headWeight >= 700 && big.headAccent,
       `the head is ${big.headPx}px/${big.headWeight} over ${big.textPx}px text, accent=${big.headAccent}`);
  note(big.lead === big.card, `the pitch reads "${big.lead}", the AI Lab card "${big.card}"`);
  note(big.muted === false, 'enlarging the video left it muted');

  // Muted by hand, shrunk, enlarged again by the button: stays muted.
  await page.evaluate(() => { const m = document.querySelector('.fv-has-video .fv-mute'); m.hidden = false; });
  await page.$eval('.fv-has-video .fv-mute', el => el.click());
  const handMuted = await page.$eval('.fv-has-video .fv-video', v => v.muted);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.fv-has-video')?.matches(':popover-open'), { timeout: 5000 });
  const aboutGone = await page.$eval('.fv-has-video .fv-about', a => getComputedStyle(a).display === 'none');
  await page.$eval('.fv-has-video .fv-full', el => el.click());
  await page.waitForFunction(() => document.querySelector('.fv-has-video')?.matches(':popover-open'), { timeout: 5000 });
  const again = await page.$eval('.fv-has-video .fv-video', v => v.muted);
  console.log(`muted by hand=${handMuted}, then enlarged again by the button: muted=${again}`);
  note(handMuted, 'the mute button did not mute');
  note(aboutGone, 'the pitch is still up on the small card');
  note(again === true, 'a visitor who muted by hand was unmuted by the next enlarge');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { try { localStorage.removeItem('fv-sound-by-hand'); } catch {} });
  await page.setViewport(vp);
  await new Promise(r => setTimeout(r, 300));
}

/* ---- 13. the eye's thumbnail tooltip -------------------------------------
   FALSELY PASSES IF: the attribute were read rather than the bubble hovered,
   or the picture were found but never loaded. The placeholder's loud
   download tip this section used to measure went with the placeholder; what
   replaced it is the Mobius slot's eye, whose tip carries a clone of the
   first Mobius gallery <picture>. Three things have to be true at once: the
   bubble is ABOVE the eye (below falls off the card at the bottom right), it
   is centred on it, and the picture in it actually decoded -- a clone whose
   `sizes` or `loading` was left wrong is an empty box with a label under it. */
{
  await page.hover('.fv-item.is-on .fv-eye');
  await new Promise(r => setTimeout(r, 900));
  const tip = await page.evaluate(() => {
    const t = document.getElementById('tip');
    const b = document.querySelector('.fv-item.is-on .fv-eye');
    const tb = t.getBoundingClientRect(), r = b.getBoundingClientRect();
    const img = t.querySelector('.tip-thumb img');
    return { on: t.classList.contains('is-on'), thumb: t.classList.contains('has-thumb'),
             text: t.textContent.trim(), loaded: !!img && img.complete && img.naturalWidth > 0,
             width: img ? Math.round(img.getBoundingClientRect().width) : 0,
             gap: Math.round(r.top - tb.bottom),
             offCentre: Math.round((tb.left + tb.right) / 2 - (r.left + r.right) / 2) };
  });
  console.log(`eye tip: "${tip.text}", picture ${tip.loaded ? tip.width + 'px, loaded' : 'NOT loaded'}, ` +
              `${tip.gap}px above, ${tip.offCentre}px off centre`);
  note(tip.on && tip.thumb, 'the eye did not raise a tooltip with a picture');
  note(tip.loaded && tip.width > 200, 'the tooltip picture did not load');
  note(tip.text === 'Functional Preview', `the tooltip reads "${tip.text}"`);
  note(tip.gap >= 0 && tip.gap < 40, `the bubble sits ${tip.gap}px above the eye`);
  note(Math.abs(tip.offCentre) <= 2, `the bubble is ${tip.offCentre}px off centre`);
  await page.mouse.move(5, 5);
}

/* ---- 14. the fifth game is a placeholder in every field ------------------
   FALSELY PASSES IF: the row were only found. The point of the row is that it
   has NO HOLES -- a blank tag or a bare "GALLERY" reads as a bug rather than as
   a slot -- and that hovering it does not leave the previous game's artwork up,
   which is what showArt() does by design for a row with no art of its own. */
{
  await page.$eval('#games', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await new Promise(r => setTimeout(r, 400));
  await page.hover('.stack-row-soon');
  await new Promise(r => setTimeout(r, 450));
  const row = await page.evaluate(() => {
    const el = document.querySelector('.stack-row-soon');
    const art = document.getElementById('gameArt');
    return {
      exists: !!el, tag: el && el.tagName, href: el && el.getAttribute('href'),
      n: el && el.querySelector('span').textContent,
      name: el && el.querySelector('strong').textContent,
      kind: el && el.querySelector('small').textContent,
      tags: [...document.querySelectorAll('#gameTags .game-tag')].map(t => t.textContent.trim()),
      lead: document.querySelector('.game-desc-lead').textContent.trim(),
      body: document.querySelector('.game-desc-body').textContent.trim(),
      gallery: document.getElementById('galleryOpen').textContent.trim(),
      greyed: document.getElementById('galleryOpen').classList.contains('is-empty'),
      shot: [...document.querySelectorAll('.game-art-shot')].filter(s => !s.hidden)
        .map(s => s.dataset.art).join(','),
      artLinks: art.hasAttribute('href'),
    };
  });
  console.log(`row 05: ${row.tag} "${row.name}" / ${row.kind}, tags ${row.tags.join('/')}, ` +
              `${row.gallery} greyed=${row.greyed}, preview ${row.shot}`);
  note(row.exists && row.tag === 'DIV', `the placeholder row is a ${row.tag}, expected a DIV`);
  note(!row.href, `the placeholder row links to ${row.href}`);
  note(row.tags.every(t => t === 'TBD') && row.tags.length === 3,
       `its tags read ${row.tags.join('/')}, expected three TBD`);
  note(row.lead.length > 20 && row.body.length > 40, 'the placeholder row has no copy');
  note(row.gallery === 'GALLERY (0)', `the gallery button says "${row.gallery}"`);
  note(row.greyed, 'the empty gallery button is not greyed');
  note(row.shot === 'soon-art',
       `hovering the placeholder shows "${row.shot}", not its own hazard strip`);
  note(!row.artLinks, 'the preview frame is still a link while showing a game with no page');
}

/* ---- 15. the AI Lab placeholder ------------------------------------------
   FALSELY PASSES IF: only its presence were checked. It leads the list, and
   initAppInfo seeds the description panel from cards[0] -- so adding it at the
   top silently made the whole section rest on "nothing to show yet" while four
   live apps sat under it. That resting state is asserted here, not the card. */
{
  await page.$eval('#aiApps', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await new Promise(r => setTimeout(r, 500));
  const app = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#aiApps .ai-card')];
    const soon = document.querySelector('.ai-card-soon');
    const eye = soon && soon.querySelector('.ai-card-eye-soon');
    const q = soon && soon.querySelector('.ai-card-iconwrap-soon .icon');
    const plate = soon && soon.querySelector('.ai-card-iconwrap-soon');
    const real = document.querySelector('#aiApps .ai-card:not(.ai-card-soon) .ai-card-iconwrap');
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return {
      first: cards[0] === soon,
      name: soon && soon.querySelector('strong').textContent,
      linkTag: soon && soon.querySelector('.ai-card-link').tagName,
      resting: document.getElementById('appInfoTitle').textContent.trim(),
      eyeBg: eye && getComputedStyle(eye).backgroundColor,
      eyeBorder: eye && parseFloat(getComputedStyle(eye).borderTopWidth),
      qPaint: q && getComputedStyle(q).backgroundColor,   // masks paint with background-color
      qMask: q && getComputedStyle(q).maskImage.slice(0, 24),
      plateBox: plate && [Math.round(plate.getBoundingClientRect().width),
                          Math.round(plate.getBoundingClientRect().height)],
      realBox: real && [Math.round(real.getBoundingClientRect().width),
                        Math.round(real.getBoundingClientRect().height)],
      heights: cards.map(c => Math.round(c.getBoundingClientRect().height)),
      accent,
    };
  });
  console.log(`ai placeholder: "${app.name}" first=${app.first}, panel rests on ` +
              `"${app.resting}", eye bg ${app.eyeBg}, plate ${app.plateBox} vs ${app.realBox}, ` +
              `rows ${app.heights.join('/')}`);
  note(app.first, 'the placeholder is not the first app card');
  note(app.linkTag === 'SPAN', `its title block is a <${app.linkTag}>, which links somewhere`);
  note(app.resting !== app.name,
       `the section rests on the placeholder ("${app.resting}") instead of a real app`);
  note(/rgba\(0, 0, 0, 0\)|transparent/.test(app.eyeBg) && app.eyeBorder === 0,
       `the placeholder eye still has a chip behind it (${app.eyeBg})`);
  note(app.qMask.startsWith('url('), 'the "?" plate has no icon in it');
  note(app.plateBox[0] === app.realBox[0] && app.plateBox[1] === app.realBox[1],
       `the "?" plate is ${app.plateBox} against the real icons' ${app.realBox}`);
  note(new Set(app.heights).size === 1,
       `the app rows are ${app.heights.join('/')} tall — the placeholder changes the rhythm`);
}

/* ---- 16. the four thumbnails have a height at every width -----------------
   THE REPORTED BUG (Dex, 2026-09-09): a browser window dragged to half a
   screen showed the video but four flat lines where the thumbnails should be.

   Below 1100px the stage goes to one column: .work-grid takes height:auto and
   .work-page becomes a relative 2x2 whose rows are `1fr 1fr` -- and a fraction
   of nothing is nothing. Everything inside a card is absolutely positioned, so
   there is no content to fall back on either. The cards resolved to FOUR
   PIXELS while the video above them, which has an aspect-ratio of its own, was
   fine. That is why it read as "the big one works and the small ones do not".

   FALSELY PASSES IF: only one width were driven, or only the DESKTOP width --
   which is what every other check in this file uses, and is exactly why this
   went unseen. Four widths across both sides of the breakpoint, and the height
   is asserted against the card's own WIDTH rather than against a number, so a
   change to the ladder cannot quietly turn this into a tautology. */
{
  const shapes = [];
  for (const w of [1500, 1000, 790, 520]) {
    await page.setViewport({ width: w, height: 950 });
    await new Promise(r => setTimeout(r, 400));
    shapes.push(await page.evaluate((width) => {
      const on = document.querySelector('.work-page.is-on');
      const cards = [...on.querySelectorAll('.work-card')].map(c => c.getBoundingClientRect());
      const fv = document.querySelector('.fv').getBoundingClientRect();
      return {
        width,
        n: cards.length,
        min: Math.round(Math.min(...cards.map(r => r.height))),
        ratio: Math.min(...cards.map(r => r.height / Math.max(1, r.width))),
        block: Math.round(on.getBoundingClientRect().height),
        fv: Math.round(fv.height),
      };
    }, w));
  }
  note(shapes.length === 4, `only ${shapes.length} width(s) measured — this check lost its subject`);
  for (const s of shapes) {
    note(s.n === 4, `at ${s.width}px the page holds ${s.n} thumbnails, expected 4`);
    /* Not "taller than 4px". A thumbnail is a picture, and a picture that is a
       tenth as tall as it is wide is still collapsed, just less obviously. */
    note(s.ratio > 0.35, `at ${s.width}px a thumbnail is ${Math.round(s.ratio * 100)}% as tall as it is wide (${s.min}px) — collapsed`);
    /* The 2x2 block and the video are meant to be one object: two rows of
       half-width 16/10 cards plus the gap is one full-width 16/10 stage. */
    note(Math.abs(s.block - s.fv) < s.fv * 0.25,
         `at ${s.width}px the thumbnail block is ${s.block}px against the video's ${s.fv}px`);
  }
  console.log(`thumbnails: ${shapes.map(s => `${s.width}->${s.min}px`).join('  ')}`);
  await page.setViewport({ width: 1600, height: 1000 });
  await new Promise(r => setTimeout(r, 300));
}

/* ---- 17. Mobius 3D: the card, the eye, and the viewer inside -------------
   THE ASK (Dex, 2026-10-07): Mobius 3D second in the AI Lab list, above Inko,
   with an eye that opens a functional preview in the rounded app overlay.
   What is under /mobius/ is a BUILT copy of the mobius-3d repo's dist/, and
   that repo drives the viewer itself in depth (verification/check.mjs, 49
   checks, under this site's CSP). This section checks the half that lives
   HERE: the order, the overlay it opens, the sandbox it opens with, and that
   the copy on disk actually starts.

   FALSELY PASSES IF: only the overlay's open state were read. An overlay
   around a viewer that never started is the failure that matters, so the
   triangle count the viewer itself printed is the assertion. */
{
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await page.evaluate(() => document.getElementById('aiApps').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await new Promise(r => setTimeout(r, 500));
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('#aiApps .ai-card strong')].map(s => s.textContent.trim()));
  note(order[1] === 'Mobius 3D' && order[2] === 'Inko',
       `the AI Lab order is ${order.slice(0, 4).join(' / ')} — Mobius 3D belongs second, above Inko`);
  /* EVERY AI Lab eye and download raises its tip ABOVE itself, centred on it
     (Dex, 2026-10-09) -- the page default is below. A REAL pointer onto each
     visible one, hit-tested first; the bubble is measured, not the attribute,
     and the count is asserted so an empty walk cannot pass. */
  {
    const marks = await page.evaluate(() => [...document.querySelectorAll('#aiApps .ai-card-eye[data-tip], #aiApps .ai-card-dl[data-tip]')]
      .filter(b => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden').length);
    note(marks >= 9, `only ${marks} AI Lab eyes and downloads carry a tip, expected at least 9`);
    let above = 0;
    for (let i = 0; i < marks; i++) {
      const at = await page.evaluate((i) => {
        const b = [...document.querySelectorAll('#aiApps .ai-card-eye[data-tip], #aiApps .ai-card-dl[data-tip]')]
          .filter(b => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden')[i];
        b.scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, tip: b.dataset.tip };
      }, i);
      await page.mouse.move(5, 5);
      await new Promise(r => setTimeout(r, 150));
      await page.mouse.move(at.x, at.y, { steps: 4 });
      await new Promise(r => setTimeout(r, 400));
      const m = await page.evaluate((x, y) => {
        const b = document.elementFromPoint(x, y)?.closest('.ai-card-eye, .ai-card-dl');
        const t = document.getElementById('tip');
        if (!b) return { hit: false };
        const tb = t.getBoundingClientRect(), r = b.getBoundingClientRect();
        return { hit: true, on: t.classList.contains('is-on'), text: t.textContent.trim(),
                 gap: Math.round(r.top - tb.bottom), off: Math.round((tb.left + tb.right) / 2 - (r.left + r.right) / 2) };
      }, at.x, at.y);
      const ok = m.hit && m.on && m.text === at.tip && m.gap >= 0 && m.gap < 30 && Math.abs(m.off) <= 2;
      if (ok) above++;
      else note(false, `the "${at.tip}" tip in the AI Lab: ${JSON.stringify(m)} -- it belongs centred ABOVE the button`);
    }
    note(above === marks, `${above} of ${marks} AI Lab tips sit centred above their button`);
    console.log(`ai lab tips: ${above} of ${marks} centred above their button`);
    await page.mouse.move(5, 5);
  }
  /* TITLES GO TO THE APP, THE CODE SITS BEHIND A CHIP (Dex, 2026-10-09).
     No title in the list leaves for GitHub any more; each row whose code is
     public carries a small GitHub chip that is invisible at rest and comes up
     under a REAL pointer on its row. Counted, so a list that lost its chips
     cannot pass on an empty walk. */
  {
    const links = await page.evaluate(() => [...document.querySelectorAll('#aiApps .ai-card-link[href]')]
      .map(a => ({ name: a.querySelector('strong').textContent.trim(), href: a.getAttribute('href') })));
    const toGh = links.filter(l => /github\.com/.test(l.href));
    note(links.length >= 7 && !toGh.length, `${links.length} AI Lab titles, ${toGh.length} still going to GitHub: ${toGh.map(l => l.name).join(', ')}`);
    note(links.find(l => l.name === 'Mobius 3D')?.href === '/mobius/', `the Mobius 3D title goes to ${links.find(l => l.name === 'Mobius 3D')?.href}, not the app`);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#aiApps .ai-card')]
      .map((c, i) => ({ i, gh: c.querySelector('.ai-card-gh')?.href || '' })).filter(r => r.gh));
    note(rows.length === 6, `${rows.length} AI Lab rows carry a GitHub chip, expected 6`);
    let shown = 0;
    for (const row of rows) {
      await page.mouse.move(5, 5);
      await new Promise(r => setTimeout(r, 300));
      const at = await page.evaluate((i) => {
        const c = document.querySelectorAll('#aiApps .ai-card')[i];
        c.scrollIntoView({ block: 'center', behavior: 'instant' });
        const g = c.querySelector('.ai-card-gh'), t = c.querySelector('.ai-card-link strong').getBoundingClientRect();
        return { rest: +getComputedStyle(g).opacity, x: t.left + 4, y: t.top + t.height / 2 };
      }, row.i);
      await page.mouse.move(at.x, at.y, { steps: 3 });
      await new Promise(r => setTimeout(r, 350));
      const on = await page.evaluate((i) => {
        const g = document.querySelectorAll('#aiApps .ai-card')[i].querySelector('.ai-card-gh');
        const r = g.getBoundingClientRect();
        return { op: +getComputedStyle(g).opacity, hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.ai-card-gh') === g };
      }, row.i);
      if (at.rest === 0 && on.op === 1 && on.hit && /^https:\/\/github\.com\/dexdcimino\//.test(row.gh)) shown++;
      else note(false, `the GitHub chip on row ${row.i}: ${at.rest} at rest, ${on.op} on hover, hit ${on.hit}, ${row.gh}`);
    }
    note(shown === rows.length, `${shown} of ${rows.length} GitHub chips hide at rest and come up on hover`);
    await page.mouse.move(5, 5);

    /* THE DOWNLOAD SIZE. Mobius's is read off the release (answered above);
       this Chrome says Linux, so it is the AppImage's 127,571,858 bytes. */
    const tips = await page.evaluate(() => [...document.querySelectorAll('#mobiusDownload, .fv-get')].map(b => b.dataset.tip));
    note(releaseAsks >= 1 && tips.length === 2 && tips.every(t => t === 'Download Mobius 3D\n122 MB · no install, just run it'),
         `the Mobius download tips read ${JSON.stringify(tips)} after ${releaseAsks} release request(s)`);
    /* The installable apps' sizes are MEASURED here, not trusted: each app
       launched in a fresh profile, its service worker left to fill its cache,
       and every cached body summed. The tip states "Under 1 MB" or "About N
       MB"; data-install-size carries the same figure for this comparison. */
    const apps = await page.evaluate(() => [...document.querySelectorAll('#aiApps .ai-card-dl[data-install-size]')]
      .map(a => ({ path: new URL(a.href).pathname, size: a.dataset.installSize, tip: a.dataset.tip })));
    note(apps.length === 3, `${apps.length} install buttons state a size, expected 3`);
    const before = missing.length;
    let sized = 0;
    for (const app of apps) {
      const ctx = await browser.createBrowserContext();
      const p2 = await ctx.newPage();
      await p2.goto(`${BASE}${app.path}`, { waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {});
      await p2.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready).catch(() => {});
      await new Promise(r => setTimeout(r, 2500));
      const got = await p2.evaluate(async () => {
        let bytes = 0, files = 0;
        for (const k of await caches.keys()) {
          const c = await caches.open(k);
          for (const req of await c.keys()) { bytes += (await (await c.match(req)).arrayBuffer()).byteLength; files++; }
        }
        return { bytes, files };
      }).catch(() => ({ bytes: 0, files: 0 }));
      await ctx.close();
      const mib = got.bytes / 1048576;
      const says = app.size === '<1' ? mib < 1 : Math.round(mib) === +app.size;
      const words = app.size === '<1' ? /\nUnder 1 MB · installs in seconds$/.test(app.tip) : app.tip.endsWith(`\nAbout ${app.size} MB · installs in seconds`);
      console.log(`install size ${app.path}: ${got.files} files, ${mib.toFixed(2)} MB cached; the tip says ${app.size} MB`);
      if (got.files >= 5 && says && words) sized++;
      else note(false, `${app.path} caches ${got.files} files, ${mib.toFixed(2)} MB, but its tip says "${app.tip}" -- re-measure and fix data-install-size and the tip`);
    }
    /* The apps call their own APIs on launch, which this static server does
       not have; those 404s are the apps', not the page under test. */
    missing.splice(before, missing.length - before, ...missing.slice(before).filter(u => !u.startsWith('/api/')));
    note(sized === apps.length, `${sized} of ${apps.length} install sizes match what the app actually caches`);
    console.log(`ai lab links: ${links.length} titles, ${shown}/${rows.length} GitHub chips, Mobius tip "${tips[0]?.replace('\n', ' / ')}", ${sized}/${apps.length} install sizes measured`);
  }
  /* A REAL click on the eye: the overlay is opened by the button's own
     handler, and the sandbox is decided there. Measured and hit-tested first,
     because a click on stale coordinates lands on whatever is there instead. */
  const eye = await page.evaluate(() => {
    const b = document.querySelector('#mobiusCard .ai-card-eye');
    b.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = b.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    return { x, y, hit: !!document.elementFromPoint(x, y)?.closest('#mobiusCard .ai-card-eye') };
  });
  note(eye.hit, 'the Mobius eye is covered at its own centre');
  await page.mouse.click(eye.x, eye.y);
  await page.waitForFunction(() => document.getElementById('appModal')?.open === true, { timeout: 5000 }).catch(() => {});
  const opened = await page.evaluate(() => {
    const d = document.getElementById('appModal'), f = document.getElementById('appFrame');
    return { open: d.open, shape: d.dataset.shape, src: f.getAttribute('src') || '', sandbox: f.getAttribute('sandbox') || '',
             radius: getComputedStyle(d).borderRadius, title: document.getElementById('app-dialog-title').textContent };
  });
  note(opened.open, 'the Mobius eye did not open the app overlay');
  note(opened.shape === 'wide', `the Mobius overlay is "${opened.shape}"-shaped — the viewer wants the wide window`);
  /* WIDER THAN IT IS TALL (Dex, 2026-10-08): a stubby rectangle, not the
     near-square ThemeDock window. Measured off the frame, not the attribute. */
  const box = await page.evaluate(() => { const r = document.querySelector('#appModal .app-phone').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  note(box.w / box.h > 1.3 && box.w / box.h < 1.6, `the Mobius frame is ${box.w}x${box.h} — it should be a stubby landscape rectangle`);
  // The download sits left of the eye and leads to an installer or Releases.
  const dl = await page.evaluate(() => {
    const a = document.getElementById('mobiusDownload'), eye = document.querySelector('#mobiusCard .ai-card-eye');
    return { href: a?.href || '', left: a && a.getBoundingClientRect().right <= eye.getBoundingClientRect().left + 6 };
  });
  note(/github\.com\/dexdcimino\/mobius-3d\/releases\/latest/.test(dl.href) && dl.left, `the Mobius download: ${JSON.stringify(dl)}`);
  note(opened.src === '/mobius/?sample=knot&embed=1', `the frame was pointed at "${opened.src}"`);
  note(/\ballow-downloads\b/.test(opened.sandbox), 'the Mobius frame cannot download — its Save screenshot would do nothing');
  note(opened.title === 'Mobius 3D', `the overlay is titled "${opened.title}"`);
  const viewer = await page.waitForFunction(() => {
    const s = document.getElementById('appFrame').contentWindow?.mobiusDebug?.statsText;
    return s && /triangles/.test(s) ? s : false;
  }, { timeout: 30000 }).then(h => h.jsonValue()).catch(() => '');
  note(/28,800 triangles/.test(viewer), `the viewer in the overlay reports "${viewer}" — it did not start on the sample`);
  console.log(`mobius: order ${order.slice(0, 3).join(' / ')}, ${opened.shape} overlay ${box.w}x${box.h}, "${viewer.split('·')[0].trim()}", sandbox ${opened.sandbox.includes('allow-downloads') ? '+downloads' : 'no downloads'}`);

  // Escape from INSIDE the frame closes the overlay, through the site's own
  // deferred rule: the viewer has nothing open, so it claims nothing.
  // A REAL click into the frame first: a scripted focus() across an iframe
  // boundary does not move the browser's focus (CLAUDE.md, the ones that lie),
  // and the Escape would then go to this document instead of the viewer's.
  /* The site binds its Escape rule on the frame's LOAD. The sample is built
     during the viewer's own script now, so the triangle count can be on
     screen a beat before load fires -- and an Escape in that beat has no
     listener to reach. Waited for, not slept. */
  await page.waitForFunction(() => document.getElementById('appFrame').contentDocument?.readyState === 'complete', { timeout: 5000 }).catch(() => {});
  const inside = await page.evaluate(() => {
    const r = document.getElementById('appFrame').getBoundingClientRect();
    return { x: r.left + r.width * 0.25, y: r.top + r.height * 0.8 };
  });
  await page.mouse.click(inside.x, inside.y);
  const focusInFrame = await page.evaluate(() => document.activeElement === document.getElementById('appFrame'));
  note(focusInFrame, 'a click on the viewer did not put focus in its frame');
  await page.keyboard.press('Escape');
  const closed = await page.waitForFunction(() => !document.getElementById('appModal').open, { timeout: 3000 })
    .then(() => true).catch(() => false);
  note(closed, 'Escape inside the viewer did not close the overlay');

  // The download allowance belongs to this card only, and must not leak to
  // the next app the shared overlay opens.
  const other = await page.evaluate(() => {
    const card = [...document.querySelectorAll('#aiApps .ai-card[data-app-modal]')].find(c => !c.hasAttribute('data-app-downloads'));
    card.querySelector('.ai-card-eye').click();
    return document.getElementById('appFrame').getAttribute('sandbox') || '(none)';
  });
  note(!/\ballow-downloads\b/.test(other), `the next app opened with "${other}" — the Mobius allowance leaked`);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
}

/* ---- 17b. Proto Isles: a featured slot that is a GALLERY ------------------
   FALSELY PASSES IF: the overlay were only asserted open -- it is the SAME
   dialog as VIEW ALL WORK, so the tabs have to be Proto Isles' own, the hero
   has to be one of its shots and actually decode, and VIEW ALL WORK afterwards
   has to be back on the portfolio's eight. And the lock is asserted by its
   LABEL, because the keypad it opens is the ` one and opens for anything. */
{
  /* BEFORE section 18, on purpose: that one leaves a phone's emulation
     behind it, and after it a mouse click at (783,775) arrived at (855,928)
     -- on the section under the card -- one run in two. */
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await page.$eval('#work', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('.fv-item')];
    if (!items[1].classList.contains('is-on')) document.querySelector('[data-fv="1"]').click();
  });
  await page.waitForFunction(() => document.querySelector('.fv-gallery')?.classList.contains('is-on'), { timeout: 5000 });
  /* The section before this one reloads the page, so the stage is still
     sliding in on its .reveal (24px over .7s) when this starts: a coordinate
     read now is where the card is passing, and the first version of this
     check clicked the section underneath. Wait for the slide to finish. */
  await page.waitForFunction(() => {
    const st = getComputedStyle(document.querySelector('.fw-stage'));
    return st.transform === 'none' && st.opacity === '1';
  }, { timeout: 5000 });
  const at = await page.$eval('.fv-gallery', el => { const r = el.getBoundingClientRect();
    return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.35 }; });
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, at);
  note(hit === 'fv-open', `the middle of the Proto Isles card is ${hit}, not its open button`);
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction(() => document.getElementById('workModal').open
    && /proto-isles/.test(document.getElementById('workHeroImg').currentSrc)
    && document.getElementById('workHeroImg').complete, { timeout: 10000 }).catch(() => {});
  const pi = await page.evaluate(() => ({
    open: document.getElementById('workModal').open,
    tabs: [...document.querySelectorAll('.work-tab')].map(t => t.textContent),
    on: document.querySelector('.work-tab[aria-selected="true"]')?.textContent,
    hero: document.getElementById('workHeroImg').currentSrc,
    w: document.getElementById('workHeroImg').naturalWidth,
    thumbs: document.querySelectorAll('#workStrip .work-thumb').length,
  }));
  note(pi.open, 'the Proto Isles card did not open the gallery');
  note(JSON.stringify(pi.tabs) === JSON.stringify(['VIDEO0', 'CHARACTERS5', 'ENVIRONMENT5', 'ITEMS5', 'PETS5', 'UI5', 'FEATURED3']),
       `Proto Isles tabs are ${JSON.stringify(pi.tabs)}`);
  note(pi.on === 'CHARACTERS5', `Proto Isles opened on ${pi.on}, not on its first tab with shots`);
  note(/proto-isles/.test(pi.hero) && pi.w > 0, `the Proto Isles hero is ${pi.hero} (${pi.w}px)`);
  note(pi.thumbs === 5, `the Proto Isles strip has ${pi.thumbs} thumbs, not 5`);
  const masters = await page.evaluate(() => [...document.querySelectorAll('.pi-data figure img')].map(i => i.getAttribute('src')));
  note(masters.length === 28 && new Set(masters).size === masters.length,
       `Proto Isles names ${masters.length} shots, ${new Set(masters).size} of them different`);

  /* THE CATEGORY BUTTONS over the arrows (Dex, 2026-10-09): each wears the
     NEIGHBOURING tab's icon, comes up only within two arrow-widths of its
     own arrow, never moves that arrow, and walks the tabs with wrapping.
     FALSELY PASSES IF: the reveal were read off the class alone (it is read
     off the computed opacity after the fade), or the jump were clicked with
     .click() (it is a REAL press, hit-tested first, on a button that is
     invisible until the pointer is near). */
  const jumps = () => page.evaluate(() => {
    const box = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, top: r.top, bottom: r.bottom }; };
    const side = (jump, arrow) => ({ ...box(jump), arrow: box(arrow), hidden: jump.hidden,
      icon: jump.querySelector('.icon').dataset.icon, tip: jump.dataset.tip,
      op: getComputedStyle(jump).opacity, near: jump.parentElement.classList.contains('is-near') });
    return { on: document.querySelector('.work-tab[aria-selected="true"]')?.textContent,
      frame: box(document.querySelector('.work-frame')),
      prev: side(document.getElementById('workJumpPrev'), document.getElementById('workPrev')),
      next: side(document.getElementById('workJumpNext'), document.getElementById('workNext')) };
  });
  // Until the fade has actually finished, not a guessed sleep: a 320ms wait
  // read 0.92 once, Chrome stalling the transition between compositor ticks.
  const settle = async () => {
    await new Promise(r => setTimeout(r, 60));
    /* And until the picture has landed: its box is the picture's own shape
       now, so the arrows on it move when a tab whose first piece is another
       shape (Featured's key art is 16:10, the rest 1920x920) finishes
       decoding -- and the dialog's own opening animation moves everything. */
    await page.waitForFunction(() => !document.getAnimations()
      .some(a => a.effect?.target?.classList?.contains('work-jump') || a.effect?.target?.id === 'workModal')
      && !document.getElementById('workHeroImg').classList.contains('is-fading'), { timeout: 3000 }).catch(() => {});
  };
  await page.mouse.move(5, 5); await settle();
  let j = await jumps();
  note(!j.prev.hidden && !j.next.hidden, 'the Proto Isles category buttons are hidden');
  note(j.prev.icon === 'pi-video' && j.next.icon === 'pi-tree',
       `on Characters the category buttons wear ${j.prev.icon} / ${j.next.icon}, not the video and the tree`);
  note(j.prev.op === '0' && j.next.op === '0', `with the pointer far away the category buttons are at opacity ${j.prev.op} / ${j.next.op}`);
  const arrowAt = j.next.arrow;
  note(Math.abs(arrowAt.y - j.frame.y) <= 1, `the next arrow is ${arrowAt.y - j.frame.y}px off the frame's middle`);
  // 1.8 arrow-widths in from the next arrow: near it, and far from the other.
  await page.mouse.move(arrowAt.x - arrowAt.w * 1.8, arrowAt.y, { steps: 4 }); await settle();
  j = await jumps();
  note(j.next.near && j.next.op === '1' && j.prev.op === '0',
       `1.8 widths from the next arrow the buttons read prev ${j.prev.op}, next ${j.next.op}`);
  note(Math.abs(j.next.arrow.x - arrowAt.x) < 0.5 && Math.abs(j.next.arrow.y - arrowAt.y) < 0.5,
       'the next arrow moved when its category button came up');
  note(Math.abs(j.next.w - j.next.arrow.w) < 0.5 && Math.abs(j.next.x - j.next.arrow.x) < 0.5 && j.next.bottom <= j.next.arrow.top - 8,
       `the category button is not the arrow's circle sitting above it: ${JSON.stringify([j.next.w, j.next.arrow.w, j.next.bottom, j.next.arrow.top])}`);
  await page.mouse.move(arrowAt.x - arrowAt.w * 2.6, arrowAt.y, { steps: 2 }); await settle();
  j = await jumps();
  note(!j.next.near && j.next.op === '0', `2.6 widths away the next category button is still up (${j.next.op})`);
  // A real press on it: Characters -> Environment, and the icons move along.
  const press = async (side) => {
    const b = (await jumps())[side];
    await page.mouse.move(b.arrow.x, b.arrow.y, { steps: 3 });
    await page.mouse.move(b.x, b.y, { steps: 3 }); await settle();
    const hitJump = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.work-jump')?.id, b);
    await page.mouse.click(b.x, b.y);
    return hitJump;
  };
  let hitJump = await press('next');
  j = await jumps();
  note(hitJump === 'workJumpNext' && j.on === 'ENVIRONMENT5', `a press on the tree hit ${hitJump} and landed on ${j.on}`);
  note(j.prev.icon === 'pi-player' && j.next.icon === 'pi-sword' && j.next.tip === 'ITEMS',
       `on Environment the buttons wear ${j.prev.icon} / ${j.next.icon} (${j.next.tip})`);
  await press('next');
  j = await jumps();
  note(j.on === 'ITEMS5' && j.next.icon === 'snail', `after two presses: ${j.on}, next wears ${j.next.icon}`);
  hitJump = await press('prev');
  j = await jumps();
  note(hitJump === 'workJumpPrev' && j.on === 'ENVIRONMENT5', `the left category button hit ${hitJump} and landed on ${j.on}`);
  // Wrapping: Featured's right-hand button is Video, and the empty Video tab
  // still has both, so it is not a dead end.
  await page.evaluate(() => document.getElementById('work-tab-featured').click());
  await settle();
  j = await jumps();
  note(j.prev.icon === 'pi-ui' && j.next.icon === 'pi-video', `on Featured the buttons wear ${j.prev.icon} / ${j.next.icon}`);
  await press('next');
  j = await jumps();
  note(j.on === 'VIDEO0' && !j.prev.hidden && j.prev.icon === 'pi-brand' && j.next.icon === 'pi-player',
       `Featured's next went to ${j.on}, whose buttons wear ${j.prev.icon} / ${j.next.icon}`);
  await page.mouse.move(5, 5);
  console.log(`proto isles jumps: reveal within 2 widths, arrow still, tree->Environment, wrap Featured->Video`);

  await page.evaluate(() => document.getElementById('work-tab-video').click());
  const empty = await page.evaluate(() => ({
    on: document.getElementById('workPanel').classList.contains('is-empty'),
    cap: document.getElementById('workCapTitle').textContent,
    says: document.getElementById('workHero').dataset.empty,
    thumbs: document.querySelectorAll('#workStrip .work-thumb').length }));
  note(empty.on && empty.cap === 'Coming soon' && empty.says === 'VIDEO COMING' && empty.thumbs === 0,
       `an empty Proto Isles tab shows ${JSON.stringify(empty)}`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('workModal').open, { timeout: 3000 }).catch(() => {});
  await page.evaluate(() => document.getElementById('viewAllWork').click());
  await page.waitForFunction(() => document.getElementById('workModal').open, { timeout: 5000 }).catch(() => {});
  const back = await page.evaluate(() => [document.querySelectorAll('.work-tab').length,
    document.getElementById('workJumpPrev').hidden && document.getElementById('workJumpNext').hidden]);
  note(back[0] === 8, `VIEW ALL WORK after Proto Isles shows ${back[0]} tabs, not the portfolio's 8`);
  note(back[1], 'the portfolio gallery shows the Proto Isles category buttons');
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));

  /* Closing an overlay hands the page back its scroll SMOOTHLY, so a
     coordinate read too soon is where the button is going to be passing, not
     where it stops -- the first version of this clicked the section below
     it. Wait for the button to stop moving, then measure. */
  await page.$eval('#work', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  for (let last = null, same = 0; same < 3;) {
    await new Promise(r => setTimeout(r, 150));
    const y = await page.$eval('.fv-gallery .fv-lock', el => Math.round(el.getBoundingClientRect().top));
    same = y === last ? same + 1 : 0; last = y;
  }
  const lock = await page.$eval('.fv-gallery .fv-lock', el => { const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, tip: el.dataset.tip }; });
  note(!/Mobius/.test(lock.tip), `the Proto Isles download tip says "${lock.tip}"`);
  const onLock = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.fv-lock') != null, lock);
  note(onLock, 'the Proto Isles download is covered where it is drawn');
  await page.mouse.move(lock.x, lock.y);
  await new Promise(r => setTimeout(r, 300));
  await page.mouse.click(lock.x, lock.y);
  await page.waitForFunction(() => document.getElementById('codeModal').open, { timeout: 3000 }).catch(() => {});
  const label = await page.evaluate(() => [document.getElementById('codeModal').open, document.getElementById('codeLabel').textContent]);
  note(label[0] && label[1] === 'DOWNLOAD LOCKED', `the Proto Isles download opened ${JSON.stringify(label)}`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('codeModal').open, { timeout: 3000 }).catch(() => {});
  const after = await page.evaluate(() => document.getElementById('codeLabel').textContent);
  note(after === 'ENTER CODE', `after the locked download the keypad says ${after}`);
  console.log(`proto isles: ${pi.tabs.length} tabs, ${pi.thumbs} shots, hero ${pi.w}px, empty tab ok=${empty.on}, lock "${label[1]}" -> "${after}"`);
}

/* ---- 18. the AI Lab app gallery: rails, the X, and the dark round it -------
   THE ASK (Dex, 2026-10-08): every AI Lab app's gallery (they all open
   #appShotModal) gets a thin rail outside each side of the picture with an
   accent chevron, shown when the pointer comes within ~20px and always on
   touch; the X centred in the space right of the right rail; and ANY click
   in the dark round the picture closes it -- it used to only when the click
   happened to land on the <dialog> itself rather than its stage.

   FALSELY PASSES IF: the rails were tested by their markup or by .click().
   Their reveal is :hover, so the pointer is MOVED for real; the press is a
   real mouse press hit-tested first; and the shot changing is read off the
   counter, not off the handler having run. Every app with shots is opened,
   so a gallery that opened elsewhere would be missed by the count. */
{
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  /* HEADLESS CHROME MATCHES (hover:none) -- with (pointer:none), and CDP
     cannot emulate hover away in it. The always-shown rule is therefore keyed
     on (pointer:coarse) as well, which is what a touch viewport turns on, so
     the desktop half here really is the hover-to-reveal one. */
  const keys = await page.evaluate(() => [...new Set([...document.querySelectorAll('#aiApps .ai-card[data-gallery]')]
    .map(c => c.dataset.gallery)
    .filter(k => document.querySelector(`#galleryModal .gal-item[data-game="${k}"]`)))]);
  note(keys.length >= 4, `only ${keys.length} AI Lab app(s) have a gallery — this check lost its subject`);
  const centre = (sel) => page.evaluate((sel) => {
    const el = document.querySelector(sel); const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    return { x, y, w: r.width, h: r.height, left: r.left, right: r.right, top: r.top,
             hit: !!document.elementFromPoint(x, y)?.closest(sel) };
  }, sel);
  const openFor = async (key) => {
    await page.evaluate((key) => {
      const card = document.querySelector(`#aiApps .ai-card[data-gallery="${key}"]`);
      card.scrollIntoView({ block: 'center', behavior: 'instant' });
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, key);
    await new Promise(r => setTimeout(r, 200));
    await page.$eval('#appArtView', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const v = await centre('#appArtView');
    await page.mouse.click(v.x, v.y);
    return page.waitForFunction(() => document.getElementById('appShotModal').open, { timeout: 3000 })
      .then(() => true).catch(() => false);
  };
  const opacity = (sel) => page.$eval(sel, el => +getComputedStyle(el).opacity);
  let galleries = 0;
  for (const key of keys) {
    if (!await openFor(key)) { note(false, `the ${key} gallery did not open from its frame`); continue; }
    galleries++;
    await new Promise(r => setTimeout(r, 300));
    const n = await page.$eval('#appShotCount', el => +el.textContent.split('/')[1]);
    const pic = await centre('#appShotStage img');
    const close = await centre('#appShotClose');
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    note(pic.w > 300 && pic.h > 150, `${key}: the picture is ${Math.round(pic.w)}x${Math.round(pic.h)}`);
    if (n > 1) {
      const next = await centre('#appShotRailNext');
      const prev = await centre('#appShotRailPrev');
      note(next.left > pic.right && prev.right < pic.left, `${key}: a rail is over the picture, not beside it`);
      note(Math.abs(next.h - pic.h / 3) < 4 || next.h === 72, `${key}: the rail is ${Math.round(next.h)}px against a ${Math.round(pic.h)}px picture`);
      note(Math.abs(next.y - pic.y) < 2, `${key}: the rail is not centred on the picture`);
      // the X: centred between the right rail and the screen's edge, level with the picture
      const mid = (next.right + vw) / 2;
      note(Math.abs(close.x - mid) < 3 && Math.abs(close.y - pic.y) < 3,
           `${key}: the X is at ${Math.round(close.x)},${Math.round(close.y)} — expected ${Math.round(mid)},${Math.round(pic.y)}`);
      // hidden far off, shown within 20px, by a REAL pointer
      await page.mouse.move(pic.x, pic.y);
      await new Promise(r => setTimeout(r, 300));
      const far = await opacity('#appShotRailNext');
      await page.mouse.move(next.right + 15, next.y);
      await new Promise(r => setTimeout(r, 300));
      const near = await opacity('#appShotRailNext');
      note(far === 0 && near === 1, `${key}: the right rail reads ${far} far off and ${near} within 15px`);
      const before = await page.$eval('#appShotCount', el => el.textContent);
      note(next.hit, `${key}: the right rail is covered at its centre`);
      await page.mouse.click(next.x, next.y);
      const after = await page.$eval('#appShotCount', el => el.textContent);
      note(+after.split('/')[0] === (+before.split('/')[0] % n) + 1, `${key}: the right rail took ${before} to ${after}`);
      await page.mouse.click(prev.x, prev.y);
      const back = await page.$eval('#appShotCount', el => el.textContent);
      note(back === before, `${key}: the left rail took ${after} to ${back}, expected ${before}`);
    } else {
      note(await page.$eval('#appShotRailNext', el => el.hidden), `${key}: one shot but the rails show`);
    }
    // a press on the picture keeps it open; one in the dark under it closes it
    await page.mouse.click(pic.x, pic.y);
    note(await page.$eval('#appShotModal', d => d.open), `${key}: a click on the picture closed the gallery`);
    const below = { x: pic.x, y: Math.min(pic.top + pic.h + 8, pic.top + pic.h + 8) };
    const target = await page.evaluate((x, y) => document.elementFromPoint(x, y)?.className || '', below.x, below.y);
    await page.mouse.click(below.x, below.y);
    const shut = await page.waitForFunction(() => !document.getElementById('appShotModal').open, { timeout: 2000 })
      .then(() => true).catch(() => false);
    note(shut, `${key}: a click in the dark under the picture (on "${target}") left the gallery open`);
  }
  note(galleries === keys.length, `${galleries} of ${keys.length} AI Lab galleries opened`);

  // The far left and the X itself close it too, measured on the first gallery.
  if (await openFor(keys[0])) {
    await new Promise(r => setTimeout(r, 300));
    await page.mouse.click(12, 500);
    note(!await page.$eval('#appShotModal', d => d.open), 'a click at the far left of the screen left the gallery open');
  }
  if (await openFor(keys[0])) {
    await new Promise(r => setTimeout(r, 300));
    const close = await centre('#appShotClose');
    note(close.hit, 'the X is covered at its centre');
    await page.mouse.click(close.x, close.y);
    note(!await page.$eval('#appShotModal', d => d.open), 'the X did not close the gallery');
  }

  // Touch: no hover, so the rails are always shown.
  await page.setViewport({ width: 1600, height: 1000, hasTouch: true });
  await new Promise(r => setTimeout(r, 300));
  note(await page.evaluate(() => matchMedia('(hover:none) and (pointer:coarse)').matches),
       'the touch viewport does not read as touch -- the next check would test nothing');
  const multi = keys.find(k => k === 'inko') || keys[0];
  if (await openFor(multi)) {
    await new Promise(r => setTimeout(r, 300));
    await page.mouse.move(5, 5);
    await new Promise(r => setTimeout(r, 300));
    const rail = await page.$eval('#appShotRailNext', el => ({ hidden: el.hidden, op: +getComputedStyle(el).opacity }));
    note(!rail.hidden && rail.op === 1, `on touch the rail is ${rail.hidden ? 'hidden' : `at opacity ${rail.op}`}`);
  }
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));

  // A phone: the rails inside the picture's edges, the X above its corner, all on screen.
  await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
  await new Promise(r => setTimeout(r, 400));
  const phone = await page.evaluate((key) => {
    const card = document.querySelector(`#aiApps .ai-card[data-gallery="${key}"]`);
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.getElementById('appArtView').click();
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    const d = document.getElementById('appShotModal');
    return { open: d.open, vw: document.documentElement.clientWidth, pic: r('appShotStage').toJSON(),
             next: r('appShotRailNext').toJSON(), x: r('appShotClose').toJSON(),
             op: +getComputedStyle(document.getElementById('appShotRailNext')).opacity };
  }, multi);
  note(phone.open, 'the gallery did not open on a phone');
  note(phone.next.right <= phone.pic.right && phone.next.right <= phone.vw && phone.op === 1,
       `on a phone the right rail is at ${Math.round(phone.next.right)} of ${phone.vw} (opacity ${phone.op})`);
  note(phone.x.bottom <= phone.pic.top && phone.x.right <= phone.vw && phone.x.top >= 0,
       `on a phone the X is not above the picture's corner (${JSON.stringify(phone.x)})`);
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  await page.setViewport({ width: 1600, height: 1000 });
  console.log(`app gallery: ${galleries}/${keys.length} opened, rails, X and the dark round the picture driven`);
}

note(missing.length === 0, `404s: ${[...new Set(missing)].slice(0, 5).join(', ')}`);

await browser.close();
server.close();
console.log(`\n${pass} checks passed`);
console.log(fail.length ? `FAIL (${fail.length}):\n  ${fail.join('\n  ')}`
                        : 'PASS — featured work and the overlay both hold');
process.exit(fail.length ? 1 : 0);
