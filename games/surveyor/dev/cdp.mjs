// The smallest Chrome DevTools Protocol client that can take a screenshot.
//
// No npm, no puppeteer: node has had a global WebSocket since 22, and Chrome
// ships a JSON endpoint that hands out the socket URL. That is the whole of what
// a screenshot needs, and it means the harness has no dependency to install on a
// fresh clone — which is the only reason a screenshot harness survives.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Where Chrome lives. Edge is the fallback because it is the same engine and it
// is present on every Windows machine even when Chrome is not.
const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

export function findChrome() {
  for (const c of CANDIDATES) if (c && existsSync(c)) return c;
  throw new Error('no Chrome or Edge found — set CHROME=<path to the exe>');
}

// ---- static server ------------------------------------------------------
// ES modules need a real origin; file:// refuses them. This serves the repo and
// nothing above it.

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8',
};

export function serve(root) {
  const server = createServer((req, res) => {
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(normalize(root)) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, close: () => server.close() });
    });
  });
}

// ---- browser ------------------------------------------------------------

/**
 * `gpu: true` renders on the real adapter instead of SwiftShader.
 *
 * The default stays software on purpose: it is deterministic, it is what the
 * screenshot sheets are compared across, and it is available on any machine.
 * But a frame TIME off SwiftShader is a software rasteriser's frame time and
 * says nothing about what a player sees, so anything measuring cost rather than
 * pixels wants this. Verified reachable headless on Windows via ANGLE/D3D11.
 */
export async function launch({ width = 900, height = 560, port = 9222, gpu = false } = {}) {
  const exe = findChrome();
  const profile = mkdtempSync(join(tmpdir(), 'surveyor-shots-'));
  const child = spawn(exe, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    // SwiftShader, explicitly. Headless has no GPU to fall back from, and
    // without these two flags the WebGL context creation simply fails.
    ...(gpu
      ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });

  let version = null;
  for (let i = 0; i < 80 && !version; i++) {
    await wait(125);
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch { /* not up yet */ }
  }
  if (!version) {
    child.kill();
    throw new Error('Chrome never came up:\n' + stderr);
  }

  const browser = await connect(version.webSocketDebuggerUrl);
  return {
    version: version.Browser,
    browser,
    async newPage() {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const t = list.find((x) => x.id === targetId);
      const page = await connect(t.webSocketDebuggerUrl);
      page.targetId = targetId;
      return page;
    },
    async close() {
      browser.close();
      child.kill();
      await wait(200);
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* windows holds it */ }
    },
  };
}

/** One websocket, with the id/response bookkeeping and an event bus. */
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(m.method + ': ' + m.error.message));
      else resolve(m.result);
    } else if (m.method) {
      for (const fn of listeners) fn(m.method, m.params);
    }
  });
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    }),
    on: (fn) => listeners.push(fn),
    close: () => ws.close(),
  };
}

/**
 * Evaluate an expression in the page and return its value.
 *
 * `awaitPromise` is on, so the expression may be an async IIFE — which is how
 * the harness waits for N rendered frames rather than guessing at a sleep.
 */
export async function evaluate(page, expression) {
  const r = await page.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error('page threw: ' + (r.exceptionDetails.exception?.description
      || r.exceptionDetails.text));
  }
  return r.result.value;
}

export { wait };
