// net/photon.js — the Photon Realtime transport (ARENA1_STEPS Phase 7),
// implementing the SAME surface as loopback: addLocalPlayer / sendCommand /
// onSnapshot / tick / tickCount / level / world, plus `ready` and `localId`.
//
//   host   — first actor in the room (Photon master). Runs the authoritative
//            sim exactly like loopback, consumes remote command batches, and
//            broadcasts snapshots at SNAPSHOT_RATE_NET (20Hz) with the events
//            of the whole 3-tick window aggregated so none are lost.
//   client — no sim. Sends commands at 60Hz batched per network tick, keeps
//            an INTERP_BUFFER_MS (100ms) snapshot buffer, renders remote
//            entities interpolated from the buffer, and renders the LOCAL
//            player from the freshest snapshot (immediate prediction-free
//            local echo — v1: no reconciliation, the input delay on non-host
//            is accepted per the briefing's stated ceiling).
//
// Join flow: room name only — first in creates, master is host, no lobby, no
// matchmaking, no lag comp. Host leaving ENDS the match (no migration): the
// client is told rather than left hanging. Loopback remains the solo path;
// the switch is the ?room= boot flag in main.js.
//
// Structure: createHostCore / createClientCore are pure protocol machines
// with an injected `net` adapter and clock — tests/net.mjs drives both over
// an in-memory pipe. createPhotonTransport is the thin SDK glue (vendored
// photon-realtime-module.js, same AppId Stickland ships on).

import { createSim, FLAG } from '../sim/sim.js';
import { createWorld } from '../sim/world.js';
import { buildLevel, tickPlatforms } from '../sim/level.js';
import { rngFor } from '../core/rng.js';
import { PVP_DEFAULT, SNAPSHOT_RATE_NET, INTERP_BUFFER_MS, SIM_DT } from '../config.js';

// Reconciliation threshold (MD 8): below this the difference is ignored
// entirely — no nudging, partial corrections accumulate error. Above it the
// local state snaps to authority and replays. Wire rounding is 1cm, so
// agreement lands well under this when the sims truly agree.
const PREDICT_EPS = 0.05;
const HIST_CAP = 300; // ~5s of unacked commands; beyond that something is wrong

const APP_ID = 'ff6d154a-33f9-480a-bb99-eeccfde3b012'; // the site's Photon app (Stickland's)
const APP_VERSION = 'arena1-v1'; // partitions arena traffic from Stickland's
const MAX_PLAYERS = 8;

export const EV = { WELCOME: 11, COMMANDS: 12, SNAPSHOT: 13 };
export const TICKS_PER_NET = Math.max(1, Math.round(1 / (SNAPSHOT_RATE_NET * SIM_DT))); // 3
const CMD_QUEUE_CAP = 12; // ≈200ms of backlog; beyond that old inputs are stale, drop them

// Wire trim: 1e-6 rounding is for determinism hashing, not for the network —
// 2 decimals (1cm) is plenty for remote rendering and halves the payload.
const w2 = (v) => Math.round(v * 100) / 100;
const roundVec = (v) => ({ x: w2(v.x), y: w2(v.y), z: w2(v.z) });
function roundWire(snap) {
  return {
    ...snap,
    players: snap.players.map((p) => ({
      ...p, pos: roundVec(p.pos), vel: roundVec(p.vel),
      yaw: w2(p.yaw), pitch: w2(p.pitch), fuel: w2(p.fuel), hp: w2(p.hp),
      grapple: p.grapple ? roundVec(p.grapple) : null,
    })),
    enemies: snap.enemies.map((e) => ({ ...e, pos: roundVec(e.pos) })),
    cells: snap.cells.map((c) => ({ ...c, pos: roundVec(c.pos) })),
  };
}

// ── host ────────────────────────────────────────────────────────────────────
// net adapter: { myActorNr(), send(code,data), onEvent(cb), onActorJoin(cb),
//               onActorLeave(cb) } — send goes to the other actors in the room.
// opts.enemies passes through to the sim — tests isolate the prediction
// machinery on an interference-free host (enemy knockback is authoritative
// physics the client can't predict; it corrects by design, which is exactly
// what the isolation tests must NOT count as a determinism leak).
export function createHostCore(seed, { pvp = PVP_DEFAULT, enemies = true } = {}, net) {
  const sim = createSim(seed, { pvp, enemies });
  const localId = sim.addPlayer();
  const actorToPlayer = new Map(); // actorNr → playerId
  const queues = new Map();        // playerId → { q: [], last: cmd|null }
  const acks = new Map();          // playerId → highest command tick CONSUMED (MD 8)
  const subscribers = [];
  let pendingLocal = null;
  let eventAcc = [];

  const welcome = () => net.send(EV.WELCOME, {
    seed, pvp, players: Object.fromEntries(actorToPlayer),
  });
  net.onActorJoin((actorNr) => {
    if (actorNr === net.myActorNr() || actorToPlayer.has(actorNr)) return;
    const id = sim.addPlayer();
    actorToPlayer.set(actorNr, id);
    queues.set(id, { q: [], last: null });
    welcome();
  });
  net.onActorLeave((actorNr) => {
    const id = actorToPlayer.get(actorNr);
    if (id == null) return;
    actorToPlayer.delete(actorNr);
    queues.delete(id);
    sim.removePlayer(id);
  });
  net.onEvent((code, data, actorNr) => {
    if (code !== EV.COMMANDS) return;
    const id = actorToPlayer.get(actorNr);
    if (id == null || data.playerId !== id) return; // never accept commands for someone else
    const st = queues.get(id);
    for (const c of data.cmds) st.q.push(c);
    if (st.q.length > CMD_QUEUE_CAP) st.q.splice(0, st.q.length - CMD_QUEUE_CAP);
  });

  return {
    ready: Promise.resolve(),
    isHost: true,
    get localId() { return localId; },
    addLocalPlayer() { return localId; },
    sendCommand(cmd) { pendingLocal = cmd; },
    onSnapshot(cb) { subscribers.push(cb); },
    tick() {
      const cmds = new Map();
      if (pendingLocal) { cmds.set(localId, pendingLocal); pendingLocal = null; }
      for (const [id, st] of queues) {
        // dry queue: hold the last known inputs — a jittery peer keeps moving
        // rather than stuttering to idle between batches. The ack only ever
        // advances on REAL consumption: a held repeat was already acked, and
        // acking it again would tell the client a command it never sent ran.
        const fromQueue = st.q.shift();
        if (fromQueue) { st.last = fromQueue; acks.set(id, fromQueue.tick); }
        const cmd = fromQueue ?? st.last;
        if (cmd) cmds.set(id, cmd);
      }
      sim.step(cmds);
      const snap = sim.snapshot();
      eventAcc.push(...snap.events);
      if (snap.tick % TICKS_PER_NET === 0) {
        net.send(EV.SNAPSHOT, {
          ...roundWire({ ...snap, events: eventAcc }),
          acks: Object.fromEntries(acks), // per-client highest consumed cmd tick
        });
        eventAcc = [];
      }
      for (const cb of subscribers) cb(snap); // host renders its own sim per tick
      return snap;
    },
    get tickCount() { return sim.tick; },
    get level() { return sim.level; },
    get world() { return sim.world; },
    get playerCount() { return actorToPlayer.size + 1; },
  };
}

// ── client ──────────────────────────────────────────────────────────────────
// hooks: { onEnded } — the host left; the match is over, not hung.
// opts.now: injectable clock (tests); defaults to performance.now.
export function createClientCore(net, hooks = {}, opts = {}) {
  const now = opts.now || (() => performance.now());
  let welcomed = false;
  let seed = null, pvp = PVP_DEFAULT, localId = null;
  let world = null, level = null;
  let readyResolve;
  const ready = new Promise((res) => { readyResolve = res; });
  const buffer = [];        // { at, snap } — raw 20Hz wire snapshots
  let pendingEvents = [];
  const subscribers = [];
  let batch = [];
  let localTick = 0;
  let platformTick = 0;
  const hostActor = net.masterActorNr();

  // ── prediction + reconciliation (MD 8) ─────────────────────────────────
  // A local predictOnly sim mirrors this client's player through the
  // UNMODIFIED movement port; every sent command steps it the same frame.
  // Snapshots carry per-client acks; on each ack the predicted state at that
  // command is compared against authority — under PREDICT_EPS the difference
  // is ignored, over it the state snaps to authority (command-derived
  // internals kept from local history) and the unacked tail replays.
  // Authority never moves: the client sends commands and accepts corrections.
  let predictSim = null;
  let predictReady = false;
  let everSent = false;   // no input yet → track authority, don't predict
  const pendingHist = []; // { cmd, simTickAfter, stateAfter (deep clone) }
  let corrections = 0, maxCorrection = 0;

  // Fields the client can never predict (damage, pickups, kill credit) are
  // adopted from authority; position/velocity are what corrections govern.
  function applyAuth(p, authMe) {
    p.pos = { ...authMe.pos };
    p.vel = { ...authMe.vel };
    p.hp = authMe.hp;
    p.fuel = authMe.fuel; p.fuelMax = authMe.fuelMax;
    p.dashCharges = authMe.dashCharges;
    p.deaths = authMe.deaths; p.kills = authMe.kills;
    p.cellsGot = authMe.cellsGot; p.summitDone = authMe.summitDone;
    p.grounded = !!(authMe.flags & FLAG.GROUNDED);
    if (!authMe.grapple) p.grapple = null; // host released (e.g. death) — let go
  }

  function initPredict(authMe, hostTick) {
    predictSim = createSim(seed, { predictOnly: true });
    predictSim.addPlayer(localId); // host's id: same seeded spawn, same key
    const p = predictSim.getPlayer(localId);
    applyAuth(p, authMe);
    p.yaw = authMe.yaw; p.pitch = authMe.pitch;
    predictSim.setTick(hostTick); // host tick domain: platform state aligns
    predictReady = true;
  }

  function onAck(data) {
    const ack = data.acks ? data.acks[localId] : undefined;
    const authMe = data.players.find((q) => q.id === localId);
    if (ack == null || !authMe) return;
    const idx = pendingHist.findIndex((h) => h.cmd.tick === ack);
    if (idx < 0) { // ack for a command outside history (stale or dropped run)
      while (pendingHist.length && pendingHist[0].cmd.tick <= ack) pendingHist.shift();
      return;
    }
    const h = pendingHist[idx];
    const d = Math.hypot(
      h.stateAfter.pos.x - authMe.pos.x,
      h.stateAfter.pos.y - authMe.pos.y,
      h.stateAfter.pos.z - authMe.pos.z);
    if (d > PREDICT_EPS) {
      corrections++;
      if (d > maxCorrection) maxCorrection = d;
      // Snap: authoritative pos/vel/scalars + command-derived internals
      // (dash timers, buffers, grapple mode) from the local history — those
      // came from the same command stream and are not on the wire.
      const restored = structuredClone(h.stateAfter);
      applyAuth(restored, authMe);
      predictSim.setPlayer(localId, restored);
      predictSim.setTick(h.simTickAfter);
      for (let i = idx + 1; i < pendingHist.length; i++) { // replay the tail
        const e = pendingHist[i];
        predictSim.step(new Map([[localId, e.cmd]]));
        e.simTickAfter = predictSim.tick;
        e.stateAfter = structuredClone(predictSim.getPlayer(localId));
      }
    } else {
      // Below threshold: ignore the positional difference entirely (no
      // nudging), but still adopt the unpredictable scalars.
      const p = predictSim.getPlayer(localId);
      p.hp = authMe.hp;
      if (p.fuelMax !== authMe.fuelMax) { p.fuelMax = authMe.fuelMax; p.fuel = authMe.fuel; }
      p.deaths = authMe.deaths; p.kills = authMe.kills;
      p.cellsGot = authMe.cellsGot; p.summitDone = authMe.summitDone;
    }
    pendingHist.splice(0, idx + 1);
  }

  net.onActorLeave((actorNr) => {
    if (actorNr === hostActor) hooks.onEnded?.(); // no migration in v1
  });
  net.onEvent((code, data, actorNr) => {
    if (code === EV.WELCOME && actorNr === hostActor && !welcomed) {
      const mine = data.players[net.myActorNr()];
      if (mine == null) return; // roster broadcast for someone else's join
      seed = data.seed; pvp = data.pvp; localId = mine;
      world = createWorld();
      level = buildLevel(world, rngFor(seed, 'level'));
      welcomed = true;
      readyResolve();
    } else if (code === EV.SNAPSHOT && actorNr === hostActor && welcomed) {
      buffer.push({ at: now(), snap: data });
      const cutoff = now() - 2000;
      while (buffer.length > 2 && buffer[0].at < cutoff) buffer.shift();
      pendingEvents.push(...data.events);
      // Prediction bootstraps from the first authoritative sight of self —
      // and until the FIRST input exists it keeps re-snapping to the newest
      // authority (there is nothing predicted to preserve, and the host keeps
      // idle-stepping this player through spawn-fall/settle; freezing at the
      // bootstrap state would make the first ack read as a phantom
      // correction). From the first command on, prediction owns the state.
      const meAuth = data.players.find((q) => q.id === localId);
      if (!predictReady) {
        if (meAuth) initPredict(meAuth, data.tick);
      } else if (!everSent) {
        if (meAuth) {
          const p = predictSim.getPlayer(localId);
          applyAuth(p, meAuth);
          p.yaw = meAuth.yaw; p.pitch = meAuth.pitch;
          predictSim.setTick(data.tick);
        }
      } else {
        onAck(data);
      }
      // Collapser triggers replay locally so platform visuals track the host
      // (movers/blinkers are pure tick functions and need no wire at all).
      for (const ev of data.events) {
        if (ev.type !== 'platform_trigger') continue;
        const pl = level.platforms[ev.platformId];
        if (pl && pl.state === 'idle') {
          pl.state = 'shaking';
          pl.timerTicks = Math.max(1, Math.round(0.8 / SIM_DT) - (data.tick - ev.tick));
        }
      }
    }
  });

  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpVec = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
  function interpList(la, lb, t) {
    const byId = new Map(la.map((e) => [e.id, e]));
    return lb.map((e) => {
      const p = byId.get(e.id);
      return p ? { ...e, pos: lerpVec(p.pos, e.pos, t), vel: e.vel && p.vel ? lerpVec(p.vel, e.vel, t) : e.vel } : e;
    });
  }

  function emitSynth() {
    if (!welcomed || !buffer.length) return;
    const target = now() - INTERP_BUFFER_MS;
    let a = buffer[0], b = buffer[0];
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i].at <= target) { a = buffer[i]; b = buffer[Math.min(i + 1, buffer.length - 1)]; }
    }
    if (target > buffer[buffer.length - 1].at) a = b = buffer[buffer.length - 1]; // stall: hold newest
    const t = a === b ? 0 : Math.min(1, Math.max(0, (target - a.at) / (b.at - a.at)));
    const synth = {
      ...b.snap,
      tick: Math.floor(lerp(a.snap.tick, b.snap.tick, t)),
      players: interpList(a.snap.players, b.snap.players, t),
      enemies: interpList(a.snap.enemies, b.snap.enemies, t),
      cells: interpList(a.snap.cells, b.snap.cells, t),
      events: pendingEvents.splice(0),
    };
    // Local player entry: PREDICTED state (MD 8) — pos/vel/flags/grapple
    // respond the same frame input happens — with the scalars the client
    // never predicts (hp, kills, pickups) taken from the freshest authority.
    // Until prediction bootstraps, fall back to the pre-MD-8 local echo.
    const newest = buffer[buffer.length - 1].snap;
    const meNow = newest.players.find((p) => p.id === localId);
    const meEntry = (() => {
      if (!predictReady) return meNow;
      const pe = predictSim.snapshot().players.find((q) => q.id === localId);
      if (!pe) return meNow;
      return meNow ? {
        ...pe,
        hp: meNow.hp, deaths: meNow.deaths, kills: meNow.kills,
        cellsGot: meNow.cellsGot, summitDone: meNow.summitDone,
        fuelMax: meNow.fuelMax,
      } : pe;
    })();
    if (meEntry) {
      const i = synth.players.findIndex((p) => p.id === localId);
      if (i >= 0) synth.players[i] = meEntry; else synth.players.push(meEntry);
    }
    // Advance local platform state to the emitted tick (visuals only; the
    // authoritative platforms live in the host's sim).
    while (platformTick < synth.tick) tickPlatforms(world, level, platformTick++, null, []);
    for (const cb of subscribers) cb(synth);
  }

  return {
    ready,
    isHost: false,
    get localId() { return localId; },
    addLocalPlayer() { return localId; }, // identity arrives with the welcome
    sendCommand(cmd) {
      // Nothing is sent or predicted until prediction has bootstrapped from
      // authority — commands the host would misalign against idle ticks.
      if (!predictReady) return;
      everSent = true;
      const stamped = { ...cmd, playerId: localId, tick: predictSim.tick };
      batch.push(stamped);
      // Predict NOW: the local sim steps this command the same frame it was
      // issued — the whole point of MD 8.
      predictSim.step(new Map([[localId, stamped]]));
      pendingHist.push({
        cmd: stamped,
        simTickAfter: predictSim.tick,
        stateAfter: structuredClone(predictSim.getPlayer(localId)),
      });
      if (pendingHist.length > HIST_CAP) pendingHist.shift();
    },
    onSnapshot(cb) { subscribers.push(cb); },
    tick() {
      localTick++;
      if (batch.length >= TICKS_PER_NET) net.send(EV.COMMANDS, { playerId: localId, cmds: batch.splice(0) });
      emitSynth();
    },
    get tickCount() { return localTick; },
    get level() { return level; },
    get world() { return world; },
    get playerCount() { return buffer.length ? buffer[buffer.length - 1].snap.players.length : 0; },
    // Correction telemetry (MD 8): frequent corrections mean a determinism
    // leak, not a tuning problem. unacked = pendingHist depth (replay cost).
    get prediction() {
      return predictReady
        ? { corrections, maxCorrection, unacked: pendingHist.length }
        : null;
    },
  };
}

// ── SDK glue ────────────────────────────────────────────────────────────────
// Loads the vendored SDK on demand (script element, same-origin — CSP-clean),
// joins the room, and hands the resulting adapter to the right core.
function loadSdk() {
  if (window.Photon) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/photon-realtime-module.js';
    s.onload = res;
    s.onerror = () => rej(new Error('Photon SDK failed to load'));
    document.head.appendChild(s);
  });
}

export function createPhotonTransport({ room, seedWanted = 1, pvp = PVP_DEFAULT, onEnded, onStatus } = {}) {
  let core = null;
  const pendingSubs = [];
  let coreResolve;
  const coreReady = new Promise((res) => { coreResolve = res; });
  const status = (msg) => onStatus?.(msg);

  (async () => {
    await loadSdk();
    const P = window.Photon;
    const client = new P.LoadBalancing.LoadBalancingClient(P.ConnectionProtocol.Wss, APP_ID, APP_VERSION);
    const eventCbs = [], joinCbs = [], leaveCbs = [];
    const adapter = {
      myActorNr: () => client.myActor().actorNr,
      masterActorNr: () => client.myRoomMasterActorNr(),
      send: (code, data) => client.raiseEvent(code, data),
      onEvent: (cb) => eventCbs.push(cb),
      onActorJoin: (cb) => joinCbs.push(cb),
      onActorLeave: (cb) => leaveCbs.push(cb),
    };
    client.onEvent = (code, content, actorNr) => { for (const cb of eventCbs) cb(code, content, actorNr); };
    client.onActorJoin = (actor) => { for (const cb of joinCbs) cb(actor.actorNr); };
    client.onActorLeave = (actor) => { for (const cb of leaveCbs) cb(actor.actorNr); };
    client.onStateChange = (state) => {
      const name = P.LoadBalancing.LoadBalancingClient.StateToName(state);
      if (name === 'JoinedLobby') { status(`joining ${room}…`); client.joinRoom(room); }
      if (name === 'Joined' && !core) {
        const isHost = client.myRoomMasterActorNr() === client.myActor().actorNr;
        core = isHost
          ? createHostCore(seedWanted, { pvp }, adapter)
          : createClientCore(adapter, { onEnded });
        for (const cb of pendingSubs) core.onSnapshot(cb);
        status(isHost ? `hosting ${room}` : `joined ${room}`);
        core.ready.then(coreResolve);
      }
      if (name === 'Error' || name === 'Disconnected') {
        if (core && !core.isHost) onEnded?.(); // connection died mid-match
        status('offline');
      }
    };
    client.onOperationResponse = (errorCode, errorMsg, operationCode) => {
      if (operationCode === 226 && errorCode) {
        // room does not exist yet — first one in creates it and hosts
        client.createRoom(room, { maxPlayers: MAX_PLAYERS });
      }
    };
    status('connecting…');
    client.connectToRegionMaster('us');
  })();

  // The facade delegates to whichever core the join produced. `ready` gates
  // main.js, so nothing touches level/world/localId before they exist.
  return {
    ready: coreReady,
    get isHost() { return core ? core.isHost : false; },
    get localId() { return core?.localId ?? null; },
    addLocalPlayer() { return core?.addLocalPlayer() ?? null; },
    sendCommand(cmd) { core?.sendCommand(cmd); },
    onSnapshot(cb) { if (core) core.onSnapshot(cb); else pendingSubs.push(cb); },
    tick() { core?.tick(); },
    get tickCount() { return core?.tickCount ?? 0; },
    get level() { return core?.level ?? null; },
    get world() { return core?.world ?? null; },
    get netInfo() { return core ? { room, isHost: core.isHost, players: core.playerCount } : { room, isHost: false, players: 0 }; },
    get prediction() { return core?.prediction ?? null; },
  };
}
