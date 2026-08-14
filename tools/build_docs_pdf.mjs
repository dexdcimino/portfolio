/**
 * Generate the downloadable PDFs from the letter/resume markup in index.html.
 *
 * WHY THIS EXISTS
 * The PDFs used to be a separate artefact — produced once by ReportLab, with
 * the generator never committed. That left two copies of the same words with
 * nothing keeping them in step, and no way to regenerate the file after an
 * edit. index.html is the single source now: this reads the rendered panel and
 * prints it, so the download can only ever say what the site says.
 *
 * The site is light text on a dark ground. A document is the opposite, so the
 * print sheet below restates colour and typography from scratch rather than
 * inheriting styles.css — the same reason the copy button's HTML flavour
 * carries no colour.
 *
 *   node tools/build_docs_pdf.mjs [baseUrl]      default http://127.0.0.1:8784
 *
 * Needs Chrome listening on --remote-debugging-port=9333 and the site served
 * at baseUrl. Verify afterwards with --check, which fails if a PDF is missing
 * or older than index.html.
 */
import { writeFileSync, statSync, existsSync } from 'node:fs';
import { argv, exit } from 'node:process';

const BASE = argv.find(a => a.startsWith('http')) || 'http://127.0.0.1:8784';
const CHECK = argv.includes('--check');

const DOCS = [
  { tab: 'tab-cover', panel: 'panel-cover', out: 'assets/about/Dex_Cimino_Cover.pdf' },
  { tab: 'tab-resume', panel: 'panel-resume', out: 'assets/about/Dex_Cimino_Resume.pdf' },
];

if (CHECK) {
  const src = statSync('index.html').mtimeMs;
  const stale = DOCS.filter(d => !existsSync(d.out) || statSync(d.out).mtimeMs < src);
  if (stale.length) {
    console.log('build_docs_pdf --check: ' + stale.length + ' PDF(s) missing or older than index.html');
    for (const d of stale) console.log('  ' + d.out);
    console.log('Run: node tools/build_docs_pdf.mjs');
    exit(1);
  }
  console.log('build_docs_pdf --check: both PDFs present and newer than index.html');
  exit(0);
}

/* Document typography, stated outright. Nothing here comes from styles.css. */
const SHEET = `
  @page { size: Letter; margin: 0.9in 0.85in; }
  * { box-sizing: border-box; }
  body { margin:0; background:#fff; color:#14181d;
         font-family: Georgia, 'Times New Roman', serif; font-size:10.5pt; line-height:1.55; }
  .cv-head { border-bottom:1.5pt solid #14181d; padding-bottom:10pt; margin-bottom:16pt; }
  .cv-name { margin:0; font-family: Helvetica, Arial, sans-serif;
             font-size:21pt; letter-spacing:.06em; font-weight:700; }
  .cv-role { margin:4pt 0 0; font-family: Helvetica, Arial, sans-serif;
             font-size:8.5pt; letter-spacing:.13em; color:#4a5560; text-transform:uppercase; }
  .cv-contact { margin:7pt 0 0; font-family: Helvetica, Arial, sans-serif;
                font-size:9pt; color:#33404c; }
  .cv-contact a { color:#33404c; text-decoration:none; }
  .cv-contact span { margin:0 5pt; color:#8a97a3; }
  .cv-block h3 { font-family: Helvetica, Arial, sans-serif; font-size:9pt;
                 letter-spacing:.16em; color:#4a5560; margin:0 0 10pt; font-weight:700; }
  .cv-block p { margin:0 0 9pt; }
  .cv-block a { color:#14181d; }
  .cv-signoff { margin-top:2pt; }
  .cv-signoff strong { font-family: Helvetica, Arial, sans-serif; letter-spacing:.05em; }
  .cv-footer { margin-top:22pt; padding-top:9pt; border-top:.75pt solid #c9d2da;
               font-family: Helvetica, Arial, sans-serif; font-size:8pt;
               letter-spacing:.11em; color:#6b7885; }
  .cv-list { margin:0 0 9pt; padding-left:15pt; }
  .cv-list li { margin:0 0 4pt; }
  .cv-row { display:flex; justify-content:space-between; gap:12pt; }
  .cv-row span:last-child { color:#4a5560; white-space:nowrap; }
`;

/* --- minimal CDP client (same shape as the test harness) ------------------ */
async function connect(port) {
  let targets = [];
  for (let i = 0; i < 40; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (targets.some(t => t.type === 'page' && t.webSocketDebuggerUrl)) break;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  const target = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!target) throw new Error('no Chrome page target on ' + port);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id != null) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.bad(new Error(JSON.stringify(m.error))) : p.ok(m.result);
    } else listeners.forEach(f => f(m));
  };
  const send = (method, params = {}) => new Promise((ok, bad) => {
    const n = ++id; pending.set(n, { ok, bad });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  return {
    send, on: f => listeners.push(f), close: () => ws.close(),
    async eval(expr) {
      const r = await send('Runtime.evaluate', {
        expression: `(async () => { const wait = ms => new Promise(r => setTimeout(r, ms)); ${expr} })()`,
        returnByValue: true, awaitPromise: true,
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
      return r.result.value;
    },
  };
}

const page = await connect(9333);
await page.send('Runtime.enable');
await page.send('Page.enable');
await page.send('Network.enable');
await page.send('Network.setCacheDisabled', { cacheDisabled: true });

for (const doc of DOCS) {
  // Pull the panel's markup straight out of the live page.
  const loaded = new Promise(r => page.on(m => { if (m.method === 'Page.loadEventFired') r(); }));
  await page.send('Page.navigate', { url: `${BASE}/?pdf=${Date.now()}` });
  await loaded;
  await new Promise(r => setTimeout(r, 1200));
  const markup = await page.eval(`
    document.querySelector('[data-resume-open]').click(); await wait(600);
    document.getElementById('${doc.tab}').click(); await wait(400);
    const p = document.getElementById('${doc.panel}');
    return p.innerHTML;`);

  // Render it standalone against the print sheet, then print that.
  const html = '<!doctype html><meta charset="utf-8"><title>Dex Cimino</title>'
    + '<style>' + SHEET + '</style>' + markup;
  const l2 = new Promise(r => page.on(m => { if (m.method === 'Page.loadEventFired') r(); }));
  await page.send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
  await l2;
  await new Promise(r => setTimeout(r, 500));

  const { data } = await page.send('Page.printToPDF', {
    printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0,
  });
  writeFileSync(doc.out, Buffer.from(data, 'base64'));
  const kb = (Buffer.from(data, 'base64').length / 1024).toFixed(0);
  console.log(`  wrote ${doc.out}  ${kb} KB`);
}

page.close();
console.log('build_docs_pdf: done — PDFs regenerated from index.html');
