/* Images pasted into the notes.
 *
 *   POST /api/notes/asset   { token, type, data }   ->  { key, bytes }
 *   GET  /api/notes/asset?key=<sha>.<ext>&t=<token> ->  the image
 *
 * WHY IMAGES ARE NOT IN THE DOCUMENT. A data: URI inside the note HTML would
 * ride along with every autosave -- the whole document is written a second or
 * two after each keystroke -- so a session with thirty screenshots in it would
 * push tens of megabytes an hour to store one sentence. Stored beside the
 * document and referenced by key, an image costs one upload, ever.
 *
 * WHY THE TOKEN IS IN THE URL ON GET. An <img> cannot send a header, and this
 * site sets no cookies. The token is the same bearer token every other notes
 * request carries; a URL that holds it is exactly as sensitive as the document
 * that holds the key, which is already behind that token. The response is
 * `private` and never enters a shared cache.
 *
 * `data` is base64 rather than a multipart body: Vercel parses JSON for us and
 * a form parser is a dependency this repo does not want for one route. The
 * client has already scaled the image down, so the 4/3 overhead is on a file
 * that was made small first.
 */

'use strict';

const store = require('../../lib/notes-store.js');

module.exports = async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  const missing = store.configError();
  if (missing) {
    console.error('notes/asset: ' + missing);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'notes storage is not configured' });
  }

  if (req.method === 'GET') {
    const query = req.query || parseQuery(req.url);
    if (!store.tokenOk(query.t)) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(401).json({ error: 'session expired' });
    }
    try {
      const found = await store.getAsset(query.key);
      if (!found) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(404).json({ error: 'no such asset' });
      }
      // The key is the hash of the bytes, so the bytes behind a URL can never
      // change: immutable is true, and private keeps it out of shared caches.
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.setHeader('Content-Type', found.contentType);
      res.setHeader('Content-Length', String(found.bytes.length));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.statusCode = 200;
      return res.end(found.bytes);
    } catch (err) {
      console.error('notes/asset: read failed', err);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(502).json({ error: 'could not read the asset' });
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || !store.tokenOk(body.token)) {
    return res.status(401).json({ error: 'session expired' });
  }
  if (typeof body.data !== 'string' || typeof body.type !== 'string') {
    return res.status(400).json({ error: 'type and data are required' });
  }

  let bytes;
  try {
    bytes = Buffer.from(body.data, 'base64');
  } catch {
    return res.status(400).json({ error: 'data is not base64' });
  }

  try {
    const result = await store.putAsset(bytes, body.type);
    return res.status(200).json(result);
  } catch (err) {
    if (err && err.tooLarge) return res.status(413).json({ error: err.message });
    if (err && err.badType) return res.status(415).json({ error: err.message });
    console.error('notes/asset: write failed', err);
    return res.status(502).json({ error: 'could not store the asset' });
  }
};

function parseQuery(url) {
  const out = {};
  const at = (url || '').indexOf('?');
  if (at < 0) return out;
  for (const pair of url.slice(at + 1).split('&')) {
    const eq = pair.indexOf('=');
    const k = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
    const v = decodeURIComponent(eq < 0 ? '' : pair.slice(eq + 1));
    out[k] = v;
  }
  return out;
}
