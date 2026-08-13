// ══════════════════════════════════════════════════════
//  Entry point
// ══════════════════════════════════════════════════════
//  The original launched play mode from a button in the notes app's sessions
//  popup. Standalone we boot straight into the world.

import './shims.js';
import './chat-picker.js';   // defines the window._dex* chat picker bridges
import './audio.js';         // installs its own unlock listeners; never throws
import './platformer.js';    // platformer world (MD 06); self-activates when play mode is off
import { startAccentWatch } from './accent.js';
import { initCharacter, mountCosmeticsButton } from './character.js';
import { initPlayMode, enterPlayMode } from './playmode.js';

// Publish the host page's --accent into the vars the game reads, and keep
// them in sync. Must run before anything paints.
startAccentWatch();

initCharacter();
initPlayMode();

// One frame of breathing room so character.js can build #char-overlay and
// playmode.js can size its canvases before the world fades in.
//
// rAF alone can starve here: an occluded window or backgrounded tab during
// load never produces a frame, and the game would simply not start (MD 00
// hit exactly this under headless verification). The timeout is the
// fallback path; the guard keeps enterPlayMode() from ever running twice.
let _booted = false;
function _boot() {
  if (_booted) return;
  _booted = true;
  enterPlayMode();
  // The button stack is built during the enter transition; this waits for it.
  mountCosmeticsButton();
}
requestAnimationFrame(_boot);
setTimeout(_boot, 300);
