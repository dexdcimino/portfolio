// ══════════════════════════════════════════════════════
//  Build configuration
// ══════════════════════════════════════════════════════

// Multiplayer is fully wired but dark by default. Flip to true to enable
// Photon: every photon*() call in playmode.js is gated on this flag, so with
// it off the game makes zero network requests and #play-connection-hud
// never appears.
export const MULTIPLAYER = false;

// Photon room to join when MULTIPLAYER is true. The original derived this
// from the active notes session; standalone there is one shared world.
export const ROOM_ID = 'portfolio-freeplay';
