// One vehicle, three physics models. Switching forms preserves momentum, so
// hitting 2 as you skim onto a lake converts a bad rover into a fast boat and
// hitting 3 off a ridge converts speed into altitude.
//
// Two things live here that aren't strictly physics, because they're driven by
// it and nothing else should own them: the hop (crouch, extend, air, land, with
// the wheels trailing the body on the way through), and flooding — a rover in
// deep water fills up, goes under, and gets fished out.

import { frameQuat } from '../world/surface.js';
import { iceHolds, iceRide } from '../world/water.js';
import { bodies, advance, steer, pickTarget, centreOf } from '../world/hyper.js';
import { TransitFrame, landingYaw } from '../world/gravity.js';
import { ROVER, BOAT, JET, DRONE, FUEL, WORLD, HOP, WHEEL, SUSP, HYPER,
         AIR, PARACHUTE, SKID } from '../tune.js';
import { emit } from '../core/events.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

const WTMP = { x: 0, y: 0, z: 0 };
let FQ = null;

export class Craft {
  constructor(forms, surface) {
    this.forms = forms;                 // { rover, boat, jet }
    // The world, seen through a local tangent frame whose +Y is the local up.
    // Every (x, z) below is an offset in that frame, in metres, and y is height
    // above sea level — which is why none of the physics needed rewriting.
    this.surf = surface;
    this.world = new BABYLON.Vector3(0, 0, 0);   // planet-centred position
    this.mode = 'rover';
    this.pos = new BABYLON.Vector3(0, 0, 0);
    this.vel = new BABYLON.Vector3(0, 0, 0);
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.speed = 0;
    this.speedScalar = 0;
    this.fuel = FUEL.start;
    this.boostHeat = 0;
    this.grounded = true;
    this.onWater = false;
    this.onIce = false;        // Vault only: driving on frozen water
    this.hyper = null;         // between worlds: system-space transit state
    /* ...and the basis it is drawn in out there. Its up is the summed gravity
       field's, so it is the destination's local up by the time the craft
       arrives and the departure world's on the frame it left — one object,
       following one field, rather than a special case at each end. */
    this.transit = new TransitFrame();
    this.economy = null;       // set by main.js; the trip check reads it
    this.hyperT = 0;           // 0..1, how fast that is. Every FX reads this
    this.bodies = null;        // the system, resolved once on the way out
    this.glide = false;
    this.droneLift = 0;    // metres of held climb above the drone's hover line
    this.time = 0;
    this.wheelSpin = 0;
    this.shake = 0;
    this.flightTime = 0;
    this.topSpeed = 0;

    // hop / suspension
    this.airborne = false;
    this.hopVel = 0;
    this.fallVel = 0;      // settling onto ground that dropped away
    this.hopCool = 0;
    this.charging = false;   // winding up a jump
    this.charge = 0;         // seconds held
    this.releaseQueued = false;
    this.chargeShot = 0;     // charge fraction of the last launch
    this.airTime = 0;
    this.sinceLand = 9;
    this.chain = 0;
    this.chainBoost = 1;   // speed cap multiplier earned by chaining hops
    this.bodyY = 0;
    this.wheelY = 0;
    this.bodyKick = 0;
    this.jiggle = 0;
    this.jetLift = 0;
    this.assist = 0;       // seconds of autopilot left
    this.assistGround = 0; // smoothed ground line the autopilot follows
    this.nearGround = 0;   // 0..1 ground-proximity warning
    this.wheelGround = new Float64Array(6);  // ground under each contact patch
    this.wheelLoad = 0;    // mean strut travel, for dust and audio
    this.lastImpact = 0;

    // boat
    this.planing = false;
    this.planeMix = 0;     // damped 0..1, for drag, trim and audio
    this.surge = 0;        // seconds of boost surge left
    this.boostWas = false;
    this.lastSurf = undefined;

    // water
    this.swamp = 0;        // 0 dry, 1 hull full
    this.sinkY = 0;        // metres below the ride line
    this.floodTime = 0;    // seconds fully swamped
    this.wasWet = false;
    this.drowns = 0;

    // impacts as skids, and the canopy
    this.wadeCarry = 0;    // m/s of overspeed still being carried into water
    this.wadeCarry0 = 0;   // ...what it was at entry, so the ramp has a scale
    this.beachCarry = 0;   // the same, for a hull running up a beach
    this.beachCarry0 = 0;
    this.wasBeached = false;
    this.skid = 0;         // 0..1, how much of the current skid is left
    this.skidKind = null;  // 'water' | 'beach' | null — which sound it is
    this.chute = 0;        // 0..1, how open the canopy is
    this.chuteOut = false; // ...and whether it is meant to be

    // Drop in on solid ground. The frame was already anchored there by the
    // caller, so the craft starts at its own origin.
    this.pos.set(0, this.surf.surfaceHeight(0, 0) + ROVER.rideHeight, 0);
    this.setMode('rover', true);
    this.applyTransform();
  }

  get groundHeight() { return this.surf.surfaceHeight(this.pos.x, this.pos.z); }
  get altitude() { return this.pos.y - Math.max(this.groundHeight, WORLD.waterY); }
  /**
   * 0..1, how far gone you are. Depth or time, whichever is further along —
   * on a shallow bed the hull stops descending but you're still drowning.
   */
  get submersion() {
    return clamp(Math.max(
      this.sinkY / Math.max(0.5, ROVER.drownDepth),
      this.floodTime / Math.max(0.5, ROVER.drownTime)), 0, 1);
  }

  setMode(mode, silent) {
    if (mode === this.mode && !silent) return;
    if (mode === 'jet' && this.fuel < JET.minFuelToLaunch) {
      emit('denied', { reason: 'fuel' });
      return;
    }
    if (mode === 'drone' && this.fuel < DRONE.minFuelToLaunch) {
      emit('denied', { reason: 'fuel' });
      return;
    }
    const prev = this.mode;
    this.mode = mode;
    for (const key of ['rover', 'boat', 'jet', 'drone']) {
      if (this.forms[key]) this.forms[key].root.setEnabled(key === mode);
    }

    /* MID-AIR TRANSFORM — every transform, not just the jet's.
       Dropping out of the jet with air underneath you used to zero the vertical
       state and set the rover down flat on the next frame, so altitude was
       something you could only spend by landing. That got fixed, but it got
       fixed by testing `prev === 'jet'`, which quietly made the rule a property
       of the form you were LEAVING rather than a property of there being air
       under you. So jet -> rover and jet -> boat carried, and boat -> rover and
       rover -> boat went on snapping to the deck from any height.
       The test is now the only thing this was ever about: is there air under
       you. All six transitions preserve position and all three velocity
       components, in every direction, from any form to any form.
       VERTICAL VELOCITY LIVES IN A DIFFERENT FIELD PER FORM, which is what made
       it possible to drop on the floor twice. The jet integrates `vel.y`; the
       rover and the boat both integrate `hopVel`. Reading the wrong one yields
       a silent zero rather than an error, so the source is picked explicitly
       here and written to BOTH channels below.
       Nothing gates this but the air — no fuel check, no cooldown, no lockout.
       Transforming back to the jet before you land has to stay open, because
       that is what turns a fall into something you can fly out of, and it is
       the reason altitude is worth spending at all. */
    const floorNow = Math.max(this.groundHeight,
      this.surf.planet.hasWater ? WORLD.waterY : -Infinity);
    /* The jet is always flying; the rover and the boat carry their own flag for
       it. Asking the flag rather than the height alone is what keeps a hull
       floating on a swell or a rover sitting on its 0.55m ride height from ever
       reading as airborne, and the clearance test on top of it is what keeps a
       touchdown from doing so — the jet's own landing sets you at floor + 1.3
       and then calls setMode, which would otherwise leave you falling on the
       ground you had just arrived on. */
    // The jet and the drone are always flying; the ground forms carry a flag.
    const inAir = prev === 'jet' || prev === 'drone' || this.airborne;
    const dropping = !silent && inAir &&
      this.pos.y - floorNow > AIR.minClearance;
    const carryH = dropping ? Math.hypot(this.vel.x, this.vel.z) : 0;
    // The jet AND the drone keep their vertical speed in vel.y; the ground
    // forms keep theirs in hopVel. Reading the wrong channel is a silent zero.
    const carryV = dropping
      ? ((prev === 'jet' || prev === 'drone') ? this.vel.y : this.hopVel) : 0;
    // A transform is also a bilge pump and a reset of anything mid-air. If you
    // were under, you come up with it — otherwise a jet launched from the
    // bottom of a lake touches down before its first frame is over.
    if (this.sinkY > 0.05) this.pos.y = Math.max(this.pos.y, WORLD.waterY + 0.9);
    this.sinkY = 0;
    this.floodTime = 0;
    this.swamp = 0;
    this.airborne = dropping;
    this.hopVel = carryV;
    this.fallVel = 0;
    this.airTime = 0;
    this.charging = false;
    this.charge = 0;
    this.releaseQueued = false;
    this.bodyKick = 0;
    this.planing = false;
    this.planeMix = 0;
    this.surge = 0;
    this.lastSurf = undefined;
    this.chainBoost = 1;
    this.chain = 0;
    this.wadeCarry = 0;
    this.beachCarry = 0;
    this.wasBeached = false;
    this.skid = 0;
    this.skidKind = null;
    /* The canopy is cut by ANY transform, which is what makes switching back to
       the jet an escape hatch rather than a negotiation: there is no collapse
       animation to sit through and no state that can outlive the form. */
    this.chuteOut = false;
    this.chute = 0;

    if (mode === 'jet') {
      this.glide = false;
      this.jetLift = 0;
      this.assistGround = 0;
      if (dropping) {
        /* MOMENTUM TRANSFERS WHOLE, AND THE JET GETS NO EXCEPTION — but the jet
           has no vertical velocity to hand it to. updateJet REBUILDS vel from
           scratch every frame out of speedScalar along a heading made of yaw
           and pitch, so a vel.y written here is overwritten before it moves you
           a single metre. That is why the old launch impulse looked like it was
           doing something: what actually cancelled the fall was `pitch = -0.42`
           putting the nose up, and the free +26 was never the mechanism.
           Preserving the fall therefore means restating it in the jet's own
           currency. The speed is the whole 3D speed you were carrying, and the
           pitch is the angle that reproduces its vertical part, since fwd.y is
           -sin(pitch). A rover falling at 90 m/s becomes a jet doing 90 m/s
           straight down with the nose there too, and pulling out is flying
           rather than a formality. The clamp is the airframe's own pitch limit:
           a dead vertical drop arrives at 74 degrees nose down. */
        const S = Math.hypot(carryH, carryV);
        this.speedScalar = S;
        this.speed = S;
        this.pitch = clamp(Math.asin(clamp(-carryV / Math.max(S, 0.001), -1, 1)),
          -1.30, 1.30);
        this.vel.set(Math.sin(this.yaw) * carryH, carryV, Math.cos(this.yaw) * carryH);
        /* And no launch autopilot. Nine seconds of hands-off altitude hold is
           what a LAUNCH gets; handing it to a fall would fly you out of the
           dive on your behalf, which is the same free save by another road.
           JET.avoidLift still applies — it is always on by design, autopilot or
           not, and softening a dive at a hillside is what makes this learnable. */
        this.assist = 0;
      } else {
        // Convert whatever ground speed you had into a launch. speedScalar is
        // what updateJet actually integrates — setting `speed` here did nothing,
        // so launching from a standstill started you below stall and put you
        // straight back into the dirt.
        this.speedScalar = Math.max(this.speedScalar, JET.launchSpeed);
        this.speed = this.speedScalar;
        this.pos.y += 3.0;
        this.vel.y = JET.launchImpulse;
        this.pitch = -0.42;
        this.assist = JET.assistTime;
      }
    } else if (mode === 'drone') {
      /* The drone integrates `vel` directly, all three components, so the
         carry is simply the velocity you arrived with — a jet handing over at
         60 m/s becomes a drone doing 60 m/s that its own drag then reels in.
         The hover picks up FROM WHERE YOU ARE: the lift offset is set so the
         current height above the floor is the held height, which is what
         makes drone-from-jet a mid-air brake rather than a descent. */
      this.pitch = 0; this.roll = 0;
      this.speedScalar = carryH;
      this.vel.set(Math.sin(this.yaw) * carryH, dropping ? carryV : 0,
        Math.cos(this.yaw) * carryH);
      const floorD = Math.max(this.groundHeight,
        this.surf.planet.hasWater ? WORLD.waterY : -Infinity);
      this.droneLift = clamp((this.pos.y - floorD) - DRONE.hover, 0, DRONE.maxLift);
    } else {
      this.pitch = 0; this.roll = 0;
      if (dropping) {
        /* Horizontal momentum, restated in each form's own currency: the rover
           integrates `speedScalar` along its yaw, the boat integrates `vel`
           directly, so both are set. Both also have a speed ceiling a jet is
           far above — and `chainBoost` is already this file's lever for
           "temporarily above your ceiling, bleeding back down to it", so the
           carry rides that rather than growing a second system alongside it.
           It damps back to 1 on its own, which is the fast rover becoming an
           ordinary one over a couple of seconds instead of on one frame. */
        this.speedScalar = carryH;
        this.chainBoost = Math.max(1, carryH / ROVER.maxSpeed);
        this.vel.set(Math.sin(this.yaw) * carryH, carryV, Math.cos(this.yaw) * carryH);
      }
    }
    if (!silent) emit('transform', { from: prev, to: mode, pos: this.world.clone() });
  }

  update(dt, input) {
    this.time += dt;
    const wantBoost = input.boost;
    // The beam is not physics, but it is an input, and inputs arrive here. It
    // is read by survey.js, which owns scanning as a verb and therefore owns
    // this one too.
    this.beamHeld = !!input.beam;

    // Between worlds nothing local applies: no ground, no tangent frame, no
    // form to switch into. The whole update is the analytic step.
    if (this.hyper) { this.updateHyper(dt); return; }

    if (input.mode && input.mode !== this.mode) this.setMode(input.mode);

    this.hopCool = Math.max(0, this.hopCool - dt);
    this.sinceLand += dt;

    // Skid state is rebuilt from scratch every frame by whichever form owns it.
    // The jet has none — you cannot skid on air.
    this.skid = 0;
    this.skidKind = null;

    if (this.mode === 'rover') this.updateRover(dt, input, wantBoost);
    else if (this.mode === 'boat') this.updateBoat(dt, input, wantBoost);
    else if (this.mode === 'drone') this.updateDrone(dt, input, wantBoost);
    else this.updateJet(dt, input, wantBoost);

    this.speed = this.vel.length();
    this.topSpeed = Math.max(this.topSpeed, this.speed);
    const boosting = wantBoost && this.canBoost();
    this.boostHeat = lerp(this.boostHeat, boosting ? 1 : 0, 1 - Math.exp(-6 * dt));
    this.shake = Math.max(0, this.shake - dt * 2.4);

    this.tickSuspension(dt);
    this.rebase();
    this.applyTransform();
  }

  /**
   * Walk the tangent frame by however far the craft moved this frame and zero
   * the local offset.
   *
   * This is the whole trick. The craft is always at its own frame's origin, so
   * (x, z) never grows and the tangent plane is never used further than one
   * frame of travel — 2.6m at full jet speed, where the plane is 3mm off the
   * sphere. Everything upstream gets to keep believing in flat ground.
   */
  rebase() {
    if (this.pos.x !== 0 || this.pos.z !== 0) {
      this.surf.advance(this.pos.x, this.pos.z);
      this.pos.x = 0;
      this.pos.z = 0;
    }
  }

  canBoost() {
    if (this.mode === 'jet') return !this.glide && this.fuel > 0;
    if (this.mode === 'drone') return this.fuel > 0;
    return true;
  }

  // ---- hyper travel ------------------------------------------------------

  /**
   * Leave the world.
   *
   * There is no button for this: climbing past the approach altitude IS the
   * departure, because that altitude is the boundary of the sphere inside which
   * flight is local. Everything the craft carries — heading, fuel, the form it
   * is in — is unchanged; what changes is that position becomes a point in the
   * system rather than an offset in a tangent frame.
   */
  enterHyper() {
    const P = this.surf.planet;
    const fr = this.surf.frame;
    const w = fr.toWorld(this.pos.x, this.pos.y, this.pos.z, WTMP);
    const c = centreOf(P.key);
    const p = { x: w.x + c.x, y: w.y + c.y, z: w.z + c.z };

    // The heading, taken out of the tangent frame into system space. vel is in
    // local (east, up, north), which are the frame's own axes.
    const v = this.vel;
    let dx = fr.east.x * v.x + fr.up.x * v.y + fr.north.x * v.z;
    let dy = fr.east.y * v.x + fr.up.y * v.y + fr.north.y * v.z;
    let dz = fr.east.z * v.x + fr.up.z * v.y + fr.north.z * v.z;
    let l = Math.hypot(dx, dy, dz);
    if (l < 1e-6) { dx = fr.up.x; dy = fr.up.y; dz = fr.up.z; l = 1; }
    const dir = { x: dx / l, y: dy / l, z: dz / l };

    const bs = this.bodies || (this.bodies = bodies());
    const target = pickTarget(bs, p, dir, P.key);

    /* THE TRIP CHECK. Committed before the craft leaves, not discovered halfway.
       Deceleration is automatic, so running dry in transit would not strand you
       in space — it would land you somewhere you did not choose with nothing
       left to leave again, which is worse. The escape burn stops you leaving by
       accident; this stops you leaving by mistake. */
    if (this.economy && target) {
      const check = this.economy.canReach(P.key, target.key);
      if (!check.ok) {
        emit('hyperdenied', {
          to: target.key, name: target.name, need: check.need, have: check.have,
        });
        // Refused, not queued: you are still flying, still under your own
        // power, and still pointed at the sky. Nose down and you are home.
        return;
      }
      this.economy.spend(check.need);
    }

    /* The orientation is carried out of the frame as well as the heading, and
       this line is the whole of "no snap at the boundary": the basis is seeded
       with exactly what applyTransform was drawing on the previous frame, so
       departure is the same attitude expressed in a frame that has no planet
       under it rather than a new attitude computed from world +Y. */
    this.transit.seed(fr, this.yaw, this.pitch, this.roll);

    this.hyper = { p, dir, target, speed: this.speedScalar, alt: this.pos.y, from: P.key };
    emit('hyperenter', { from: P.key, to: target ? target.key : null, target });
  }

  /**
   * One frame between worlds: bend onto the target, take one analytic step,
   * and hand back the moment the step crosses an approach sphere.
   */
  updateHyper(dt) {
    const bs = this.bodies || (this.bodies = bodies());
    /* Turn late. The steering rate scales with how fast you already are, and
       that ordering is the whole of it: speed comes from ALTITUDE, altitude
       comes from flying straight up, and a craft that turns toward a sideways
       target while it is still slow spends its climb going sideways instead.
       Measured — at a flat rate, turning HARDER made every trip slower and the
       spread between worlds wider, monotonically. */
    steer(this.hyper, this.hyper.target, dt,
      HYPER.turnRate * (HYPER.turnLow + (1 - HYPER.turnLow) * this.hyperT));
    const arrived = advance(bs, this.hyper, dt);

    /* Nose onto the course, then bank onto the local up. Attitude only — the
       field does not move the craft, because speed out here is a function of
       altitude and that law is hyper's, not this one's. */
    this.transit.aim(bs, this.hyper.p, this.hyper.dir, dt);

    this.speedScalar = this.hyper.speed;
    this.speed = this.hyper.speed;
    this.topSpeed = Math.max(this.topSpeed, this.speed);

    /* The single number the presentation follows — FOV, streaks, aberration,
       the engine mix and the readout all read this and nothing else.
       LOG scaled, because the journey is a sequence of doublings: on a linear
       fraction of the cap the craft would sit at "nearly zero" for two thirds
       of a trip and then slam to full in the last second. And because speed is
       a function of altitude and altitude is symmetric about the midpoint, so
       is this — the fall-off on approach is the rise played backwards, with no
       code to make it so. */
    this.hyperT = clamp(Math.log2(Math.max(1, this.speed / HYPER.localSpeed)) /
      Math.log2(HYPER.maxSpeed / HYPER.localSpeed), 0, 1);
    this.altitude_ = this.hyper.alt;

    // The scene is centred on whichever world is currently built, so the mesh
    // and the camera get the transit position expressed in that world's frame.
    const c = centreOf(this.surf.planet.key);
    this.world.set(this.hyper.p.x - c.x, this.hyper.p.y - c.y, this.hyper.p.z - c.z);
    this.applyTransform();

    if (arrived) {
      /* Direction on the destination, in its own frame — which is what a
         Surface is anchored by. The listener rebuilds the world and hands back
         a Surface through landOn(); nothing here assumes it will, so a headless
         caller with no listener simply stops in space rather than throwing. */
      const b = arrived;
      const dx = this.hyper.p.x - b.c.x, dy = this.hyper.p.y - b.c.y, dz = this.hyper.p.z - b.c.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      emit('hyperarrive', {
        key: b.key,
        dir: { x: dx / l, y: dy / l, z: dz / l },
        alt: HYPER.approachAlt,
        speed: this.speed,
      });
    }
  }

  /**
   * Stand the craft on the ground where it is, right now.
   *
   * WHY THIS HAD TO EXIST. The constructor puts the craft at y = 0, and y is
   * height above SEA LEVEL, not above the ground. findSpawn returns a
   * DIRECTION and has never returned a height — so the two halves of a spawn
   * were never actually joined up. It only stopped being invisible when the
   * spawn search changed: it used to stop at the first point in its height
   * band, which on a Fibonacci spiral from the pole meant something near the
   * bottom of that band, and the error was a metre or two. Scoring the whole
   * spiral for how many neighbour worlds sit in the sky picks by a criterion
   * with no relation to height at all, so the chosen point can sit anywhere in
   * a band that runs from relief * 0.12 to relief * 0.75 — up to 78m above sea
   * level on Anvil, with the craft still starting at zero. Underground, and
   * then thrown clear.
   *
   * Every field that could carry that throw forward is cleared here as well as
   * the position. Setting y alone leaves whatever the suspension had already
   * wound up on the frame it spent inside the rock.
   */
  settle() {
    const gh = this.surf.surfaceHeight(this.pos.x, this.pos.z);
    this.pos.y = Math.max(gh, this.surf.planet.hasWater ? WORLD.waterY : -Infinity) +
      ROVER.rideHeight;
    this.vel.set(0, 0, 0);
    this.fallVel = 0;
    this.hopVel = 0;
    this.airborne = false;
    this.grounded = true;
    this.speed = 0;
    this.speedScalar = 0;
    this.lastImpact = 0;
    this.sinceLand = 0;
  }

  /**
   * Hyper hands back: stand the craft up in flight over a new world.
   *
   * Arrival speed is not negotiable — the law brought it back down to jet
   * speeds on the way in, and this clamps what is left. The autopilot is handed
   * the controls for the same reason it is after a launch: arriving somewhere
   * you have never been, nose-down at altitude, is not a good first impression.
   */
  landOn(surface, alt) {
    /* The heading, read out of the transit basis and into the new world's
       frame, BEFORE the basis is thrown away. Yaw is the one part of the
       attitude an arrival has to carry: pitch and roll below are a deliberate
       stand-up that the autopilot then flies, but yaw was simply never set,
       so the craft used to arrive pointing at whatever compass bearing it had
       been holding on the world it left — a number with no meaning on this one.
       Guarded, because this is also the dev warp's path: there is no transit
       basis to read on a warp, and reading the stale one would replace an
       arbitrary heading with a differently arbitrary one. */
    if (this.hyper) this.yaw = landingYaw(this.transit, surface.frame);
    this.surf = surface;
    this.hyper = null;
    this.hyperT = 0;
    this.bodies = null;
    this.pos.set(0, alt === undefined ? HYPER.approachAlt : alt, 0);
    this.speedScalar = Math.min(this.speedScalar, JET.maxSpeed);
    this.speed = this.speedScalar;
    this.vel.set(0, 0, 0);
    this.pitch = 0.10;
    this.roll = 0;
    this.glide = false;
    this.airborne = false;
    this.assist = JET.assistTime;
    this.assistGround = 0;
    this.applyTransform();
  }

  // ---- the hop ----------------------------------------------------------

  /**
   * Crouch, launch, ballistic air, land. Shared by rover and boat; the jet
   * gets a straight impulse instead because it has no ground to push off.
   * rideY is the surface height the form wants to sit at right now.
   */
  rideSurface(dt, input, rideY, o) {
    this.tickCharge(dt, input, rideY, o);
    this.tickChute(dt);

    if (this.airborne) {
      /* Gravity, less whatever the canopy is currently carrying.
         Damping toward `descent` on top of a FULL gravity step does not settle
         at `descent` — it settles at `descent + gravity/rate`, because the two
         terms fight to an offset. That put the real terminal rate at 22 m/s
         while the constant said 11, which is the kind of number someone tunes
         from and gets a surprise. Taking gravity out in proportion to how open
         the canopy is makes the constant mean what it says at full deployment,
         and leaves the partly-open descent correctly faster.
         At chute 0 this is exactly the line it replaced, so hops are untouched. */
      this.hopVel -= HOP.gravity * (1 - this.chute) * dt;
      if (this.chute > 0) {
        /* The canopy is a terminal descent rate, not a brake: it takes hold
           over about half a second, so a deploy reads as a swing rather than a
           jerk, and a half-open canopy is proportionally weaker — which is what
           puts the opening itself into the motion and not only into the mesh.
           It never pushes you up; arrive slower than `descent` and it does
           nothing at all. */
        this.hopVel = damp(this.hopVel, -PARACHUTE.descent,
          PARACHUTE.open * this.chute, dt);
        const bleed = Math.exp(-PARACHUTE.drag * this.chute * dt);
        this.speedScalar *= bleed;
        this.vel.x *= bleed; this.vel.z *= bleed;
      }
      this.pos.y += this.hopVel * dt;
      this.airTime += dt;
      if (this.pos.y <= rideY) {
        this.pos.y = rideY;
        const impact = Math.abs(this.hopVel);
        this.airborne = false;
        this.hopVel = 0;
        this.fallVel = 0;
        this.sinceLand = 0;
        this.lastImpact = impact;
        this.bodyKick = -clamp(impact / 18, 0.12, 1) * 0.40;
        this.shake = Math.max(this.shake, clamp(impact / 34, 0, 0.6));
        emit('thump', {
          pos: this.world.clone(), impact, air: this.airTime,
          water: this.onWater, chain: this.chain,
        });
        this.airTime = 0;
      }
    } else {
      // Asymmetric follow. Coming down has to be much stiffer than going up:
      // a symmetric lag left the rover hanging metres off the deck over every
      // 5m terrace edge, and letting it fall under gravity instead just turned
      // each edge into a ski jump. This hugs the ground without launching.
      const rate = this.pos.y > rideY ? o.followDown : o.follow;
      this.pos.y = damp(this.pos.y, rideY, rate, dt);
      // Ground falling away faster than the suspension can follow is a jump,
      // not a fall. Off by default — see HOP.ledgeAir.
      if (HOP.ledgeAir && o.canHop && this.pos.y - rideY > HOP.ledgeDrop &&
          Math.abs(this.speedScalar) > 6) {
        this.airborne = true;
        this.hopVel = 0;
        this.airTime = 0;
        this.chain = 0;
      }
    }
  }

  /**
   * The auto-deploy canopy.
   *
   * A rover that falls out of the sky should not simply die — but it must not
   * be free either, or the altitude that mid-air transforming just made cheap
   * to reach would stop meaning anything.
   *
   * IT IS A SAVE, NOT A GLIDE, and that is a claim about WHEN. It used to open
   * at a per-world height — the planet's relief times 2.2 — and it opened the
   * moment you were above that line rather than below it, so any real fall
   * deployed at the top and the canopy WAS the descent. It also opened at the
   * same altitude whether you were sinking at 3 m/s or arriving at 90, because
   * a height cannot tell those apart. Now it opens a couple of seconds before
   * you would hit: one rule for all six worlds, scaled to how fast you are
   * actually falling, at the only point in the fall anyone is watching.
   *
   * TWO TERMS, AND THE SECOND IS NOT OPTIONAL. Time to impact on its own fires
   * at the apex of a full-charge hop — a slow descent close to the ground is
   * arithmetically indistinguishable from the end of a fall. So the canopy also
   * asks whether the landing would be harder than one you chose: predicted
   * impact speed under full gravity, against a threshold set clear of what a
   * wound-up hop returns to the deck at. Both numbers are global; neither is
   * read off the planet, which is the point of the rewrite.
   */
  tickChute(dt) {
    const floor = Math.max(this.groundHeight,
      this.surf.planet.hasWater ? WORLD.waterY : -Infinity);
    if (this.airborne && !this.chuteOut && this.hopVel < -PARACHUTE.minFall) {
      const alt = this.pos.y - floor;
      const rate = -this.hopVel;
      /* Impact speed if nothing changes. For a ballistic arc this comes out
         equal to the speed you left the ground at, which is exactly why it
         tells a hop from a fall — see PARACHUTE.hardLanding. */
      const impact = Math.sqrt(rate * rate + 2 * HOP.gravity * Math.max(alt, 0));
      if (alt > 0 && alt / rate < PARACHUTE.warn &&
          impact > PARACHUTE.hardLanding) {
        this.chuteOut = true;
        emit('chute', { pos: this.world.clone(), alt, impact });
      }
    }
    /* Out until you land or leave the form — deliberately NOT re-tested against
       the ceiling on the way down. A canopy that repacked itself the moment you
       dropped back under the threshold would strobe through exactly the band of
       altitude it exists to cover, and would cut away at the worst moment of
       every descent it was in the middle of saving. */
    if (!this.airborne) this.chuteOut = false;
    this.chute = damp(this.chute, this.chuteOut ? 1 : 0,
      this.chuteOut ? PARACHUTE.open : PARACHUTE.stow, dt);
  }

  /**
   * Hold to wind up, release to leap.
   *
   * The charge fraction is measured from the *minimum* squat rather than from
   * zero, so a tap lands on exactly the old hop and only a deliberate hold
   * buys height. Releasing before the minimum squat has elapsed does not
   * cancel — the launch is queued and fires once the chassis has visibly
   * crouched, which is what keeps a quick tap from looking like a teleport.
   */
  tickCharge(dt, input, rideY, o) {
    if (this.airborne || !o.canHop) {
      this.charging = false;
      this.charge = 0;
      this.releaseQueued = false;
      return;
    }

    if (input.hopHeld && !this.charging && !this.releaseQueued && this.hopCool <= 0) {
      this.charging = true;
      this.charge = 0;
      emit('chargestart', {});
    }
    if (!this.charging) return;

    this.charge = Math.min(HOP.chargeTime, this.charge + dt);
    if (!input.hopHeld) this.releaseQueued = true;

    // Reaching full does not fire — it just stops charging. You hold a wound-up
    // jump for as long as you like and pick the moment, which matters when the
    // whole point is clearing something specific.
    if (this.releaseQueued && this.charge >= HOP.crouch) {
      const t = clamp((this.charge - HOP.crouch) /
        Math.max(0.01, HOP.chargeTime - HOP.crouch), 0, 1);
      // Linear in HEIGHT. Height goes as v², so the impulse multiplier is the
      // square root of the height multiplier — lerping the impulse straight to
      // chargeMax would make a full charge 100x, not 10x.
      const mult = Math.sqrt(1 + t * (HOP.chargeMax * HOP.chargeMax - 1));
      // Start the arc from the ride line. The springs are usually a little
      // below it on rough ground, and launching from there put the craft
      // under its own landing check on the very first frame.
      this.pos.y = Math.max(this.pos.y, rideY);
      this.chargeShot = t;
      this.charging = false;
      this.releaseQueued = false;
      this.charge = 0;
      this.hopCool = HOP.cooldown;
      this.launchHop(o.impulse * mult);
    }
  }

  /** 0..1 while winding up, for the suspension squat, audio and HUD. */
  get chargeT() {
    return this.charging ? clamp(this.charge / HOP.chargeTime, 0, 1) : 0;
  }

  launchHop(impulse) {
    this.charging = false;
    this.charge = 0;
    this.airborne = true;
    this.hopVel = impulse;
    this.airTime = 0;
    this.bodyKick = HOP.bodyRise;
    // Land and go straight back up and you keep — and build — your speed. The
    // cap lifts with the chain, so the bonus survives the next clamp.
    if (this.sinceLand < HOP.chainWindow) {
      this.chain++;
      this.chainBoost = Math.min(HOP.chainCap, this.chainBoost * (1 + HOP.chainBonus));
      this.speedScalar *= 1 + HOP.chainBonus;
    } else {
      this.chain = 0;
    }
    emit('hop', { pos: this.world.clone(), chain: this.chain });
  }

  /**
   * The read the player actually sees: body squats, body extends, wheels
   * arrive late because they're hanging off springs rather than bolted on.
   */
  tickSuspension(dt) {
    let target = 0;
    if (this.charging) {
      // Squats progressively as it winds up, so the height you are about to
      // get is readable off the chassis before you let go.
      target = lerp(HOP.bodyDip * 0.45, HOP.chargeDip, this.chargeT);
    } else if (this.bodyKick !== 0) {
      target = this.bodyKick;
      this.bodyKick = damp(this.bodyKick, 0, 7.5, dt);
      if (Math.abs(this.bodyKick) < 0.004) this.bodyKick = 0;
    }

    this.jiggle = this.mode === 'rover' && !this.airborne && !this.onWater
      ? clamp(Math.abs(this.speedScalar) / 26, 0, 1) : 0;
    if (this.jiggle > 0) target += Math.sin(this.time * 9.3) * 0.015 * this.jiggle;

    this.bodyY = damp(this.bodyY, target, HOP.bodyLerp, dt);
    const droop = this.airborne ? -HOP.wheelDroop : 0;
    this.wheelY = damp(this.wheelY, this.bodyY * 0.34 + droop, HOP.wheelLerp, dt);
  }

  // ---- ground ----------------------------------------------------------
  updateRover(dt, input, boost) {
    // surfaceHeight, not height: the wheels have to sit on the triangles that
    // are drawn, not on the ideal curve they approximate.
    const gh = this.surf.surfaceHeight(this.pos.x, this.pos.z);
    // A dry world has nothing to ford, nothing to flood in, and no shell to
    // read a depth off. Ember's fissures cut below sea level and would
    // otherwise read as lakes you drown in.
    const depth = this.surf.planet.hasWater ? Math.max(0, WORLD.waterY - gh) : 0;
    /* Vault: frozen water is a SURFACE. Ice thick enough to hold the rover
       takes it out of the water path entirely — no wading, no flooding, it
       simply drives across at the waterline. Past the melt line the ice does
       not hold, `wet` goes true, and everything below is the flooding code that
       was always here. That is the whole change: one boolean, and no second
       flooding system.
       `iceHolds` is false on the other five worlds, so their water behaves
       exactly as it did — which is the regression that matters. */
    this.onIce = depth > 0.35 && iceHolds(this.surf.planet, depth);
    /* Water you are falling TOWARD is not water you are in. Without this a
       rover dropped out of a jet takes wading drag and the water speed cap from
       eighty metres up — wrong on its own terms, and the exact opposite of the
       momentum the drop exists to preserve. */
    const aloft = this.pos.y > WORLD.waterY + AIR.wadeCeiling;
    const wet = depth > 0.35 && !this.onIce && !aloft;
    if (wet && !this.wasWet && Math.abs(this.speedScalar) > 4) {
      const entry = Math.abs(this.speedScalar);
      emit('splash', {
        pos: this.world.clone(), force: clamp(entry / 24, 0.3, 1.3), entry,
      });
      /* THE ENTRY IS A SKID. Everything above waterMaxSpeed used to be clamped
         away on the single frame the hull touched, which is what made driving
         into a lake read as hitting a wall. It is kept here instead and bled
         off over a distance below.
         Only the ENTRY changes. fordDepth still fords, sinkDepth still floods,
         drownDepth and drownTime still drown you on the same schedule — none of
         that is touched, and none of it needs to be. */
      if (entry > SKID.minEntry) {
        this.wadeCarry = Math.max(0, entry - ROVER.waterMaxSpeed);
        this.wadeCarry0 = this.wadeCarry;
      }
    }
    this.wasWet = wet;
    this.onWater = wet;

    /* Burn the carried overspeed off across SKID.waterLength METRES of travel,
       linearly — see the note on SKID. The speed cap below rides this down, so
       the hull goes from entry speed to the wading cap over a fixed distance
       instead of on the frame it touched. */
    if (!wet) { this.wadeCarry = 0; this.wadeCarry0 = 0; }
    else if (this.wadeCarry > 0) {
      const travelled = Math.abs(this.speedScalar) * dt;
      this.wadeCarry -= travelled * (this.wadeCarry0 / SKID.waterLength);
      // ...and a floor under it, so a hull that stops dead in the shallows
      // cannot sit in a skid it is no longer travelling far enough to finish.
      if (this.wadeCarry < 0.25 || Math.abs(this.speedScalar) <= ROVER.waterMaxSpeed + 0.25) {
        this.wadeCarry = 0; this.wadeCarry0 = 0;
      }
    }
    const wadeT = this.wadeCarry > 0
      ? clamp(this.wadeCarry / Math.max(1, this.wadeCarry0), 0, 1) : 0;
    if (wadeT > 0) { this.skid = wadeT; this.skidKind = 'water'; }

    // Ford the shallows; past that the hull starts taking water on.
    const swampT = wet
      ? clamp((depth - ROVER.fordDepth) / Math.max(0.4, ROVER.sinkDepth - ROVER.fordDepth), 0, 1)
      : 0;
    const before = this.swamp;
    this.swamp = damp(this.swamp, swampT, 3.2, dt);
    if (before <= 0.55 && this.swamp > 0.55) emit('flood', { depth });

    const maxS = wet
      ? ROVER.waterMaxSpeed * (1 - 0.65 * this.swamp)
      : (boost ? ROVER.boostSpeed : ROVER.maxSpeed);
    const accel = wet
      ? ROVER.accel * (0.42 - 0.30 * this.swamp)
      : (boost ? ROVER.boostAccel : ROVER.accel);
    // Progressive drag: the water closes on you across the skid instead of
    // arriving all at once at the waterline. At entry it is barely more than
    // driving on land; by the end of the skid it is the full wallow it always
    // was, which is the state the flooding code below expects to find.
    const drag = wet ? lerp(ROVER.waterDrag, ROVER.drag, wadeT) : ROVER.drag;

    // Turning authority scales with speed — no pirouettes from a standstill,
    // and next to none while the wheels are off the ground.
    const grip = clamp(Math.abs(this.speedScalar) / 12, 0, 1) * (this.airborne ? 0.30 : 1);
    this.yaw += input.turn * ROVER.turn * dt * grip * (this.speedScalar < 0 ? -1 : 1);

    let s = this.speedScalar || 0;
    const drive = this.airborne ? input.fwd * 0.12 : input.fwd;
    s += (drive * accel - Math.sign(s) * drag * Math.abs(s) * 0.35) * dt;
    if (input.fwd === 0 && !this.airborne) s -= Math.sign(s) * Math.min(Math.abs(s), drag * 6 * dt);
    // Chained hops raise the ceiling temporarily; it bleeds back down.
    this.chainBoost = damp(this.chainBoost, 1, 0.55, dt);
    s = clamp(s, -maxS * 0.42,
      maxS * (wet ? 1 : this.chainBoost) + (wet ? this.wadeCarry : 0));
    this.speedScalar = s;

    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.vel.set(fx * s, 0, fz * s);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // Sample the ground under each of the six contact patches. Everything
    // below — ride height, body attitude and strut travel — comes out of this
    // one array, which is what makes it a suspension rather than a mesh
    // sliding along an average.
    const contact = this.sampleWheels();
    const gh2 = contact.ride;
    // Wading, the hull floats level with the waterline; as it takes water on
    // it settles. These offsets are relative to the (now very small) ride
    // height — at the old 1.5 they were dunking the rover just for paddling.
    const surf = this.onWater
      ? WORLD.waterY + this.surf.waveAt(this.pos.x, this.pos.z, this.time) * 0.6
        - 0.10 - 0.55 * this.swamp
      : gh2;
    const rideBase = surf + ROVER.rideHeight * (1 - 0.42 * this.swamp);

    // A hull with water in it sits lower and lower — until it reaches the bed,
    // which it rests on rather than sinking through. That's why the recovery
    // is on a timer as well as a depth: a shallow bed would otherwise leave
    // you parked underwater forever.
    if (this.swamp > 0.995 && !this.airborne) {
      const maxSink = Math.max(0, rideBase - (gh2 + ROVER.bedClearance));
      this.floodTime += dt;
      this.sinkY = Math.min(maxSink,
        this.sinkY + ROVER.sinkRate * (0.55 + this.sinkY * 0.55) * dt);
      if (this.sinkY > ROVER.drownDepth || this.floodTime > ROVER.drownTime) {
        this.drown();
        return;
      }
    } else {
      this.floodTime = Math.max(0, this.floodTime - dt * 1.6);
      this.sinkY = Math.max(0, this.sinkY - dt * 2.8);
    }

    const rideY = rideBase - this.sinkY;

    this.rideSurface(dt, input, rideY, {
      impulse: HOP.impulse,
      canHop: this.swamp < 0.5,
      follow: 22,
      followDown: 48,
    });
    // Anti-tunnelling only. The springs lag by design, and driving up out of a
    // flooded basin used to mean climbing out through the rock for half a
    // second. It must sit *below* the ride line or it fights the suspension.
    const hardFloor = gh2 - 0.15;
    if (this.pos.y < hardFloor) this.pos.y = hardFloor;
    this.grounded = !this.airborne;

    // Attitude comes from where the wheels actually are. The surface normal is
    // kept as a blend partner because it stays smooth where six discrete
    // contact points get noisy — over a boulder, say.
    const k = 1 - Math.exp(-ROVER.tiltLerp * dt);
    if (this.airborne) {
      this.pitch = lerp(this.pitch, -clamp(this.hopVel / 26, -0.3, 0.3), k * 0.7);
      this.roll = lerp(this.roll, -input.turn * 0.20, k * 0.7);
    } else {
      const n = this.surf.normalAt(this.pos.x, this.pos.z, 2.4);
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      const np = Math.atan2(n.x * fx + n.z * fz, Math.max(n.y, 0.2));
      const nr = -Math.atan2(n.x * rx + n.z * rz, Math.max(n.y, 0.2));
      // On ice the wheels are the only honest witness: the terrain normal under
      // them belongs to the lake bed, several metres down.
      const a = this.onIce ? 1 : SUSP.attitude;
      const tp = lerp(np, contact.pitch, a);
      const tr = lerp(nr, contact.roll, a);
      this.pitch = lerp(this.pitch, this.onWater ? 0 : tp, k);
      this.roll = lerp(this.roll, (this.onWater ? 0 : tr) - input.turn * 0.13 * grip, k);
    }

    this.tickWheels(dt, contact);
    this.wheelSpin += (s / WHEEL.radius) * dt * (this.airborne ? 0.55 : 1);

    if (!this.onWater && !this.airborne && Math.abs(s) > 6) this.addFuel(ROVER.harvest * dt);
  }

  /**
   * Ground height under each of the six contact patches, plus the chassis ride
   * line and the body attitude that falls out of them.
   *
   * The ride line is biased toward the highest wheel rather than the mean, so
   * the chassis clears the bump instead of the bump clearing the chassis.
   */
  sampleWheels() {
    const wheels = this.forms.rover.wheels;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const g = this.wheelGround;
    let sum = 0, max = -1e9;
    let fSum = 0, fN = 0, rSum = 0, rN = 0;
    let lSum = 0, lN = 0, rtSum = 0, rtN = 0;

    // A tyre this size bridges a step rather than following it, so each wheel
    // reads the mean of its contact patch fore and aft along the rolling
    // direction. Averaged, not maxed: taking the high point biases every wheel
    // upward against the chassis' single centre sample, and the struts end up
    // permanently compressed.
    const rr = WHEEL.radius * 0.9;
    const fx = s * rr, fz = c * rr;

    for (let i = 0; i < wheels.length; i++) {
      const md = wheels[i].metadata;
      // Yaw-only placement: pitch and roll move the hub by centimetres and
      // would make this a feedback loop for no visible gain.
      const wx = this.pos.x + c * md.lx + s * md.lz;
      const wz = this.pos.z - s * md.lx + c * md.lz;
      // Ice, where there is any, is what the wheel rests on. Applied per
      // contact patch rather than once for the vehicle, so the suspension reads
      // the lip of a frozen lake the same way it reads a kerb.
      const h = iceRide(this.surf.planet,
        (this.surf.surfaceHeight(wx, wz) * 2 +
          this.surf.surfaceHeight(wx + fx, wz + fz) +
          this.surf.surfaceHeight(wx - fx, wz - fz)) * 0.25);
      g[i] = h;
      sum += h;
      if (h > max) max = h;
      if (md.lz > 0.5) { fSum += h; fN++; } else if (md.lz < -0.5) { rSum += h; rN++; }
      if (md.lx < 0) { lSum += h; lN++; } else { rtSum += h; rtN++; }
    }

    const mean = sum / wheels.length;
    const front = fN ? fSum / fN : mean, rear = rN ? rSum / rN : mean;
    const left = lN ? lSum / lN : mean, right = rtN ? rtSum / rtN : mean;
    const wheelbase = WHEEL.axles[WHEEL.axles.length - 1] - WHEEL.axles[0];

    // The chassis rides the ground beneath the chassis. Driving it from the
    // wheel samples instead lifts the whole vehicle by however much the
    // roughest wheel found, which is how it ended up hovering again — the
    // struts are what absorb the difference, and that is their whole job.
    const centre = iceRide(this.surf.planet,
      this.surf.surfaceHeight(this.pos.x, this.pos.z));

    return {
      ride: centre * (1 - SUSP.bodyShare) + Math.max(centre, mean) * SUSP.bodyShare,
      // Nose up on a climb is negative pitch, which is why this is negated.
      pitch: -Math.atan2(front - rear, Math.max(wheelbase, 0.5)),
      roll: SUSP.rollSign * Math.atan2(right - left, WHEEL.track * 2),
    };
  }

  /** Drive each strut to the ground under its own wheel. */
  tickWheels(dt, contact) {
    const form = this.forms.rover;
    const wheels = form.wheels;
    const g = this.wheelGround;
    const kk = 1 - Math.exp(-SUSP.rate * dt);
    let load = 0;

    for (let i = 0; i < wheels.length; i++) {
      const md = wheels[i].metadata;
      // Where the hub would have to sit for this tyre to touch its patch,
      // expressed as travel away from rest.
      const want = this.airborne
        ? -SUSP.down
        : clamp((g[i] + WHEEL.radius) - this.pos.y - md.restY, -SUSP.down, SUSP.up);
      md.travel += (want - md.travel) * kk;
      load += md.travel;
    }
    this.wheelLoad = load / wheels.length;
  }

  /** Flooded out. The survey recovers you to the nearest dry ground. */
  drown() {
    const spot = this.surf.findDry(0.04 * this.surf.planet.relief,
      this.surf.planet.radius * 0.4) || { x: 0, z: 0 };
    const from = this.world.clone();
    // Walk the frame to the rescue point rather than teleporting in world
    // space, so the heading survives and the LOD field follows.
    this.surf.advance(spot.x, spot.z);
    this.pos.set(0, this.surf.surfaceHeight(0, 0) + ROVER.rideHeight, 0);
    this.vel.set(0, 0, 0);
    this.speedScalar = 0;
    this.sinkY = 0;
    this.floodTime = 0;
    this.swamp = 0;
    this.airborne = false;
    this.hopVel = 0;
    this.wasWet = false;
    this.fuel = Math.max(0, this.fuel - FUEL.drownPenalty);
    this.shake = 1;
    this.drowns++;
    this.applyTransform();
    emit('drown', { from, to: this.world.clone(), cost: FUEL.drownPenalty });
  }

  // ---- water -----------------------------------------------------------
  updateBoat(dt, input, boost) {
    const gh = this.surf.surfaceHeight(this.pos.x, this.pos.z);
    this.onWater = this.surf.planet.hasWater && gh < WORLD.waterY - 0.5;

    const speedNow = Math.hypot(this.vel.x, this.vel.z);

    /* ---- beaching ----
       Crossing the waterline used to clamp the hull to landMaxSpeed on that one
       frame, which stopped a planing boat dead at the shore: a wall, where the
       thing being modelled is a transition. The overspeed is carried up onto
       the sand instead and ground off over a couple of hull lengths.
       AIRBORNE IS NOT BEACHED. A boat dropped out of a jet is over land, not on
       it, and keeps everything until something actually touches it — otherwise
       the mid-air transform above would hand you a hull doing 5 m/s at 200m. */
    const beaching = !this.onWater && !this.airborne;
    if (beaching && !this.wasBeached && speedNow > SKID.minEntry) {
      this.beachCarry = Math.max(0, speedNow - BOAT.landMaxSpeed);
      this.beachCarry0 = this.beachCarry;
      emit('beach', {
        pos: this.world.clone(), speed: speedNow,
        // How long the scrape is going to last, so the sound can be cut to the
        // skid rather than fired as a fixed one-shot that ends before it does.
        secs: clamp(SKID.beachLength / Math.max(4, speedNow), 0.25, 3.0),
      });
    }
    this.wasBeached = beaching;
    if (!beaching) { this.beachCarry = 0; this.beachCarry0 = 0; }
    else if (this.beachCarry > 0) {
      const travelled = speedNow * dt;
      this.beachCarry -= travelled * (this.beachCarry0 / SKID.beachLength);
      if (this.beachCarry < 0.25 || speedNow <= BOAT.landMaxSpeed + 0.25) {
        this.beachCarry = 0; this.beachCarry0 = 0;
      }
    }
    const beachT = this.beachCarry > 0
      ? clamp(this.beachCarry / Math.max(1, this.beachCarry0), 0, 1) : 0;
    if (beachT > 0) { this.skid = beachT; this.skidKind = 'beach'; }

    // ---- planing ----
    // Hysteresis: it takes more speed to get the hull up than to keep it up,
    // so the state does not chatter along the threshold. The crossing itself
    // is an event both ways, because that is the thing worth feeling.
    const planeT = clamp((speedNow - BOAT.planeSpeed) / BOAT.planeWidth, 0, 1);
    const was = this.planing;
    this.planing = this.onWater &&
      (planeT > (was ? BOAT.planeOff : BOAT.planeOn));
    if (this.planing !== was) {
      emit(this.planing ? 'plane' : 'plough',
        { pos: this.pos.clone(), speed: speedNow });
    }
    this.planeMix = damp(this.planeMix, this.planing ? 1 : 0, 5.5, dt);

    // ---- boost as a surge ----
    // Holding it gives a hard shove for the first fraction of a second and
    // then settles into the sustained ceiling, so it reads as a throttle
    // rather than as a different top speed.
    if (boost && !this.boostWas) this.surge = BOAT.surgeTime;
    this.boostWas = boost;
    this.surge = Math.max(0, this.surge - dt);
    const surgeK = boost ? this.surge / BOAT.surgeTime : 0;

    const maxS = this.onWater ? (boost ? BOAT.boostSpeed : BOAT.maxSpeed)
      /* Falling, not beached — and nothing that is not touching the hull may
         take speed off it. Clamping to BOAT.maxSpeed here threw away two
         thirds of the momentum of a boat dropped out of a jet, which is the
         one thing the mid-air transform above exists to preserve. */
      : this.airborne ? Math.max(BOAT.boostSpeed, speedNow)
      : BOAT.landMaxSpeed + this.beachCarry;      // running up the sand
    const base = this.onWater ? (boost ? BOAT.boostAccel : BOAT.accel) : BOAT.accel * 0.3;
    const accel = base + surgeK * BOAT.surgeAccel;
    // Hull friction arrives across the skid too, so the beach takes hold of you
    // rather than catching you. In the air there is nothing to scrape against.
    const drag = this.onWater
      ? lerp(BOAT.ploughDrag, BOAT.drag, this.planeMix)
      : this.airborne ? BOAT.drag
      : lerp(BOAT.landDrag, BOAT.drag, beachT);

    const grip = clamp(speedNow / 10, 0, 1);
    this.yaw += input.turn * BOAT.turn * dt * grip * (this.airborne ? 0.4 : 1);

    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.vel.x += fx * input.fwd * accel * dt;
    this.vel.z += fz * input.fwd * accel * dt;

    // ---- carving ----
    // Sideways velocity bleeds off faster the harder the hull is banked, and
    // only really bites once it is planing. Commit to the lean and the boat
    // holds its line; turn lazily and it washes out sideways.
    const along = this.vel.x * fx + this.vel.z * fz;
    const latX = this.vel.x - fx * along, latZ = this.vel.z - fz * along;
    const carve = clamp(Math.abs(this.roll) / BOAT.bankMax, 0, 1) * this.planeMix;
    const bleedRate = this.onWater
      ? lerp(BOAT.bleedLazy, BOAT.bleedCarve, carve)
      : this.airborne ? BOAT.bleedLazy : 9;
    const bleed = Math.exp(-bleedRate * dt);
    this.vel.x = fx * along + latX * bleed;
    this.vel.z = fz * along + latZ * bleed;

    const dragK = Math.exp(-drag * 0.4 * dt);
    this.vel.x *= dragK; this.vel.z *= dragK;

    const sp0 = Math.hypot(this.vel.x, this.vel.z);
    if (sp0 > maxS) { this.vel.x *= maxS / sp0; this.vel.z *= maxS / sp0; }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    const wave = this.surf.waveAt(this.pos.x, this.pos.z, this.time);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    // Planing flattens the ride: the hull skips the tops rather than following
    // the swell down into every trough.
    const follow = lerp(1, 0.35, this.planeMix);
    const surf = this.onWater
      ? WORLD.waterY + wave * follow
      : this.surf.surfaceHeight(this.pos.x, this.pos.z) + 0.35;
    const rideY = surf + 0.18;

    // ---- wave launch ----
    // How fast the water under the bow is rising, in m/s. Measured against the
    // UNDAMPED swell: a planing hull skips the tops rather than following them
    // down, but the crest is still the shape of a ramp, and taking the rise off
    // the flattened ride line makes it far too small to ever throw anything.
    const raw = WORLD.waterY + wave;
    const rise = this.lastSurf === undefined ? 0 : (raw - this.lastSurf) / Math.max(dt, 1e-4);
    this.lastSurf = raw;
    if (this.onWater && this.planing && !this.airborne &&
        rise > BOAT.waveMinRise && this.hopCool <= 0) {
      this.pos.y = Math.max(this.pos.y, rideY);
      this.airborne = true;
      this.hopVel = rise * BOAT.waveLaunch;
      this.airTime = 0;
      this.hopCool = BOAT.waveCooldown;
      emit('wavelaunch', { pos: this.world.clone(), rise });
    }

    this.speedScalar = sp;
    this.rideSurface(dt, input, rideY, {
      impulse: HOP.boatImpulse,
      canHop: this.onWater,
      follow: 10,
      followDown: 16,
    });

    // ---- landing ----
    // Come down flat and you keep your speed. Come down nose-high or hard and
    // the hull digs in and scrubs it off.
    if (this.sinceLand === 0 && this.lastImpact > BOAT.slamFrom) {
      const level = 1 - clamp(Math.abs(this.pitch) / 0.5, 0, 1);
      const harsh = clamp((this.lastImpact - BOAT.slamFrom) / 16, 0, 1) * (1 - level * 0.6);
      const keep = 1 - harsh * (1 - BOAT.slamKeep);
      this.vel.x *= keep; this.vel.z *= keep;
      this.speedScalar = Math.hypot(this.vel.x, this.vel.z);
      if (harsh > 0.15) emit('slam', { pos: this.world.clone(), harsh, keep });
    }

    // Bow rides high while ploughing and drops as the hull comes up — that
    // change of attitude is what makes planing legible without a readout.
    const swell = (this.surf.waveAt(this.pos.x + 2, this.pos.z, this.time) -
                   this.surf.waveAt(this.pos.x - 2, this.pos.z, this.time)) * 0.5;
    const k = 1 - Math.exp(-5 * dt);
    const push = clamp(sp / BOAT.planeSpeed, 0, 1) * (input.fwd > 0 ? 1 : 0.4);
    const bowUp = -BOAT.bowUp * push * (1 - this.planeMix);
    const trim = -0.05 * this.planeMix;
    const airPitch = this.airborne ? -0.22 : 0;
    this.pitch = lerp(this.pitch, bowUp + trim + airPitch, k);
    // Banks harder once planing — that lean is what the carve reads off.
    const bank = -input.turn * BOAT.bankMax * grip * lerp(0.55, 1, this.planeMix);
    this.roll = lerp(this.roll, bank + swell * (this.onWater ? 1 : 0), k);
    this.grounded = !this.onWater && !this.airborne;

    if (this.onWater && sp > 5) this.addFuel(BOAT.harvest * dt);
  }

  // ---- air -------------------------------------------------------------
  updateJet(dt, input, boost) {
    const burning = boost && !this.glide && this.fuel > 0;
    const drain = this.glide ? 0 : (burning ? JET.boostBurn : JET.burn);
    this.fuel = Math.max(0, this.fuel - drain * dt);
    if (this.fuel <= 0 && !this.glide) {
      this.glide = true;
      emit('fuelout', {});
    }
    this.flightTime += dt;

    // In the air the hop is a pop — a short vertical kick that costs charge.
    if (input.hopPress && this.hopCool <= 0 && this.fuel > HOP.jetCost) {
      this.hopCool = HOP.cooldown + 0.2;
      this.jetLift = HOP.jetImpulse;
      this.fuel = Math.max(0, this.fuel - HOP.jetCost);
      this.bodyKick = HOP.bodyRise * 0.7;
      emit('hop', { pos: this.world.clone(), chain: 0 });
    }
    this.jetLift = damp(this.jetLift, 0, HOP.jetDecay, dt);

    // Autopilot hands over as soon as you ask for the controls.
    if (input.pitch !== 0 || input.roll !== 0) {
      this.assist = Math.min(this.assist, JET.assistFade);
    }
    const wasAuto = this.assist > 0;
    this.assist = Math.max(0, this.assist - dt);
    const auto = clamp(this.assist / JET.assistFade, 0, 1);
    if (wasAuto && this.assist <= 0) emit('manual', {});

    this.pitch += input.pitch * JET.pitchRate * dt * (1 - auto * 0.5);
    this.pitch = clamp(this.pitch, -1.30, 1.30);
    this.roll += input.roll * JET.rollRate * dt * (1 - auto * 0.5);
    this.roll = clamp(this.roll, -1.75, 1.75);
    if (input.roll === 0) this.roll -= this.roll * JET.levelAssist * dt;

    const ghNow = Math.max(this.surf.surfaceHeight(this.pos.x, this.pos.z), WORLD.waterY);
    if (auto > 0) {
      // Altitude hold, wings level. Chasing the raw ground height porpoises
      // badly — at 90m/s a ridge arrives faster than the nose can answer — so
      // it follows a smoothed ground line and converts the height error into a
      // climb *rate*, then into the pitch angle that produces it. That last
      // step is what keeps the correction proportionate at any speed.
      this.assistGround = this.assistGround === 0
        ? ghNow : damp(this.assistGround, ghNow, 1.2, dt);
      const err = (this.assistGround + JET.assistAlt) - this.pos.y;
      const wantClimb = clamp(err * 0.6, -24, 30);
      const wantPitch = -Math.asin(
        clamp(wantClimb / Math.max(this.speedScalar, 20), -0.5, 0.5));
      const k = 1 - Math.exp(-JET.assistRate * dt);
      this.pitch = lerp(this.pitch, wantPitch, k * auto);
      this.roll = lerp(this.roll, 0, k * auto);
    }

    // Banked turns: roll is how you steer, yaw follows.
    this.yaw += Math.sin(this.roll) * JET.yawFromRoll * dt * clamp(Math.abs(this.speedScalar) / 60, 0.3, 1.6);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fwd = new BABYLON.Vector3(Math.sin(this.yaw) * cp, -sp, Math.cos(this.yaw) * cp);

    // Air thins with altitude: this caps the climb, which is what stops a
    // full-power vertical burn turning into a two-minute free glide home.
    const alt = this.pos.y - WORLD.waterY;
    let thin = clamp(1 - (alt - JET.ceiling) / JET.ceilingFade, 0, 1);
    // The escape burn. Holding boost keeps a floor of thrust above the ceiling,
    // and that floor is what a departure is made of — release it and the air is
    // thin again and you sink back toward the world.
    if (burning) thin = Math.max(thin, JET.escapeThin);

    const thrust = (this.glide ? 0 : (burning ? JET.boostThrust : JET.thrust)) * thin;
    const maxS = burning ? JET.boostSpeed : JET.maxSpeed;
    let s = this.speedScalar || JET.maxSpeed * 0.5;
    s += (thrust - s * 0.55) * dt;
    s += -fwd.y * JET.gravity * 1.35 * dt;      // dives pay you, climbs charge you
    s = clamp(s, this.glide ? JET.glideMinSpeed : JET.minSpeed, maxS);
    this.speedScalar = s;

    this.vel.copyFrom(fwd).scaleInPlace(s);
    // Below flying speed the wings stop working and you drop.
    const stall = Math.max(0, (JET.stallSpeed - s)) * (this.glide ? 0.62 : 0.40);
    this.vel.y -= stall + (1 - thin) * 22;
    this.vel.y += this.jetLift;

    // Ground proximity. Always on, autopilot or not — a dive at a hillside
    // gets softened rather than ended, which is what makes the jet learnable.
    const clear = this.pos.y - ghNow;
    if (clear < JET.avoidRange) {
      const t = 1 - Math.max(clear, 0) / JET.avoidRange;
      this.vel.y += JET.avoidLift * t * t;
      this.pitch = lerp(this.pitch, -0.30, (1 - Math.exp(-2.4 * dt)) * t);
      this.nearGround = t;
    } else {
      this.nearGround = 0;
    }

    this.pos.addInPlace(this.vel.scale(dt));

    /* Out. The approach altitude is the edge of local flight, so climbing
       through it IS the departure — no key, no mode, no confirmation. The jet's
       own ceiling sits just above it, which makes leaving a world the last
       thing the jet can do under its own power.
       CLIMBING through, specifically: an arrival is handed back at this exact
       altitude, and without the sign of the vertical speed the craft would
       depart again on the frame it landed, forever. */
    if (this.pos.y > HYPER.approachAlt && this.vel.y > 0) { this.enterHyper(); return; }

    const gh = this.surf.surfaceHeight(this.pos.x, this.pos.z);
    const floor = Math.max(gh, WORLD.waterY);
    this.onWater = this.surf.planet.hasWater && gh < WORLD.waterY;

    if (this.pos.y < floor + 1.3) {
      const impact = Math.abs(this.vel.y) + s * 0.35;
      this.pos.y = floor + 1.3;
      if (impact > JET.crashSpeed) {
        this.shake = 1;
        this.fuel = Math.max(0, this.fuel - 6);
        emit('crash', { pos: this.world.clone(), speed: s });
      } else {
        emit('landed', { pos: this.world.clone(), water: this.onWater });
      }
      this.speedScalar = Math.min(s, ROVER.maxSpeed);
      this.setMode(this.onWater ? 'boat' : 'rover');
      return;
    }

    this.grounded = false;
  }

  /**
   * The drone: a hover, not a wing. It holds height with no input — the fourth
   * physics model is mostly a vertical spring — and it moves by TILTING, with
   * the thruster pods visibly vectoring in applyTransform. Precise and slow
   * beside the jet: the jet crosses the world, this gets you into a canyon and
   * back out.
   *
   * There is no descend key on purpose. The hover line follows the floor, so
   * flying out over a canyon IS the descent, and Space (climb) is how you get
   * back out; the held height stays where you leave it, which is the "holds
   * altitude without input" the form is for. R lands it, like everything else.
   */
  updateDrone(dt, input, boost) {
    const drain = boost ? DRONE.boostBurn : DRONE.burn;
    this.fuel = Math.max(0, this.fuel - drain * dt);
    this.flightTime += dt;
    if (this.fuel <= 0) {
      /* Out of charge the rotors stop, and what happens next is whatever
         happens to a falling rover — a form that already knows how to fall,
         open a canopy and land. The transform carries the momentum whole. */
      emit('fuelout', {});
      this.setMode(this.onWater ? 'boat' : 'rover');
      return;
    }

    // Yaw is direct, quadcopter-style; tilt is how you move.
    this.yaw += input.turn * DRONE.turnRate * dt;
    const wantPitch = input.fwd * DRONE.tilt * (boost ? 1.25 : 1);
    this.pitch = damp(this.pitch, wantPitch, DRONE.tiltRate, dt);
    this.roll = damp(this.roll, -input.turn * DRONE.tilt * 0.55, DRONE.tiltRate, dt);

    // Thrust follows the tilt — the pods vector, the craft slides after them.
    const a = (boost ? DRONE.boostAccel : DRONE.accel) * (this.pitch / DRONE.tilt);
    this.vel.x += Math.sin(this.yaw) * a * dt;
    this.vel.z += Math.cos(this.yaw) * a * dt;
    const drag = Math.exp(-DRONE.drag * dt);
    this.vel.x *= drag; this.vel.z *= drag;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const maxS = boost ? DRONE.boostSpeed : DRONE.maxSpeed;
    if (hs > maxS) { const k = maxS / hs; this.vel.x *= k; this.vel.z *= k; }
    this.speedScalar = Math.hypot(this.vel.x, this.vel.z);

    if (input.hopHeld) {
      this.droneLift = Math.min(DRONE.maxLift, this.droneLift + DRONE.climbRate * dt);
    }
    const gh = this.surf.surfaceHeight(this.pos.x, this.pos.z);
    const floor = Math.max(gh, this.surf.planet.hasWater ? WORLD.waterY : -Infinity);
    this.onWater = this.surf.planet.hasWater && gh < WORLD.waterY;
    const wantY = floor + DRONE.hover + this.droneLift;
    // A spring on the climb RATE, not a snap to the position: the ease as it
    // crests a ridge is what reads as mass.
    const wantV = clamp((wantY - this.pos.y) * DRONE.hoverSpring,
      -DRONE.sinkRate, DRONE.riseRate);
    this.vel.y = damp(this.vel.y, wantV, DRONE.hoverDamp, dt);

    this.pos.addInPlace(this.vel.scale(dt));

    // The skids kiss the ground rather than clip it; R is how you land.
    if (this.pos.y < floor + 0.6) {
      this.pos.y = floor + 0.6;
      if (this.vel.y < 0) this.vel.y = 0;
    }
    this.grounded = false;
    this.airborne = false;
  }

  addFuel(v) {
    this.fuel = Math.min(FUEL.max, this.fuel + v);
  }

  applyTransform() {
    const form = this.forms[this.mode];
    const root = form.root;

    /* In transit there is no tangent frame, so the craft carries its own —
       and it is composed the same way, which is the point. The local rotation
       is the identity because the transit basis IS the craft's axes: it is
       aimed at the heading and banked onto the gravity field every frame, so
       there is nothing left for a yaw, pitch and roll to say.
       This used to be RotationYawPitchRoll(heading, pitch, 0), which references
       world +Y. See TransitFrame for what that cost at the boundary. */
    if (this.hyper) {
      root.position.copyFrom(this.world);
      if (!root.rotationQuaternion) root.rotationQuaternion = new BABYLON.Quaternion();
      frameQuat(this.transit, root.rotationQuaternion);
      return;
    }

    // Local -> world. The frame supplies the position and the orientation of
    // the tangent basis; the craft's own yaw/pitch/roll then compose on top of
    // it, which is how a y-up vehicle ends up standing on the side of a ball.
    const fr = this.surf.frame;
    const w = fr.toWorld(this.pos.x, this.pos.y, this.pos.z, WTMP);
    this.world.set(w.x, w.y, w.z);
    root.position.set(w.x, w.y, w.z);

    const local = BABYLON.Quaternion.RotationYawPitchRoll(this.yaw, this.pitch, this.roll);
    if (!FQ) FQ = new BABYLON.Quaternion();
    frameQuat(fr, FQ);
    if (!root.rotationQuaternion) root.rotationQuaternion = new BABYLON.Quaternion();
    FQ.multiplyToRef(local, root.rotationQuaternion);

    /* The canopy, scaled up out of nothing so that the OPENING is the thing you
       see rather than a chute that was suddenly there. It widens faster than it
       rises, which is how fabric actually fills, and it swings on a slow double
       pendulum while it is bleeding off your drift. Parented to the form root,
       so it inherits the tangent frame and hangs along local up on a sphere
       without any of that arithmetic happening twice. */
    if (form.chute) {
      const c = this.chute;
      form.chute.setEnabled(c > 0.01);
      if (c > 0.01) {
        form.chute.scaling.set(0.30 + c * 0.70, 0.22 + c * 0.78, 0.30 + c * 0.70);
        form.chute.position.y = 2.0 + c * 2.8;
        form.chute.rotation.z = Math.sin(this.time * 1.7) * 0.11 * c;
        form.chute.rotation.x = Math.cos(this.time * 1.3) * 0.09 * c;
      }
    }

    // Suspension travel is applied to the children, not the root, so the
    // vehicle's contact point with the world stays honest.
    if (form.body) form.body.position.y = this.bodyY;

    if (form.wheels) {
      for (let i = 0; i < form.wheels.length; i++) {
        const w = form.wheels[i];
        const md = w.metadata;
        if (!md) continue;
        const jig = this.jiggle
          ? Math.sin(this.time * 13 + i * 1.9) * 0.022 * this.jiggle : 0;
        // Independent strut travel, plus the hop's shared body motion.
        w.position.y = md.restY + md.travel + this.wheelY + jig;
        w.rotation.x = this.wheelSpin;
      }
    }

    // Pistons stretch to reach their hub, so you can see the struts working.
    if (form.struts) {
      for (let i = 0; i < form.struts.length; i++) {
        const p = form.struts[i];
        const wmd = form.wheels[i].metadata;
        const reach = p.metadata.anchorY - (wmd.restY + wmd.travel + this.wheelY);
        p.scaling.y = Math.max(SUSP.strutMin, reach);
      }
    }

    /* The pods swivel — thrust vectoring is the drone's whole character. They
       lean further than the body does (DRONE.swivel multiplies the tilt), so
       a hard forward tilt reads as four rotors visibly pulling the craft
       along rather than a brick gliding under a slab. */
    if (form.pods) {
      for (const pod of form.pods) {
        const md = pod.metadata;
        pod.rotation.x = md.baseX + this.pitch * DRONE.swivel;
        pod.rotation.z = -this.roll * DRONE.swivel * 0.8;
      }
    }

    if (form.arms) {
      for (let i = 0; i < form.arms.length; i++) {
        const a = form.arms[i];
        const md = a.metadata;
        if (!md) continue;
        const travel = form.wheels[i].metadata.travel + this.wheelY;
        a.position.y = md.baseY + travel * 0.75;
        // Arms swing as the wheels drop away — reads as travel, not float.
        a.rotation.z = md.baseRoll * (1 - travel * 0.5);
      }
    }
  }
}
