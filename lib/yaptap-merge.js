'use strict';
/* The YapTap sync merge rule — one implementation, used by the server
   store and mirrored by the PWA client (yaptap/app.js mergeDocs):
     · Notes unite by id. The copy with the larger `updated` wins.
     · A deletion tombstone { id, ts } with ts >= a note's `updated`
       beats the note, on both sides.
     · The result is sorted newest-first (storage order, as the app keeps
       it everywhere) and tombstones are kept so a stale device cannot
       resurrect a deleted note. */

function mergeDocs(a, b) {
  const byId = new Map();
  for (const doc of [a, b]) {
    for (const n of (doc && doc.notes) || []) {
      if (!n || typeof n.id !== 'string') continue;
      const cur = byId.get(n.id);
      if (!cur || (n.updated || n.ts || 0) > (cur.updated || cur.ts || 0)) byId.set(n.id, n);
    }
  }
  const del = new Map();
  for (const doc of [a, b]) {
    for (const d of (doc && doc.deleted) || []) {
      if (!d || typeof d.id !== 'string') continue;
      del.set(d.id, Math.max(del.get(d.id) || 0, d.ts || 0));
    }
  }
  const notes = [...byId.values()].filter(n => (del.get(n.id) || 0) < (n.updated || n.ts || 0));
  notes.sort((x, y) => (y.ts - x.ts) || (y.updated - x.updated));
  const deleted = [...del.entries()].map(([id, ts]) => ({ id, ts }));
  return { notes, deleted };
}

module.exports = { mergeDocs };
