/* Pause menu — ported from Stickland's (games/stickland/src/pausemenu.js) per
   MD. Ported: shell, backdrop, exit action, accent picker, controls reference,
   volume + mute. Omitted on purpose: the keybind rebinder and the FX shake
   slider — Chomp has neither a rebindable action nor a shake system, so they
   are not stubbed and not rendered disabled.

   Wiring contract (do not change): main.js owns the pause ladder. This module
   binds NO Escape/P handler — it only fills the #paused overlay that
   setState('paused') already shows and hides, and Resume goes through
   window.Chomp.resume(). Space and click-resume also stay main.js's.

   Self-contained: injects its own styles, edits nothing else, so the next
   game drop re-applies by copying this file and adding one script tag
   (see INTEGRATION-NOTES.md). */

import { setAudioLevels, legacyAudioLevel, playUiSelect } from './systems/audio.js';
/* MD 26 item 1 — the shared Clayweld mixer, same module Arena 1 uses. */
import { createAudioSettings, buildAudioPanel } from '../../_shared/audio-panel.js';

/* The site's seven accents, byte-identical to ACCENTS in the site's script.js.
   The duplication is deliberate and documented there: the game must not reach
   into the parent document, and the palette changes rarely. */
const SITE_ACCENTS = [
  { name: 'red',    hex: '#D94727' },
  { name: 'yellow', hex: '#FAAA1E' },
  { name: 'lime',   hex: '#9EE02B' },
  { name: 'cyan',   hex: '#2CC7F6' },
  { name: 'blue',   hex: '#335DF3' },
  { name: 'purple', hex: '#A85CF5' },
  { name: 'white',  hex: '#E9EBEC' },
];
// The site's own key. Same-origin (the wrapper loads the game from
// /games/chomp/, a root-relative path), so one localStorage is shared and the
// choice made here carries back to dexcimino.com with no postMessage bridge.
const SITE_ACCENT_KEY = 'dex-accent-name';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/* Relative luminance, sRGB — same maths as Stickland's _knobFor. Above ~0.5
   the accent is a light colour and dark ink reads on it; below, white. */
function inkFor(hex) {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.5 ? '#0b0d12' : '#ffffff';
}

function currentAccent() {
  const hit = SITE_ACCENTS.find(a => a.name === store.get(SITE_ACCENT_KEY));
  return hit || SITE_ACCENTS[2]; // lime, the site default
}

function applyAccent(a, persist = true) {
  document.documentElement.style.setProperty('--cmenu-accent', a.hex);
  document.documentElement.style.setProperty('--cmenu-ink', inkFor(a.hex));
  if (persist) store.set(SITE_ACCENT_KEY, a.name);
  // The character wears the accent too — visuals/proc/chomp.js listens and
  // retints the live materials.
  window.dispatchEvent(new CustomEvent('chomp-accent', { detail: a.name }));
  for (const b of document.querySelectorAll('.cmenu-swatch')) {
    b.classList.toggle('is-on', b.dataset.name === a.name);
  }
}

/* Chomp's real player controls, read from js/main.js. The ?debug=1 keys are
   dev tools, not player controls, and are deliberately not listed. */
const CONTROLS = [
  ['Move', ['W', 'A', 'S', 'D'], 'or arrow keys'],
  ['Sprint', ['Shift'], ''],
  ['Chomp', ['Space'], 'or left click'],
  ['Pause', ['Esc', 'P'], ''],
];

/* The mixer's three faders MULTIPLY, and the shared defaults did not account
   for that: master 0.35 x music 0.30 x the track's own 0.53 is 0.056 — about 5%
   of full scale, which rendered through the real graph is a peak of -27 dBFS.
   That is not "quiet background music", that is inaudible under any system
   volume a person actually uses. FX fared better only because a transient
   survives attenuation that sustained music does not.

   These are Chomp's own defaults rather than a change to
   games/_shared/audio-panel.js, which is Arena 1's too and whose mix is its
   own business.

   The rescale runs once, stamped by CHOMP_MIX_VERSION, and only ever raises a
   channel — someone who deliberately turned FX down keeps it. It has to touch
   stored settings at all because the old numbers meant a different loudness:
   leaving a player on 35/30 would leave them on silence they never chose. */
const CHOMP_MIX = { master: 0.80, music: 0.60, fx: 0.70 };
const CHOMP_MIX_VERSION = '2';
const MIX_VERSION_KEY = 'chomp-mix-version';

function rescaleMix(settings) {
  if (store.get(MIX_VERSION_KEY) === CHOMP_MIX_VERSION) return;
  for (const [key, floor] of Object.entries(CHOMP_MIX)) {
    if (settings.get(key) < floor) settings.set(key, floor);
  }
  store.set(MIX_VERSION_KEY, CHOMP_MIX_VERSION);
}

/* Master silences the other channels, the way Stickland's menu does it.

   Switching master off has to move every fader, not just stop the sound: a
   music slider sitting at 30% while nothing plays is the UI disagreeing with
   itself. Turning master back on restores what was there, and touching any
   child while master is down brings master back up — otherwise the child looks
   live and stays silent.

   This wraps the SHARED settings object rather than changing it. That module is
   Arena 1's too, and its own semantics (mute a channel, keep its slider where
   it was) are right for a panel with no master cascade. Nothing here reaches
   into games/_shared/. */
function masterCascade(settings) {
  const CHILDREN = ['music', 'fx'];
  // What to come back to. Seeded from the current levels, updated whenever a
  // channel is left in an audible state.
  const remembered = {};
  for (const key of settings.keys) remembered[key] = settings.get(key) || undefined;

  const remember = (key) => { const v = settings.get(key); if (v > 0) remembered[key] = v; };
  const restore = (key) => settings.set(key, remembered[key] ?? 0.4);

  const silenceChildren = () => CHILDREN.forEach((k) => { remember(k); settings.set(k, 0); settings.setOn(k, false); });
  // Only restores children that master silenced — a channel the user turned off
  // on purpose stays off, because it was already 0 before master went down.
  const restoreChildren = () => CHILDREN.forEach((k) => {
    if (settings.get(k) === 0 || !settings.isOn(k)) { restore(k); settings.setOn(k, true); }
  });
  const wakeMaster = () => {
    if (settings.isOn('master') && settings.get('master') > 0) return;
    settings.set('master', remembered.master ?? 0.35);
    settings.setOn('master', true);
  };

  return {
    ...settings,
    keys: settings.keys,
    get: settings.get,
    level: settings.level,
    isOn: settings.isOn,
    set(key, v) {
      const value = Number(v) || 0;
      if (key === 'master') {
        remember('master');
        settings.set('master', value);
        // Dragging master to zero is muting it; dragging it back up is unmuting.
        if (value === 0) { settings.setOn('master', false); silenceChildren(); }
        else { settings.setOn('master', true); restoreChildren(); }
        return;
      }
      settings.set(key, value);
      if (value > 0) { remember(key); wakeMaster(); }
    },
    setOn(key, on) {
      if (key === 'master') {
        if (on) { restore('master'); settings.setOn('master', true); restoreChildren(); }
        else { remember('master'); settings.set('master', 0); settings.setOn('master', false); silenceChildren(); }
        return;
      }
      if (on) { restore(key); settings.setOn(key, true); wakeMaster(); }
      else { remember(key); settings.set(key, 0); settings.setOn(key, false); }
    },
  };
}

const CSS = `
/* pointer-events: the game's #hud is pointer-events:none so the canvas gets
   clicks — which meant every click on this menu fell THROUGH to the canvas,
   whose paused-state handler resumed the game. The overlay reclaims events
   for itself and everything in it. */
#paused.overlay{display:flex;align-items:center;justify-content:center;padding:18px;pointer-events:auto}
#paused.hidden{display:none}
.cmenu{
  width:min(460px,92vw);max-height:min(86vh,640px);overflow:auto;
  background:rgba(13,17,22,.96);border:1px solid rgba(255,255,255,.12);
  border-radius:16px;padding:22px 22px 0;
  color:#f1f3f4;font-family:'Segoe UI',system-ui,sans-serif;text-align:left;
  box-shadow:0 18px 60px rgba(0,0,0,.6);
}
.cmenu h1{margin:0 0 16px;font-size:26px;letter-spacing:.14em}
.cmenu h2{margin:18px 0 10px;font-size:11px;font-weight:800;letter-spacing:.22em;
  color:#8d959c;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:6px}
.cmenu-swatches{display:flex;gap:10px;justify-content:center}
.cmenu-swatch{width:30px;height:30px;border-radius:50%;cursor:pointer;padding:0;
  border:2px solid rgba(255,255,255,.18);transition:transform .15s ease,border-color .15s ease}
.cmenu-swatch:hover{transform:scale(1.12)}
.cmenu-swatch.is-on{border-color:#fff;box-shadow:0 0 0 2px var(--cmenu-accent,#9EE02B)}
.cmenu-rows{display:grid;gap:8px}
.cmenu-row{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:14px}
.cmenu-keys{display:flex;gap:4px;align-items:center}
.cmenu-key{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:22px;
  padding:0 7px;font-size:11px;font-weight:600;color:#f1f3f4;background:#232830;
  border:2px solid #3a4450;border-radius:6px;white-space:nowrap}
.cmenu-alt{color:#8d959c;font-size:12px;margin-left:6px}
.cmenu-audio{display:flex;align-items:center;gap:12px}
.cmenu-audio input[type=range]{flex:1;min-width:0;accent-color:var(--cmenu-accent,#9EE02B)}
/* The audio panel is a COLUMN of channels. It was mounted on a .cmenu-audio
   element, which is a flex ROW, so master / music / fx were laid out side by
   side — 943px of content in a 458px menu, i.e. the horizontal scrollbar.
   The shared module (games/_shared/audio-panel.js) only emits class names; the
   styling is each game's, and Chomp had none for .aud-* at all. */
.cmenu-audpanel{display:grid;gap:10px;align-items:stretch}
.aud-chan{display:flex;align-items:center;gap:10px;min-width:0}
/* min-width:0 is what actually stops the overflow: a flex item will not shrink
   below its content otherwise, and a range input's default width is 129px. */
.aud-range{flex:1;min-width:0;accent-color:var(--cmenu-accent,#9EE02B)}
.aud-chanlabel{flex:0 0 52px;font-size:11px;font-weight:800;letter-spacing:.08em;
  color:#8d959c;text-transform:uppercase}
.aud-range-val{flex:0 0 40px;text-align:right;font-size:11px;font-weight:700;
  color:#8d959c;font-variant-numeric:tabular-nums}
/* The switch: a pill that fills with the accent when the channel is on, so the
   row reads at a glance without needing the percentage. */
.aud-toggle{flex:0 0 auto;width:34px;height:20px;padding:0;border-radius:999px;cursor:pointer;
  border:2px solid #3a4450;background:#232830;position:relative;
  transition:background .15s ease,border-color .15s ease}
.aud-toggle::after{content:'';position:absolute;top:50%;left:2px;width:12px;height:12px;
  border-radius:50%;background:#8d959c;transform:translateY(-50%);
  transition:transform .15s ease,background .15s ease}
.aud-toggle.on{background:var(--cmenu-accent,#9EE02B);border-color:var(--cmenu-accent,#9EE02B)}
.aud-toggle.on::after{background:var(--cmenu-ink,#0b0d12);transform:translate(14px,-50%)}
.aud-toggle:focus-visible{outline:2px solid var(--cmenu-accent,#9EE02B);outline-offset:2px}
/* A channel silenced by master reads as off without pretending to be
   independently disabled — it still takes a click to bring back. */
.aud-chan.is-silenced .aud-chanlabel,.aud-chan.is-silenced .aud-range-val{opacity:.55}
.cmenu-zoomlab{font-size:11px;font-weight:800;letter-spacing:.08em;color:#8d959c;min-width:64px}
.cmenu-mute{min-width:64px;height:28px;border-radius:14px;cursor:pointer;font-size:11px;font-weight:800;
  letter-spacing:.08em;border:2px solid #3a4450;background:#232830;color:#f1f3f4;
  transition:background .15s ease,color .15s ease,border-color .15s ease}
.cmenu-mute.is-muted{background:var(--cmenu-accent,#9EE02B);border-color:var(--cmenu-accent,#9EE02B);color:var(--cmenu-ink,#0b0d12)}
/* Fixed action bar: EXIT/RESUME stay visible while the sections scroll behind.
   Sticky and in-flow, so the scroll region's bottom padding is the bar itself
   and the last section can always scroll clear of it. Opaque on purpose. */
.cmenu-foot{display:flex;justify-content:space-between;gap:12px;
  position:sticky;bottom:0;margin:20px -22px 0;padding:12px 22px 18px;
  background:#151a21;border-top:1px solid rgba(255,255,255,.1)}
.cmenu-btn{min-height:42px;padding:0 20px;border-radius:10px;cursor:pointer;font-weight:800;
  letter-spacing:.06em;font-size:13px;border:2px solid rgba(255,255,255,.22);background:transparent;color:#f1f3f4;
  transition:border-color .15s ease,background .15s ease}
.cmenu-btn:hover{border-color:rgba(255,255,255,.5)}
/* Exit left, Resume right — the standing order from Stickland's menu. Resume
   wears the accent, its ink flipped dark/light by the same luminance rule as
   the mute pill, so white-on-lime never happens. */
.cmenu-resume{background:var(--cmenu-accent,#9EE02B);border-color:var(--cmenu-accent,#9EE02B);color:var(--cmenu-ink,#0b0d12)}
.cmenu-resume:hover{filter:brightness(1.08)}
/* Respawn: square, icon only, centred between EXIT and RESUME by the footer's
   own space-between. aspect-ratio rather than a fixed width so it stays square
   against whatever min-height the row settles at. Deliberately wears the same
   neutral outline as EXIT rather than the accent — RESUME is the primary
   action here and should stay the only filled control. */
.cmenu-restart{flex:0 0 auto;aspect-ratio:1;padding:0;display:grid;place-items:center}
.cmenu-restart svg{width:19px;height:19px;display:block}
`;

function build() {
  const host = document.getElementById('paused');
  if (!host) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const menu = document.createElement('div');
  menu.className = 'cmenu';
  menu.innerHTML = `
    <h1>PAUSED</h1>
    <h2>Accent</h2>
    <div class="cmenu-swatches"></div>
    <h2>Controls</h2>
    <div class="cmenu-rows"></div>
    <h2>Camera</h2>
    <div class="cmenu-audio cmenu-zoom-row">
      <span class="cmenu-zoomlab">ZOOM OUT</span>
      <input class="cmenu-zoom" type="range" min="0.5" max="2" step="0.05" aria-label="Camera zoom out">
    </div>
    <h2>Audio</h2>
    <div class="cmenu-audio cmenu-audpanel">
    </div>
    <div class="cmenu-foot">
      <button class="cmenu-btn cmenu-exit" type="button">EXIT GAME</button>
      <button class="cmenu-btn cmenu-restart" type="button" aria-label="Respawn" title="Respawn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
      <button class="cmenu-btn cmenu-resume" type="button">RESUME</button>
    </div>`;
  host.replaceChildren(menu);

  const swatches = menu.querySelector('.cmenu-swatches');
  for (const a of SITE_ACCENTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cmenu-swatch';
    b.dataset.name = a.name;
    b.style.background = a.hex;
    b.setAttribute('aria-label', `Accent ${a.name}`);
    b.addEventListener('click', () => applyAccent(a));
    swatches.appendChild(b);
  }
  applyAccent(currentAccent(), false);

  const rows = menu.querySelector('.cmenu-rows');
  for (const [label, keys, alt] of CONTROLS) {
    const row = document.createElement('div');
    row.className = 'cmenu-row';
    const keySpans = keys.map(k => `<kbd class="cmenu-key">${k}</kbd>`).join('');
    row.innerHTML = `<span>${label}</span><span class="cmenu-keys">${keySpans}${alt ? `<span class="cmenu-alt">${alt}</span>` : ''}</span>`;
    rows.appendChild(row);
  }

  // Camera zoom: 2.0 (full zoom-out) is the shipped default; the choice
  // persists as chomp-zoom and systems/camera.js applies the event live.
  const zoom = menu.querySelector('.cmenu-zoom');
  const storedZoom = parseFloat(store.get('chomp-zoom'));
  zoom.value = Number.isFinite(storedZoom) ? Math.min(2, Math.max(0.5, storedZoom)) : 2;
  zoom.addEventListener('input', () => {
    store.set('chomp-zoom', zoom.value);
    window.dispatchEvent(new CustomEvent('chomp-zoom', { detail: parseFloat(zoom.value) }));
  });
  // The scroll wheel also drives zoom (camera.js); mirror it here so the
  // slider always shows the live value when the menu opens mid-scroll.
  window.addEventListener('chomp-zoom-sync', (e) => { zoom.value = String(e.detail); });

  /* Same shared panel as Arena 1, same three channels, persisted under
     `chomp-audio`. Chomp's createAudio() is still a TODO stub, so the levels
     currently land in audio.js and wait there — setAudioLevels stores them and
     applies them the moment a graph exists. The panel ships now rather than
     with the audio because MD 26 makes it the standard for every game, and a
     mixer that appears at the same time as the first sound is a mixer written
     twice. */
  const audioSettings = createAudioSettings('chomp', setAudioLevels,
    { legacyMaster: legacyAudioLevel() ?? undefined });
  rescaleMix(audioSettings);
  buildAudioPanel(menu.querySelector('.cmenu-audpanel'), masterCascade(audioSettings));

  /* UI select (MD 27). The menu is plain DOM and emits nothing on the event
     bus, so the sound is hung on the panel's own buttons — one delegated
     listener rather than a call in each handler, so a button added later is
     audible without anyone remembering to wire it. Capture phase, because
     `resume` and `restart` tear the menu down (or reload the page) and a
     bubble-phase listener would fire too late to be heard.
     Deliberately NOT on the audio panel's own sliders and mute toggles: a
     click sound on every step of a volume drag is unusable. */
  menu.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('button');
    if (btn && !btn.closest('.aud-panel')) playUiSelect();
  }, true);

  menu.querySelector('.cmenu-resume').addEventListener('click', () => {
    if (window.Chomp && window.Chomp.resume) window.Chomp.resume();
  });
  menu.querySelector('.cmenu-restart').addEventListener('click', () => {
    // Chomp restarts by reloading — the same thing the death screen already
    // does ("click respawns" in main.js). There is no partial-reset path to
    // reuse: the cave, the creatures and the evolution chain are all seeded at
    // boot, so a fresh run IS a fresh page.
    location.reload();
  });
  menu.querySelector('.cmenu-exit').addEventListener('click', () => {
    // Navigate the PARENT, not the iframe: the game runs framed and the
    // site's frame-ancestors header refuses to load the site inside a frame.
    // Same-origin, so window.top is reachable; standalone it's a no-op alias.
    (window.top || window).location.href = '/';
  });
  // Clicking the dimmed area OUTSIDE the panel resumes — the same contract as
  // the site's dialogs (backdrop click closes). Clicks inside the panel stay
  // inside the panel.
  host.addEventListener('click', (e) => {
    if (e.target === host && window.Chomp && window.Chomp.resume) window.Chomp.resume();
  });
}

build();
