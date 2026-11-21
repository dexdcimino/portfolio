/* A local stand-in for Vercel and Firebase, so the Dex Board at /board/ can be
 * opened SIGNED IN as the owner on this machine. Layout and interaction only.
 *
 *   node tools/board_harness.mjs [--port 8131]
 *
 * What is FAKE, and therefore what this cannot tell you:
 *   - /account/site-auth.js is replaced by a module that reports one signed in
 *     user. The real Google sign in and the real owner check never run.
 *   - /api/auth/unlock answers 200. The real handler (lib/owner-auth.js) is
 *     not exercised; tools/owner_gate_check.mjs is what checks that.
 *   - /board/store.js is replaced by a localStorage store with the same
 *     interface (load, save, listen, flush, destroy). Firestore never runs.
 *   - /api/notes/unlock and /api/notes/save hold a notes document in memory.
 *     The document is built from the gitignored seeds in
 *     ../_resources/notes-import/ when they exist (Dex's own notes, never
 *     committed), and from a small built in document otherwise.
 * Everything else is the real file from the repo, under the site's real CSP
 * (vercel.json, minus upgrade-insecure-requests). */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('--port', process.env.PORT || 8131));
const HEADERS = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8')).headers;
const SITE_CSP = HEADERS.find((h) => h.source === '/(.*)').headers
  .find((h) => h.key === 'Content-Security-Policy').value
  .replace(/;\s*upgrade-insecure-requests/, '')
  /* SILENT. The Music tab starts playing on open, as the overlay does, and a
     harness run once played songs out loud on Dex's speakers. Every player
     is refused here: no embed may frame and no media may load, so the tab's
     layout and controls can be checked and nothing can make a sound. */
  .replace(/frame-src [^;]*/, "frame-src 'self'")
  .replace(/media-src [^;]*/, "media-src 'none'");

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.avif': 'image/avif', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

const FAKE_AUTH = `
export const CONFIG = { projectId: 'harness' };
export const LOCAL_FLAG = 'site:signedIn';
const user = { uid: 'dex-harness', displayName: 'Dex Cimino', email: 'owner@harness.test', photoURL: null,
  getIdToken: async () => 'harness-id-token' };
const out = () => { try { return localStorage.getItem('harness:signedOut') === '1'; } catch { return false; } };
const fns = new Set();
export function onUser(fn) { fns.add(fn); setTimeout(() => fn(out() ? null : user), 0); return () => fns.delete(fn); }
export function currentUser() { return out() ? null : user; }
export async function signIn() { try { localStorage.removeItem('harness:signedOut'); } catch {} fns.forEach((f) => f(user)); return { user }; }
export async function signOut() { try { localStorage.setItem('harness:signedOut', '1'); } catch {} fns.forEach((f) => f(null)); }
export async function idToken() { return out() ? null : 'harness-id-token'; }
export const errorText = (e) => String((e && e.message) || e);
export const cancelled = () => false;
export function provider() { return null; }
`;

const FAKE_STORE = `
export const BOARD_DOC_NAMES = ["board-overview","board-schedule","board-diet","board-layout","board-exercise","board-work"];
export function createBoardStore(uid, onSavedState) {
  const key = (n) => 'harness-board:' + n;
  const listeners = new Map();
  const notify = (s) => { if (typeof onSavedState === 'function') onSavedState(s); };
  return {
    uid,
    async load(name) { try { return JSON.parse(localStorage.getItem(key(name)) || 'null'); } catch { return null; } },
    save(name, data) { notify('saving'); localStorage.setItem(key(name), JSON.stringify(data)); setTimeout(() => notify('saved'), 120); },
    listen(name, cb) { const s = listeners.get(name) || new Set(); s.add(cb); listeners.set(name, s); return () => s.delete(cb); },
    async flush() { return true; },
    destroy() { listeners.clear(); },
  };
}
export default createBoardStore;
`;

/* The notes document. Seeds first (Dex's own, gitignored, outside the repo),
   then a small built in one. */
function seedDoc() {
  const dirs = [join(ROOT, '_resources', 'notes-import'), join(ROOT, '..', '..', '..', '_resources', 'notes-import')];
  const sessions = [];
  for (const dir of dirs) {
    for (const name of ['seed-3.json', 'seed-2-4.json']) {
      const p = join(dir, name);
      if (!existsSync(p)) continue;
      try {
        const data = JSON.parse(require_(p));
        for (const s of data.sessions || []) sessions.push(s);
      } catch (err) { console.warn('harness: seed unreadable', p, err.message); }
    }
    if (sessions.length) break;
  }
  if (!sessions.length) {
    sessions.push({ title: 'Notes', cats: [
      { title: 'Today', body: '<ul><li>First thing</li><li>Second thing</li></ul>' },
      { title: 'Ideas', body: '<p><b>Bold</b> idea, and a list:</p><ol><li>one</li><li>two</li></ol>' },
    ] });
  }
  /* The seeds are exports without ids, and a real stored document always has
     them. Board view files each category under its session BY ID, so id-less
     sessions all matched each other and one save copied every category into
     every session. Give them the ids the real store would. */
  let n = 0;
  for (const s of sessions) {
    s.id = s.id || 'hs' + (n += 1);
    for (const c of s.cats || []) c.id = c.id || 'hc' + (n += 1);
    for (const c of s.archived || []) c.id = c.id || 'hc' + (n += 1);
  }
  return { v: 2, sessions };
}
import { readFileSync } from 'node:fs';
const require_ = (p) => readFileSync(p, 'utf8');
let notesDoc = seedDoc();
let notesRev = 1;
console.log('harness: notes document with ' + notesDoc.sessions.length + ' session(s), '
  + notesDoc.sessions.reduce((n, s) => n + (s.cats || []).length, 0) + ' categories');

const readBody = (req) => new Promise((ok) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => { try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { ok({}); } });
});
const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = decodeURIComponent(url.pathname);
  if (path === '/api/auth/unlock') return json(res, 200, { ok: true, owner: true });
  if (path === '/api/notes/unlock') {
    return json(res, 200, { token: 'harness-notes-token', format: 'json', content: notesDoc, rev: notesRev, savedAt: new Date().toISOString() });
  }
  if (path === '/api/notes/save') {
    const body = await readBody(req);
    if (body && body.doc) { notesDoc = body.doc; notesRev += 1; }
    return json(res, 200, { rev: notesRev, savedAt: new Date().toISOString(), token: 'harness-notes-token' });
  }
  if (path === '/api/music/playlist') return json(res, 200, { playlists: [], rev: 1 });
  if (path.startsWith('/api/')) return json(res, 404, { error: 'not in the harness' });

  const head = { 'content-security-policy': SITE_CSP, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (path === '/account/site-auth.js') { res.writeHead(200, { ...head, 'content-type': MIME['.js'] }); return res.end(FAKE_AUTH); }
  if (path === '/board/store.js') { res.writeHead(200, { ...head, 'content-type': MIME['.js'] }); return res.end(FAKE_STORE); }
  if (path === '/board/sw.js') { res.writeHead(404, head); return res.end(); }

  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (path.endsWith('/')) file = join(file, 'index.html');
  try {
    const data = await readFile(file);
    res.writeHead(200, { ...head, 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, head);
    res.end('not found');
  }
});
server.listen(PORT, '127.0.0.1', () => console.log('board harness on http://127.0.0.1:' + PORT + '/board/'));
