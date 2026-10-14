/* yaptap-store — per-account YapTap notes, in the SAME store the rest of
   the site's per-user data already lives in: Vercel Blob (private) with a
   local-fs stand-in for development and checks, exactly the io pattern of
   lib/sketch-store.js and lib/notes-store.js. One JSON document per
   account: yaptap/users/<uid>.json, keyed by the Firebase uid that
   lib/site-identity.js verifies — the same account identity Inko and
   DexNote use. Server-only: this module touches the BLOB_READ_WRITE_TOKEN,
   which never leaves the server.

   A document is the whole notebook:
       { notes: [{ id, ts, updated, text }…], deleted: [{ id, ts }…] }
   Merge rule (applied on every push, identical on the client): union by
   note id — the copy with the larger `updated` wins; a deletion
   tombstone with ts >= a note's `updated` beats the note. See
   lib/yaptap-merge.js (pure, shared logic lives there so the rule is
   written once). */

const fs = require('node:fs');
const path = require('node:path');
const { mergeDocs } = require('./yaptap-merge');

const KEY_PREFIX = 'yaptap/users/';

// In production this stays unset and Blob is used. Locally (checks, the
// `serve` mirror) NOTES_DEV_DIR points at a scratch directory so the store
// can be exercised without touching the live vaults.
const DEV_DIR = process.env.NOTES_DEV_DIR || '';

function configError() {
  if (DEV_DIR) return null;
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return 'blob storage is not configured (BLOB_READ_WRITE_TOKEN missing)';
  }
  return null;
}

function keyFor(uid) {
  // uid comes from a verified Firebase token; still whitelist the shape so
  // a uid can never become a path.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid || '')) throw new Error('bad uid');
  return KEY_PREFIX + uid + '.json';
}

function devFile(uid) {
  return path.join(DEV_DIR, keyFor(uid));
}

async function blobClient() {
  // Lazy import so the fs-only path never loads the SDK.
  return import('@vercel/blob');
}

async function getDoc(uid) {
  if (DEV_DIR) {
    try {
      const raw = fs.readFileSync(devFile(uid), 'utf8');
      const doc = JSON.parse(raw);
      return sanitizeDoc(doc);
    } catch (e) {
      if (e && e.code === 'ENOENT') return { notes: [], deleted: [] };
      throw e;
    }
  }
  const { get } = await blobClient();
  const res = await get(keyFor(uid), { access: 'private' }).catch(() => null);
  if (!res || res.statusCode !== 200 || !res.stream) return { notes: [], deleted: [] };
  const text = await new Response(res.stream).text();
  try { return sanitizeDoc(JSON.parse(text)); }
  catch (e) { return { notes: [], deleted: [] }; }
}

async function putDoc(uid, doc) {
  const body = JSON.stringify(sanitizeDoc(doc));
  if (DEV_DIR) {
    const file = devFile(uid);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return;
  }
  const { put } = await blobClient();
  await put(keyFor(uid), body, {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

function sanitizeDoc(doc) {
  const clean = { notes: [], deleted: [] };
  if (!doc || typeof doc !== 'object') return clean;
  if (Array.isArray(doc.notes)) {
    for (const n of doc.notes) {
      if (!n || typeof n.id !== 'string' || typeof n.text !== 'string') continue;
      clean.notes.push({
        id: n.id.slice(0, 64),
        ts: +n.ts || 0,
        updated: +n.updated || +n.ts || 0,
        text: n.text.slice(0, 100000),
      });
    }
  }
  if (Array.isArray(doc.deleted)) {
    for (const d of doc.deleted) {
      if (!d || typeof d.id !== 'string') continue;
      clean.deleted.push({ id: d.id.slice(0, 64), ts: +d.ts || 0 });
    }
  }
  return clean;
}

/* Pull-merge-push in one step: the client's document is merged into the
   stored one and the canonical result is returned, so one round trip
   both uploads and downloads. */
async function mergeInto(uid, clientDoc) {
  const current = await getDoc(uid);
  const merged = mergeDocs(current, sanitizeDoc(clientDoc));
  await putDoc(uid, merged);
  return merged;
}

module.exports = { configError, getDoc, putDoc, mergeInto, sanitizeDoc, KEY_PREFIX };
