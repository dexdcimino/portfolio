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
  // Second batch (2026-08): the first ten candidates were rejected in
  // audition; tracks 5 and 6 survived. w* = chill explore for the open
  // world, p* = energetic for platform mode.
  { file: 'w1-crystal-cave.mp3',       name: 'Crystal Cave',               set: 'world' },
  { file: 'w2-mysterious-ambience.mp3', name: 'Mysterious Ambience',       set: 'world' },
  { file: 'w3-field-of-dreams.mp3',    name: 'The Field of Dreams',        set: 'world' },
  { file: 'w4-snowfall.ogg',           name: 'Snowfall',                   set: 'world' },
  { file: 'w5-calm-theme.ogg',         name: 'Calm Theme',                 set: 'world' },
  { file: 'w6-a-path.ogg',             name: 'A Path Which Leads Somewhere', set: 'world' },
  { file: 'w7-observing-the-star.ogg', name: 'Observing the Star',         set: 'world' },
  { file: 'p1-junkala-level-1.ogg',    name: 'Action Chiptune — Level 1',  set: 'platform' },
  { file: 'p2-junkala-level-2.ogg',    name: 'Action Chiptune — Level 2',  set: 'platform' },
  { file: 'p3-nes-venus.ogg',          name: 'Venus',                      set: 'platform' },
  { file: 'p4-fast-fight.ogg',         name: 'Fast Fight',                 set: 'platform' },
  { file: 'p5-awake.mp3',              name: 'Awake!',                     set: 'platform' },
];

/* Per-track gain, measured the same way the site's other music is: each file's
   loudest 300ms window scaled to one reference, capped so nothing peaks over
   0.95. Without this the loudest master wins the audition regardless of whether
   it is the best track. Re-measured for this batch (the reference is the
   quietest of the twelve, so the kept tracks' numbers moved too). */
const GAIN = {
  'w1-crystal-cave.mp3': 0.27, 'w2-mysterious-ambience.mp3': 0.31,
  'w3-field-of-dreams.mp3': 0.92, 'w4-snowfall.ogg': 0.82,
  'w5-calm-theme.ogg': 0.67, 'w6-a-path.ogg': 1.00,
  'w7-observing-the-star.ogg': 0.52,
  'p1-junkala-level-1.ogg': 0.15, 'p2-junkala-level-2.ogg': 0.16,
  'p3-nes-venus.ogg': 0.38, 'p4-fast-fight.ogg': 0.18, 'p5-awake.mp3': 0.22,
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
