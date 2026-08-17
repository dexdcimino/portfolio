// Minimal pub/sub. Keeps HUD, FX and audio off the gameplay modules' backs.

const map = new Map();

export function on(evt, fn) {
  if (!map.has(evt)) map.set(evt, new Set());
  map.get(evt).add(fn);
  return () => off(evt, fn);
}

export function off(evt, fn) {
  const s = map.get(evt);
  if (s) s.delete(fn);
}

export function emit(evt, payload) {
  const s = map.get(evt);
  if (!s) return;
  for (const fn of s) {
    try { fn(payload); } catch (err) { console.error('[events]', evt, err); }
  }
}

export function clear() { map.clear(); }
