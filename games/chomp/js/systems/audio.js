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
