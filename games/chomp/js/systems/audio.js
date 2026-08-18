// systems/audio.js — Chomp's audio engine (MD 27).
//
// Bus graph, matching Arena 1 exactly so the two games behave identically and
// one mixer setting means the same thing in both:
//
//     music ─┐
//            ├─→ master ─→ compressor ─→ destination
//     fx ────┘
//
// The graph itself comes from games/_shared/audio-panel.js `createBusGraph`
// rather than being rebuilt here — that module is the standard, and a second
// hand-rolled compressor is how "why is Chomp quieter than Arena 1" starts.
//
// Levels are NOT owned here. The pause menu writes them through setAudioLevels
// below (persisted under `chomp-audio` by the shared panel), and they are held
// until a graph exists — see attachBusGraph. There is one settings path.

import { createSamplePlayer } from '../../../_shared/sample-player.js';
import { createBusGraph } from '../../../_shared/audio-panel.js';
import { on } from '../core/events.js';

/* The pre-MD-26 single-level API (setVolume/getVolume/setMuted/isMuted/
   effectiveVolume) is gone. It had no callers left once the pause menu moved to
   the shared panel, and keeping a second thing that can write the output level
   is how a slider ends up "sometimes doing nothing". Its two keys survive below
   for one purpose only: reading an existing player's old level once, so the
   upgrade does not silently change how loud the game is. */
function readStore(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

/* ── MD 26: shared mixer levels ────────────────────────────────────────────
   The pause menu drives master/music/fx through games/_shared/audio-panel.js.
   Levels can arrive before the audio graph exists — the panel is built at page
   load, the graph waits for a user gesture — so they are held here and applied
   the moment attachBusGraph runs. The legacy single-level key is migrated once
   so an existing player's volume is not discarded by the upgrade. */
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

/* ── Samples ───────────────────────────────────────────────────────────────
   MD 27 asked for seven sounds. Five are wired, because five are all this game
   emits anything for — see assets/audio/CREDITS.md and the MD 27 report for
   the three that have no emitter (spawn, level start, level fail).

   `gain` is not a taste value. Each file was decoded and measured (loudest
   300ms window RMS), normalised toward a common reference, then given a
   deliberate mix offset: chomp fires on every input and sits low, death
   happens once a run and sits proud. Doing it here rather than re-encoding
   keeps the shipped files byte-identical to the CC0 pack, which is what makes
   the CREDITS rename map verifiable.

   `cap` is per sound and follows how fast the thing can fire: chomp is
   spammable, death happens once. */
let samples = null;
const SAMPLES = {
  chomp:    ['chomp.ogg',     { cap: 5, gain: 1.01 }],
  eat:      ['eat.ogg',       { cap: 4, gain: 0.68 }],
  evolve:   ['evolve.ogg',    { cap: 2, gain: 1.13 }],
  death:    ['death.ogg',     { cap: 1, gain: 1.31 }],
  uiSelect: ['ui-select.ogg', { cap: 3, gain: 0.73 }],
  // Not a one-shot: loaded for its decoded buffer, driven by startMusic below.
  music:    ['music.mp3',     { cap: 1, gain: 1 }],
};

/* One looping source on the music bus, started once the context exists and then
   left alone — the panel's Music channel is the only volume control it needs,
   so there is no second fader here to disagree with. Deliberately quiet at
   source as well: music sits UNDER the FX, and a track that only sits back
   because the default slider says so is one bad drag away from drowning the
   game.

   The number moves with every track and the loudness does not: each swap is
   re-measured in the loudest 300 ms window and the gain scaled to land on the
   level that was signed off. 0.45 (Arena 1) → 0.57 (Dark Shrine, 0.193) →
   0.73 (Boss Battle 6 Metal, 0.1506): 0.57 × (0.193 / 0.1506) ≈ 0.73. The
   number moving is not a mix decision, it is the same loudness meeting a
   different recording. Headroom: 0.73 × its 0.574 peak is 0.42.
   `loop = true` on the BufferSource is a sample-accurate loop with no gap —
   the reason this is a decoded buffer and not an <audio> element. */
const MUSIC_GAIN = 0.73;
let musicNode = null;
function startMusic() {
  if (musicNode || !samples || !busGraph) return;
  const buf = samples.buffer('music');
  if (!buf) return;                 // no track shipped: silence, not an error
  musicNode = ctx.createBufferSource();
  musicNode.buffer = buf;
  musicNode.loop = true;
  const g = ctx.createGain();
  g.gain.value = MUSIC_GAIN;
  musicNode.connect(g); g.connect(busGraph.music);
  musicNode.start();
}

/* Arena 1 falls back to a synthesized tone when a sample is missing. Chomp has
   no synth — missing means SILENT — so the miss is logged instead, once per
   key. A sound that quietly stopped existing is far harder to notice than one
   that says so, and "the game went quiet after we renamed a file" is exactly
   the bug this prevents. */
const warned = new Set();
function play(name, opts) {
  if (samples && samples.play(name, opts)) return true;
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`[chomp audio] "${name}" did not play — no sample loaded. `
      + `Chomp has no synthesized fallback, so this event is silent. `
      + `Expected assets/audio/${SAMPLES[name]?.[0] ?? '?'}`);
  }
  return false;
}

let ctx = null;
let started = false;

/* Autoplay policy: a context created before a user gesture is born suspended,
   and every sound played into it is lost rather than queued. So the graph is
   built on the FIRST gesture and not at boot. Chomp starts playing immediately
   (main.js boots straight into the cave with no splash), which means the first
   few frames of a run genuinely have no audio available — see the MD 27 report
   on why "level start" cannot be wired here. */
function start() {
  if (started) return;
  started = true;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const graph = createBusGraph(ctx);
  // Hands the graph the levels the pause menu already stored — this is the
  // single settings path, not a second one.
  attachBusGraph(graph);
  samples = createSamplePlayer({ ctx, destination: graph.fx, basePath: 'assets/audio/' });
  for (const [name, [file, opts]] of Object.entries(SAMPLES)) {
    const loading = samples.load(name, file, opts);
    // The track can only start once its buffer is decoded, and it is the one
    // entry whose load result is worth waiting on — a one-shot that arrives
    // late simply plays late, but music that starts before it decodes never
    // starts at all.
    if (name === 'music') loading.then((got) => { if (got) startMusic(); });
  }
  if (ctx.state === 'suspended') ctx.resume();
}

/* The music bus. Null until the first gesture builds the graph. */
export function musicDestination() { return busGraph ? busGraph.music : null; }
/* For tests and for anyone adding a second music cue: is the loop running? */
export function musicPlaying() { return !!musicNode; }

/* UI sounds are not on the event bus — the pause menu is plain DOM — so this is
   exported for it to call directly. */
export function playUiSelect() { play('uiSelect'); }

let wired = false;
export function createAudio() {
  if (wired) return;
  wired = true;

  // Any of these is a real user gesture, and any of them can be the first one:
  // Chomp is playable with the mouse or the keyboard alone.
  const kick = () => start();
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(ev, kick, { once: false, passive: true });
  }

  /* Only events Chomp actually emits (audited for MD 27):
       player:chomp   — the maw snaps shut, on every input
       player:eat     — something was actually swallowed
       player:evolve  — stage up
       player:death   — run over
     player:devolve, player:damage and player:bonk also exist and have no sound
     in the MD 27 list; they are left alone rather than guessed at. */
  on('player:chomp', () => play('chomp'));
  on('player:eat', () => play('eat'));
  on('player:evolve', () => play('evolve'));
  on('player:death', () => play('death'));

  return { play, playUiSelect, musicDestination };
}
