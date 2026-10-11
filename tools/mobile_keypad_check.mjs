/* Touch-mode regression: nav padlock -> typed code -> destination survives.
 * Self-serves the repo. Fake notes data; no account or production writes.
 * node tools/mobile_keypad_check.mjs
 */
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
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


const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
let pass = 0;
const errors = [];
const check = (ok, message) => { if (!ok) throw new Error(message); pass++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  await page.createCDPSession().then(s => s.send('Browser.setDownloadBehavior', {behavior:'deny'}));
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.url().includes('/api/notes/save')) {
      return req.respond({status:200,contentType:'application/json',body:JSON.stringify({rev:1,savedAt:Date.now()})});
    }
    if (req.url().includes('/api/notes/unlock')) {
      return req.respond({status:200,contentType:'application/json',body:JSON.stringify({
        token:'test-only',format:'html',content:'<h1>Test notes</h1><p>Fixture</p>',rev:0,savedAt:null
      })});
    }
    if (!req.url().startsWith(BASE)) return req.respond({status:204,body:''});
    return req.continue();
  });
  const fresh = async () => {
    await page.goto(BASE, {waitUntil:'networkidle2'});
    await page.evaluate(() => {
      sessionStorage.clear();
      document.getElementById('sidebar').classList.add('nav-open');
    });
    await page.tap('[data-codes-keypad]');
    check(await page.evaluate(() => document.getElementById('codeModal').open), 'nav tap did not open keypad');
  };
  await fresh();
  check(await page.evaluate(() => 'ontouchstart' in window), 'touch-only Back handler was not exercised');
  await page.keyboard.type('work', {delay:60});
  await sleep(1200);
  check(await page.evaluate(() => document.getElementById('dashModal').open && !document.getElementById('codeModal').open),
    'WORK disappeared during mobile keypad handoff');
  // A real browser Back still closes the destination, while X cleanup must
  // not close a new keypad opened before the history traversal finishes.
  await page.goBack();
  await sleep(400);
  check(await page.evaluate(() => !document.querySelector('dialog[open]')), 'Back did not close WORK');
  await fresh();
  await page.keyboard.type('notes', {delay:60});
  await sleep(1500);
  check(await page.evaluate(() => document.getElementById('notesModal').open && !document.getElementById('codeModal').open),
    'public NOTES disappeared during mobile keypad handoff');
  check(await page.evaluate(() => !document.getElementById('notesEditor').hidden), 'public notes did not reach editor');
  await page.evaluate(() => document.getElementById('notesModal').close());
  await sleep(500);
  await fresh();
  // This fixtures the server's owner decision, not authentication or content.
  await page.evaluate(() => { window.dexOwner.is = true; });
  await page.keyboard.type('notes', {delay:60});
  await sleep(1500);
  check(await page.evaluate(() => document.getElementById('notesModal').open && !document.getElementById('codeModal').open),
    'owner NOTES disappeared during mobile keypad handoff');
  await page.evaluate(() => document.getElementById('notesModal').close());
  await sleep(500);
  await fresh();
  await page.tap('#codeClose');
  await page.evaluate(() => document.querySelector('[data-codes-keypad]').click());
  await sleep(800);
  check(await page.evaluate(() => document.getElementById('codeModal').open), 'history cleanup closed a reopened keypad');
  check(errors.length === 0, 'page errors: '+errors.join('; '));
  check(missing.length === 0, 'missing assets: '+missing.join(', '));
  console.log(pass+' checks passed — mobile nav WORK/NOTES, Back and reopen');
} finally {
  await browser.close();
  server.close();
}
