'use strict';
const crypto = require('node:crypto');
const embeds = require('./music-embeds.js');
const MAX_PLAYLISTS = 500;
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
const nameKey = name => name.trim().toLowerCase();
function nameOf(value, legacy = false) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f]/.test(value)) fail('use a playlist name of 1–80 characters');
  if (['all', 'repeat'].includes(nameKey(value))) {
    if (legacy) return value.trim() + ' (imported)';
    fail('All and Repeat are reserved playlists');
  }
  return value.trim();
}
function idOf(value) {
  if (typeof value !== 'string' || !/^[\w-]{1,100}$/.test(value)) fail('invalid playlist id');
  return value;
}
function ids(values) {
  if (!Array.isArray(values) || values.length > 12000) fail('invalid playlist tracks');
  return [...new Set(values.map(value => { const source = embeds.parse(value); if (!source) fail('invalid playlist track'); return source.v; }))];
}
function state(doc) {
  if (doc.playlists !== undefined && !Array.isArray(doc.playlists)) fail('invalid saved playlists');
  const playlists = (doc.playlists || []).map(p => ({ id: idOf(p.id), name: nameOf(p.name), tracks: ids(p.tracks), removed: ids(p.removed || []) }));
  if (playlists.length > MAX_PLAYLISTS || new Set(playlists.map(p => p.id)).size !== playlists.length || new Set(playlists.map(p => nameKey(p.name))).size !== playlists.length) fail('invalid saved playlists');
  if (doc.playlistMigrations !== undefined && (!Array.isArray(doc.playlistMigrations) || !doc.playlistMigrations.every(v => typeof v === 'string' && /^[a-f\d]{64}$/.test(v)))) fail('invalid saved migration receipts');
  if (doc.deletedPlaylistNames !== undefined && (!Array.isArray(doc.deletedPlaylistNames) || !doc.deletedPlaylistNames.every(v => typeof v === 'string'))) fail('invalid saved playlist history');
  return { playlists, playlistMigrations: [...new Set(doc.playlistMigrations || [])], deletedPlaylistNames: [...new Set(doc.deletedPlaylistNames || [])] };
}
function publicPlaylists(doc) { return state(doc).playlists.map(({ id, name, tracks }) => ({ id, name, tracks })); }
function apply(doc, body, cleanTrack) {
  const next = { tracks: doc.tracks.map(t => ({ ...t })), ...state(doc) };
  const action = body.action;
  const playlist = id => { const found = next.playlists.find(p => p.id === id); if (!found) fail('that playlist no longer exists', 404); return found; };
  const member = (p, v, on) => {
    p.tracks = on ? [...new Set([...p.tracks, v])] : p.tracks.filter(id => id !== v);
    p.removed = on ? p.removed.filter(id => id !== v) : [...new Set([...p.removed, v])];
  };
  if (action === 'add') {
    const track = cleanTrack({ v: body.url, t: body.t, a: body.a, r: body.repeat === true });
    if (!track) fail('a link, a title and an artist are all needed');
    if (next.tracks.some(t => t.v === track.v)) fail('that video is already in the playlist', 409);
    if (body.playlistId) member(playlist(body.playlistId), track.v, true);
    if (body.playlistIds !== undefined) {
      if (!Array.isArray(body.playlistIds) || body.playlistIds.length > MAX_PLAYLISTS) fail('invalid restored playlist memberships');
      for (const id of new Set(body.playlistIds.map(idOf))) {
        const existing = next.playlists.find(p => p.id === id);
        if (existing) member(existing, track.v, true);
      }
    }
    next.tracks.push(track);
  } else if (['remove', 'repeat', 'rename'].includes(action)) {
    const track = next.tracks.find(t => t.v === body.v);
    if (!track) fail('that track is not in the playlist', 404);
    if (action === 'remove') {
      next.tracks = next.tracks.filter(t => t.v !== body.v);
      for (const p of next.playlists) if (p.tracks.includes(body.v)) member(p, body.v, false);
    } else if (action === 'repeat') { if (body.on) track.r = true; else delete track.r; }
    else { const title = String(body.t || '').trim().slice(0, 200); if (!title) fail('title is required'); track.t = title; }
  } else if (action === 'playlist-create') {
    const name = nameOf(body.name), id = idOf(body.id);
    const existing = next.playlists.find(p => p.id === id);
    if (existing) { if (existing.name !== name) fail('playlist id already exists', 409); return null; }
    if (next.playlists.some(p => nameKey(p.name) === nameKey(name))) fail('a playlist with that name already exists', 409);
    if (next.playlists.length >= MAX_PLAYLISTS) fail('playlist limit reached');
    next.playlists.push({ id, name, tracks: [], removed: [] });
  } else if (action === 'playlist-delete') {
    const p = next.playlists.find(p => p.id === body.id);
    if (!p) return null;
    next.deletedPlaylistNames = [...new Set([...next.deletedPlaylistNames, nameKey(p.name)])];
    next.playlists = next.playlists.filter(item => item.id !== body.id);
  } else if (action === 'playlist-member') {
    if (typeof body.on !== 'boolean') fail('membership must be true or false');
    if (!next.tracks.some(t => t.v === body.v)) fail('that track is not in All', 404);
    member(playlist(body.id), body.v, body.on);
  } else if (action === 'playlist-import') {
    if (!Array.isArray(body.playlists) || body.playlists.length > MAX_PLAYLISTS) fail('invalid legacy playlists');
    // Validate the entire batch before applying anything; imports never replace shared data.
    const incoming = body.playlists.map(p => ({ id: idOf(p.id), name: nameOf(p.name, true), tracks: ids(p.tracks) }));
    let changed = false;
    for (const old of incoming) {
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ ...old, tracks: [...old.tracks].sort() })).digest('hex');
      if (next.playlistMigrations.includes(fingerprint)) continue;
      changed = true;
      next.playlistMigrations.push(fingerprint);
      if (next.deletedPlaylistNames.includes(nameKey(old.name))) continue;
      let p = next.playlists.find(p => nameKey(p.name) === nameKey(old.name));
      if (!p) {
        if (next.playlists.length >= MAX_PLAYLISTS) fail('playlist limit reached');
        p = { id: next.playlists.some(p => p.id === old.id) ? crypto.randomUUID() : old.id, name: old.name, tracks: [], removed: [] };
        next.playlists.push(p);
      }
      p.tracks = [...new Set([...p.tracks, ...old.tracks.filter(v => next.tracks.some(t => t.v === v) && !p.removed.includes(v))])];
    }
    if (!changed) return null;
  } else fail('no such action');
  return next;
}
module.exports = { apply, state, publicPlaylists };
