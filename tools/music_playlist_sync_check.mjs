/* Shared public playlists, lossless device imports and Blob conditional-write retries.
 * No network or production writes: real handlers/store, scratch disk and a Blob double. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const dir = mkdtempSync(join(tmpdir(), 'music-playlists-sync-'));
process.env.NOTES_DEV_DIR = dir;
process.env.TUNES_PASSWORD = 'sync-test-only';
delete process.env.VERCEL_ENV;
const store = require('../lib/music-store.js'), changes = require('../lib/music-playlists.js');
const handler = require('../api/music/playlist.js');
const token = store.mintToken();
let count = 0;
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); count++; };
const api = async body => {
  let status = 200, data;
  await handler({ method: body ? 'POST' : 'GET', body, query: {} }, { setHeader() {}, status(value) { status = value; return this; }, json(value) { data = value; return this; } });
  return { status, data };
};
const edit = async (action, extra = {}) => { const r = await api({ token, action, ...extra }); assert.equal(r.status, 200, JSON.stringify(r)); return r.data; };
const mutate = body => store.mutate(doc => changes.apply(doc, body, store.cleanTrack));
try {
  let doc = (await api()).data;
  const [a, b, c, d] = doc.tracks.slice(0, 4).map(t => t.v);
  check(doc.playlists, [], 'old music schema upgrades without reseeding the library');
  check(doc.playlistsVersion, 1, 'clients can detect shared playlist support');
  for (const action of ['playlist-create', 'playlist-member', 'playlist-delete', 'playlist-import']) check((await api({ action })).status, 401, 'visitors cannot edit public playlists');
  const stillness = [{ id: 'desktop-old', name: 'Stillness', tracks: [a, b] }];
  const shorts = [{ id: 'phone-old', name: 'Shorts', tracks: [b, c] }];
  await edit('playlist-import', { playlists: stillness });
  doc = await edit('playlist-import', { playlists: shorts });
  check(doc.playlists.map(p => p.name), ['Stillness', 'Shorts'], 'independent phone and desktop imports merge');
  check(doc.playlists[0].tracks, [a, b], 'desktop songs preserved');
  check(doc.playlists[1].tracks, [b, c], 'phone songs preserved');
  check(doc.playlists[0].removed, undefined, 'internal deletion history is not public');
  check(doc.playlistMigrations, undefined, 'private migration receipts are not public');
  check(readdirSync(join(dir, 'music/legacy')).length, 2, 'complete device originals archived before import acknowledgment');
  const beforeRetry = doc.rev;
  doc = await edit('playlist-import', { playlists: shorts });
  check(doc.rev, beforeRetry, 'retrying an acknowledged import does not rewrite anything');
  doc = await edit('playlist-import', { playlists: [{ id: 'second-phone', name: 'shorts', tracks: [a, c] }] });
  check(doc.playlists.length, 2, 'same-name imports merge instead of duplicating the playlist');
  check(new Set(doc.playlists[1].tracks), new Set([a, b, c]), 'same-name songs are unioned');
  doc = await edit('playlist-member', { id: 'desktop-old', v: a, on: false });
  doc = await edit('playlist-import', { playlists: [{ id: 'late-desktop', name: 'Stillness', tracks: [a, b, d] }] });
  check(doc.playlists[0].tracks, [b, d], 'late migration preserves new songs but does not undo an explicit removal');
  await edit('playlist-delete', { id: 'phone-old' });
  doc = await edit('playlist-import', { playlists: [{ id: 'unvisited-phone', name: 'Shorts', tracks: [a, b, c, d] }] });
  check(doc.playlists.some(p => p.name === 'Shorts'), false, 'an old device cannot resurrect a globally deleted playlist');
  await edit('playlist-import', { playlists: shorts });
  check((await api()).data.playlists.some(p => p.name === 'Shorts'), false, 'lost local migration marker cannot resurrect deleted playlists');
  const invalid = await api({ token, action: 'playlist-import', playlists: [stillness[0], { id: 'bad/id', name: 'Invalid', tracks: [] }] });
  check(invalid.status, 400, 'malformed batches are rejected without partial import');
  doc = await edit('playlist-create', { id: 'shared-new', name: 'New playlist' });
  doc = await edit('add', { url: 'SyncAdded01', t: 'A new song', a: 'Test', playlistId: 'shared-new' });
  check(doc.playlists.find(p => p.id === 'shared-new').tracks, ['SyncAdded01'], 'Add Song saves library and selected playlist atomically');
  check(doc.tracks.some(t => t.v === 'SyncAdded01'), true, 'selected playlist additions also enter All');
  check((await api({ token, action: 'add', url: 'SyncAdded02', t: 'Gone', a: 'Test', playlistId: 'missing' })).status, 404, 'stale playlist destination is refused');
  check((await api()).data.tracks.some(t => t.v === 'SyncAdded02'), false, 'missing destination does not leave a partial All-only addition');
  const removed = await edit('remove', { v: 'SyncAdded01' });
  check((await api()).data.playlists.find(p => p.id === 'shared-new').tracks, [], 'removing a library track cleans shared memberships');
  await edit('add', { url: removed.undo.v, t: removed.undo.t, a: removed.undo.a, repeat: !!removed.undo.r, playlistIds: removed.undo.playlistIds });
  check((await api()).data.playlists.find(p => p.id === 'shared-new').tracks, ['SyncAdded01'], 'undo restores the actual server-side playlist memberships atomically');
  await edit('remove', { v: 'SyncAdded01' });
  await Promise.all([a, b, c, d].map(v => edit('playlist-member', { id: 'shared-new', v, on: true })));
  check(new Set((await api()).data.playlists.find(p => p.id === 'shared-new').tracks), new Set([a, b, c, d]), 'parallel device membership edits preserve all changes');
  const stale = await store.read();
  await edit('playlist-member', { id: 'shared-new', v: a, on: false });
  await assert.rejects(store.write(stale, stale.tracks), store.Conflict); count++;
  const current = await store.read();
  check(current.playlists.find(p => p.id === 'shared-new').tracks.includes(a), false, 'stale whole-document writer cannot restore a removed song');
  check((await store.readBackupDocument('music/backups/daily.json')).playlists !== undefined, true, 'new backups include shared playlist state');
  writeFileSync(join(dir, 'music/backups/weekly.json'), JSON.stringify({ tracks: current.tracks }));
  doc = await edit('restore', { name: 'music/backups/weekly.json' });
  check(doc.playlists.some(p => p.id === 'shared-new'), true, 'restoring an old track-only backup preserves current playlists');

  // Model separate serverless workers: the shared store changes between GET and PUT.
  const blobModule = require.resolve('@vercel/blob'), oldModule = require.cache[blobModule];
  const blobs = new Map(), writes = []; let version = 1, inject = true, missingTag = false, changeDuringRead = false;
  blobs.set(store.CURRENT, { body: JSON.stringify(await store.read()), etag: 'v1' });
  const { BlobPreconditionFailedError, BlobNotFoundError } = require('@vercel/blob');
  class BlobAlreadyExistsError extends Error { constructor() { super(); this.name = 'BlobAlreadyExistsError'; } }
  require.cache[blobModule] = { exports: {
    BlobPreconditionFailedError,
    BlobNotFoundError,
    async head(key) {
      const found = blobs.get(key);
      if (!found) throw new BlobNotFoundError();
      return { etag: missingTag ? '' : found.etag };
    },
    async get(key, options) {
      assert.equal(options.useCache, false);
      const found = blobs.get(key); if (!found) return null;
      const body = found.body;
      if (key === store.CURRENT && changeDuringRead) {
        changeDuringRead = false;
        const other = JSON.parse(body); other.rev++;
        other.playlists.push({ id: 'mid-read', name: 'Changed during read', tracks: [], removed: [] });
        blobs.set(key, { body: JSON.stringify(other), etag: 'v' + ++version });
      }
      // Deliberately different delivery ETag: it must never be used for a write.
      return { stream: new ReadableStream({ start(controller) { controller.enqueue(Buffer.from(body)); controller.close(); } }), blob: { etag: 'W/"delivery-etag"' } };
    },
    async put(key, body, options) {
      if (key === store.CURRENT && inject) {
        inject = false;
        const other = JSON.parse(blobs.get(key).body); other.rev++;
        other.playlists.push({ id: 'other-device', name: 'Other device', tracks: [], removed: [] });
        blobs.set(key, { body: JSON.stringify(other), etag: 'v' + ++version });
      }
      const previous = blobs.get(key);
      if (!options.allowOverwrite && previous) throw new BlobAlreadyExistsError();
      if (options.ifMatch && previous?.etag !== options.ifMatch) throw new BlobPreconditionFailedError();
      if (key === store.CURRENT && previous) assert.equal(typeof options.ifMatch, 'string', 'all overwrites must use a conditional write');
      const etag = 'v' + ++version; blobs.set(key, { body, etag }); writes.push({ key, options }); return { etag };
    },
  } };
  delete process.env.NOTES_DEV_DIR;
  process.env.BLOB_READ_WRITE_TOKEN = 'test-double-only';
  try {
    await mutate({ action: 'playlist-create', id: 'our-device', name: 'Our device' });
    doc = await store.read();
    check(doc.playlists.some(p => p.id === 'other-device') && doc.playlists.some(p => p.id === 'our-device'), true, 'Blob ETag conflict retries on the newer state without losing the other device');
    await Promise.all([a, b, c, d].map(v => mutate({ action: 'playlist-member', id: 'our-device', v, on: true })));
    check(new Set((await store.read()).playlists.find(p => p.id === 'our-device').tracks), new Set([a, b, c, d]), 'independent Blob writers merge concurrent patches through conditional retries');
    check(writes.filter(w => w.key === store.CURRENT).every(w => !!w.options.ifMatch), true, 'every existing Blob write has an ETag precondition');
    check(writes.filter(w => w.key === store.CURRENT).every(w => w.options.ifMatch !== 'W/"delivery-etag"'), true, 'conditional writes use authoritative storage metadata, never the delivery HTTP ETag');
    changeDuringRead = true;
    await mutate({ action: 'playlist-create', id: 'after-read', name: 'After read' });
    check((await store.read()).playlists.some(p => p.id === 'mid-read'), true, 'a change between metadata reads retries without overwriting the intervening edit');
    await store.archiveLegacy(shorts);
    await store.archiveLegacy(shorts);
    check([...blobs.keys()].filter(key => key.startsWith('music/legacy/')).length, 1, 'immutable cloud originals are safely reusable with real SDK existing-path behavior');
    blobs.delete(store.CURRENT);
    await Promise.all(['first-a', 'first-b'].map(id => mutate({ action: 'playlist-create', id, name: id })));
    check((await store.read()).playlists.length, 2, 'two first-time device migrations cannot overwrite initial Blob creation');
    const writesBeforeMissingToken = writes.length;
    missingTag = true; await assert.rejects(store.read(), /concurrency token/); count++;
    check(writes.length, writesBeforeMissingToken, 'a missing concurrency token must never fall back to an unconditional write');
  } finally { if (oldModule) require.cache[blobModule] = oldModule; else delete require.cache[blobModule]; process.env.NOTES_DEV_DIR = dir; }
  console.log(`music_playlist_sync_check: ${count} checks passed`);
} finally { rmSync(dir, { recursive: true, force: true }); }
