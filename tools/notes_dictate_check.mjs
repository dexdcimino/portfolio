/* Drive DICTATION and the AI Lab SANDBOX in a real browser.
 *
 *   node tools/notes_dev_server.mjs &
 *   node tools/notes_dictate_check.mjs [--port 8123]
 *
 * SPEECH RECOGNITION CANNOT RUN HEADLESS -- there is no microphone and no
 * speech service -- so a fake SpeechRecognition is installed before any of
 * the page's own script runs, and the checks drive it by hand. That is not a
 * mock of our code: every line of notes/dictate.js runs for real, including
 * the restart loop, the commit diff and the DOM writes. What it cannot tell
 * you is whether Chrome's own engine behaves the way the fake does, which is
 * why the fake emits BOTH shapes a real engine emits -- desktop Chrome's
 * incremental finals and Android's cumulative ones -- and both are asserted.
 *
 * The clock is faked the same way, so the ten-minute silence cap can be
 * tested in a second rather than in ten minutes.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = `http://127.0.0.1:${arg('--port', 8123)}`;
const STORE = resolve(arg('--dir', join(ROOT, '.notes-dev')));

const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => p && existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');

const fail = [];
let pass = 0;
let tokenBeforeSandbox = null;
const note = (ok, why) => { if (ok) pass++; else fail.push(why); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* The fake engine and the fake clock, installed before the page's scripts. */
const STUB = `
(() => {
  const realNow = Date.now;
  window.__skew = 0;
  Date.now = () => realNow() + window.__skew;

  class FakeRecognition {
    constructor() {
      this.continuous = false; this.interimResults = false; this.lang = ''; this.maxAlternatives = 1;
      this.onresult = null; this.onerror = null; this.onend = null;
      this.state = 'new';
      FakeRecognition.made.push(this);
    }
    start() {
      if (FakeRecognition.throwOnStart) { FakeRecognition.throwOnStart = false; throw new Error('busy'); }
      this.state = 'running'; FakeRecognition.live = this;
    }
    stop()  { if (this.state !== 'running') return; this.state = 'stopped'; this._end(); }
    abort() { this.aborted = true; if (this.state !== 'running') return; this.state = 'aborted'; if (this.onerror) this.onerror({ error: 'aborted' }); this._end(); }
    _end()  { if (FakeRecognition.live === this) FakeRecognition.live = null; if (this.onend) this.onend(); }
  }
  FakeRecognition.made = [];
  FakeRecognition.live = null;
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;

  // slots: [[text, isFinal], ...] -- the whole results list, as the engine
  // would hand it over.
  window.__say = (slots) => {
    const r = FakeRecognition.live;
    if (!r || !r.onresult) return 'no live recognizer';
    const results = slots.map(([t, final]) => { const alt = [{ transcript: t, confidence: 0.9 }]; alt.isFinal = !!final; return alt; });
    r.onresult({ resultIndex: 0, results });
    return 'ok';
  };
  window.__endSession = () => { const r = FakeRecognition.live; if (r) r.stop(); };
  // Fire a result on a SPECIFIC recognizer, live or not: the late delivery
  // from an aborted one is the thing worth proving cannot write.
  window.__sayOn = (idx, slots) => {
    const r = FakeRecognition.made[idx];
    if (!r) return 'no such recognizer';
    if (!r.onresult) return 'unhooked';
    const results = slots.map(([t, final]) => { const alt = [{ transcript: t, confidence: 0.9 }]; alt.isFinal = !!final; return alt; });
    r.onresult({ resultIndex: 0, results });
    return 'delivered';
  };
  window.__errSession = (kind) => { const r = FakeRecognition.live; if (r && r.onerror) r.onerror({ error: kind }); };
  window.__mic = {
    made: () => FakeRecognition.made.length,
    live: () => !!FakeRecognition.live,
    settings: () => { const r = FakeRecognition.live; return r ? { continuous: r.continuous, interim: r.interimResults, alts: r.maxAlternatives, lang: r.lang } : null; },
  };
})();
`;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-first-run', '--no-default-browser-check', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.createCDPSession().then(s => s.send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {}));
await page.setViewport({ width: 1500, height: 950 });
await page.evaluateOnNewDocument(STUB);
page.on('pageerror', e => fail.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error' && !/favicon|401/.test(m.text())) fail.push(`console: ${m.text()}`); });

/* Every request the page makes, so the sandbox can be proved to make none. */
const apiCalls = [];
page.on('request', (r) => { if (/\/api\/notes\//.test(r.url())) apiCalls.push(`${r.method()} ${r.url().split('?')[0]}`); });

await page.goto(`${BASE}/#notes`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('#notesPins .vault-pin', { visible: true });
await page.focus('#notesPins .vault-pin');
for (const c of 'notes') { await page.keyboard.type(c); await sleep(40); }
await page.waitForFunction(() => document.querySelectorAll('.nt-cat').length > 0, { timeout: 20000 });

/* A scratch category to talk into. */
await page.keyboard.down('Alt'); await page.keyboard.press('n'); await page.keyboard.up('Alt');
await sleep(200);
await page.keyboard.type('Dictation scratch');
await page.keyboard.press('Enter');
await sleep(80);
const catId = await page.evaluate(() => document.activeElement.dataset.cat);
const sel = `.nt-body[data-cat="${catId}"]`;
const text = () => page.$eval(sel, (b) => b.textContent.replace(/\u00a0/g, ' '));
const html = () => page.$eval(sel, (b) => b.innerHTML);
/* A say() that cannot pass silently. window.__say returns a string when
   there is no live recognizer, and a check that speaks into nothing and then
   asserts nothing changed would pass for the wrong reason. */
const say = async (slots) => {
  const r = await page.evaluate((s) => window.__say(s), slots);
  if (r !== 'ok') fail.push(`spoke into nothing (${r}) — no live recognizer at this point in the run`);
  return r;
};
/* The mic is clicked programmatically. page.click() aims at a viewport
   coordinate, and a category below the fold puts that coordinate off screen --
   which silently clicks nothing and reads exactly like a dead button. Where a
   REAL pointer matters (the click-mid-utterance case) the element is scrolled
   into view first and page.mouse is used. That the mic is where a person can
   reach it is asserted by geometry in check 1, not by whether puppeteer
   happened to hit it. */
const clickMic = () => page.evaluate((id) => document.querySelector(`.nt-mic[data-cat="${id}"]`).click(), catId);
const micState = () => page.evaluate((id) => {
  const b = document.querySelector(`.nt-mic[data-cat="${id}"]`);
  return { live: b.classList.contains('is-live'), pressed: b.getAttribute('aria-pressed') };
}, catId);

/* ---- 1. the button is there, and starting configures the engine ---------- */
{
  const shown = await page.evaluate((id) => {
    const b = document.querySelector(`.nt-mic[data-cat="${id}"]`);
    if (!b) return null;
    const body = document.querySelector(`.nt-body[data-cat="${id}"]`);
    const r = b.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    return { hidden: b.hidden, fromRight: Math.round(br.right - r.right), fromBottom: Math.round(br.bottom - r.bottom), size: Math.round(r.width) };
  }, catId);
  note(!!shown, 'there is no microphone button on a text box');
  note(shown && !shown.hidden, 'the microphone button is hidden even though the engine is available');
  note(shown && shown.fromRight >= 0 && shown.fromRight < 20 && shown.fromBottom >= 0 && shown.fromBottom < 20,
       `the microphone is not in the bottom-right of the box (${shown && shown.fromRight}px from the right, ${shown && shown.fromBottom}px from the bottom)`);
  console.log(`mic button: ${shown.size}px, ${shown.fromRight}px from the right edge, ${shown.fromBottom}px from the bottom`);

  await clickMic();
  await sleep(150);
  const s = await page.evaluate(() => window.__mic.settings());
  note(!!s, 'clicking the microphone did not start a recognizer');
  note(s && s.continuous === true && s.interim === true, `the recognizer is not continuous with interim results: ${JSON.stringify(s)}`);
  note((await micState()).live, 'the button does not show that it is listening');
  console.log(`started: ${JSON.stringify(s)}`);
}

/* ---- 2. provisional words show, and reach NOTHING ------------------------
   FALSELY PASSES IF: it only checked the screen. Provisional text that gets
   into the history is undone into; provisional text that gets into the store
   is saved. Both are asserted against the real functions. */
{
  await say([['hello wor', false]]);
  await sleep(60);
  note(/nt-interim/.test(await html()), 'provisional words did not appear');
  note((await text()).includes('hello wor'), 'the provisional words are not on screen');
  const leak = await page.evaluate((id) => {
    const b = document.querySelector(`.nt-body[data-cat="${id}"]`);
    const clone = b.cloneNode(true);
    return { inSerialize: /nt-interim|hello wor/.test(clone.innerHTML) && !!b.querySelector('.nt-interim') };
  }, catId);
  void leak;
  // The real test: what the app would save, and what it would undo to.
  const saved = await page.evaluate(async () => {
    const { serialize } = await import('/notes/schema.js');
    const b = document.querySelector('.nt-body[data-cat="' + document.querySelector('.nt-mic.is-live').dataset.cat + '"]');
    return serialize(b);
  });
  note(!/hello wor|nt-interim/.test(saved), `provisional words reached serialize(): ${saved}`);
  note(await page.evaluate(() => !!document.querySelector('.nt-interim[contenteditable="false"]')),
       'the provisional span is editable, so the browser will type into it');
}

/* ---- 3. a final commits as real text, once ------------------------------- */
{
  await say([['hello world', true]]);
  await sleep(80);
  note(!/nt-interim/.test(await html()), 'the provisional span survived the final');
  note((await text()).trim() === 'Hello world', `the final did not commit cleanly: "${await text()}"`);
  note(/^<p>Hello world<\/p>$/.test((await html()).trim()), `the committed text is not plain text in the paragraph: ${await html()}`);
  // The same final again must not write it twice.
  await say([['hello world', true]]);
  await sleep(80);
  note((await text()).trim() === 'Hello world', `a repeated final was written twice: "${await text()}"`);
  console.log(`commit: "${await text()}"`);
}

/* ---- 4. desktop Chrome's shape: finals are INCREMENTS -------------------- */
{
  await say([['hello world', true], [' and then some', true]]);
  await sleep(80);
  note((await text()).trim() === 'Hello world and then some', `incremental finals did not append: "${await text()}"`);
}

/* ---- 5. Android's shape: finals are CUMULATIVE SNAPSHOTS -----------------
   FALSELY PASSES IF: only one slot were ever sent. This is the exact shape
   that wrote the sentence four times in the app this replaces. */
{
  // A fresh recognizer, so the committed tracker starts clean.
  await page.evaluate(() => window.__endSession());
  await sleep(120);
  await page.evaluate((id) => {
    const b = document.querySelector(`.nt-body[data-cat="${id}"]`);
    b.innerHTML = '<p><br></p>';
    b.dispatchEvent(new Event('input', { bubbles: true }));
    const s = getSelection(); s.collapse(b.firstChild, 0);
  }, catId);
  await sleep(60);
  await say([['test', true]]);
  await say([['test', true], ['test one', true]]);
  await say([['test', true], ['test one', true], ['test one two', true]]);
  await sleep(80);
  note((await text()).trim() === 'Test one two', `cumulative finals were written more than once: "${await text()}"`);
  console.log(`cumulative: "${await text()}"`);
}

/* ---- 6. the words follow the caret --------------------------------------- */
{
  await page.evaluate((id) => {
    const b = document.querySelector(`.nt-body[data-cat="${id}"]`);
    b.innerHTML = '<p>one</p><p>two</p>';
    b.dispatchEvent(new Event('input', { bubbles: true }));
    const p = b.firstChild;
    const s = getSelection(); s.collapse(p.firstChild, 3);   // end of "one"
  }, catId);
  await sleep(60);
  await page.evaluate(() => window.__endSession());
  await sleep(120);
  await say([['inserted here', true]]);
  await sleep(80);
  const shape = await page.$eval(sel, (b) => [...b.children].map(c => c.textContent).join(' | '));
  note(shape === 'one inserted here | two', `dictation did not land at the caret: ${shape}`);
  console.log(`caret follows: ${shape}`);
}

/* ---- 7. a click mid-utterance keeps the words where they were said -------
   FALSELY PASSES IF: it never checked the recognizer was cut off. Without
   the abort the engine's own final for those words lands a second time at
   the new caret, which is a duplicate nobody can explain. */
{
  await page.evaluate((id) => {
    const b = document.querySelector(`.nt-body[data-cat="${id}"]`);
    b.innerHTML = '<p>alpha</p><p>bravo</p>';
    b.dispatchEvent(new Event('input', { bubbles: true }));
    const s = getSelection(); s.collapse(b.firstChild.firstChild, 5);
  }, catId);
  await sleep(60);
  await page.evaluate(() => window.__endSession());
  await sleep(140);
  await page.evaluate((id) => {
    document.querySelector(`.nt-cat[data-cat="${id}"]`).scrollIntoView({ block: 'center', behavior: 'instant' });
  }, catId);
  await sleep(300);
  const before = await page.evaluate(() => window.__mic.made());
  await say([[' half a sentence', false]]);
  await sleep(60);
  note((await text()).includes('half a sentence'), 'the provisional words are not showing before the click');
  // Click into the second paragraph.
  const at = await page.evaluate((id) => {
    const p = document.querySelector(`.nt-body[data-cat="${id}"]`).children[1];
    const r = p.getBoundingClientRect();
    // Left end of the line: the right end of the last one is under the
    // microphone, and a click there stops dictation, correctly.
    return { x: Math.round(r.left + 6), y: Math.round(r.top + r.height / 2) };
  }, catId);
  note(await page.evaluate((p) => { const e = document.elementFromPoint(p.x, p.y); return !!(e && e.closest('.nt-body')); }, at),
       'the harness is aiming at a point that is not in the text box');
  await page.mouse.click(at.x, at.y);
  await sleep(250);
  const after = await page.evaluate(() => window.__mic.made());
  const shape = await page.$eval(sel, (b) => [...b.children].map(c => c.textContent).join(' | '));
  note(/^alpha half a sentence/.test(shape), `the provisional words did not stay where they were said: ${shape}`);
  note(!/nt-interim/.test(await html()), 'the provisional span survived the click');
  note(after > before, `the recognizer was not cut off by the click (${before} -> ${after} recognizers)`);
  /* The abort is what stops those words arriving a second time. A real
     engine drops the utterance; this proves that even if the aborted
     recognizer DID deliver its final late, it can no longer write -- which
     is the property, and it survives a racing browser. */
    const late = await page.evaluate((i) => window.__sayOn(i, [[' half a sentence', true]]), before - 1);
  await sleep(120);
  const twice = (await text()).match(/half a sentence/g) || [];
  note(twice.length === 1, `the words landed ${twice.length} times: the aborted recognizer still wrote (${late})`);
  note(late === 'unhooked', `the aborted recognizer still has its handlers attached (${late})`);
  console.log(`click mid-utterance: ${shape.replace(/\s+/g, ' ')}, recognizers ${before} -> ${after}`);
}

/* ---- 8. undo treats a dictated phrase as one step ------------------------ */
{
  await page.evaluate((id) => {
    const b = document.querySelector(`.nt-body[data-cat="${id}"]`);
    b.innerHTML = '<p>keep</p>';
    b.dispatchEvent(new Event('input', { bubbles: true }));
    const s = getSelection(); s.collapse(b.firstChild.firstChild, 4);
  }, catId);
  await sleep(60);
  await page.evaluate(() => window.__endSession());
  await sleep(140);
  await say([[' and drop this', true]]);
  await sleep(100);
  note((await text()).trim() === 'keep and drop this', `the phrase did not commit: "${await text()}"`);
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  await sleep(120);
  note((await text()).trim() === 'keep', `Ctrl+Z did not take back exactly the dictated phrase: "${await text()}"`);
  await page.keyboard.down('Control'); await page.keyboard.press('y'); await page.keyboard.up('Control');
  await sleep(120);
  note((await text()).trim() === 'keep and drop this', `redo did not put the phrase back: "${await text()}"`);
}

/* ---- 9. the engine ending on its own does not end the session ------------ */
{
  const before = await page.evaluate(() => window.__mic.made());
  await page.evaluate(() => window.__errSession('no-speech'));
  await page.evaluate(() => window.__endSession());
  await sleep(200);
  const after = await page.evaluate(() => window.__mic.made());
  note(after === before + 1, `a session that ended on its own did not restart (${before} -> ${after})`);
  note((await micState()).live, 'the button stopped showing as listening after an automatic restart');
  note(await page.evaluate(() => window.__mic.live()), 'no recognizer is running after the restart');
  console.log(`auto-restart: ${before} -> ${after} recognizers, still listening`);
}

/* ---- 10. the pill appears when the box is scrolled away ------------------ */
{
  await page.evaluate(() => { document.querySelector('.nt-canvas').scrollTo({ top: 0, behavior: 'instant' }); });
  await sleep(300);
  const p = await page.evaluate(() => {
    const el = document.querySelector('.nt-pill');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const side = document.querySelector('.nt-sidebar').getBoundingClientRect();
    const head = document.querySelector('.nt-header').getBoundingClientRect();
    return { on: el.classList.contains('is-on'), leftOfSidebar: Math.round(r.left - side.right), belowHeader: Math.round(r.top - head.bottom), name: el.querySelector('.nt-pill-name').textContent, time: el.querySelector('.nt-pill-time').textContent };
  });
  note(!!p, 'there is no dictation pill');
  note(p && p.on, 'the pill did not appear when the recording box was scrolled out of view');
  note(p && p.leftOfSidebar > 0 && p.leftOfSidebar < 40, `the pill is ${p && p.leftOfSidebar}px right of the sidebar, expected just outside it`);
  note(p && p.belowHeader > 0 && p.belowHeader < 40, `the pill is ${p && p.belowHeader}px below the header`);
  note(p && p.name === 'Dictation scratch', `the pill names "${p && p.name}"`);
  note(p && /^\d\d:\d\d$/.test(p.time), `the pill's timer reads "${p && p.time}"`);
  console.log(`pill: "${p.name}" ${p.time}, ${p.leftOfSidebar}px right of the sidebar, ${p.belowHeader}px below the header`);

  // Clicking it goes back to the box, and the pill stands down.
  await page.evaluate(() => document.querySelector('.nt-pill-main').click());
  await sleep(800);
  note(!(await page.$eval('.nt-pill', e => e.classList.contains('is-on'))), 'the pill stayed up after scrolling back to the box');
}

/* ---- 11. ten minutes of silence, on a fake clock ------------------------- */
{
  note(await page.evaluate(() => window.__mic.live()), 'not recording going into the silence check');
  await page.evaluate(() => { window.__skew = 9 * 60 * 1000; });
  await sleep(1200);
  note(await page.evaluate(() => window.__mic.live()), 'dictation stopped after nine minutes of silence, before the cap');
  // A word puts the full ten minutes back.
  await say([['still here', false]]);
  await page.evaluate(() => { window.__skew = 18 * 60 * 1000; });
  await sleep(1200);
  note(await page.evaluate(() => window.__mic.live()), 'speech did not reset the silence clock');
  await page.evaluate(() => { window.__skew = 30 * 60 * 1000; });
  await sleep(1300);
  note(!(await page.evaluate(() => window.__mic.live())), 'dictation did not stop after ten minutes without a word');
  note(!(await micState()).live, 'the button still shows as listening after the silence cap');
  note(!/nt-interim/.test(await html()), 'provisional words were left on screen when the silence cap fired');
  await page.evaluate(() => { window.__skew = 0; });
  console.log('silence cap: survived 9 minutes, reset by a word, stopped after 10');
}

/* ---- 12. a refused microphone says so and stops -------------------------- */
{
  await clickMic();
  await sleep(150);
  note(await page.evaluate(() => window.__mic.live()), 'could not restart after the silence cap');
  await page.evaluate(() => window.__errSession('not-allowed'));
  await sleep(200);
  note(!(await page.evaluate(() => window.__mic.live())), 'a refused microphone did not stop the session');
  note(!(await micState()).live, 'the button still shows as listening after the microphone was refused');
  const said = await page.$eval('.nt-toast', e => e.textContent).catch(() => '');
  note(/microphone/i.test(said), `nothing told the user the microphone was refused (toast said "${said}")`);
  console.log(`refusal: "${said}"`);
}

/* ---- 13. nothing provisional ever reached the store ---------------------- */
{
  await page.keyboard.down('Control'); await page.keyboard.press('s'); await page.keyboard.up('Control');
  await page.waitForFunction(() => /^SAVED/.test(document.querySelector('.nt-status').textContent), { timeout: 15000 });
  const stored = JSON.parse(await readFile(join(STORE, 'notes/current.json'), 'utf8'));
  const body = JSON.stringify(stored.doc);
  note(!/nt-interim/.test(body), 'a provisional span was saved to the store');
  note(!/hello wor\b/.test(body), 'a provisional word was saved to the store');
  console.log(`store: clean of provisional text (${body.length} chars)`);
}

/* ---- tidy: delete the scratch category ----------------------------------- */
await page.evaluate((id) => {
  const row = [...document.querySelectorAll('.nt-row')].find(r => r.dataset.cat === id);
  if (row) row.querySelector('.nt-row-x').click();
}, catId);
await page.waitForSelector('.nt-modal').catch(() => {});
await page.click('.nt-modal .nt-btn.is-left').catch(() => {});
await sleep(200);
await page.evaluate(() => document.getElementById('notesModal').close());
await sleep(300);

/* ---- 14. THE SANDBOX: the AI Lab preview --------------------------------
   FALSELY PASSES IF: it only looked at what was on screen. The point of the
   sandbox is what it CANNOT do, so this counts every request to /api/notes/
   it makes (must be none) and checks the real document on disk is untouched
   afterwards. */
{
  const storeBefore = await readFile(join(STORE, 'notes/current.json'), 'utf8');
  tokenBeforeSandbox = await page.evaluate(() => { try { return sessionStorage.getItem('notes-token'); } catch { return null; } });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 60000 });
  apiCalls.length = 0;
  await page.$eval('[data-notes-demo]', el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await sleep(400);
  await page.click('[data-notes-demo]');
  const opened = await page.waitForFunction(() => document.querySelectorAll('.nt-cat').length > 0, { timeout: 20000 }).then(() => true).catch(() => false);
  note(opened, 'the AI Lab eyeball did not open the notes sandbox');

  const shape = await page.evaluate(() => ({
    demo: document.querySelector('.nt-app').classList.contains('is-demo'),
    cats: [...document.querySelectorAll('.nt-cat')].map(c => ({
      title: c.querySelector('.nt-cat-title').textContent,
      emoji: c.querySelector('.nt-cat-emoji').textContent,
      colour: c.style.getPropertyValue('--c').trim(),
    })),
    session: document.querySelector('.nt-session-title').textContent,
    sessionEmoji: document.querySelector('.nt-session-emoji').textContent,
    sessionColour: document.querySelector('.nt-app').style.getPropertyValue('--c').trim(),
    status: document.querySelector('.nt-status').textContent,
    note: !!document.querySelector('.nt-demo-note'),
    todos: document.querySelectorAll('.nt-body ul.todo li').length,
    checked: document.querySelectorAll('.nt-body ul.todo li[data-checked]').length,
    nested: document.querySelectorAll('.nt-body li ul li').length,
    mics: document.querySelectorAll('.nt-mic').length,
  }));
  console.log('sandbox:', JSON.stringify(shape));
  note(shape.demo, 'the sandbox is not marked as a demo');
  note(shape.session === 'Brainstorm', `the sandbox session is "${shape.session}", expected Brainstorm`);
  note(shape.sessionEmoji === '\u{1F47D}', `the sandbox session icon is "${shape.sessionEmoji}", expected the alien`);
  note(shape.cats.length === 2, `${shape.cats.length} categories in the sandbox, expected 2`);
  note(shape.cats[0] && shape.cats[0].colour === shape.sessionColour, 'the first category is not the session colour');
  note(shape.cats[1] && shape.cats[1].colour !== shape.sessionColour, 'the second category is the same colour as the session — the point is to show two');
  note(shape.cats.every(c => c.emoji && c.emoji.trim()), 'a sandbox category has no emoji');
  note(shape.todos >= 2 && shape.checked >= 1, `the sandbox does not show a to-do list with something ticked (${shape.checked}/${shape.todos})`);
  note(shape.nested >= 2, `the sandbox does not show nested bullets (${shape.nested})`);
  note(shape.note, 'the sandbox does not say it is a sandbox');
  note(/SANDBOX/.test(shape.status), `the save status reads "${shape.status}"`);
  note(shape.mics === 2, `${shape.mics} microphones in the sandbox, expected one per box`);

  // It is a real editor: type, and it behaves.
  await page.evaluate(() => {
    const b = document.querySelector('.nt-body');
    b.focus();
    const r = document.createRange(); r.selectNodeContents(b); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('Enter');
  await page.keyboard.type('- a visitor typed this');
  await sleep(200);
  note(await page.evaluate(() => /a visitor typed this/.test(document.querySelector('.nt-body').textContent)), 'typing in the sandbox did nothing');
  await sleep(2000);           // longer than the save debounce
  note(apiCalls.length === 0, `the sandbox called the notes API: ${apiCalls.join(', ')}`);
  console.log(`sandbox made ${apiCalls.length} calls to /api/notes/ while being typed into`);

  // Escape throws it away.
  await page.keyboard.press('Escape');
  await sleep(400);
  note(await page.evaluate(() => document.querySelectorAll('.nt-app').length === 0), 'the sandbox is still in the page after Escape');
  note(await page.evaluate(() => !document.documentElement.outerHTML.includes('a visitor typed this')), 'what the visitor typed is still in the page after closing');

  // Reopening is blank again.
  await page.click('[data-notes-demo]');
  await page.waitForFunction(() => document.querySelectorAll('.nt-cat').length > 0, { timeout: 20000 });
  note(await page.evaluate(() => !document.querySelector('.nt-canvas').textContent.includes('a visitor typed this')), 'the sandbox remembered what the last visitor typed');
  await page.keyboard.press('Escape');
  await sleep(300);

  note(apiCalls.length === 0, `the sandbox called the notes API across its whole life: ${apiCalls.join(', ')}`);
  const storeAfter = await readFile(join(STORE, 'notes/current.json'), 'utf8');
  note(storeAfter === storeBefore, 'the real notes changed while the sandbox was being used');
  console.log('sandbox: closed clean, reopened blank, real notes byte-identical');
}

/* ---- 15. the sandbox cannot see the real notes --------------------------- */
{
  const leak = await page.evaluate(() => document.documentElement.outerHTML.includes('Pick a new game name'));
  note(!leak, 'the real notes are in the page after opening the sandbox');
  const token = await page.evaluate(() => { try { return sessionStorage.getItem('notes-token'); } catch { return null; } });
  note(token === tokenBeforeSandbox, 'the sandbox changed the session token');
}

await browser.close();
console.log(`\n${pass} checks passed`);
console.log(fail.length ? `FAIL (${fail.length}):\n  ${fail.join('\n  ')}` : 'PASS — every dictation and sandbox check held');
process.exit(fail.length ? 1 : 0);
