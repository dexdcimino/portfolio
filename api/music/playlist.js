/* The live playlist.
 *
 *   GET  /api/music/playlist                         ->  { rev, savedAt, tracks, playlists }
 *   POST /api/music/playlist  { action, ... }        ->  the same, after the edit
 *
 * READING IS PUBLIC. The list was always public -- it shipped in the page as
 * tracks.json -- so MUSIC reads it with no code at all.
 *
 * EDITING NEEDS A TOKEN, and a token needs Dex SIGNED IN: an idToken for his
 * own Google (lib/owner-auth.js), or the DexAuth token, which is itself only
 * minted for that sign-in. No code is read (Dex, 2026-10-08: signed in is
 * admin everywhere, and the codes are no more). The overlay asks for this
 * the moment it opens for Dex; this is the check that matters, because this
 * route can be called by anyone who reads the page source.
 *
 * ACTIONS
 *   unlock   {idToken} | {jwt}       -> { token }
 *   lookup   {token, url}            -> { v, t, a }   a guess for the add form
 *   add      {token, url, t, a, repeat?, playlistId?, playlistIds?}
 *   remove   {token, v}
 *   repeat   {token, v, on}          the REPEAT playlist, now shared
 *   playlist-create {token, id, name}
 *   playlist-delete {token, id}
 *   playlist-member {token, id, v, on}
 *   playlist-import {token, playlists}   additive, replay-safe device migration
 *   backups  {token}                 -> { backups:[{name, kind, label, count}] }
 *   restore  {token, name}
 *
 * Every edit goes through store.write(), which copies the list it is about to
 * replace BEFORE replacing it. See lib/music-store.js.
 */

'use strict';

const store = require('../../lib/music-store.js');
const owner = require('../../lib/owner-auth.js');
const playlists = require('../../lib/music-playlists.js');

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
      if (!(body.jwt && owner.adminOk(body.jwt))) {
        const who = await owner.ownerOf(body.idToken);
        if (who === 'unverifiable') return res.status(502).json({ error: 'could not verify the sign-in' });
        if (who !== 'owner') return res.status(401).json({ error: 'sign in' });
      }
      return res.status(200).json({ token: store.mintToken() });
    }

    // Everything past here edits, or reads the backups, and needs a token.
    if (!store.tokenOk(body.token)) return res.status(401).json({ error: 'not allowed' });

    if (action === 'lookup') {
      const source = store.parseEmbed(body.url);
      if (!source) return res.status(400).json({ error: 'use a YouTube, Instagram post/Reel, Vimeo, SoundCloud, Spotify or TikTok link, or a Bandcamp player embed' });
      const v = source.v;
      const doc = await store.read();
      const already = doc.tracks.some((t) => t.v === v);
      let guess = { t: '', a: '' };
      /* MUSIC_LOOKUP_OFFLINE: the harness's seam. It drives the add form end to
         end without YouTube, which would otherwise decide the result of a test
         about this site. Never set on a deploy -- and if it were, the form still
         works: it asks for the title instead of guessing it. */
      if (!source.e && !process.env.MUSIC_LOOKUP_OFFLINE) try {
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
      return res.status(200).json({ v, p: source.p, u: source.u, t: guess.t, a: guess.a, already });
    }

    if (action === 'backups') {
      return res.status(200).json({ backups: await store.listBackups() });
    }

    if (['add', 'remove', 'repeat', 'rename', 'playlist-create', 'playlist-delete', 'playlist-member', 'playlist-import'].includes(action)) {
      if (action === 'playlist-import') {
        // Validate first, then preserve the complete original device collection before acknowledging it.
        playlists.apply(await store.read(), body, store.cleanTrack);
        await store.archiveLegacy(body.playlists);
      }
      let undo = null;
      const doc = await store.mutate(before => {
        if (action === 'remove') {
          const track = before.tracks.find(t => t.v === body.v);
          if (track) undo = { ...track, playlistIds: before.playlists.filter(p => p.tracks.includes(body.v)).map(p => p.id) };
        }
        return playlists.apply(before, body, store.cleanTrack);
      });
      return res.status(200).json({ ...view(doc), ...(undo ? { undo } : {}) });
    }
    if (action === 'restore') {
      const backup = await store.readBackupDocument(body.name);
      if (!backup?.tracks.length) return res.status(404).json({ error: 'no such backup' });
      return res.status(200).json(view(await store.mutate(before => ({ ...before, ...backup,
        playlistMigrations: [...new Set([...(before.playlistMigrations || []), ...(backup.playlistMigrations || [])])],
        deletedPlaylistNames: [...new Set([...(before.deletedPlaylistNames || []), ...(backup.deletedPlaylistNames || [])])],
      }))));
    }

    return res.status(400).json({ error: 'no such action' });
  } catch (err) {
    if (err.status && [400, 404, 409].includes(err.status)) return res.status(err.status).json({ error: err.message });
    console.error('music/playlist: failed', err);
    return res.status(502).json({ error: 'the playlist could not be reached' });
  }
};

function view(doc) {
  return { rev: doc.rev, savedAt: doc.savedAt, seeded: !!doc.seeded, count: doc.tracks.length, tracks: doc.tracks, playlists: playlists.publicPlaylists(doc), playlistsVersion: 1 };
}
