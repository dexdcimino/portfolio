// music.js — the audition player.
//
// Stickland ships zero audio ASSETS: everything you hear is synthesised in
// audio.js. This module is the one exception and it is deliberately temporary —
// a rack of CC0 candidates with next/previous, so a track can be judged while
// actually playing the game rather than in a browser tab. When one is chosen,
// this file shrinks to that single track (or goes away again).
//
// Two consequences worth knowing, both stated rather than hidden:
//   · The files are fetched at runtime from `music/` next to index.html, so the
//     built single file is no longer self-contained the way README.md promises.
//     Opened straight from disk (file://) the fetch fails, and the game runs
//     exactly as before with no music and no error — the standalone promise
//     degrades rather than breaks.
//   · An <audio> element, not a decoded buffer: these are minutes long and
//     multi-megabyte, and decoding one into memory to switch away from it two
//     seconds later is the wrong trade. It is routed INTO the existing graph
//     through createMediaElementSource, so the pause menu's Music fader governs
//     it like everything else.

import { musicDestination, audioContext } from './audio.js';

/* Labelled by number because that is how they are picked: "track 4" is the
   answer this rack exists to get. The names are here so the answer can be
   turned back into a file without counting rows. */
export const TRACKS = [
  { file: 'w1-adventure-theme.ogg',   name: 'Adventure Theme',            set: 'world' },
  { file: 'w2-town-theme.mp3',        name: 'Town Theme',                 set: 'world' },
  { file: 'w3-a-start-to-space.ogg',  name: 'A Start to Space',           set: 'world' },
  { file: 'w4-picnic.mp3',            name: 'Picnic',                     set: 'world' },
  { file: 'w5-calm-theme.ogg',        name: 'Calm Theme',                 set: 'world' },
  { file: 'w6-a-path.ogg',            name: 'A Path Which Leads Somewhere', set: 'world' },
  { file: 'w7-frozen-in-time.mp3',    name: 'Frozen in Time',             set: 'world' },
  { file: 'p1-run-jump-duck.ogg',     name: 'Run Jump Duck',              set: 'platform' },
  { file: 'p2-bravery-run.ogg',       name: 'Bravery Run',                set: 'platform' },
  { file: 'p3-chiptune-stage-1.ogg',  name: 'Chiptune Adventures 1',      set: 'platform' },
  { file: 'p4-chiptune-stage-2.ogg',  name: 'Chiptune Adventures 2',      set: 'platform' },
  { file: 'p5-chiptune-select.ogg',   name: 'Chiptune Adventures Select', set: 'platform' },
];

/* Per-track gain, measured the same way the site's other music is: each file's
   loudest 300ms window scaled to one reference, capped so nothing peaks over
   0.95. Without this the loudest master wins the audition regardless of whether
   it is the best track. */
const GAIN = {
  'w1-adventure-theme.ogg': 0.64, 'w2-town-theme.mp3': 0.59, 'w3-a-start-to-space.ogg': 1.00,
  'w4-picnic.mp3': 0.66, 'w5-calm-theme.ogg': 1.00, 'w6-a-path.ogg': 1.00,
  'w7-frozen-in-time.mp3': 0.44, 'p1-run-jump-duck.ogg': 0.68, 'p2-bravery-run.ogg': 0.58,
  'p3-chiptune-stage-1.ogg': 0.64, 'p4-chiptune-stage-2.ogg': 0.62, 'p5-chiptune-select.ogg': 0.89,
};

const KEY = 'stickland-track';
const BASE = 'music/';

let el = null;          // the <audio> element
let node = null;        // its MediaElementSource, made once — a second one throws
let gain = null;
let index = 0;
let started = false;
let failed = false;
const listeners = new Set();

const clamp = (i) => ((i % TRACKS.length) + TRACKS.length) % TRACKS.length;

function announce() {
  const t = TRACKS[index];
  for (const fn of listeners) {
    try { fn({ index, number: index + 1, total: TRACKS.length, name: t.name, set: t.set, failed, playing: !!el && !el.paused }); }
    catch (e) { /* a listener must not be able to stop playback */ }
  }
}

/* Called by the menu to follow the state without polling. Fires immediately so
   a menu built after playback started still shows the right track. */
export function onMusicChange(fn) {
  listeners.add(fn);
  announce();
  return () => listeners.delete(fn);
}

function ensure() {
  if (el || failed) return el;
  const ctx = audioContext();
  const dest = musicDestination();
  if (!ctx || !dest) return null;                 // no gesture yet — try again later
  try {
    el = new Audio();
    el.loop = true;
    el.preload = 'none';
    el.crossOrigin = 'anonymous';
    node = ctx.createMediaElementSource(el);
    gain = ctx.createGain();
    node.connect(gain); gain.connect(dest);
    el.addEventListener('error', () => { failed = true; announce(); });
    el.addEventListener('playing', announce);
    el.addEventListener('pause', announce);
  } catch (e) {
    failed = true;
    el = null;
  }
  return el;
}

function load(play) {
  const a = ensure();
  if (!a) return;
  const t = TRACKS[index];
  failed = false;
  gain.gain.value = GAIN[t.file] ?? 0.7;
  a.src = BASE + t.file;
  try { localStorage.setItem(KEY, String(index)); } catch (e) { /* private mode */ }
  if (play) a.play().catch(() => { /* autoplay policy — the next gesture starts it */ });
  announce();
}

/* Started from the first user gesture, like the rest of the audio graph: a
   context created before one is suspended, and an <audio> told to play before
   one is refused. */
/* audio.js calls this through the window on the first gesture — see the note
   there. Registered here so the wiring lives with the thing being started. */
try {
  window._sticklandStartMusic = () => startMusic();
  /* The same programmatic handle audio.js exposes for the mixer, for the same
     reasons: the console can drive it, and the test suite can read what is
     actually loaded. The <audio> element is deliberately NOT in the document —
     it is a source feeding the graph, not something to lay out — so `element`
     is the only way to see its state from outside. */
  window._dexMusic = {
    next: () => nextTrack(), prev: () => prevTrack(), toggle: () => toggleMusic(),
    state: () => musicState(), element: () => el,
  };
} catch (e) { /* no window */ }

export function startMusic() {
  if (started) return;
  const stored = parseInt((() => { try { return localStorage.getItem(KEY); } catch (e) { return null; } })(), 10);
  index = Number.isFinite(stored) ? clamp(stored) : 0;
  if (!ensure()) return;                          // graph not up yet; caller retries
  started = true;
  load(true);
}

export function nextTrack() { index = clamp(index + 1); load(true); }
export function prevTrack() { index = clamp(index - 1); load(true); }
export function toggleMusic() {
  const a = ensure();
  if (!a) return;
  if (a.paused) { if (!a.src) load(true); else a.play().catch(() => {}); }
  else a.pause();
  announce();
}
export function musicState() {
  const t = TRACKS[index];
  return { index, number: index + 1, total: TRACKS.length, name: t.name, set: t.set,
           failed, playing: !!el && !el.paused };
}
