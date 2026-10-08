/* Universal JWT verification (DexAuth).
   Accepts JWTs from /api/auth/unlock as an alternative to TUNES password.
   Uses shared AUTH_SECRET env var. */
const { createHmac, timingSafeEqual } = require('crypto');
function verifyUniversalJWT(token) {
  const secret = process.env.AUTH_SECRET;
  if (!token || !secret) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [h, b, s] = parts;
    const exp = createHmac('sha256', secret).update(h + '.' + b).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (s.length !== exp.length) return false;
    if (!timingSafeEqual(Buffer.from(s), Buffer.from(exp))) return false;
    const payload = JSON.parse(Buffer.from(b.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) return false;
    return payload.tier === 'admin' || payload.tier === 'editor';
  } catch (e) { return false; }
}

/* The live playlist.
 *
 *   GET  /api/music/playlist                         ->  { rev, savedAt, tracks }
 *   POST /api/music/playlist  { action, ... }        ->  the same, after the edit
 *
 * READING IS PUBLIC. The list was always public -- it shipped in the page as
 * tracks.json -- so MUSIC reads it with no code at all.
 *
 * EDITING NEEDS A TOKEN, and a token needs TUNES_PASSWORD. The vault code only
 * opens the overlay; this is the check that matters, because this route can be
 * called by anyone who reads the page source.
 *
 * ACTIONS
 *   unlock   {code}                  -> { token }
 *   lookup   {token, url}            -> { v, t, a }   a guess for the add form
 *   add      {token, url, t, a}
 *   remove   {token, v}
 *   repeat   {token, v, on}          the REPEAT playlist, now shared
 *   backups  {token}                 -> { backups:[{name, kind, label, count}] }
 *   restore  {token, name}
 *
 * Every edit goes through store.write(), which copies the list it is about to
 * replace BEFORE replacing it. See lib/music-store.js.
 */

'use strict';

const store = require('../../lib/music-store.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  const missing = store.configError();
  if (missing) {
    console.error('music/playlist: ' + missing);
    return res.status(503).json({ error: 'the playlist store is not configured' });
  }

  try {
    if (req.method === 'GET') {
      return res.status(200).json(view(await store.read()));
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'GET or POST' });
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    body = body || {};
    const action = String(body.action || '');

    if (action === 'unlock') {
      const unset = store.adminError();
      if (unset) {
        console.error('music/playlist: ' + unset);
        return res.status(503).json({ error: 'editing is not set up on this deploy' });
      }
      const jwtOk = body.jwt && verifyUniversalJWT(body.jwt);
      if (!jwtOk && !(await store.passwordOk(body.code))) return res.status(401).json({ error: 'wrong' });
      return res.status(200).json({ token: store.mintToken() });
    }

    // Everything past here edits, or reads the backups, and needs a token.
    if (!store.tokenOk(body.token)) return res.status(401).json({ error: 'not allowed' });

    if (action === 'lookup') {
      const v = store.parseId(body.url);
      if (!v) return res.status(400).json({ error: 'that is not a YouTube video link' });
      const doc = await store.read();
      const already = doc.tracks.some((t) => t.v === v);
      let guess = { t: '', a: '' };
      /* MUSIC_LOOKUP_OFFLINE: the harness's seam. It drives the add form end to
         end without YouTube, which would otherwise decide the result of a test
         about this site. Never set on a deploy -- and if it were, the form still
         works: it asks for the title instead of guessing it. */
      if (!process.env.MUSIC_LOOKUP_OFFLINE) try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${v}`)}`,
          { signal: ctrl.signal });
        clearTimeout(timer);
        if (r.ok) {
          const o = await r.json();
          guess = store.guess(o.title, o.author_name);
        } else if (r.status === 401 || r.status === 404) {
          /* oEmbed answers 401 for a video whose owner blocks embedding and
             404 for one that is gone. Either way the embed will not play it,
             so it is said now rather than discovered on the first press. */
          return res.status(422).json({ error: 'that video cannot be embedded, or it is gone', v });
        }
      } catch { /* no title is not a reason to refuse: the form asks for one */ }
      return res.status(200).json({ v, t: guess.t, a: guess.a, already });
    }

    if (action === 'backups') {
      return res.status(200).json({ backups: await store.listBackups() });
    }

    const doc = await store.read();

    if (action === 'add') {
      const track = store.cleanTrack({ v: body.url, t: body.t, a: body.a });
      if (!track) return res.status(400).json({ error: 'a link, a title and an artist are all needed' });
      if (doc.tracks.some((t) => t.v === track.v)) {
        return res.status(409).json({ error: 'that video is already in the playlist', v: track.v });
      }
      return res.status(200).json(view(await store.write(doc, [...doc.tracks, track])));
    }

    if (action === 'remove') {
      const next = doc.tracks.filter((t) => t.v !== body.v);
      if (next.length === doc.tracks.length) return res.status(404).json({ error: 'that track is not in the playlist' });
      return res.status(200).json(view(await store.write(doc, next)));
    }

    if (action === 'repeat') {
      let hit = false;
      const next = doc.tracks.map((t) => {
        if (t.v !== body.v) return t;
        hit = true;
        const copy = { ...t };
        if (body.on) copy.r = true; else delete copy.r;
        return copy;
      });
      if (!hit) return res.status(404).json({ error: 'that track is not in the playlist' });
      return res.status(200).json(view(await store.write(doc, next)));
    }

    if (action === 'rename') {
      const newTitle = String(body.t || '').trim().slice(0, 200);
      if (!newTitle) return res.status(400).json({ error: 'title is required' });
      let hit = false;
      const next = doc.tracks.map((t) => {
        if (t.v !== body.v) return t;
        hit = true;
        return { ...t, t: newTitle };
      });
      if (!hit) return res.status(404).json({ error: 'that track is not in the playlist' });
      return res.status(200).json(view(await store.write(doc, next)));
    }

    if (action === 'restore') {
      const tracks = await store.readBackup(body.name);
      if (!tracks || !tracks.length) return res.status(404).json({ error: 'no such backup' });
      return res.status(200).json(view(await store.write(doc, tracks)));
    }

    return res.status(400).json({ error: 'no such action' });
  } catch (err) {
    console.error('music/playlist: failed', err);
    return res.status(502).json({ error: 'the playlist could not be reached' });
  }
};

function view(doc) {
  return { rev: doc.rev, savedAt: doc.savedAt, seeded: !!doc.seeded, count: doc.tracks.length, tracks: doc.tracks };
}
