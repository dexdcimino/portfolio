// systems/audio.js — sfx/music from assets/audio/ (ART_BIBLE slots),
// silent-skip if a file is missing.
//
// Master volume API (site pause-menu contract): one master level + an
// independent mute flag, both persisted under chomp-* localStorage keys and
// restored on boot. Unmuting restores the previous level — it never resets.
// (Deliberately NOT a multi-bus mixer; per-bus split is a separate job.)

const VOLUME_KEY = 'chomp-volume';
const MUTED_KEY = 'chomp-muted';

function readStore(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — volume just won't persist */
  }
}

let volume = Math.min(1, Math.max(0, parseFloat(readStore(VOLUME_KEY, '1')) || 0));
let muted = readStore(MUTED_KEY, '0') === '1';

export function setVolume(v) {
  volume = Math.min(1, Math.max(0, Number(v) || 0));
  writeStore(VOLUME_KEY, String(volume));
}

export function getVolume() {
  return volume;
}

export function setMuted(on) {
  muted = !!on;
  writeStore(MUTED_KEY, muted ? '1' : '0');
}

export function isMuted() {
  return muted;
}

// What playback code should actually apply to sounds.
export function effectiveVolume() {
  return muted ? 0 : volume;
}

// TODO(MD-06): load slots, subscribe to events, expose toggle().
export function createAudio() {
  // TODO(MD-06)
}

/* ── MD 26: shared mixer levels ────────────────────────────────────────────
   The pause menu now drives master/music/fx through games/_shared/audio-panel.js.
   Chomp has no audio graph yet (createAudio is a TODO stub above), so the
   levels are held here and handed over the moment one exists — whoever builds
   it reads currentAudioLevels() rather than inventing a second settings path.
   The legacy single-level key is migrated once so an existing player's volume
   is not discarded by the upgrade. */
const LEGACY_VOLUME_KEY = 'chomp-volume';
const LEGACY_MUTED_KEY = 'chomp-muted';
let levels = { master: 0.35, music: 0.30, fx: 0.40 };
let busGraph = null;

export function setAudioLevels(next) {
  levels = next;
  if (busGraph) busGraph.apply(levels);
}
export function currentAudioLevels() { return levels; }
// Called by whoever builds the audio graph; see createBusGraph in the shared
// module for a ready-made master/music/fx set.
export function attachBusGraph(graph) {
  busGraph = graph;
  if (graph) graph.apply(levels);
}
export function legacyAudioLevel() {
  const v = parseFloat(readStore(LEGACY_VOLUME_KEY, ''));
  if (!Number.isFinite(v)) return null;
  return readStore(LEGACY_MUTED_KEY, '0') === '1' ? 0 : Math.min(1, Math.max(0, v));
}
