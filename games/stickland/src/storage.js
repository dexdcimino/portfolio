// ══════════════════════════════════════════════════════
//  Local persistence — replaces every Firestore read/write
// ══════════════════════════════════════════════════════
//  Was:                            Now:
//    worlds/default            →   'sfg-world'
//    users/{uid}.cosmetics     →   'sfg-cosmetics'
//    (already local)           →   'dexnote-hotbar'    — key kept as-is
//    (already local)           →   'dexnote-keybinds'  — key kept as-is

const K_WORLD     = 'sfg-world';
const K_COSMETICS = 'sfg-cosmetics';

// ── Guarded localStorage ───────────────────────────────
// Chrome/Firefox allow localStorage on file://; Safari and some hardened
// configurations throw on any access. Every persistence call in the game
// routes through this accessor: when real storage is unusable it falls back
// to an in-memory Map, so the game still plays (and keeps state within the
// session) — it just forgets between sessions. A storage failure must never
// become a black screen.

const _mem = new Map();

const _ls = (() => {
  try {
    const probe = '__sfg-probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch (e) {
    console.warn('[storage] localStorage unavailable (' + e.message + ') — using in-memory fallback; nothing will persist between sessions');
    return null;
  }
})();

export const safeStorage = {
  getItem(key) {
    if (_ls) { try { return _ls.getItem(key); } catch (e) {} }
    return _mem.has(key) ? _mem.get(key) : null;
  },
  setItem(key, val) {
    val = String(val);
    if (_ls) { try { _ls.setItem(key, val); return; } catch (e) {} }
    _mem.set(key, val);
  },
  removeItem(key) {
    if (_ls) { try { _ls.removeItem(key); } catch (e) {} }
    _mem.delete(key);
  },
};

function _read(key) {
  try {
    const raw = safeStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function _write(key, val) {
  try { safeStorage.setItem(key, JSON.stringify(val)); return true; }
  catch (e) { console.warn('[storage] save failed for', key, e.message); return false; }
}

// ── World ──────────────────────────────────────────────
// generateWorld() is fully deterministic (seeded rand, fixed counts), so
// first run just seeds from it. After that we persist so in-game changes
// survive a reload.
//
// MD 08: the payload carries a generator version stamp. Without it, any
// change to generateWorld() is invisible to every existing player — the old
// cached world passes the grass+castle sanity check and gets served forever,
// while fresh profiles see the new world. Version mismatch → regenerate.
// (Old worlds were pure cached generator output — there is no world editor
// and nothing in play mutates the saved objects — so nothing of the player's
// is lost by regenerating.)

/**
 * @param {() => Array} generate  fallback generator (playmode's generateWorld)
 * @param {number} version        current generator version (playmode's WORLD_GEN_VERSION)
 */
export function loadWorld(generate, version) {
  const saved = _read(K_WORLD);
  const objects = saved && Array.isArray(saved.objects) ? saved.objects : null;

  // Version gate first, then the same sanity check the Firestore path used:
  // a world with no grass or no castle is stale, so regenerate rather than
  // ship a broken map.
  if (objects && objects.length > 0 && (saved.v || 0) === (version || 0)) {
    const hasGrass  = objects.some(o => o.type === 'grass');
    const hasCastle = objects.some(o => o.type === 'castle');
    if (hasGrass && hasCastle) return objects;
  }

  const fresh = generate();
  saveWorld(fresh, version);
  return fresh;
}

export function saveWorld(objects, version) {
  return _write(K_WORLD, { v: version || 0, objects, savedAt: Date.now() });
}

export function resetWorld() {
  safeStorage.removeItem(K_WORLD);
}

// ── Cosmetics ──────────────────────────────────────────

export function loadCosmetics() {
  const c = _read(K_COSMETICS);
  return (c && typeof c === 'object') ? c : null;
}

export function saveCosmetics(cosmetics) {
  return _write(K_COSMETICS, { ...cosmetics });
}
