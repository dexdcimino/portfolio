// visuals/proc/chomp.js — procedural player placeholder: sphere + horns +
// jaw + eyes, scaled per stage (ART_BIBLE radii via data/stages.js).
// Also exports the shared proc helpers (unlitMat, applyGenericPose,
// finishVisual) used by proc/foods.js, proc/enemies.js and loaders/glb.js —
// they live here to keep the TECH.md repo layout unchanged.

import { CONFIG } from '../../config.js';
import { STAGE_RADII } from '../../data/stages.js';
import { rngFor } from '../../core/rng.js';

const V = CONFIG.visuals;

export function unlitMat(scene, hex, glow = 0.25) {
  const m = new BABYLON.StandardMaterial('procMat', scene);
  const c = BABYLON.Color3.FromHexString(hex);
  m.diffuseColor = c;
  m.specularColor = BABYLON.Color3.Black();
  m.emissiveColor = c.scale(glow); // readable in the dark cave
  return m;
}

// Art-agnostic morphState → root transform (TECH.md §Morph). Facing yaw
// convention: atan2(dx, dz), 0 = +Z; local +Z is the visual's "forward".
// bank leans the body into turns; breathe is a uniform idle scale pulse.
export function applyGenericPose(root, pose) {
  root.rotation.y = pose.facing ?? 0;
  root.rotation.z = -(pose.bank ?? 0);
  const st = pose.stretch ?? 0;
  const sq = pose.squash ?? 0;
  const sz = pose.squeeze ?? 0; // tight gap: sides pull IN, body rises
  const SQ = CONFIG.squeeze;
  const k = (1 + (pose.breathe ?? 0)) * (pose.scale ?? 1); // breathe + entity size
  root.scaling.z = Math.max(0.05, (1 + st * V.stretchGrow + sq * V.squashWiden) * (1 - sz * SQ.visualNarrow) * k);
  root.scaling.x = Math.max(0.05, (1 - st * V.stretchShrink + sq * V.squashWiden) * (1 - sz * SQ.visualNarrow) * k);
  root.scaling.y = Math.max(0.05, (1 - st * V.stretchShrink - sq * V.squashFlatten) * (1 + sz * SQ.visualTall) * k);
  root.position.y = (root._baseY ?? 0) + (pose.bob ?? 0);
}

// Wrap a proc root into the standard visual record {root, setPose, destroy}.
export function finishVisual(root, extraPose = null) {
  return {
    root,
    setPose(pose) {
      applyGenericPose(root, pose);
      if (extraPose) extraPose(pose);
    },
    destroy() {
      root.dispose(false, true); // children + materials
    },
  };
}

/* Accent-driven character palette (per Dex, v2). Keyed by the site's accent
   name (dex-accent-name, shared same-origin) and resolved AT EVERY BUILD, so
   every stage's rebuild — evolve, respawn, debug stage jump — wears the same
   accent. Live changes rebuild the visual (main.js listens for chomp-accent
   and remounts), which is what keeps the two-tone fur exact instead of
   approximated: tuft colours are vertex-baked and cannot be retinted. */
const CHOMP_PALETTES = {
  // "black" throughout is the game's near-black (#101216 family), never
  // #000000 — flat true black reads as a hole in this lighting.
  red:    { body: '#D94727', eyes: '#FFB021', horns: '#241A14', tuftBase: '#D94727', tuftTip: '#FAAA1E' },
  yellow: { body: '#FAAA1E', eyes: '#D94727', horns: '#241A14', tuftBase: '#FAAA1E', tuftTip: '#101216' },
  lime:   { body: '#9EE02B', eyes: '#FAAA1E', horns: '#FAAA1E', tuftBase: '#9EE02B', tuftTip: '#D9F245' },
  cyan:   { body: '#0E1418', eyes: '#2CC7F6', horns: '#2CC7F6', tuftBase: '#0E1418', tuftTip: '#2CC7F6' },
  blue:   { body: '#335DF3', eyes: '#FF8A2B', horns: '#241A14', tuftBase: '#335DF3', tuftTip: '#335DF3' },
  purple: { body: '#A85CF5', eyes: '#39FF14', horns: '#321952', tuftBase: '#A85CF5', tuftTip: '#39FF14' },
  white:  { body: '#E9EBEC', eyes: '#101216', horns: '#101216', tuftBase: '#E9EBEC', tuftTip: '#101216' },
};
function accentPalette() {
  try { return CHOMP_PALETTES[localStorage.getItem('dex-accent-name')] || CHOMP_PALETTES.lime; }
  catch { return CHOMP_PALETTES.lime; }
}

export function buildMawlingProc(stage, scene) {
  const s = Math.min(Math.max(stage, 1), 5);
  const r = STAGE_RADII[s - 1];
  const root = new BABYLON.TransformNode(`proc_player_s${s}`, scene);
  const y = r * 1.15; // hovers (ART_BIBLE: origin at volume centre)

  const pal = accentPalette();
  const bodyMat = unlitMat(scene, pal.body);
  const baseBody = bodyMat.diffuseColor.clone();

  // Head group: skull + horns + eyes tilt BACK together on chomp — the whole
  // top of the head rears away from the jaw for an exaggerated gape (MD-04b+).
  const headPivot = new BABYLON.TransformNode('headPivot', scene);
  headPivot.parent = root;
  headPivot.position.set(0, y, -r * 0.15); // pivot at the back of the head

  const skull = BABYLON.MeshBuilder.CreateSphere('skull', { diameter: r * 2 }, scene);
  skull.material = bodyMat;
  skull.parent = headPivot;
  skull.position.z = r * 0.15;

  // Jaw: flattened sphere on a pivot — opens as a SCOOP (rotates ~72° while
  // dropping and jutting forward) so it stays in front of the body, never
  // swinging back inside it.
  const jawPivot = new BABYLON.TransformNode('jawPivot', scene);
  jawPivot.parent = root;
  jawPivot.position.set(0, y - r * 0.25, r * 0.1);
  const jawBase = jawPivot.position.clone();
  const jaw = BABYLON.MeshBuilder.CreateSphere('jaw', { diameter: r * 1.7 }, scene);
  jaw.scaling.y = 0.45;
  jaw.material = bodyMat;
  jaw.parent = jawPivot;
  jaw.position.z = r * 0.25;

  // Teeth: bone cones that separate as the mouth opens. Sparse nubs at stage
  // 1, a crowded row of fangs by stage 5 (count and size scale with stage).
  // Teeth: each fang lives under a HOLDER anchored at its gum line, offset by
  // half its height, and the holders scale with mouthOpen — retracted nubs
  // when the mouth is closed (nothing clips through jaw or face), full fangs
  // on the gape. Big from stage 1, monstrous later.
  const toothMat = unlitMat(scene, '#F2EEE2', 0.55);
  const toothCount = 2 + s * 2;
  const toothH = r * (0.5 + s * 0.12); // trimmed — they poked out past the jaw
  const toothHolders = [];
  const makeTooth = (parent, px, py, pz, pointDown) => {
    const holder = new BABYLON.TransformNode('toothHolder', scene);
    holder.parent = parent;
    holder.position.set(px, py, pz);
    const fang = BABYLON.MeshBuilder.CreateCylinder(
      'tooth',
      { diameterTop: 0, diameterBottom: toothH * 0.55, height: toothH, tessellation: 5 },
      scene
    );
    fang.material = toothMat;
    fang.parent = holder;
    fang.position.y = (pointDown ? -1 : 1) * (toothH / 2); // base sits AT the gum line
    if (pointDown) fang.rotation.x = Math.PI;
    toothHolders.push(holder);
  };
  for (let i = 0; i < toothCount; i++) {
    const a = (toothCount === 1 ? 0 : i / (toothCount - 1) - 0.5) * 1.5; // front arc
    makeTooth(jawPivot, Math.sin(a) * r * 0.52, r * 0.12, Math.cos(a) * r * 0.52 + r * 0.1, false);
    makeTooth(headPivot, Math.sin(a) * r * 0.5, -r * 0.3, Math.cos(a) * r * 0.56 + r * 0.08, true);
  }

  // Lava throat: a small emissive glow tucked INSIDE the mouth cavity — only
  // visible through the gape. (It used to swell past the body and read as a
  // giant orange disc. Never again.)
  const throat = BABYLON.MeshBuilder.CreateSphere('throat', { diameter: r * 0.9 }, scene);
  throat.scaling.set(0.85, 0.6, 0.55);
  throat.material = unlitMat(scene, '#FF5A3C', 1);
  throat.parent = root;
  throat.position.set(0, y - r * 0.1, r * 0.1);

  // Horns: COUNT = STAGE (1 centre nub → a 4/5-horn crown), forward on the
  // head, curved — chained tapering segments curling back and flaring out.
  const tuftBase = BABYLON.Color3.FromHexString(pal.tuftBase);
  const tuftTip = BABYLON.Color3.FromHexString(pal.tuftTip);
  const hornMat = unlitMat(scene, pal.horns, 0.12);
  const hornSegs = s <= 2 ? 2 : 3;
  // [xMult, sizeMult] per horn, per stage
  const HORN_LAYOUTS = [
    [[0, 1]],
    [[-1, 1], [1, 1]],
    [[-1, 1], [1, 1], [0, 1.2]],
    [[-1, 1], [1, 1], [-0.45, 1.25], [0.45, 1.25]],
    [[-1, 1], [1, 1], [-0.45, 1.2], [0.45, 1.2], [0, 1.45]],
  ];
  for (const [xm, sizeMult] of HORN_LAYOUTS[s - 1]) {
    let node = new BABYLON.TransformNode('hornBase', scene);
    node.parent = headPivot;
    node.position.set(xm * r * 0.42, r * 0.78, r * 0.3); // forward of centre
    node.rotation.z = -xm * 0.3;
    node.rotation.x = -0.2;
    let segLen = r * (0.45 + s * 0.08) * sizeMult; // trimmed — s3-5 were spears
    let segDia = r * (s === 1 ? 0.58 : 0.3 + s * 0.05) * sizeMult; // s1: one FAT nub
    for (let i = 0; i < hornSegs; i++) {
      const tip = i === hornSegs - 1;
      const seg = BABYLON.MeshBuilder.CreateCylinder(
        'horn',
        { diameterTop: tip ? 0 : segDia * 0.6, diameterBottom: segDia, height: segLen, tessellation: 6 },
        scene
      );
      seg.material = hornMat;
      seg.parent = node;
      seg.position.y = segLen / 2;
      const joint = new BABYLON.TransformNode('hornJoint', scene);
      joint.parent = node;
      joint.position.y = segLen * 0.9;
      joint.rotation.x = -0.55; // curl backward
      joint.rotation.z = -xm * 0.18; // and flare outward
      node = joint;
      segDia *= 0.6;
      segLen *= 0.75;
    }
  }

  // FUR: thick WAVY tufts over skull and jaw — each tuft is two chained cone
  // segments with per-tuft curl, flowing back-and-down, baked and MERGED into
  // one mesh per body part (so jaw fur rides the jaw; near-free at runtime).
  // Kept clear of: eyes, the horn crown, and both mouth rims.
  {
    const fur = rngFor('fur', s);
    const furV3 = (x, y, z) => new BABYLON.Vector3(x, y, z);
    const buildFurOn = (pivot, center, rx, ry, rz, count, excluded) => {
      const cones = [];
      for (let i = 0; i < count; i++) {
        const th = Math.acos(1 - 2 * ((i + 0.5) / count));
        const ph = i * 2.399963;
        const dir = furV3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
        if (excluded(dir)) continue;
        const base = center.add(furV3(dir.x * rx, dir.y * ry, dir.z * rz).scale(0.94));
        // flow: outward blended toward back/down, plus per-tuft wobble
        let flow = dir.add(furV3((fur() - 0.5) * 0.5, -0.35 + (fur() - 0.5) * 0.3, -0.8)).normalize();
        let len = r * (0.3 + fur() * 0.28);
        let dia = r * (0.26 + fur() * 0.15); // THICK tufts
        let p = base;
        for (let seg = 0; seg < 2; seg++) {
          const cone = BABYLON.MeshBuilder.CreateCylinder(
            'furTuft',
            { diameterTop: seg === 1 ? 0 : dia * 0.55, diameterBottom: dia, height: len, tessellation: 4 },
            scene
          );
          cone.position = p.add(flow.scale(len / 2));
          cone.rotationQuaternion = BABYLON.Quaternion.FromUnitVectorsToRef(
            BABYLON.Vector3.Up(), flow, new BABYLON.Quaternion()
          );
          const shade = 0.65 + fur() * 0.55;
          const segBase = seg === 1 ? tuftTip : tuftBase;
          const cc = (seg === 0 && fur() < 0.25 ? segBase.scale(0.55) : segBase).scale(shade);
          const vcount = cone.getTotalVertices();
          const cols = new Float32Array(vcount * 4);
          for (let v = 0; v < vcount; v++) { cols[v * 4] = cc.r; cols[v * 4 + 1] = cc.g; cols[v * 4 + 2] = cc.b; cols[v * 4 + 3] = 1; }
          cone.setVerticesData(BABYLON.VertexBuffer.ColorKind, cols);
          cones.push(cone);
          // second segment: continue from the tip, curled further back + twisted
          p = p.add(flow.scale(len * 0.85));
          flow = flow.add(furV3((fur() - 0.5) * 0.7, -0.3, -0.5 + (fur() - 0.5) * 0.4)).normalize();
          len *= 0.7;
          dia *= 0.55;
        }
      }
      if (!cones.length) return;
      const merged = BABYLON.Mesh.MergeMeshes(cones, true, true, undefined, false, false);
      merged.name = 'fur';
      merged.material = furMat;
      merged.parent = pivot;
      merged.isPickable = false;
    };
    const furMat = new BABYLON.StandardMaterial('furMat', scene);
    furMat.diffuseColor = BABYLON.Color3.White(); // × per-tuft vertex color
    furMat.specularColor = BABYLON.Color3.Black();
    furMat.emissiveColor = BABYLON.Color3.White().scale(0.09);
    // Skull coat: skip eye cones, the horn crown, and the lower-front mouth rim
    buildFurOn(headPivot, furV3(0, 0, r * 0.15), r, r, r, 64, (d) => {
      if (d.y > 0.72) return true; // horn crown
      if (d.y < -0.45 && d.z > 0.3) return true; // upper-teeth rim
      const eyeL = furV3(-0.33, 0.29, 0.9).normalize();
      const eyeR = furV3(0.33, 0.29, 0.9).normalize();
      return BABYLON.Vector3.Dot(d, eyeL) > 0.82 || BABYLON.Vector3.Dot(d, eyeR) > 0.82;
    });
    // Jaw beard: underside and sides only (top is the mouth)
    buildFurOn(jawPivot, furV3(0, 0, r * 0.25), r * 0.85, r * 0.38, r * 0.85, 30, (d) => d.y > 0.1);
  }

  // Acid-green eyes — pushed clear of the skull surface so they actually show
  // (post head-pivot refactor they ended up buried inside the sphere).
  const eyeMat = unlitMat(scene, pal.eyes, 1);
  for (const side of [-1, 1]) {
    const eye = BABYLON.MeshBuilder.CreateSphere('eye', { diameter: r * 0.3 }, scene);
    eye.material = eyeMat;
    eye.parent = headPivot;
    eye.position.set(side * r * 0.36, r * 0.32, r * 1.12);
  }

  const throatBase = throat.scaling.clone();
  return finishVisual(root, (pose) => {
    const mo = pose.mouthOpen ?? 0;
    // bite = real chomp/gulp only (no ambient proximity) — drives the big
    // body moves; the jaw itself still pre-opens near food via mouthOpen.
    const bite = pose.bite ?? Math.max(0, (mo - 0.5) * 2);
    root.rotation.x = -bite * V.chompBodyPitch; // gape tips toward the camera
    headPivot.rotation.x = -mo * V.skullTilt; // head rears way back
    headPivot.scaling.setAll(1 + bite * V.headSwell); // and the head SWELLS
    jawPivot.rotation.x = mo * V.jawOpenAngle; // scoop open (≤ ~72°)…
    jawPivot.position.set(
      jawBase.x,
      jawBase.y - mo * r * V.jawDropMult, // …dropping…
      jawBase.z + mo * r * V.jawJutMult //  …and jutting forward, clear of the body
    );
    throat.scaling.copyFrom(throatBase).scaleInPlace(1 + mo * V.throatSwell);
    throat.setEnabled(mo > 0.12); // hidden until the mouth actually parts
    const toothScale = 0.22 + mo * 0.78; // fangs extend with the gape
    for (const holder of toothHolders) holder.scaling.setAll(toothScale);
    bodyMat.diffuseColor = pose.tint ?? baseBody;
    bodyMat.emissiveColor = bodyMat.diffuseColor.scale(0.25);
  });
}
