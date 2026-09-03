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
  /* Case 6 left the work overlay open, and the shortcut deliberately stands
     down while any dialog is up. Closing it here is not tidying -- without it
     this whole section measures a modal that never opened. */
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
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate(() =>
      document.querySelectorAll('#codePins .vault-pin').forEach(p => { p.value = ''; }));
    await page.focus('#codePins .vault-pin');
    for (const c of 'ZZZZZ') { await page.keyboard.type(c); await new Promise(r => setTimeout(r, 40)); }
    await new Promise(r => setTimeout(r, 500));
  }
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
      onDownload: hitOf(item.querySelector('.fv-dl'), 0.5, 0.5),
    };
  });
  console.log(`video card: "${card.title}" at ${card.strongPx}px; ` +
              `over the title ${card.onTitle}, over the download ${card.onDownload}`);
  note(card.title === 'TITLE COMING!', `the video card reads "${card.title}"`);
  note(card.strongPx < 42 && card.strongPx > 24,
       `the caption is ${card.strongPx}px; it was 47.6 and came down a fifth`);
  note(!card.onTitle.includes('card-shade'), 'the fade is painted over the caption');
  note(!card.onDownload.includes('card-shade'), 'the fade is painted over the download button');

  /* The info popover sits BESIDE its icon. Measured against the hazard strip's
     TAPE, not against .fv-soon's box: that box is 44% of the frame tall and
     mostly empty at the top, so a box-to-box test calls a clean layout a
     collision. What the complaint was about is ink on ink. */
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
  note(Math.abs(desc.offCentre) <= 3,
       `the description is ${desc.offCentre}px off the icon's centre line`);
  note(!desc.onTape, 'the description is printed over the UNDER CONSTRUCTION strip');
  note(desc.widthShare < 70, `the description spans ${desc.widthShare}% of the frame`);
  note(new Set(desc.texts).size === 1 && desc.texts.length === 3,
       `the three slots say ${new Set(desc.texts).size} different things, expected one`);
}

/* ---- 13. the loud tooltip ------------------------------------------------
   FALSELY PASSES IF: the attribute were read rather than the bubble hovered.
   Three separate things have to be true at once and none is visible in markup:
   the bubble must be ABOVE the button (the default is below, which for a
   control in the bottom-right corner of a card falls off the window), the two
   lines must be coloured differently, and the click answer must hand the
   button back the tip it had rather than the hard-coded "Download" it used to
   restore -- which would silently flatten this into one plain line. */
{
  await page.hover('.fv-item.is-on .fv-dl');
  await new Promise(r => setTimeout(r, 400));
  const tip = await page.evaluate(() => {
    const t = document.getElementById('tip');
    const b = document.querySelector('.fv-item.is-on .fv-dl');
    const tb = t.getBoundingClientRect(), r = b.getBoundingClientRect();
    const lead = t.querySelector('.tip-lead'), sub = t.querySelector('.tip-sub');
    return { on: t.classList.contains('is-on'), loud: t.classList.contains('is-loud'),
             lead: lead && lead.textContent, sub: sub && sub.textContent,
             leadColor: lead && getComputedStyle(lead).color,
             subColor: sub && getComputedStyle(sub).color,
             gap: Math.round(r.top - tb.bottom),
             offCentre: Math.round((tb.left + tb.right) / 2 - (r.left + r.right) / 2) };
  });
  console.log(`tip: "${tip.lead}" / "${tip.sub}", ${tip.gap}px above, ` +
              `${tip.offCentre}px off centre, lead ${tip.leadColor}`);
  note(tip.on && tip.loud, 'the download button did not raise the loud tooltip');
  note(!!tip.lead && !!tip.sub, 'the tooltip did not split into two lines');
  note(tip.leadColor !== tip.subColor, 'both tooltip lines are the same colour');
  note(tip.gap >= 0 && tip.gap < 40, `the bubble sits ${tip.gap}px above the button`);
  note(Math.abs(tip.offCentre) <= 2, `the bubble is ${tip.offCentre}px off centre`);

  // The click answer, and what it gives back afterwards.
  await page.click('.fv-item.is-on .fv-dl');
  await new Promise(r => setTimeout(r, 250));
  const during = await page.evaluate(() => document.querySelector('.fv-item.is-on .fv-dl').dataset.tip);
  await new Promise(r => setTimeout(r, 2400));
  const after = await page.evaluate(() => {
    const b = document.querySelector('.fv-item.is-on .fv-dl');
    return { tip: b.dataset.tip, kind: b.dataset.tipKind };
  });
  console.log(`after the click: "${during}" -> "${after.tip}" (${after.kind})`);
  note(during === 'Build coming soon', `the click answered "${during}"`);
  note(after.tip.includes('\n') && after.kind === 'loud',
       `the button came back with "${after.tip}" (${after.kind}), not the tip it had`);
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

note(missing.length === 0, `404s: ${[...new Set(missing)].slice(0, 5).join(', ')}`);

await browser.close();
server.close();
console.log(`\n${pass} checks passed`);
console.log(fail.length ? `FAIL (${fail.length}):\n  ${fail.join('\n  ')}`
                        : 'PASS — featured work and the overlay both hold');
process.exit(fail.length ? 1 : 0);
