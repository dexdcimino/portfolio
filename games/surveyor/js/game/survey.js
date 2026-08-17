// The reason to go anywhere. Fuel cells are scattered currency; beacons are
// the actual job — park near one, hold still enough to scan it, get paid in
// flight time. Both stream with the chunk grid and are placed deterministically,
// so a beacon you saw from the air is still there when you drive back.

import { rngFor, range } from '../core/rng.js';
import { height } from '../world/noise.js';
import { faceDir, dirToFace, arcBetween } from '../world/sphere.js';
import { placeOnSphere } from '../world/surface.js';
import { FUEL, COLORS } from '../tune.js';
import { emit } from '../core/events.js';

// Props stream on a coarse cube-face grid rather than the old (cx, cz) chunk
// grid. The cell is sized in uv, so it covers the same arc on any planet.
const PROP_CELLS = 12;              // cells per face edge
const PROP_RING = 2;                // rings of cells kept alive around you
const SCAN_RANGE = 34;
const SCAN_TIME = 2.0;

const D = { x: 0, y: 0, z: 0 };
const FC = { f: 0, u: 0, v: 0 };

export class Survey {
  constructor(scene, craft, planet) {
    this.scene = scene;
    this.craft = craft;
    this.planet = planet;
    this.cellUV = 2 / PROP_CELLS;
    this.active = new Map();     // chunkKey -> { cells:[], beacon }
    this.scanned = new Set();
    this.collected = new Set();
    this.center = '';
    this.beaconsScanned = 0;
    this.cellsCollected = 0;
    this.scanTarget = null;
    this.scanProgress = 0;

    this.matCell = this.emissive('cell', COLORS.phosphor);
    this.matBeacon = this.emissive('beaconLit', COLORS.beacon);
    this.matBeaconDone = this.emissive('beaconDone', COLORS.phosphor);
    this.matStone = new BABYLON.StandardMaterial('beaconStone', scene);
    this.matStone.diffuseColor = new BABYLON.Color3(0.18, 0.22, 0.25);
    this.matStone.specularColor = new BABYLON.Color3(0, 0, 0);

    // Templates, cloned per instance.
    this.cellProto = BABYLON.MeshBuilder.CreatePolyhedron('cellProto',
      { type: 1, size: 0.85 }, scene);
    this.cellProto.material = this.matCell;
    this.cellProto.setEnabled(false);
    this.cellProto.isPickable = false;
    this.cellProto.renderingGroupId = 1;
  }

  /**
   * Emissive above 1.0 on purpose: that is the threshold the HDR bloom pass
   * picks up, and it is why these read as lit objects rather than as flat
   * coloured polys. They are ordinary scene meshes, so terrain occludes them.
   */
  emissive(name, c, k = 2.3) {
    const m = new BABYLON.StandardMaterial(name, this.scene);
    m.emissiveColor = new BABYLON.Color3(c[0] * k, c[1] * k, c[2] * k);
    m.diffuseColor = new BABYLON.Color3(0, 0, 0);
    m.specularColor = new BABYLON.Color3(0, 0, 0);
    m.disableLighting = true;
    return m;
  }

  // ---- placement -------------------------------------------------------

  /** One cube-face cell worth of props. */
  spawnCell(f, iu, iv) {
    const P = this.planet;
    const c = this.cellUV;
    const u0 = -1 + iu * c, v0 = -1 + iv * c;
    const key = f + ':' + iu + ',' + iv;
    const rng = rngFor(P.seed, 'props:' + key);
    const entry = { cells: [], beacon: null };

    const nCells = 1 + ((rng() * 3) | 0);
    for (let i = 0; i < nCells; i++) {
      const ck = 'c:' + key + ',' + i;
      if (this.collected.has(ck)) continue;
      faceDir(f, u0 + rng() * c, v0 + rng() * c, D);
      const h = height(D, P);
      // Cells float above water and hover over land — always reachable.
      const y = Math.max(h, 0) + range(rng, 2.4, 5.0);
      const m = this.cellProto.clone(ck);
      m.setEnabled(true);
      m.renderingGroupId = 1;
      placeOnSphere(m, P, D, y, 0);
      m.metadata = {
        key: ck, baseY: y, phase: rng() * 6.28,
        dir: { x: D.x, y: D.y, z: D.z },
      };
      entry.cells.push(m);
    }

    // Roughly one beacon per four cells, always on dry, fairly level ground.
    if (rng() < 0.26) {
      const bu = u0 + range(rng, 0.15, 0.85) * c;
      const bv = v0 + range(rng, 0.15, 0.85) * c;
      faceDir(f, bu, bv, D);
      const h = height(D, P);
      const dir = { x: D.x, y: D.y, z: D.z };
      // Slope from a small uv step, converted to metres per metre.
      const du = c * 0.02;
      const scale = P.faceArc * 0.5 * du;
      faceDir(f, bu + du, bv, D);
      const su = Math.abs(height(D, P) - h);
      faceDir(f, bu, bv + du, D);
      const sv = Math.abs(height(D, P) - h);
      const slope = Math.hypot(su, sv) / Math.max(scale, 0.001);
      if (h > 0.04 * P.relief && slope < 0.6) {
        entry.beacon = this.buildBeacon('b:' + key, dir, h);
      }
    }

    this.active.set(key, entry);
  }
  buildBeacon(key, dir, elevation) {
    const root = new BABYLON.TransformNode('beacon_' + key, this.scene);
    // Beacons stand on the radial, so a mast is upright wherever it lands.
    placeOnSphere(root, this.planet, dir, elevation, 0);

    const shaft = BABYLON.MeshBuilder.CreateCylinder('shaft',
      { height: 15, diameterTop: 1.1, diameterBottom: 2.4, tessellation: 7 }, this.scene);
    shaft.parent = root;
    shaft.position.y = 7.0;
    shaft.material = this.matStone;
    shaft.isPickable = false;
    shaft.renderingGroupId = 1;

    const lit = this.scanned.has(key);
    const crystal = BABYLON.MeshBuilder.CreatePolyhedron('crystal',
      { type: 2, size: 1.5 }, this.scene);
    crystal.parent = root;
    crystal.position.y = 16.2;
    crystal.material = lit ? this.matBeaconDone : this.matBeacon;
    crystal.isPickable = false;
    crystal.renderingGroupId = 1;

    const ring = BABYLON.MeshBuilder.CreateTorus('bring',
      { diameter: 5.2, thickness: 0.22, tessellation: 20 }, this.scene);
    ring.parent = root;
    ring.position.y = 12.5;
    ring.material = lit ? this.matBeaconDone : this.matBeacon;
    ring.isPickable = false;
    ring.renderingGroupId = 1;

    return { key, root, crystal, ring, lit, dir, elevation, world: root.position.clone() };
  }

  despawnChunk(key) {
    const e = this.active.get(key);
    if (!e) return;
    for (const c of e.cells) c.dispose();
    if (e.beacon) {
      e.beacon.root.getChildMeshes().forEach((m) => m.dispose());
      e.beacon.root.dispose();
    }
    this.active.delete(key);
  }

  // ---- loop ------------------------------------------------------------

  update(dt) {
    const craft = this.craft;
    const P = this.planet;
    const here = craft.surf.frame.up;
    dirToFace(here.x, here.y, here.z, FC);
    const iu = Math.floor((FC.u + 1) / this.cellUV);
    const iv = Math.floor((FC.v + 1) / this.cellUV);
    const cellKey = FC.f + ':' + iu + ',' + iv;

    if (cellKey !== this.center) {
      this.center = cellKey;
      for (let dv = -PROP_RING; dv <= PROP_RING; dv++) {
        for (let du = -PROP_RING; du <= PROP_RING; du++) {
          const ju = iu + du, jv = iv + dv;
          // Cells running off a face edge are skipped. The neighbouring face
          // has its own, and props are cosmetic enough that a thin seam along
          // twelve edges does not justify a cross-face adjacency table.
          if (ju < 0 || jv < 0 || ju >= PROP_CELLS || jv >= PROP_CELLS) continue;
          const k = FC.f + ':' + ju + ',' + jv;
          if (!this.active.has(k)) this.spawnCell(FC.f, ju, jv);
        }
      }
      for (const key of [...this.active.keys()]) {
        const parts = key.split(':');
        const ij = parts[1].split(',').map(Number);
        if (Number(parts[0]) !== FC.f ||
            Math.max(Math.abs(ij[0] - iu), Math.abs(ij[1] - iv)) > PROP_RING) {
          this.despawnChunk(key);
        }
      }
    }

    const t = craft.time;
    let nearest = null, nearestD = 1e9;

    for (const [, e] of this.active) {
      for (let i = e.cells.length - 1; i >= 0; i--) {
        const m = e.cells[i];
        const md = m.metadata;
        // Bob along the radial and spin about it, not about world Y.
        placeOnSphere(m, P, md.dir,
          md.baseY + Math.sin(t * 1.7 + md.phase) * 0.55, t * 1.4);

        const d = BABYLON.Vector3.Distance(m.position, craft.world);
        if (d < 4.6) {
          this.collected.add(md.key);
          craft.addFuel(FUEL.cellValue);
          this.cellsCollected++;
          emit('pickup', { pos: m.position.clone(), value: FUEL.cellValue });
          m.dispose();
          e.cells.splice(i, 1);
        }
      }

      const b = e.beacon;
      if (b) {
        b.ring.rotation.y += dt * (b.lit ? 0.6 : 1.6);
        b.crystal.rotation.y -= dt * 1.1;
        if (!b.lit) {
          // Great-circle distance, not a chord — on a small world the two
          // diverge quickly and the range readout would read short.
          const d = arcBetween(b.dir, here, P.radius);
          if (d < nearestD) { nearestD = d; nearest = b; }
        }
      }
    }

    // Scanning: proximity only, so you can scan from a hover or a parked rover.
    if (nearest && nearestD < SCAN_RANGE) {
      if (this.scanTarget !== nearest) {
        this.scanTarget = nearest;
        this.scanProgress = 0;
        emit('scanstart', { key: nearest.key });
      }
      this.scanProgress += dt / SCAN_TIME;
      if (this.scanProgress >= 1) {
        nearest.lit = true;
        this.scanned.add(nearest.key);
        nearest.crystal.material = this.matBeaconDone;
        nearest.ring.material = this.matBeaconDone;
        this.beaconsScanned++;
        this.craft.addFuel(FUEL.beaconValue);
        emit('scanned', { pos: nearest.world.clone(), value: FUEL.beaconValue });
        this.scanTarget = null;
        this.scanProgress = 0;
      }
    } else if (this.scanTarget) {
      this.scanTarget = null;
      this.scanProgress = 0;
      emit('scanabort', {});
    }

    this.nearestBeacon = nearest;
    this.nearestDist = nearestD;
  }
}
