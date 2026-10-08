/* A local stand-in for Vercel, so the notes overlay can be driven end to end
 * on this machine.
 *
 * It serves the repo as static files and routes /api/notes/*, /api/auth/* and
 * /api/chess/table to THE REAL HANDLERS in api/. Nothing about the password check, the token, the
 * seeding, the revision check, the backup tiers or the asset store is
 * re-implemented here — those are the shipped modules, required directly.
 * What is different is only where the bytes land: NOTES_DEV_DIR puts them on
 * disk instead of in Vercel Blob, which lib/notes-store.js refuses to do in
 * production for exactly the reason that makes it safe here.
 *
 *   node tools/notes_dev_server.mjs [--port 8123] [--dir <scratch>] [--legacy]
 *
 * --legacy seeds the scratch store with a pre-rebuild notes/current.html (the
 * seed) and no current.json, which is the state the live store is in on the
 * first open after the rebuild. The migration path cannot be tested without it.
 *
 * WHAT THIS CANNOT TELL YOU: whether @vercel/blob works. Everything above the
 * storage call is real; the storage call itself is the file backend. That gap
 * is named in the report rather than papered over.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const require = createRequire(import.meta.url);
// fileURLToPath, not .pathname: this repo's own directory has a space in it,
// and a raw pathname hands you %20 in a filesystem path.
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const HEADERS = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8')).headers;
const cspFor = (source) => HEADERS
  .find((h) => h.source === source).headers.find((h) => h.key === 'Content-Security-Policy').value
  // upgrade-insecure-requests would send the harness's own http:// requests to https://
  .replace(/;\s*upgrade-insecure-requests/, '');
const SITE_CSP = cspFor('/(.*)');
const DEXNOTE_CSP = cspFor('/dexnote/(.*)');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('--port', 8123));

process.env.NOTES_DEV_DIR = resolve(arg('--dir', join(ROOT, '.notes-dev')));
process.env.NOTES_PASSWORD = process.env.NOTES_PASSWORD || 'notes';
// The playlist's edit password, for the TUNES code. The vault folds codes to
// upper case and so does the check, so this matches whatever case is typed.
process.env.TUNES_PASSWORD = process.env.TUNES_PASSWORD || 'tunes';
// The DexAuth signing key. /api/auth/unlock mints for Dex signed in only, so
// a harness that wants admin brings its own certificate server too
// (SITE_AUTH_CERTS_URL / SITE_AUTH_PROJECT; music_admin_check does).
process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'dev-auth-secret';
delete process.env.VERCEL_ENV;

if (process.argv.includes('--legacy')) {
  const dir = join(process.env.NOTES_DEV_DIR, 'notes');
  await mkdir(dir, { recursive: true });
  await rm(join(dir, 'current.json'), { force: true });
  await writeFile(join(dir, 'current.html'), require(join(ROOT, 'lib/notes-seed.js')), 'utf8');
}

const unlock = require(join(ROOT, 'api/notes/unlock.js'));
const save = require(join(ROOT, 'api/notes/save.js'));
const asset = require(join(ROOT, 'api/notes/asset.js'));
const chessTable = require(join(ROOT, 'api/chess/table.js'));
const musicPlaylist = require(join(ROOT, 'api/music/playlist.js'));
const authUnlock = require(join(ROOT, 'api/auth/unlock.js'));
const authVerify = require(join(ROOT, 'api/auth/verify.js'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.webm': 'video/webm',
  '.aff': 'text/plain; charset=utf-8', '.dic': 'text/plain; charset=utf-8',
};

/* The handlers are written against Vercel's req/res, which is Node's plus a
 * parsed `body`, a parsed `query`, and `res.status().json()`. All a few lines. */
function shim(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

const readBody = (req) => new Promise((done) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
});

const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  shim(res);

  if (url.startsWith('/api/notes/') || url.startsWith('/api/chess/') || url.startsWith('/api/music/') || url.startsWith('/api/auth/')) {
    const route = url === '/api/notes/unlock' ? unlock
                : url === '/api/auth/unlock' ? authUnlock
                : url === '/api/auth/verify' ? authVerify
                : url === '/api/notes/save' ? save
                : url === '/api/notes/asset' ? asset
                : url === '/api/chess/table' ? chessTable
                : url === '/api/music/playlist' ? musicPlaylist : null;
    if (!route) return res.status(404).json({ error: 'no such route' });
    const raw = await readBody(req);
    try { req.body = raw ? JSON.parse(raw) : null; } catch { req.body = null; }
    req.query = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    if (process.env.NOTES_TRACE) console.log('>>', req.method, url, JSON.stringify(req.body || req.query).slice(0, 120));
    try {
      await route(req, res);
    } catch (err) {
      console.error('handler threw', err);
      if (!res.writableEnded) res.status(500).json({ error: String(err) });
    }
    return;
  }

  const file = resolve(join(ROOT, normalize(url.endsWith('/') ? `${url}index.html` : url)));
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      // The shipped CSP, so a harness run catches an inline style or a
      // cross-origin fetch the way production would refuse it.
      // Both read from vercel.json, so the harness and the deploy cannot
      // disagree: /dexnote/ has its own policy, everything else the site's.
      'content-security-policy': url.startsWith('/dexnote/') ? DEXNOTE_CSP : SITE_CSP,
    });
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('404');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`notes dev server: http://127.0.0.1:${PORT}/#notes`);
  console.log(`  password: ${process.env.NOTES_PASSWORD}`);
  console.log(`  tunes:    ${process.env.TUNES_PASSWORD}`);
  console.log(`  storage : ${process.env.NOTES_DEV_DIR}`);
});
