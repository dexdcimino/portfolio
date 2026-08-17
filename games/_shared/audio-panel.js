/* ==========================================================================
   games/_shared/audio-panel.js — the Clayweld audio panel.

   Ported from Stickland's pause menu (src/pausemenu.js `_channel` + src/audio.js
   bus graph) and extracted rather than copied, because MD 26 makes this the
   standard for every game going forward and three divergent copies of a mixer
   is exactly the failure that produces "why is Chomp quieter than Arena 1".

   What Stickland had that this keeps:
     · a row per channel: mute toggle, label, live slider, % readout;
     · 'input' rather than 'change', so you tune by ear while dragging;
     · a remembered pre-mute level, so unmuting returns you where you were
       instead of to some default;
     · settings persisted immediately, not on close.

   What changed, per MD 26:
     · the bus set is master / music / fx (Stickland had sfx / ui / amb, which
       is its own mix, not a general one);
     · defaults are master 35, music 30, fx 40;
     · localStorage keys are namespaced per game, so Arena 1 and Chomp do not
       fight over one set of levels while sharing an origin.

   This module owns SETTINGS and UI only. It deliberately does not create an
   AudioContext: each game already has one, built at a different moment in its
   own boot, and taking that over would be a much larger change than the panel
   is worth. `createBusGraph` is offered for the routing side and is optional.
   ========================================================================== */

export const CHANNELS = [
  { key: 'master', label: 'Master' },
  { key: 'music', label: 'Music' },
  { key: 'fx', label: 'FX' },
];

// MD 26. Master sits low on purpose: these games are played in a browser tab
// next to everything else a person has open, and a game that arrives at full
// volume gets muted at the OS level and never turned back up.
export const DEFAULTS = { master: 0.35, music: 0.30, fx: 0.40 };

/* Namespaced per game. Both games are served from the same origin, so a single
   'audio-settings' key would have Chomp overwrite Arena 1's mix every time you
   switched. `game` is the prefix, e.g. 'arena1' -> 'arena1-audio'. */
export function createAudioSettings(game, onChange, opts = {}) {
  const KEY = `${game}-audio`;
  const state = { ...DEFAULTS, muted: { master: false, music: false, fx: false }, last: { ...DEFAULTS } };

  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      for (const { key } of CHANNELS) {
        if (typeof s?.[key] === 'number' && s[key] >= 0 && s[key] <= 1) state[key] = s[key];
        if (typeof s?.muted?.[key] === 'boolean') state.muted[key] = s.muted[key];
        // A remembered level of 0 would make unmute a no-op; fall back.
        state.last[key] = (typeof s?.last?.[key] === 'number' && s.last[key] > 0)
          ? s.last[key] : (state[key] > 0 ? state[key] : DEFAULTS[key]);
      }
    }
    else if (typeof opts.legacyMaster === 'number') {
      /* Nothing stored under the new key, but this player had the old
         single-level mixer. Carry their master across rather than jumping them
         to the new default — an upgrade that changes how loud the game is,
         without being asked, is a bug from the player's side. */
      state.master = Math.min(1, Math.max(0, opts.legacyMaster));
      state.muted.master = state.master === 0;
      if (state.master > 0) state.last.master = state.master;
    }
  } catch { /* private mode / disabled storage — defaults stand, nothing breaks */ }

  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* not persisted */ }
  };
  // Effective level: muted channels are 0 without losing the slider position,
  // so the UI still shows where you were and unmute is exact.
  const level = (key) => (state.muted[key] ? 0 : state[key]);
  const notify = () => onChange?.({
    master: level('master'), music: level('music'), fx: level('fx'),
  });

  notify();
  return {
    keys: CHANNELS.map((c) => c.key),
    get: (key) => state[key],
    level,
    isOn: (key) => !state.muted[key] && state[key] > 0,
    set(key, v) {
      state[key] = Math.min(1, Math.max(0, Number(v) || 0));
      if (state[key] > 0) { state.last[key] = state[key]; state.muted[key] = false; }
      save(); notify();
    },
    setOn(key, on) {
      state.muted[key] = !on;
      // Turning a channel back on when its slider was dragged to zero has to
      // restore something audible, or the toggle appears broken.
      if (on && state[key] === 0) state[key] = state.last[key] || DEFAULTS[key];
      save(); notify();
    },
    reset() {
      Object.assign(state, DEFAULTS);
      state.muted = { master: false, music: false, fx: false };
      state.last = { ...DEFAULTS };
      save(); notify();
    },
  };
}

/* Builds the panel. `root` is an element to fill; returns a repaint function
   so a menu that reopens can re-sync without rebuilding the DOM. Class names
   match Stickland's so the styling is the same panel, not a lookalike. */
export function buildAudioPanel(root, settings) {
  const rows = [];
  root.classList.add('aud-panel');
  root.textContent = '';

  for (const { key, label } of CHANNELS) {
    const row = document.createElement('div');
    row.className = 'aud-chan';

    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'aud-toggle';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-label', `${label} on`);

    const lab = document.createElement('span');
    lab.className = 'aud-chanlabel';
    lab.textContent = label;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0'; input.max = '100'; input.step = '1';
    input.className = 'aud-range';
    input.setAttribute('aria-label', `${label} volume`);

    const val = document.createElement('span');
    val.className = 'aud-range-val';

    const paint = () => {
      const pct = Math.round(settings.get(key) * 100);
      input.value = String(pct);
      val.textContent = pct + '%';
      // Drives the filled portion of the track in CSS.
      input.style.setProperty('--fill', pct + '%');
      const on = settings.isOn(key);
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-checked', String(on));
    };

    // 'input', not 'change': applies live while dragging, which is the whole
    // point of a volume slider — you set it by ear, not by number.
    input.addEventListener('input', () => { settings.set(key, input.value / 100); repaint(); });
    sw.addEventListener('click', () => { settings.setOn(key, !settings.isOn(key)); repaint(); });

    row.append(sw, lab, input, val);
    root.appendChild(row);
    rows.push(paint);
  }

  function repaint() { for (const p of rows) p(); }
  repaint();
  return repaint;
}

/* Optional routing helper: master -> compressor -> destination, with music and
   fx feeding master. The compressor is Stickland's safety net — heavy combat
   squeezes instead of clipping, which matters more once real samples replace
   synthesized tones (MD 26 item 2 asks for exactly that guarantee).
   Returns { master, music, fx, apply } — `apply` takes the object the settings
   onChange hands you. */
export function createBusGraph(ctx) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 20;
  comp.ratio.value = 5;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  comp.connect(ctx.destination);

  const master = ctx.createGain();
  master.connect(comp);
  const music = ctx.createGain();
  const fx = ctx.createGain();
  music.connect(master);
  fx.connect(master);

  return {
    master, music, fx,
    apply(levels) {
      const t = ctx.currentTime;
      // setTargetAtTime, not a jump: dragging a slider should not click.
      master.gain.setTargetAtTime(levels.master, t, 0.02);
      music.gain.setTargetAtTime(levels.music, t, 0.02);
      fx.gain.setTargetAtTime(levels.fx, t, 0.02);
    },
  };
}
