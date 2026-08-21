# ARENA 1 — Architecture

First-person movement arena: hex arena with a 570 m platform Ascent, hitscan +
rockets, AI enemies and five serpent tiers, up to 6 players over Photon. Built
as a **headless deterministic sim with a render layer over it**; solo play runs
the same host code with zero peers. Status: Phases 0–7 of `ARENA1_STEPS.md`
plus the MD series through 26 (shared audio mixer was MD 26).

## Layers — strictly one-directional, enforced by script

`js/sim/` + `js/core/` + `js/net/` know nothing about Babylon, `Math.random`,
or wall time — `tests/guards.mjs` greps for violations. Render may read
`transport.level` and `transport.world.raycast` (blob shadows), nothing else.

## Modules

- `js/config.js` — every tunable: `TUNE` (prototype verbatim), `SIM_DT=1/60`,
  `SNAPSHOT_RATE_NET=20`, `INTERP_BUFFER_MS=100`, `PVP_DEFAULT=true`
- `js/main.js` — boot, input→command, fixed-step accumulator, render loop,
  session lifecycle, net orchestration, HUD, leaderboard, embed hooks
- `js/pausemenu.js` — pause overlay (tag, accent, lobby row, audio, quality);
  binds no keys — main.js owns Escape. Its last section is the shared Reset All
  Player Progress control (`games/_shared/reset-progress.js`) — a section like
  Audio or Controls, above the pinned action row — shipped **disabled**:
  everything this game stores is a preference (`arena1-quality`, `arena1-pvp`,
  `arena1-tag`, `arena1-audio`, `dex-accent-name`), so there is no progress to
  destroy. A save key added to `keys` makes it live with no other change
- `js/core/` — `rng.js` (FNV-1a + mulberry32 `rngFor(seed,...salts)`),
  `events.js` (pub/sub), `pool.js`
- `js/sim/` — `vec.js`, `entities.js` (id alloc; serpents/bolts from a separate
  base-100000 counter so their count can't shift player spawns), `world.js`
  (capsule collision, raycast, step-up), `level.js` (hex arena + Ascent gen),
  `movement.js`, `combat.js`, `enemies.js`, `serpent.js`, `sim.js`
  (`createSim(seed, opts)` — the contract)
- `js/net/transport.js` — THE SEAM. Loopback = host-with-zero-peers
- `js/net/photon.js` — `createHostCore` (authoritative sim), `createClientCore`
  (no sim: 100 ms interp buffer + prediction/reconciliation, MD 8),
  `createPhotonTransport` (SDK glue). NOTE: the header comment "v1: no
  reconciliation" is stale — MD 8 shipped it
- `js/render/` — `scene.js`, `level.js`, `actors.js`, `fx.js`, `serpent.js`
  (rebuilds bodies locally from path params), `weapons.js`
- `js/systems/audio.js` — synth cues + `_shared/sample-player.js`; mix via
  `games/_shared/audio-panel.js` under localStorage key `arena1-audio`

## Data shapes that cross boundaries

- **Command** `{tick, playerId, move:{x,z}, yaw, pitch, buttons, weapon}` —
  `BTN` bitfield includes RESPAWN and PAUSED on purpose (client-side teleport
  or freeze would desync)
- **Snapshot** (`sim.js snapshot()`): players/enemies/cells/rockets/serpents/
  bolts/events; positions rounded 1e-6 in sim, 2 dp on the wire. Platforms are
  a pure function of tick and never travel; serpent segments are recomputed
  client-side from `path` params. Host adds `tag`, `accent`, `acks` on the wire
- **Transport interface** (both loopback and Photon): `ready, isHost, seed,
  localId, netInfo, prediction, addLocalPlayer(), sendCommand(cmd),
  onSnapshot(cb), tick(), tickCount, level, world, dispose()`
- Protocol events `EV = {WELCOME:11, COMMANDS:12, SNAPSHOT:13, TAG:14, ACCENT:15}`

## Call flow

Boot: wrapper `/arena1` iframes the game and focuses the frame → `main.js`
starts a **loopback session immediately**, then `netAttempt()` joins Photon in
parallel (dynamic import); on join the world swaps in place (deferred behind
the controls modal); on failure solo just keeps playing. Host leaving ends the
match — no host migration, no lag compensation (deliberate).

Per tick: one accumulator (`pump()`) drains 60 Hz fixed steps —
`sendCommand(buildCommand(tick))` then `transport.tick()`. A Blob-Worker
heartbeat keeps pumping when the tab is hidden (Chrome suspends rAF; this froze
a host's match on alt-tab). Render interpolates prev/last snapshot by
`acc/SIM_DT`; camera yaw/pitch never route through snapshots.

## Numbers a session will ask for

- 60 Hz sim, 20 Hz snapshots (`TICKS_PER_NET=3`), 100 ms interp,
  `PREDICT_EPS` 0.05 m, `MAX_PLAYERS` 6
- Hex arena `HEX_R=100` (200 m across corners), rim walls 12 m,
  `SUMMIT_Y=570`, kill floor −25, spawn (0,4,26)±2 seeded
- Zap: 0.11 s cd, 12 dmg; rocket: speed 40, splash 11 m, cubic falloff,
  self-knockback 88 (never pvp-gated — rocket jumps work in co-op)
- Fuel 100 (+20/cell, cap 280), jet burn 26/s (~3.85 s), air regen after 2 s
- Serpents: 5 tiers (t1–giant), tail-pop hp 5–8, closed-form flight path
- Photon: `APP_ID` in `photon.js` (shared with Stickland), AppVersion
  `arena1-v1` + raw `?photonver=` suffix. **Harness/test windows must pass
  `?photonver=-m12fixed`** — random suffixes exhaust the AppVersion quota

## Tests

12 plain-Node scripts in `tests/` (`node tests/x.mjs`, no runner, ~270
assertions): guards, determinism (600-tick byte-identical), world, movement,
stepup, combat, net (protocol over an in-memory pipe with injected clock),
prediction, md16, md24, md25, serpent. `opts.enemies=false` is a test hook.

## Invariants

- All sim randomness is `rngFor(seed, ...salts)`; all sim time is `tick`
- Solo must never bypass the transport seam
- Renderer keys mesh pools by entity id, never creation order
- `sim.step()` takes a Map (an array once silently dropped every command)

## Known-outstanding

Balance is "v1, on record" (`combat.js:18`). Out of scope on purpose: host
migration, lag comp, spectators, more guns, mobile input. Two-word lobby IDs
noted but "do not build now".

## The site cursor

The page installs the site’s accent cursor set last (`games/_shared/cursor-boot.js` → `cursor.js`): arrow, pointing hand and I-beam as accent data URIs, following the shared `dex-cursor` toggle and accent live over the storage event. The crosshair lock (`#game { cursor:none }`) is an explicit rule and always outranks it — the in-game cursor is a game state, not site chrome.
