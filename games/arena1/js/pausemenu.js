/* Arena 1 pause menu — ported from Chomp's (games/chomp/js/pausemenu.js), the
   proven site-integration precedent. Sections: accent picker, controls
   reference, quality, PvP (match-start flag), volume + mute.

   Wiring contract (do not change): main.js owns the state machine AND Escape.
   This module binds NO keys — it only fills the #paused overlay that
   setState('paused') shows and hides, and Resume goes through
   window.Arena1.resume(). Quality changes are handed to main via the
   'arena1-quality' event (main owns the engine).

   Self-contained: injects its own styles, edits nothing else. */

import { setVolume, getVolume, setMuted, isMuted } from './systems/audio.js';

/* The site's seven accents, byte-identical to ACCENTS in the site's script.js
   (verified against script.js:51-59 at build time). The duplication is
   deliberate and documented there: the game must not reach into the parent
   document, and the palette changes rarely. */
// Exported since MD 14: actors.js maps wire accent NAMES through this same
// table for remote pills — one palette copy in the game, not two.
export const SITE_ACCENTS = [
  { name: 'red',    hex: '#D94727' },
  { name: 'yellow', hex: '#FAAA1E' },
  { name: 'lime',   hex: '#9EE02B' },
  { name: 'cyan',   hex: '#2CC7F6' },
  { name: 'blue',   hex: '#335DF3' },
  { name: 'purple', hex: '#A85CF5' },
  { name: 'white',  hex: '#E9EBEC' },
];
// The site's own key. Same-origin (the wrapper loads the game from
// /games/arena1/, a root-relative path), so one localStorage is shared and
// the choice made here carries back to dexcimino.com with no postMessage.
const SITE_ACCENT_KEY = 'dex-accent-name';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/* Relative luminance, sRGB — same maths as Stickland's/Chomp's. Above ~0.5
   the accent is a light colour and dark ink reads on it; below, white. */
function inkFor(hex) {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.5 ? '#0b0d12' : '#ffffff';
}

function currentAccent() {
  const hit = SITE_ACCENTS.find((a) => a.name === store.get(SITE_ACCENT_KEY));
  return hit || SITE_ACCENTS[2]; // lime, the site default
}

function applyAccent(a, persist = true) {
  document.documentElement.style.setProperty('--cmenu-accent', a.hex);
  document.documentElement.style.setProperty('--cmenu-ink', inkFor(a.hex));
  if (persist) store.set(SITE_ACCENT_KEY, a.name);
  for (const b of document.querySelectorAll('.cmenu-swatch')) {
    b.classList.toggle('is-on', b.dataset.name === a.name);
  }
  // MD 13/14: main retints the local grapple rope from hex; the transport
  // announces the NAME to the host so other clients recolour this pill.
  window.dispatchEvent(new CustomEvent('arena1-accent', { detail: { name: a.name, hex: a.hex } }));
}

const CONTROLS = [
  ['Move', ['W', 'A', 'S', 'D'], ''],
  ['Grapple', ['RMB'], 'hold to reel'], // MD 13: directly under Move
  ['Jump / mid-air jet', ['Space'], 'hold to burn'],
  ['Dash', ['Shift'], '×2 charges'],
  ['Slide', ['C', 'Ctrl'], ''],
  ['Zap', ['LMB'], ''],
  ['Pause', ['Esc'], ''],
];

const CSS = `
/* pointer-events: the game's #hud is pointer-events:none so the canvas gets
   clicks — the overlay reclaims events for itself and everything in it
   (Chomp's lesson, kept). */
#paused{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;
  padding:18px;pointer-events:auto;background:rgba(13,17,22,.55)}
#paused.hidden{display:none}
.cmenu{
  width:min(460px,92vw);max-height:min(86vh,660px);overflow:auto;
  background:rgba(23,13,43,.96);border:1px solid rgba(242,214,162,.22);
  border-radius:16px;padding:22px 22px 0;
  color:#F2D6A2;font-family:"Cascadia Mono","JetBrains Mono",Consolas,monospace;text-align:left;
  box-shadow:0 18px 60px rgba(0,0,0,.6);
}
.cmenu h1{margin:0 0 16px;font-size:24px;letter-spacing:.2em;font-weight:400}
.cmenu h2{margin:18px 0 10px;font-size:11px;font-weight:800;letter-spacing:.22em;
  color:#a8916b;text-transform:uppercase;border-bottom:1px solid rgba(242,214,162,.14);padding-bottom:6px}
.cmenu-swatches{display:flex;gap:10px;justify-content:center}
.cmenu-swatch{width:30px;height:30px;border-radius:50%;cursor:pointer;padding:0;
  border:2px solid rgba(255,255,255,.18);transition:transform .15s ease,border-color .15s ease}
.cmenu-swatch:hover{transform:scale(1.12)}
.cmenu-swatch.is-on{border-color:#fff;box-shadow:0 0 0 2px var(--cmenu-accent,#9EE02B)}
/* the player's identity — centred in the menu, text centred, ALL CAPS; the
   small grey label sits to its left OUTSIDE the field (same treatment as the
   lobby ID label). Prominent: bigger and bold. Never empty. */
.cmenu-tagrow{display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:12px}
.cmenu-tag{width:55%;height:42px;padding:0 12px;border-radius:8px;font-family:inherit;
  font-size:18px;font-weight:800;letter-spacing:.1em;color:#F2D6A2;background:#2b1b45;
  border:2px solid #4A2B63;outline:none;text-align:center;text-transform:uppercase}
.cmenu-tag:focus{border-color:var(--cmenu-accent,#9EE02B)}
.cmenu-pvptoggle{flex:1;height:34px;border-radius:8px;cursor:pointer;font-size:11px;
  font-weight:800;letter-spacing:.1em;border:2px solid #4A2B63;background:#2b1b45;color:#F2D6A2;
  font-family:inherit;transition:border-color .15s ease,background .15s ease,color .15s ease}
.cmenu-pvptoggle:hover{border-color:var(--cmenu-accent,#9EE02B)}
.cmenu-pvptoggle.is-on{background:var(--cmenu-accent,#9EE02B);border-color:var(--cmenu-accent,#9EE02B);color:var(--cmenu-ink,#0b0d12)}
.cmenu-vis{flex:1.4}
.cmenu-confirm{display:flex;align-items:center;gap:8px;margin:2px 0 8px;padding:8px 10px;
  background:#2b1b45;border:2px solid var(--cmenu-accent,#9EE02B);border-radius:8px}
.cmenu-confirm[hidden]{display:none}
.cmenu-confirm-text{flex:1;font-size:11px;letter-spacing:.05em;color:#F2D6A2}
.cmenu-confirm-yes,.cmenu-confirm-no{min-width:58px;height:26px;border-radius:7px;cursor:pointer;
  font-size:10px;font-weight:800;letter-spacing:.08em;border:2px solid #4A2B63;background:#170D2B;
  color:#F2D6A2;font-family:inherit}
.cmenu-confirm-yes{background:var(--cmenu-accent,#9EE02B);border-color:var(--cmenu-accent,#9EE02B);color:var(--cmenu-ink,#0b0d12)}
.cmenu-roomrow{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.cmenu-roomlab{font-size:10px;font-weight:800;letter-spacing:.18em;color:#a8916b;min-width:64px}
.cmenu-roomcode{flex:1;display:flex;align-items:center;justify-content:space-between;gap:8px;
  font-size:15px;letter-spacing:.18em;color:#F2D6A2;background:#2b1b45;
  border:2px solid #4A2B63;border-radius:8px;padding:5px 10px;font-family:inherit}
.cmenu-roomcount{font-size:10px;letter-spacing:.1em;color:#F2D6A2;opacity:.5;white-space:nowrap}
.cmenu-copy,.cmenu-join{min-width:64px;height:32px;border-radius:8px;cursor:pointer;font-size:11px;
  font-weight:800;letter-spacing:.08em;border:2px solid #4A2B63;background:#2b1b45;color:#F2D6A2;
  font-family:inherit;transition:border-color .15s ease}
.cmenu-copy:hover,.cmenu-join:hover{border-color:var(--cmenu-accent,#9EE02B)}
.cmenu-joincode{flex:1;height:32px;padding:0 10px;border-radius:8px;font-family:inherit;
  font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#F2D6A2;background:#2b1b45;
  border:2px solid #4A2B63;outline:none}
.cmenu-joincode:focus{border-color:var(--cmenu-accent,#9EE02B)}
.cmenu-rows{display:grid;gap:8px}
.cmenu-row{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px}
.cmenu-keys{display:flex;gap:4px;align-items:center}
.cmenu-key{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:22px;
  padding:0 7px;font-size:11px;font-weight:600;color:#F2D6A2;background:#2b1b45;
  border:2px solid #4A2B63;border-radius:6px;white-space:nowrap}
.cmenu-alt{color:#a8916b;font-size:11px;margin-left:6px}
.cmenu-seg{display:flex;gap:8px}
.cmenu-seg button{flex:1;height:32px;border-radius:8px;cursor:pointer;font-size:11px;font-weight:800;
  letter-spacing:.1em;border:2px solid #4A2B63;background:#2b1b45;color:#F2D6A2;
  transition:background .15s ease,border-color .15s ease,color .15s ease}
.cmenu-seg button.is-on{background:var(--cmenu-accent,#9EE02B);border-color:var(--cmenu-accent,#9EE02B);color:var(--cmenu-ink,#0b0d12)}
.cmenu-note{font-size:10px;letter-spacing:.06em;color:#a8916b;margin-top:6px}
.cmenu-audio{display:flex;align-items:center;gap:12px}
.cmenu-audio input[type=range]{flex:1;accent-color:var(--cmenu-accent,#9EE02B)}
.cmenu-mute{min-width:64px;height:28px;border-radius:14px;cursor:pointer;font-size:11px;font-weight:800;
  letter-spacing:.08em;border:2px solid #4A2B63;background:#2b1b45;color:#F2D6A2;
  transition:background .15s ease,color .15s ease,border-color .15s ease}
.cmenu-mute.is-muted{background:var(--cmenu-accent,#9EE02B);border-color:var(--cmenu-accent,#9EE02B);color:var(--cmenu-ink,#0b0d12)}
.cmenu-foot{display:flex;justify-content:space-between;gap:12px;
  position:sticky;bottom:0;margin:20px -22px 0;padding:12px 22px 18px;
  background:#1d1136;border-top:1px solid rgba(242,214,162,.18)}
.cmenu-btn{min-height:42px;padding:0 20px;border-radius:10px;cursor:pointer;font-weight:800;
  letter-spacing:.06em;font-size:13px;border:2px solid rgba(242,214,162,.3);background:transparent;color:#F2D6A2;
  transition:border-color .15s ease,background .15s ease;font-family:inherit}
.cmenu-btn:hover{border-color:rgba(242,214,162,.6)}
/* Exit left, Resume right — the standing order from Stickland's menu. Resume
   wears the accent, its ink flipped dark/light by the same luminance rule. */
.cmenu-resume{background:var(--cmenu-accent,#9EE02B);border-color:var(--cmenu-accent,#9EE02B);color:var(--cmenu-ink,#0b0d12)}
.cmenu-resume:hover{filter:brightness(1.08)}
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
    <h2>Player</h2>
    <div class="cmenu-tagrow">
      <span class="cmenu-roomlab">TAG</span>
      <input class="cmenu-tag" type="text" maxlength="12" spellcheck="false" aria-label="Player tag">
    </div>
    <div class="cmenu-swatches"></div>
    <h2>Lobby</h2>
    <div class="cmenu-roomrow">
      <span class="cmenu-roomlab">ID:</span>
      <code class="cmenu-roomcode"><span class="cmenu-roomid">SOLO</span><span class="cmenu-roomcount"></span></code>
      <button class="cmenu-copy" type="button" aria-label="Copy lobby code">COPY</button>
    </div>
    <div class="cmenu-roomrow">
      <input class="cmenu-joincode" type="text" maxlength="24" spellcheck="false"
             placeholder="enter a lobby word" aria-label="Lobby code to join">
      <button class="cmenu-join" type="button">JOIN</button>
    </div>
    <div class="cmenu-roomrow">
      <div class="cmenu-seg cmenu-vis">
        <button type="button" data-vis="public">PUBLIC</button>
        <button type="button" data-vis="private">PRIVATE</button>
      </div>
      <button class="cmenu-pvptoggle" type="button" aria-live="polite"></button>
    </div>
    <div class="cmenu-confirm" hidden>
      <span class="cmenu-confirm-text"></span>
      <button class="cmenu-confirm-yes" type="button">YES</button>
      <button class="cmenu-confirm-no" type="button">CANCEL</button>
    </div>
    <div class="cmenu-note cmenu-roomnote">pvp applies when the next match starts · matchmaking is automatic — lobby words are for playing with specific people</div>
    <h2>Controls</h2>
    <div class="cmenu-rows"></div>
    <h2>Quality</h2>
    <div class="cmenu-seg cmenu-qual">
      <button type="button" data-q="0">LOW</button>
      <button type="button" data-q="1">MED</button>
      <button type="button" data-q="2">HIGH</button>
    </div>
    <h2>Audio</h2>
    <div class="cmenu-audio">
      <button class="cmenu-mute" type="button"></button>
      <input class="cmenu-vol" type="range" min="0" max="1" step="0.01" aria-label="Master volume">
    </div>
    <div class="cmenu-foot">
      <button class="cmenu-btn cmenu-exit" type="button">EXIT GAME</button>
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

  // Player tag (MD 10): persisted under arena1-tag; the transport listens for
  // the event and announces changes to the room. Never empty — a random
  // Player1–Player99 default fills it on first load and again if the field is
  // cleared. Focus selects everything, so typing replaces. Typing must not
  // leak into the game's global key handlers (WASD state, Escape-resume) —
  // stop keys at the input.
  const genDefaultTag = () => 'PLAYER' + (1 + ((Math.random() * 99) | 0));
  const tagInput = menu.querySelector('.cmenu-tag');
  const setTag = (v) => {
    tagInput.value = v;
    store.set('arena1-tag', v);
    window.dispatchEvent(new CustomEvent('arena1-tag', { detail: v }));
  };
  {
    const stored = store.get('arena1-tag');
    // legacy mixed-case values normalize on load: stored = wire = billboard
    if (stored && stored.trim()) setTag(stored.slice(0, 12).toUpperCase());
    else setTag(genDefaultTag());
  }
  tagInput.addEventListener('focus', () => tagInput.select());
  tagInput.addEventListener('input', () => {
    const caret = tagInput.selectionStart;
    const v = tagInput.value.toUpperCase().slice(0, 12);
    if (tagInput.value !== v) { tagInput.value = v; tagInput.setSelectionRange(caret, caret); }
    store.set('arena1-tag', v);
    window.dispatchEvent(new CustomEvent('arena1-tag', { detail: v }));
  });
  tagInput.addEventListener('blur', () => {
    if (!tagInput.value.trim()) setTag(genDefaultTag()); // never a nameless pill
  });
  // the join dedupe can reroll a default remotely (transport dispatches the
  // same event) — keep the field honest when that happens
  window.addEventListener('arena1-tag', (e) => {
    if (document.activeElement !== tagInput && tagInput.value !== e.detail) tagInput.value = e.detail;
  });
  tagInput.addEventListener('keydown', (e) => e.stopPropagation());
  tagInput.addEventListener('keyup', (e) => e.stopPropagation());

  // Lobby (MD 9, reworked MD 12): current ID + live player count, copy,
  // join-by-code, and the PUBLIC/PRIVATE toggle. main.js owns the transports;
  // this UI reads window.Arena1.room() and dispatches the join events.
  // Painted on a slow interval — cheap, and always fresh when the menu is
  // actually open.
  const roomId = menu.querySelector('.cmenu-roomid');
  const roomCount = menu.querySelector('.cmenu-roomcount');
  const copyBtn = menu.querySelector('.cmenu-copy');
  const joinInput = menu.querySelector('.cmenu-joincode');
  const joinBtn = menu.querySelector('.cmenu-join');
  const visBtns = [...menu.querySelectorAll('.cmenu-vis button')];
  const confirmBox = menu.querySelector('.cmenu-confirm');
  const confirmText = menu.querySelector('.cmenu-confirm-text');
  const confirmYes = menu.querySelector('.cmenu-confirm-yes');
  const confirmNo = menu.querySelector('.cmenu-confirm-no');
  let pendingVis = null;
  const hideConfirm = () => { pendingVis = null; confirmBox.hidden = true; };
  const paintRoom = () => {
    const r = window.Arena1?.room?.();
    if (!r) return;
    roomId.textContent = r.code
      ? r.code
      : (r.netState === 'connecting' ? 'CONNECTING…' : r.netState === 'offline' ? 'SOLO · OFFLINE' : 'SOLO');
    roomCount.textContent = r.code ? `${r.players}/${r.maxPlayers ?? 6} PLAYERS` : '';
    copyBtn.disabled = !r.code;
    // The seg reflects the lobby you are IN — a state readout, not a persisted
    // setting. Solo/connecting counts as public: that is where the next
    // auto-join lands.
    const isPublic = r.isPublic ?? true;
    visBtns.forEach((b) => b.classList.toggle('is-on', (b.dataset.vis === 'public') === isPublic));
    // A confirm left unanswered dies with the menu — resume-then-repause never
    // shows a stale question.
    if (menu.offsetParent === null) hideConfirm();
  };
  setInterval(paintRoom, 1000);
  paintRoom();
  copyBtn.addEventListener('click', () => {
    const r = window.Arena1?.room?.();
    if (!r?.code) return;
    try { navigator.clipboard?.writeText(r.code); } catch { /* clipboard denied */ }
    copyBtn.textContent = 'COPIED';
    setTimeout(() => { copyBtn.textContent = 'COPY'; }, 1200);
  });
  const doJoin = () => {
    const code = joinInput.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (!code) return;
    joinInput.value = '';
    window.dispatchEvent(new CustomEvent('arena1-join-room', { detail: code }));
    window.Arena1?.resume?.();
  };
  joinBtn.addEventListener('click', doJoin);
  joinInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') doJoin();
  });
  joinInput.addEventListener('keyup', (e) => e.stopPropagation());

  // PUBLIC/PRIVATE is an action with a state readout: clicking the other side
  // asks inline (never a browser confirm) before leaving the current lobby.
  // Cancel just hides the question — paintRoom keeps the seg on the real side.
  for (const b of visBtns) {
    b.addEventListener('click', () => {
      const r = window.Arena1?.room?.();
      const isPublic = r?.isPublic ?? true;
      const want = b.dataset.vis;
      if ((want === 'public') === isPublic) { hideConfirm(); return; }
      pendingVis = want;
      confirmText.textContent = want === 'private'
        ? "Start a new private lobby? You'll leave this one."
        : "Join a public lobby? You'll leave this one.";
      confirmBox.hidden = false;
    });
  }
  confirmYes.addEventListener('click', () => {
    const want = pendingVis;
    hideConfirm();
    if (!want) return;
    window.dispatchEvent(new CustomEvent(want === 'private' ? 'arena1-new-private' : 'arena1-go-public'));
    window.Arena1?.resume?.();
  });
  confirmNo.addEventListener('click', hideConfirm);

  const rows = menu.querySelector('.cmenu-rows');
  for (const [label, keyList, alt] of CONTROLS) {
    const row = document.createElement('div');
    row.className = 'cmenu-row';
    const keySpans = keyList.map((k) => `<kbd class="cmenu-key">${k}</kbd>`).join('');
    row.innerHTML = `<span>${label}</span><span class="cmenu-keys">${keySpans}${alt ? `<span class="cmenu-alt">${alt}</span>` : ''}</span>`;
    rows.appendChild(row);
  }

  // Quality: main owns the engine; hand the choice over by event + persist it.
  const qualBtns = [...menu.querySelectorAll('.cmenu-qual button')];
  const paintQual = () => {
    const q = store.get('arena1-quality') ?? '1';
    qualBtns.forEach((b) => b.classList.toggle('is-on', b.dataset.q === q));
  };
  for (const b of qualBtns) {
    b.addEventListener('click', () => {
      store.set('arena1-quality', b.dataset.q);
      window.dispatchEvent(new CustomEvent('arena1-quality', { detail: Number(b.dataset.q) }));
      paintQual();
    });
  }
  window.addEventListener('arena1-quality-sync', paintQual); // 1/2/3 keys mirror back
  paintQual();

  // PvP (moved into the lobby section, MD 10): a property of the match you
  // are in. Writes the flag the NEXT createSim reads (match start), never the
  // live sim — the "not mid-match" rule is structural; do not "improve" it
  // into something immediate. The note under the row spells out the timing.
  const pvpToggle = menu.querySelector('.cmenu-pvptoggle');
  const paintPvp = () => {
    const on = (store.get('arena1-pvp') ?? '1') === '1'; // PVP_DEFAULT: true
    pvpToggle.textContent = on ? 'PVP ON' : 'PVP OFF';
    pvpToggle.classList.toggle('is-on', on);
    pvpToggle.setAttribute('aria-pressed', String(on));
  };
  pvpToggle.addEventListener('click', () => {
    const on = (store.get('arena1-pvp') ?? '1') === '1';
    store.set('arena1-pvp', on ? '0' : '1');
    paintPvp();
  });
  paintPvp();

  const vol = menu.querySelector('.cmenu-vol');
  const mute = menu.querySelector('.cmenu-mute');
  // audio.js persists arena1-volume / arena1-muted itself; this UI only reads
  // and writes the live API. Muted shows the slider at 0 but the stored level
  // survives underneath, so unmuting restores it rather than resetting.
  const paint = () => {
    const m = isMuted();
    vol.value = m ? 0 : getVolume();
    mute.textContent = m ? 'MUTED' : 'MUTE';
    mute.classList.toggle('is-muted', m);
    mute.setAttribute('aria-pressed', String(m));
  };
  vol.addEventListener('input', () => {
    if (isMuted()) setMuted(false);         // touching the fader is intent to hear
    setVolume(parseFloat(vol.value));
    paint();
  });
  mute.addEventListener('click', () => { setMuted(!isMuted()); paint(); });
  paint();

  menu.querySelector('.cmenu-resume').addEventListener('click', () => {
    window.Arena1?.resume?.();
  });
  menu.querySelector('.cmenu-exit').addEventListener('click', () => {
    // Navigate the PARENT, not the iframe: the game runs framed by the
    // wrapper, and the site's frame-ancestors header (correctly) refuses to
    // load the site inside a frame. Same-origin, so window.top is reachable;
    // standalone window.top === window and nothing changes. (Stickland's
    // pattern, on record there since its extraction.)
    (window.top || window).location.href = '/';
  });
  // Clicking the dimmed area OUTSIDE the panel resumes — the same contract as
  // the site's dialogs (backdrop click closes). Clicks inside stay inside.
  host.addEventListener('click', (e) => {
    if (e.target === host) window.Arena1?.resume?.();
  });
}

build();
