/* The shared sketch gallery's one endpoint. See lib/sketch-store.js.
 *
 *   GET  /api/sketch?feed=1                 -> { posts: [summary...] }   public, edge-cached 10 s
 *   GET  /api/sketch?img=sketch/img/<key>   -> the image                 public, immutable
 *   POST /api/sketch { action, ... }        -> JSON
 *
 * ACTIONS
 *   signup / login   { handle, password }            -> { handle, token }
 *   publish          { token, id, title, image, thumb } -> { post }
 *   unpublish        { token, id }
 *   vote             { token, id, kind: fire|poop|null } -> { fire, poop, mine }
 *   votes            { token, ids: [...] }           -> { votes: { id: kind } }
 *   report           { token, id }                   -> { hidden }
 *   delete-account   { token, password }
 *   moderate         { admin, id, op: hide|restore|delete }   admin = Dex's universal JWT
 */
'use strict';

const store = require('../lib/sketch-store.js');

module.exports = async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex');
  const missing = store.configError();
  if (missing) { console.error('sketch: ' + missing); return res.status(503).json({ error: 'the gallery is not configured' }); }

  try {
    if (req.method === 'GET') {
      const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      if (q.img) {
        const found = await store.image(q.img);
        if (!found) return res.status(404).end();
        // Keys are versioned per publish, so a URL never changes meaning.
        res.setHeader('Content-Type', found.type);
        res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
        return res.status(200).send(found.buf);
      }
      if (q.feed) {
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=10, stale-while-revalidate=30');
        return res.status(200).json({ posts: await store.readFeed() });
      }
      return res.status(400).json({ error: 'feed or img' });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'GET or POST' }); }

    res.setHeader('Cache-Control', 'no-store');
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    body = body || {};
    const action = String(body.action || '');

    if (action === 'signup') return res.status(200).json(await store.signup(body.handle, body.password));
    if (action === 'login') return res.status(200).json(await store.login(body.handle, body.password));
    if (action === 'moderate') {
      if (!store.isAdmin(body.admin)) return res.status(401).json({ error: 'not allowed' });
      return res.status(200).json(await store.moderate(String(body.id || ''), body.op));
    }

    const handle = store.readToken(body.token);
    if (!handle) return res.status(401).json({ error: 'Sign in again' });

    if (action === 'publish') return res.status(200).json({ post: await store.publish(handle, body) });
    if (action === 'unpublish') return res.status(200).json(await store.unpublish(handle, body.id));
    if (action === 'vote') return res.status(200).json(await store.vote(handle, body.id, body.kind === undefined ? null : body.kind));
    if (action === 'votes') return res.status(200).json({ votes: await store.myVotes(handle, body.ids) });
    if (action === 'report') return res.status(200).json(await store.report(handle, body.id));
    if (action === 'delete-account') return res.status(200).json(await store.deleteAccount(handle, body.password));
    return res.status(400).json({ error: 'no such action' });
  } catch (err) {
    if (err instanceof store.Refused) return res.status(err.status).json({ error: err.message });
    console.error('sketch: failed', err);
    return res.status(502).json({ error: 'the gallery could not be reached' });
  }
};

