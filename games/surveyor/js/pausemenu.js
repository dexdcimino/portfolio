/* Pause menu — ported from Chomp's (games/chomp/js/pausemenu.js), which was
   itself ported from Stickland's. Same shell, same backdrop, same section
   order, same footer with EXIT left and RESUME right wearing the accent.
   Ported: the shell, the accent picker, the controls reference, the shared
   audio panel, the exit and restart actions.
   Omitted on purpose: Chomp's camera-zoom slider (Surveyor's chase camera has
   its own wheel zoom and no stored setting) and Stickland's keybind rebinder
   (nothing here is rebindable).

   WIRING CONTRACT, and it is the same one Chomp states: main.js owns the pause
   ladder. This module binds NO Escape handler. It fills the #paused overlay
   that main.js shows and hides, and Resume goes through window.Surveyor.resume.
   That split is what keeps the iframe working — the game's own window listener
   is the only thing that sees Escape, and /surveyor/surveyor.js hands the frame
   focus on load so it gets there.

   Self-contained: injects its own styles and edits nothing else. */

import { createAudioSettings, buildAudioPanel } from '../../_shared/audio-panel.js';
/* The UI voice lives in js/audio/sfx.js and listens for one event. Emitting it
   from here costs this module no knowledge of the audio engine at all, which
   is the same split every other event in this game uses.
   These fire while the game is PAUSED, so the engine's master is at zero and
   most of them are inaudible by design - a paused game is quiet. Resume is the
   exception and the one that matters: it sounds on the way out, as the master
   comes back. */
import { emit } from './core/events.js';

/* The site's seven accents, byte-identical to ACCENTS in the site's script.js
   and to the copies in Chomp and Arena 1. The duplication is deliberate and
   documented there: a game must not reach into the parent document. */
const SITE_ACCENTS = [
  { name: 'red',    hex: '#D94727' },
  { name: 'yellow', hex: '#FAAA1E' },
  { name: 'lime',   hex: '#9EE02B' },
  { name: 'cyan',   hex: '#2CC7F6' },
  { name: 'blue',   hex: '#335DF3' },
  { name: 'purple', hex: '#A85CF5' },
  { name: 'white',  hex: '#E9EBEC' },
];
const SITE_ACCENT_KEY = 'dex-accent-name';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/** Relative luminance, sRGB. Above ~0.5 dark ink reads on the accent. */
function inkFor(hex) {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.5 ? '#0b0d12' : '#ffffff';
}

function currentAccent() {
  return SITE_ACCENTS.find((a) => a.name === store.get(SITE_ACCENT_KEY)) || SITE_ACCENTS[2];
}

function applyAccent(a, persist = true) {
  document.documentElement.style.setProperty('--cmenu-accent', a.hex);
  document.documentElement.style.setProperty('--cmenu-ink', inkFor(a.hex));
  if (persist) store.set(SITE_ACCENT_KEY, a.name);
  for (const b of document.querySelectorAll('.cmenu-swatch')) {
    b.classList.toggle('is-on', b.dataset.name === a.name);
  }
}

/* THE FULL LIST, and it lives here now. The start card carries an abbreviated
   version to get someone moving; this is the reference, and it is the only
   place every control is written down. Dev keys are not player controls and are
   deliberately absent. */
const CONTROLS = [
  ['Drive, steer', ['W', 'A', 'S', 'D'], 'pitch and roll in the air'],
  ['Boost', ['Shift'], 'sustained'],
  ['Jump', ['Space'], 'hold to charge, release to leap'],
  ['Drone: climb · descend', ['Space', 'Ctrl'], 'or Z to descend — the held height stays'],
  ['Rover · Boat · Jet · Drone', ['1', '2', '3', '4'], 'momentum carries across'],
  ['Back to the rover', ['R'], ''],
  ['Drop a coloniser', ['F'], 'it lands and builds itself'],
  ['Survey overlay', ['Q'], 'hold — see through the planet'],
  ['Scanner beam', ['E'], 'hold — costs charge, disrupts raiders'],
  ['Recentre the camera', ['C'], ''],
  ['Swing camera · zoom', ['Drag', 'Wheel'], ''],
  ['Mute', ['M'], ''],
  ['Pause', ['Esc'], ''],
];

/* Master silences the other channels, the way Stickland's and Chomp's menus do.
   Switching master off has to move every fader, not just stop the sound: a
   music slider sitting at 30% while nothing plays is the UI disagreeing with
   itself. This WRAPS the shared settings object rather than changing it —
   games/_shared/ is Arena 1's and Chomp's too. */
function masterCascade(settings) {
  const CHILDREN = ['music', 'fx'];
  const remembered = {};
  for (const key of settings.keys) remembered[key] = settings.get(key) || undefined;

  const remember = (k) => { const v = settings.get(k); if (v > 0) remembered[k] = v; };
  const restore = (k) => settings.set(k, remembered[k] ?? 0.4);
  const silenceChildren = () => CHILDREN.forEach((k) => {
    remember(k); settings.set(k, 0); settings.setOn(k, false);
  });
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
/* pointer-events: Surveyor's #hud is pointer-events:none so the canvas gets
   clicks, and this overlay is a sibling of it. It reclaims events for itself
   and everything in it, or every click falls through to the canvas. */
#paused.overlay{position:absolute;inset:0;z-index:40;display:flex;align-items:center;
  justify-content:center;padding:18px;pointer-events:auto;background:rgba(4,8,11,.62);
  backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
/* FADES rather than snaps. display:none cannot be transitioned, so the hidden
   state is opacity plus visibility instead - visibility is what keeps a hidden
   menu out of the tab order, and pointer-events is what keeps it from eating
   clicks meant for the canvas underneath. main.js still just toggles .hidden.
   The panel scales a hair on the way in so the menu arrives rather than
   appears; 120ms, because a pause menu that makes you wait is a bad pause
   menu. */
/* visibility is switched, never interpolated. Giving it a DURATION makes the
   computed value lag the class by a frame or more and reads as the menu being
   in the wrong state; the delay form is the one that behaves: instant on the
   way in, and held back until the fade has finished on the way out, which is
   what keeps a fading menu out of the tab order without it vanishing early. */
#paused{transition:opacity 150ms ease,visibility 0s}
#paused .cmenu{transition:transform 150ms ease}
#paused.hidden{opacity:0;visibility:hidden;pointer-events:none;transition:opacity 150ms ease,visibility 0s 150ms}
#paused.hidden .cmenu{transform:scale(.985)}
@media(prefers-reduced-motion:reduce){
  #paused,#paused .cmenu{transition:none}
  #paused.hidden .cmenu{transform:none}
}
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
/* The audio panel is a COLUMN of channels; the shared module only emits class
   names and the styling is each game's. */
.cmenu-audpanel{display:grid;gap:10px;align-items:stretch}
.aud-chan{display:flex;align-items:center;gap:10px;min-width:0}
.aud-range{flex:1;min-width:0;accent-color:var(--cmenu-accent,#9EE02B)}
.aud-chanlabel{flex:0 0 52px;font-size:11px;font-weight:800;letter-spacing:.08em;
  color:#8d959c;text-transform:uppercase}
.aud-range-val{flex:0 0 40px;text-align:right;font-size:11px;font-weight:700;
  color:#8d959c;font-variant-numeric:tabular-nums}
.aud-toggle{flex:0 0 auto;width:34px;height:20px;padding:0;border-radius:999px;cursor:pointer;
  border:2px solid #3a4450;background:#232830;position:relative;
  transition:background .15s ease,border-color .15s ease}
.aud-toggle::after{content:'';position:absolute;top:50%;left:2px;width:12px;height:12px;
  border-radius:50%;background:#8d959c;transform:translateY(-50%);
  transition:transform .15s ease,background .15s ease}
.aud-toggle.on{background:var(--cmenu-accent,#9EE02B);border-color:var(--cmenu-accent,#9EE02B)}
.aud-toggle.on::after{background:var(--cmenu-ink,#0b0d12);transform:translate(14px,-50%)}
.aud-toggle:focus-visible{outline:2px solid var(--cmenu-accent,#9EE02B);outline-offset:2px}
.aud-chan.is-silenced .aud-chanlabel,.aud-chan.is-silenced .aud-range-val{opacity:.55}
/* Fixed action bar: EXIT/RESUME stay visible while the sections scroll behind. */
.cmenu-foot{display:flex;justify-content:space-between;gap:12px;
  position:sticky;bottom:0;margin:20px -22px 0;padding:12px 22px 18px;
  background:#151a21;border-top:1px solid rgba(255,255,255,.1)}
.cmenu-btn{min-height:42px;padding:0 20px;border-radius:10px;cursor:pointer;font-weight:800;
  letter-spacing:.06em;font-size:13px;border:2px solid rgba(255,255,255,.22);background:transparent;
  color:#f1f3f4;transition:border-color .15s ease,background .15s ease}
.cmenu-btn:hover{border-color:rgba(255,255,255,.5)}
/* Press and focus, which this menu had neither of. Every control here was
   hover-only, so it read as inert to a touch device and gave a keyboard no
   idea where it was. The transform is 1px: enough to feel, not enough to
   reflow anything next to it. */
.cmenu-btn:active{transform:translateY(1px)}
.cmenu-btn:focus-visible{outline:3px solid var(--cmenu-accent,#9EE02B);outline-offset:3px}
.cmenu-swatch:active{transform:scale(1.02)}
.cmenu-swatch:focus-visible{outline:3px solid #fff;outline-offset:3px}
@media(prefers-reduced-motion:reduce){
  .cmenu-btn:active,.cmenu-swatch:active,.cmenu-swatch:hover{transform:none}
}
/* Exit left, Resume right — the standing order from Stickland's menu. Resume
   wears the accent, its ink flipped by the same luminance rule as the toggles. */
.cmenu-resume{background:var(--cmenu-accent,#9EE02B);border-color:var(--cmenu-accent,#9EE02B);
  color:var(--cmenu-ink,#0b0d12)}
.cmenu-resume:hover{filter:brightness(1.08)}
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
    <h2>Audio</h2>
    <div class="cmenu-audpanel"></div>
    <h2>Controls</h2>
    <div class="cmenu-rows"></div>
    <div class="cmenu-foot">
      <button class="cmenu-btn cmenu-exit" type="button">EXIT GAME</button>
      <button class="cmenu-btn cmenu-restart" type="button" aria-label="Restart" title="Restart"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
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
    b.addEventListener('click', () => { applyAccent(a); emit('ui', { kind: 'tick' }); });
    swatches.appendChild(b);
  }
  applyAccent(currentAccent(), false);

  const rows = menu.querySelector('.cmenu-rows');
  for (const [label, keys, alt] of CONTROLS) {
    const row = document.createElement('div');
    row.className = 'cmenu-row';
    row.innerHTML = `<span>${label}</span><span class="cmenu-keys">` +
      keys.map((k) => `<kbd class="cmenu-key">${k}</kbd>`).join('') +
      (alt ? `<span class="cmenu-alt">${alt}</span>` : '') + `</span>`;
    rows.appendChild(row);
  }

  /* The same shared mixer Arena 1 and Chomp use, persisted under
     `surveyor-audio`. The levels SCALE the tune's own mix rather than replacing
     it — see AudioEngine.setLevels — so this game's balance survives anyone
     touching a slider. */
  const settings = createAudioSettings('surveyor', (levels) => {
    if (window.Surveyor && window.Surveyor.sound) window.Surveyor.sound.setLevels(levels);
  });
  buildAudioPanel(menu.querySelector('.cmenu-audpanel'), masterCascade(settings));

  menu.querySelector('.cmenu-resume').addEventListener('click', () => {
    window.Surveyor?.resume?.();
    emit('ui', { kind: 'confirm' });
  });
  menu.querySelector('.cmenu-restart').addEventListener('click', () => {
    /* A reload, the same as Chomp's respawn. Surveyor has no partial reset to
       reuse: the world, the spawn and the scatter are all seeded at boot, so a
       fresh run IS a fresh page. The colony record survives on purpose — it is
       the save, and restarting a session is not the same as abandoning it. */
    location.reload();
  });
  menu.querySelector('.cmenu-exit').addEventListener('click', () => {
    // Navigate the PARENT, not the iframe: the site's frame-ancestors header
    // refuses to load the site inside a frame. Same-origin, so window.top is
    // reachable; standalone it is a no-op alias.
    (window.top || window).location.href = '/';
  });
  // Backdrop click resumes — the same contract as the site's dialogs.
  host.addEventListener('click', (e) => {
    if (e.target === host) window.Surveyor?.resume?.();
  });
}

/* The menu wears the SITE's accent, not the world's palette — deliberately.
   Every game on this site shares one accent choice through localStorage, and a
   pause menu that dressed itself in Vault's ice blue would be the one screen
   that did not agree with the others. */
build();
