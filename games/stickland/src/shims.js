// ══════════════════════════════════════════════════════
//  window._dex* bridge
// ══════════════════════════════════════════════════════
//  The game talks to its former host through ~60 window._dex* globals. Most
//  are internal — both ends live inside character.js / playmode.js — and are
//  left alone. These are the ones the notes app defined from the outside, so
//  standalone they need a definition here or the call sites throw.
//
//  Imported first in main.js, before character.js / playmode.js load.
//
//  Deleted rather than shimmed: window._dexOnSessionSwitchInPlayMode (only
//  the notes app's sessions.js ever consumed it) and
//  window._dexHathoraSendAppearance (dead — defined nowhere).

// Achievements lived in the notes app. 6 call sites; all fire-and-forget.
window._dexUnlockAch = () => {};

// Gates weapon unlockLevel. Called as a function — `window._dexUserLevel()` at
// character.js:1560 and :4927 — so it must be callable, not a bare number.
// 99 clears every unlockLevel in GUN_TYPES / INVENTORY_ITEMS.
window._dexUserLevel = () => 99;

window._dexAvatarEnabled = true;
// MD 10: blood defaults OFF — gore renders in the accent color and gore
// audio stays silent unless the player opts in via the ESC menu's FX tab.
// The pause menu overwrites this from the persisted sfg-fx setting at boot.
window._dexBloodEnabled = false;

// Notes-app chrome that no longer exists. Called unconditionally from
// enterPlayMode/exitPlayMode, so they must be callable no-ops.
window._dexUpdateRailSessionBtn = () => {};
window._dexRefreshPlayPopupRow = () => {};
