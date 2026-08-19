// The instrument panel. Everything here answers a question the player is
// actually asking: which way is the nearest unscanned beacon, how much flight
// do I have left, and can I afford to take off right now.

import { on } from '../core/events.js';
import { FUEL, JET, ROVER, COLORS, ECONOMY, PLANETS, DEBUG } from '../tune.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DEG = 180 / Math.PI;
// The tape grows a band for the artificial horizon when you're flying, and
// gives it back when you land — a permanently empty strip reads as a bug.
const TAPE_H = 44;
const TAPE_H_AIR = 74;
const HORIZON_Y = 46;
const BRG = { x: 0, y: 0, z: 0 };
const rgb = (c, a = 1) => `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${a})`;

/**
 * A CONTEXTUAL element: a trigger, a HOLD, and then a slow fade.
 *
 * The hold is the part that matters, and it is why this is a class rather than
 * a classList.toggle at each call site. Driving a panel straight off its
 * trigger makes it strobe: the scan bar would blink several times a second as
 * a beacon drifts in and out of range, and the beam would flash on every tap
 * of E. A HUD that flickers is worse than one that never moved.
 *
 * So a trigger tops the timer back up and the element only leaves once nothing
 * has touched it for `hold` seconds. The fade itself is CSS - see .cue, which
 * is deliberately asymmetric: fast in so the cue arrives with the event, slow
 * out so the departure is never the thing you notice.
 */
class Cue {
  constructor(el, hold) { this.el = el; this.hold = hold; this.t = 0; this.lit = false; }
  bump() { this.t = this.hold; }
  tick(dt) {
    if (this.t > 0) this.t -= dt;
    const want = this.t > 0;
    if (want === this.lit || !this.el) return;
    this.lit = want;
    this.el.classList.toggle('on', want);
  }
}

export class Hud {
  constructor(craft, survey, field, colonies) {
    this.craft = craft;
    this.survey = survey;
    this.field = field;
    this.colonies = colonies;

    this.el = {
      speed: $('speed'), speedUnit: $('speedUnit'),
      alt: $('alt'), altRow: $('altRow'),
      coord: $('coord'), sectors: $('sectors'), beacons: $('beacons'),
      colonies: $('colonies'), log: $('log'),
      fuelNum: $('fuelNum'), fuelBar: $('fuelBar'), cellGauge: $('cellGauge'),
      hyperBar: $('hyperBar'), hyperNum: $('hyperNum'), hyperGauge: $('hyperGauge'),
      scan: $('scan'), scanFill: $('scanFill'),
      beamRow: $('beamRow'), beamState: $('beamState'),
      flood: $('flood'), floodFill: $('floodFill'),
      toast: $('toast'), streaks: $('streaks'), flash: $('flash'),
      chips: {
        rover: $('chipRover'), boat: $('chipBoat'), jet: $('chipJet'),
      },
      range: $('range'),
      warp: $('warp'), warpRow: $('warpRow'),
    };

    this.root = $('hud');
    this.compass = $('compass');
    this.ctx = this.compass.getContext('2d');
    this.tapeH = TAPE_H;
    this.resize();
    window.addEventListener('resize', () => this.resize());

    /* THE CONTEXTUAL SET, with the hold each one earns.
       The log is long because its figures move in bursts - three beacons in a
       row, then nothing for a minute - and a panel that came and went between
       each would be the worst thing on screen. The scan and beam are short
       because their trigger is continuous while it lasts, so the hold only has
       to cover the gap between one and the next. Flooding sits between: it
       clears the moment you climb out of the water, and a rover that dips a
       wheel should not have the panel snap away before you have read it. */
    this.cues = {
      log: new Cue(this.el.log, 6),
      scan: new Cue(this.el.scan, 1.2),
      flood: new Cue(this.el.flood, 2.2),
      beam: new Cue(this.el.beamRow, 1.6),
      range: new Cue(this.el.range, 1.0),
      alt: new Cue(this.el.altRow, 1.5),
    };
    // Once at the start, so the log is something you have seen rather than
    // something you have to discover by watching a number change.
    this.cues.log.bump();
    this.lastLog = '';

    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.toastTimer = 0;
    this.lastMode = null;
    this.lastFuelState = null;

    // Build the segmented cell gauge once.
    for (let i = 0; i < 20; i++) {
      const seg = document.createElement('i');
      this.el.fuelBar.appendChild(seg);
    }
    this.segs = [...this.el.fuelBar.querySelectorAll('i')];

    on('hyperdenied', (e) => this.say(
      `NOT ENOUGH HYPER FOR ${e.name.toUpperCase()}  ` +
      `${Math.ceil(e.need)} NEEDED, ${Math.floor(e.have)} HELD`, 'bad'));
    on('colony', (e) => {
      if (e.geyser) this.say('VENT CLAIMED  ·  HYPER PRODUCTION ONLINE', 'good');
    });
    on('pickup', () => this.say('CELL RECOVERED  +' + FUEL.cellValue, 'good'));
    on('scanned', () => this.say('BEACON LOGGED  +' + FUEL.beaconValue, 'good'));
    on('scanstart', () => { this.el.scan.classList.add('on'); });
    on('scanabort', () => { this.el.scan.classList.remove('on'); });
    on('denied', () => this.say('CELL CHARGE TOO LOW TO LAUNCH', 'warn'));
    on('fuelout', () => this.say('CELLS DRY — GLIDING', 'warn'));
    on('crash', () => { this.say('HARD CONTACT', 'warn'); this.punch(); });
    on('transform', (e) => {
      if (e.to === 'jet') this.say('AUTOPILOT — W / S TO TAKE THE CONTROLS', 'good');
    });
    on('manual', () => this.say('MANUAL CONTROL', 'good'));
    on('flood', () => this.say('HULL FLOODING — TURN BACK OR HIT 2', 'warn'));
    on('drown', (e) => {
      this.say('SWAMPED — RECOVERED, −' + Math.round(e.cost) + ' CHARGE', 'warn');
      this.punch();
    });
    on('hop', (e) => { if (e.chain >= 2) this.say('CHAIN ×' + e.chain, 'good'); });
    on('probedrop', () => this.say('COLONISER AWAY', 'good'));
    on('colony', () => this.say('SITE ESTABLISHED — HABITAT INFLATING', 'good'));
    on('colonygrow', (e) => this.say('COLONY EXPANDING — DOME ' + e.stage, 'good'));
    on('probelost', (e) => this.say(e.why === 'water' ? 'PROBE LOST — WATER' : 'PROBE LOST — TERRAIN TOO STEEP', 'warn'));
    /* Raiders. A contact is announced wherever you are, because the world it
       happened on may not be the one you are standing on — that is the whole
       point of wall time, and an attack you are never told about is
       indistinguishable from a bug that eats colonies. */
    /* Throttled, and named. Six worlds are being attacked at once by the middle
       of a session, so an untimed toast per contact is a wall of text — but a
       contact somewhere you are not is exactly the thing worth being told. */
    this.raiderCool = 0;
    on('raider', (e) => {
      if (this.raiderCool > 0) return;
      this.raiderCool = 14;
      const here = this.colonies && this.colonies.planet.key === e.world;
      this.say(here ? 'RAIDER CONTACT — HOLD E TO DISRUPT'
        : 'RAIDER CONTACT ON ' + e.world.toUpperCase(), 'warn');
    });
    on('raiderkill', (e) => {
      if (e.by === 'ram') this.say('RAIDER RAMMED', 'good');
      else if (e.by === 'beam') this.say('RAIDER DISRUPTED', 'good');
    });
    /* What the away window did, in one line. Colonies grow while the tab is
       shut and raiders attack while it is shut — both capped to the same hour —
       so coming back to fewer colonies than you left has to be stated rather
       than discovered by counting. */
    on('away', (e) => {
      const mins = Math.round(e.seconds / 60);
      this.say(e.lost
        ? `AWAY ${mins} MIN — ${e.lost} ${e.lost > 1 ? 'COLONIES' : 'COLONY'} LOST ` +
          `ON ${e.worlds.join(', ').toUpperCase()}`
        : e.held ? `AWAY ${mins} MIN — TURRETS HELD, ${e.held} RAIDERS DESTROYED`
        : `AWAY ${mins} MIN — ALL COLONIES INTACT`,
      e.lost ? 'bad' : 'good');
    });
    on('colonylost', (e) => {
      this.say(e.geyser ? 'COLONY LOST — VENT UNCLAIMED' : 'COLONY LOST', 'bad');
      this.punch();
    });
    on('dropfail', (e) => this.say(
      e.why === 'fuel' ? 'NOT ENOUGH CHARGE FOR A COLONISER'
      : e.why === 'low' ? 'TOO LOW TO DROP A COLONISER'
      : 'COLONISERS DROP FROM THE JET', 'warn'));
  }

  resize() {
    const w = Math.min(560, window.innerWidth - 40);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const h = this.tapeH || TAPE_H;
    this.compass.width = w * dpr;
    this.compass.height = h * dpr;
    this.compass.style.width = w + 'px';
    this.compass.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cw = w;
    this.ch = h;
  }

  /** Only ever called when the form changes, never per frame. */
  setTapeHeight(h) {
    if (this.tapeH === h) return;
    this.tapeH = h;
    this.resize();
    // Everything stacked under the tape moves down with it.
    this.root.classList.toggle('flying', h === TAPE_H_AIR);
  }

  say(text, kind) {
    this.el.toast.textContent = text;
    this.el.toast.className = 'on ' + (kind || '');
    this.toastTimer = 2.2;
  }

  punch() {
    if (this.reduced) return;
    this.el.flash.classList.remove('on');
    void this.el.flash.offsetWidth;
    this.el.flash.classList.add('on');
  }

  /**
   * Artificial horizon. Only drawn when you're flying, because that's the only
   * time roll and pitch are things you can lose track of — and losing track of
   * them is the whole reason a jet feels disorienting.
   */
  drawAttitude(roll, pitch) {
    const ctx = this.ctx, w = this.cw;
    const h = TAPE_H_AIR - HORIZON_Y;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HORIZON_Y, w, h);
    ctx.clip();

    ctx.translate(w / 2, HORIZON_Y + h / 2 + Math.max(-40, Math.min(40, pitch * 34)));
    ctx.rotate(-roll);

    ctx.strokeStyle = rgb(COLORS.coast, 0.55);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-88, 0); ctx.lineTo(-16, 0);
    ctx.moveTo(16, 0); ctx.lineTo(88, 0);
    ctx.stroke();

    ctx.strokeStyle = rgb(COLORS.phosphor, 0.30);
    ctx.lineWidth = 1;
    for (const d of [-18, 18]) {
      ctx.beginPath();
      ctx.moveTo(-30, d); ctx.lineTo(30, d);
      ctx.stroke();
    }
    ctx.restore();

    // Fixed craft mark, so the horizon is read against something.
    ctx.strokeStyle = rgb(COLORS.beacon, 0.95);
    ctx.lineWidth = 2;
    ctx.beginPath();
    const cy = HORIZON_Y + h / 2;
    ctx.moveTo(w / 2 - 12, cy); ctx.lineTo(w / 2 - 4, cy);
    ctx.moveTo(w / 2 + 4, cy); ctx.lineTo(w / 2 + 12, cy);
    ctx.moveTo(w / 2, cy - 3); ctx.lineTo(w / 2, cy + 3);
    ctx.stroke();
  }

  drawCompass(yaw) {
    const ctx = this.ctx, w = this.cw;
    ctx.clearRect(0, 0, w, this.ch);

    const pxPerDeg = w / 150;              // ~150 degrees of arc visible
    const heading = ((yaw * DEG) % 360 + 360) % 360;

    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';

    for (let d = -80; d <= 80; d += 5) {
      const bearing = heading + d;
      const x = w / 2 + d * pxPerDeg;
      if (x < 8 || x > w - 8) continue;
      const norm = ((bearing % 360) + 360) % 360;
      const major = Math.abs(norm % 90) < 2.5;
      const mid = Math.abs(norm % 30) < 2.5;
      const fade = 1 - Math.min(1, Math.abs(d) / 80);
      ctx.strokeStyle = rgb(COLORS.phosphor, (major ? 0.95 : mid ? 0.5 : 0.22) * fade);
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, major ? 12 : mid ? 17 : 20);
      ctx.lineTo(x, 26);
      ctx.stroke();
      if (major) {
        const label = ['N', 'E', 'S', 'W'][Math.round(norm / 90) % 4];
        ctx.fillStyle = rgb(COLORS.coast, 0.9 * fade);
        ctx.fillText(label, x, 40);
      }
    }

    // Beacon bearing marker — the one thing on screen that tells you where to go.
    const b = this.survey.nearestBeacon;
    if (b) {
      // Bearing has to be taken in the craft's own tangent frame. Subtracting
      // world coordinates gives a chord through the planet, which points at
      // the wrong thing as soon as the target is over the curve.
      const L = this.craft.surf.toLocal(b.world.x, b.world.y, b.world.z, BRG);
      const bearing = ((Math.atan2(L.x, L.z) * DEG) % 360 + 360) % 360;
      let rel = bearing - heading;
      while (rel > 180) rel -= 360;
      while (rel < -180) rel += 360;
      const clamped = Math.max(-78, Math.min(78, rel));
      const x = w / 2 + clamped * pxPerDeg;
      const off = Math.abs(rel) > 78;
      ctx.fillStyle = rgb(COLORS.beacon, off ? 0.5 : 1);
      ctx.beginPath();
      ctx.moveTo(x, 4); ctx.lineTo(x - 5, 13); ctx.lineTo(x + 5, 13);
      ctx.closePath(); ctx.fill();
    }

    // Fixed centre index.
    ctx.strokeStyle = rgb(COLORS.coast, 0.95);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, 6); ctx.lineTo(w / 2, 30);
    ctx.stroke();
  }

  /**
   * The economy. Kept for the hyper gauge, which is one of the five permanent
   * readings; everything else it used to draw here has MOVED.
   *
   * The six planet pips, the vents-claimed count, the hyper rate and the
   * threat number are all gone from the HUD. The survey overlay already draws
   * every one of them as a table with a row per world - see systemRows in
   * overlay.js - so this was a second copy of the same four figures, kept
   * permanently on screen, for a world you are standing on and five you are
   * not. A number you cannot act on without opening the map belongs on the map.
   *
   * The signature is unchanged because main.js calls it and main.js is not
   * this job's file.
   */
  attachEconomy(economy, totals, planetKeys) {
    this.economy = economy;
    this.totals = totals;
    this.planetKeys = planetKeys;
  }

  /**
   * TEMPORARY TESTING SCAFFOLDING — the dev warp row.
   *
   * Six labelled buttons, one per world, the one you are standing on lit. It
   * replaces the Shift+1..6 bindings this had in phase 3a, which were fine at a
   * bare URL and useless everywhere the game actually gets looked at: inside an
   * iframe the modifier never reaches the canvas, so the only way to see a
   * second world was to fly there.
   *
   * It owns no warp logic. `pick` is main.js's handler and goes down exactly
   * the path an arrival takes; this is a button and a highlight.
   *
   * Gated on DEBUG.warp, and gated HARD: with the flag off the panel is removed
   * from the document rather than hidden, so there is nothing left to un-hide
   * from a console.
   */
  attachWarp(keys, current, pick) {
    if (!DEBUG.warp) { this.el.warp?.remove(); return; }
    this.warpBtns = keys.map((key) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wbtn';
      b.dataset.key = key;
      b.textContent = (PLANETS[key]?.name || key).toUpperCase();
      b.addEventListener('click', () => pick(key));
      /* The canvas keeps the keyboard. Without this the button holds focus
         after a warp and the next W goes nowhere — which reads as the warp
         having broken the controls. */
      b.addEventListener('pointerup', () => document.getElementById('stage').focus());
      this.el.warpRow.appendChild(b);
      return b;
    });
    this.el.warp.hidden = false;
    this.setWorld(current);
  }

  /** Light the world you are on. Called from every arrival, warped or flown. */
  setWorld(key) {
    if (!this.warpBtns) return;
    for (const b of this.warpBtns) {
      const here = b.dataset.key === key;
      b.classList.toggle('on', here);
      b.disabled = here;
      b.setAttribute('aria-current', here ? 'true' : 'false');
    }
  }

  /** The world under you changed. Same player, same panel, new instruments. */
  retarget(survey, field, colonies) {
    this.survey = survey;
    this.field = field;
    this.colonies = colonies;
  }

  update(dt) {
    const c = this.craft, s = this.survey;

    /* Speed. In transit the number leaves km/h behind entirely — at the cap
       that reading is ten digits long and means nothing. A plain number and a
       changed unit is all this phase needs; the FX are 3c's job. */
    if (c.hyper) {
      /* Every digit, grouped, in metres per second. Switching to km/s would
         keep the number short and lose the entire point: what sells the speed
         is the readout visibly running out of room, 158 -> 1 000 000 -> 158,
         with the groups appearing one at a time as it goes. */
      const v = Math.round(c.speed);
      this.el.speed.textContent = String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      this.el.speedUnit.textContent = 'M/S';
      // Shrink in steps as the groups arrive, so it never overruns the panel.
      const digits = String(v).length;
      this.el.speed.className = digits > 6 ? 'vast' : digits > 4 ? 'huge' : '';
    } else {
      this.el.speed.textContent = Math.round(c.speed * 3.6).toString().padStart(3, '0');
      this.el.speedUnit.textContent = 'KM/H';
      if (this.el.speed.className) this.el.speed.className = '';
    }
    // Local coordinates mean nothing between worlds; where you are going does.
    this.el.coord.textContent = c.hyper
      ? ('→ ' + (c.hyper.target ? c.hyper.target.name.toUpperCase() : 'OPEN SYSTEM'))
      : `${c.pos.x < 0 ? '−' : '+'}${Math.abs(c.pos.x).toFixed(0).padStart(5, '0')}  ` +
        `${c.pos.z < 0 ? '−' : '+'}${Math.abs(c.pos.z).toFixed(0).padStart(5, '0')}`;
    this.el.sectors.textContent = this.field.sectorsMapped.toString().padStart(3, '0');
    this.el.beacons.textContent = s.beaconsScanned.toString().padStart(2, '0');
    if (this.colonies) {
      this.el.colonies.textContent = this.colonies.count.toString().padStart(2, '0') +
        ' / ' + this.colonies.domes.toString().padStart(2, '0');
    }
    /* The log's trigger is its own content changing. Comparing the rendered
       strings rather than watching each source means a figure added later is
       covered without anyone remembering to wire it up, and it costs one
       concatenation a frame. */
    const logNow = this.el.sectors.textContent + this.el.beacons.textContent +
      this.el.colonies.textContent;
    if (logNow !== this.lastLog) { this.lastLog = logNow; this.cues.log.bump(); }

    // The beam. A state rather than a gauge: it is firing or it is not, and the
    // only other thing worth knowing is whether it is on something.
    if (this.el.beamRow) {
      // Up while it fires, and for a moment after — see Cue. The idle "HOLD E"
      // is gone: a control you are not using does not need a panel, and the
      // key is written down in the pause menu.
      if (s.beamOn) this.cues.beam.bump();
      this.el.beamRow.classList.toggle('hit', !!s.beamHits);
      const label = s.beamOn
        ? (s.beamHits ? 'ON TARGET ×' + s.beamHits : 'BEAM ACTIVE')
        : (c.fuel <= 2 ? 'CHARGE TOO LOW' : 'BEAM IDLE');
      if (label !== this.lastBeam) { this.el.beamState.textContent = label; this.lastBeam = label; }
    }

    const flying = c.mode === 'jet';
    // Altitude in transit is measured off the nearest world, which is the same
    // number the speed law is reading — so the panel shows you why you are
    // going as fast as you are.
    if (c.hyper) {
      this.cues.alt.bump();
      this.el.alt.textContent = Math.round(c.hyper.alt).toString();
    }
    this.setTapeHeight(flying ? TAPE_H_AIR : TAPE_H);
    if (flying) this.cues.alt.bump();
    if (flying && !c.hyper) {
      this.el.alt.textContent = Math.max(0, Math.round(c.altitude)).toString();
      this.el.altRow.classList.toggle('auto', c.assist > 0);
      this.el.altRow.classList.toggle('pull', c.nearGround > 0.45);
    }

    // Fuel gauge.
    const pct = c.fuel / FUEL.max;
    const lit = Math.round(pct * this.segs.length);
    const state = c.fuel < 10 ? 'crit' : c.fuel < JET.minFuelToLaunch * 3 ? 'low' : 'ok';
    if (state !== this.lastFuelState) {
      this.el.fuelBar.className = state;
      // The head carries it too, so the number and the icon warn with the bar
      // rather than leaving the bar to say it alone.
      if (this.el.cellGauge) this.el.cellGauge.className = 'gauge ' + state;
      this.lastFuelState = state;
    }
    for (let i = 0; i < this.segs.length; i++) {
      this.segs[i].classList.toggle('lit', i < lit);
    }
    this.el.fuelNum.textContent = Math.round(c.fuel).toString().padStart(3, '0');

    // ---- the economy ----------------------------------------------------
    if (this.economy) {
      const e = this.economy;
      const pct = clamp(e.hyper / ECONOMY.maxHyper, 0, 1) * 100;
      if (Math.abs(pct - (this.lastHyper || 0)) > 0.4) {
        this.lastHyper = pct;
        this.el.hyperBar.style.setProperty('--fill', pct.toFixed(1) + '%');
        const empty = e.hyper < 12;
        this.el.hyperBar.classList.toggle('empty', empty);
        if (this.el.hyperGauge) this.el.hyperGauge.classList.toggle('empty', empty);
        this.el.hyperNum.textContent = Math.round(e.hyper).toString().padStart(3, '0');
      }
    }

    // Mode chips.
    if (c.mode !== this.lastMode) {
      for (const key of ['rover', 'boat', 'jet']) {
        this.el.chips[key].classList.toggle('on', key === c.mode);
      }
      this.lastMode = c.mode;
    }
    this.el.chips.jet.classList.toggle('locked', c.fuel < JET.minFuelToLaunch);

    // Flooding. Shows the moment the hull starts taking water, well before
    // there's any danger, so going under is never a surprise.
    const swamp = c.swamp || 0;
    const sinking = (c.sinkY || 0) > 0.05;
    if (swamp > 0.05) this.cues.flood.bump();
    this.el.flood.classList.toggle('crit', sinking);
    if (swamp > 0.05) {
      const shown = sinking ? Math.max(swamp, c.submersion) : swamp;
      this.el.floodFill.style.width = (shown * 100).toFixed(0) + '%';
    }

    // Scan bar.
    if (s.scanTarget) {
      this.cues.scan.bump();
      this.el.scanFill.style.width = (s.scanProgress * 100).toFixed(1) + '%';
    }

    // Range to the next beacon.
    if (s.nearestBeacon) {
      this.el.range.textContent = Math.round(s.nearestDist) + ' M';
      this.cues.range.bump();
    }

    // Boost streaks.
    if (!this.reduced) {
      // Scaled to the rover's boost speed, so a ground boost still streaks.
      this.el.streaks.style.opacity =
        (c.boostHeat * Math.min(1, c.speed / ROVER.boostSpeed) * 0.85).toFixed(3);
    }

    for (const key in this.cues) this.cues[key].tick(dt);

    if (this.raiderCool > 0) this.raiderCool -= dt;
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.className = '';
    }

    this.drawCompass(c.yaw);
    if (flying) this.drawAttitude(c.roll, c.pitch);
  }
}
