/* A local stand-in for Vercel, so the notes overlay can be driven end to end
 * on this machine.
 *
 * It serves the repo as static files and routes /api/notes/* to THE REAL
 * HANDLERS in api/notes/. Nothing about the password check, the token, the
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

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const PORT = Number(arg('--port', 8123));

process.env.NOTES_DEV_DIR = resolve(arg('--dir', join(ROOT, '.notes-dev')));
process.env.NOTES_PASSWORD = process.env.NOTES_PASSWORD || 'notes';
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

  if (url.startsWith('/api/notes/')) {
    const route = url === '/api/notes/unlock' ? unlock
                : url === '/api/notes/save' ? save
                : url === '/api/notes/asset' ? asset : null;
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

  const file = resolve(join(ROOT, normalize(url === '/' ? '/index.html' : url)));
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      // The shipped CSP, so a harness run catches an inline style or a
      // cross-origin fetch the way production would refuse it.
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://i.ytimg.com; media-src 'self' https://vz-f98421b2-da0.b-cdn.net; font-src 'self'; connect-src 'self' https://api.web3forms.com; form-action 'self' https://api.web3forms.com; frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com; base-uri 'none'; object-src 'none'",
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
  console.log(`  storage : ${process.env.NOTES_DEV_DIR}`);
});
