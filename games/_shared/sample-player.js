/* ==========================================================================
   games/_shared/sample-player.js — MD 26 item 2 playback rules, once.

   Every requirement in the MD is here rather than in each game's audio.js,
   because they are all the same rules and all easy to get subtly wrong:

     · PRELOAD + POOL. Decoded AudioBuffers are cached by URL. A BufferSource
       is single-use by spec, so "pooling" means reusing the decoded buffer,
       not the node — allocating a node per shot is cheap, decoding is not.
     · CONCURRENCY CAP, per sound. Rapid fire stacking twelve copies of the
       same 30ms crack is what turns a weapon into mush; past the cap the
       oldest voice is stolen rather than a new one added, so the sound stays
       responsive instead of going silent under load.
     · PITCH VARIANCE. +/-5% by default, applied per shot. Identical repeats
       are what make a sampled game sound cheaper than a synthesized one.
     · FALLBACK. If a file is missing or the decode fails, `play` returns
       false and the caller runs its synthesized version. A missing asset must
       degrade to the old sound, never to silence — that is what makes it safe
       to land the loader before every sample exists.

   No AudioContext is created here; the host game passes its own, along with
   the destination node (its `fx` bus). One graph per game, still.
   ========================================================================== */

export function createSamplePlayer({ ctx, destination, basePath = '', defaultCap = 4 }) {
  const buffers = new Map();     // url -> AudioBuffer | 'failed'
  const voices = new Map();      // name -> [{ src, at }]
  const caps = new Map();        // name -> concurrent voice cap
  const gains = new Map();       // name -> per-sound trim

  async function load(name, file, { cap = defaultCap, gain = 1 } = {}) {
    caps.set(name, cap);
    gains.set(name, gain);
    const url = basePath + file;
    if (buffers.has(url)) return buffers.get(url) !== 'failed';
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      buffers.set(url, buf);
      voices.set(name, []);
      names.set(name, url);
      return true;
    } catch (e) {
      // Deliberately not fatal, and deliberately noisy once: a sound that
      // silently vanished is far harder to notice than one that logs.
      buffers.set(url, 'failed');
      console.warn(`[audio] ${name} (${url}) unavailable, using the synthesized fallback:`, e.message);
      return false;
    }
  }
  const names = new Map();       // name -> url

  function ready(name) {
    const url = names.get(name);
    return !!url && buffers.get(url) instanceof AudioBuffer;
  }

  /* Returns false when there is no sample, so callers read as:
       if (!samples.play('zap')) synthZap();
     which keeps the fallback impossible to forget. */
  function play(name, { vary = 0.05, gain = 1 } = {}) {
    const url = names.get(name);
    const buf = url && buffers.get(url);
    if (!(buf instanceof AudioBuffer)) return false;

    const live = voices.get(name) || [];
    const cap = caps.get(name) ?? defaultCap;
    // Steal the oldest rather than refusing: the newest shot is the one the
    // player just took, and dropping it is what feels broken.
    while (live.length >= cap) {
      const old = live.shift();
      try { old.src.stop(); } catch { /* already ended */ }
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Detune in cents; +/-5% is about +/-85 cents. Per shot, so a burst is
    // never the same sample twice in a row.
    if (vary > 0) {
      const cents = (Math.random() * 2 - 1) * (1200 * Math.log2(1 + vary));
      if (src.detune) src.detune.value = cents;
      else src.playbackRate.value = 1 + (Math.random() * 2 - 1) * vary;
    }
    const g = ctx.createGain();
    g.gain.value = (gains.get(name) ?? 1) * gain;
    src.connect(g); g.connect(destination);
    const entry = { src, at: ctx.currentTime };
    live.push(entry);
    voices.set(name, live);
    src.onended = () => {
      const arr = voices.get(name);
      const i = arr ? arr.indexOf(entry) : -1;
      if (i >= 0) arr.splice(i, 1);
    };
    src.start();
    return true;
  }

  /* Raw buffer access, for sounds the caller has to drive itself. The jetpack
     is a held loop with its own gain ramp, not a one-shot, so it cannot go
     through play() — it wants the decoded buffer and nothing else. Returns
     null when unavailable, which is the same fallback contract as play(). */
  function buffer(name) {
    const url = names.get(name);
    const buf = url && buffers.get(url);
    return buf instanceof AudioBuffer ? buf : null;
  }

  return { load, play, ready, buffer };
}
