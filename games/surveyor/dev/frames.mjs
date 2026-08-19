// Camera set-ups shared by the headless harnesses, as in-page expressions.
//
// WHY THIS FILE EXISTS. dev/shots.mjs and dev/noop.mjs have to point the camera
// at the same thing or their answers are about different pictures — and the
// shoreline set-up below is the one that made that obvious. Run against the
// default chase camera, the water pass measured ZERO changed pixels on Tarn,
// Vault and Anvil with a term turned up past any depth in the game. Not a bug:
// look at dev/shots/before-tarn.png and there is no water in the frame at all.
// Tarn is 85% ocean and its spawn is on a dry ridge, so the six-way sheet — the
// house instrument for "do these worlds look different" — cannot see the thing
// this pass changes on five of six worlds.
//
// So the camera set-up became a shared, tested thing rather than a paragraph
// copied between two harnesses.

/* THE WATER'S EDGE.
   FOUND, not authored: a golden-angle spiral out from the spawn looking for a
   point where the ground crosses sea level AND has real depth behind it and
   real land in front. Both tests are needed — height-near-zero alone happily
   photographs a dry saddle or a puddle. Nearest wins, so the frame is the shore
   the player would actually reach first.
   The camera is FROZEN rather than replaced, for the same reason the sky frame
   freezes it: the bloom pipeline is attached to that camera and half of what
   water draws is specular. A dry world returns shore:null and is skipped. */
export const SHORE = `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SURVEYOR;
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyQ' }));
  const hud = document.getElementById('hud');
  if (hud) hud.style.visibility = 'hidden';
  if (!S.planet.hasWater) return { shore: null };

  const find = () => {
    const N = 1200, REACH = S.planet.radius * 0.6;
    let best = null;
    for (let a = 0; a < N; a++) {
      const ang = a * 2.39996323;
      const r = 14 + REACH * Math.sqrt(a / N);
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (Math.abs(S.surfaceHeight(x, z)) > 0.9) continue;
      // Water behind it and land in front, or it is a dry crease that happens
      // to sit at sea level. Six probes each way over 45 metres.
      let wet = 0, dry = 0;
      for (let k = 1; k <= 6; k++) {
        const d = k * 7.5;
        if (S.surfaceHeight(x + Math.cos(ang) * d, z + Math.sin(ang) * d) < -1.1) wet++;
        if (S.surfaceHeight(x - Math.cos(ang) * d, z - Math.sin(ang) * d) > 0.6) dry++;
      }
      if (wet < 4 || dry < 3) continue;
      if (!best || r < best.r) best = { x, z, r, ang };
    }
    return best;
  };

  let best = find();
  if (!best) return { shore: null };
  const found = best.r;

  /* MOVE THE CRAFT TO THE SHORE FIRST, and this is not tidiness — it is the
     difference between a frame the game can produce and one it cannot.
     Terrain streams around the CRAFT. Anvil is 9.6% water and its nearest shore
     is 890m from the spawn, so flying the camera there alone put it far outside
     the streamed region: the depth pass had no ground to measure behind most of
     the water, fell back to the per-vertex depth over that area, and drew the
     silhouette of the loaded terrain across the pan as a hard-edged ellipse.
     Real, and unreachable in play — the chase camera never leaves the craft, so
     any water it can see has streamed terrain behind it. Driving there instead
     of looking there removes the artifact by removing the impossible state, and
     leaves the harness testing something the game can actually do. */
  S.craft.pos.x = best.x;
  S.craft.pos.z = best.z;
  S.craft.pos.y = Math.max(S.surfaceHeight(best.x, best.z), 0) + 2.5;
  S.craft.vel.x = 0; S.craft.vel.z = 0;
  for (let i = 0; i < 4; i++) await frame();
  // Wait for the ground to arrive, the same way the boot does.
  const t1 = performance.now();
  let settled = 0;
  while (performance.now() - t1 < 30000) {
    await frame();
    settled = S.field.queue.length === 0 ? settled + 1 : 0;
    if (settled > 20) break;
  }
  // ...and find it again from where the craft now stands, because the local
  // tangent frame re-anchors as it moves and the old coordinates no longer mean
  // what they meant.
  best = find();
  if (!best) return { shore: null };

  const c = S.cam.camera;
  S.cam.update = () => {};
  const eye = new BABYLON.Vector3(), aim = new BABYLON.Vector3();
  /* Back on the land side and ABOVE it, looking down across the shallows at
     about thirty degrees.
     The first cut stood at a rover's roof height, 9.5m, on the reasoning that
     it should photograph what a player sees. It does, and that is the problem:
     from 9.5m every lake is seen at a graze, the shallow margin collapses into
     a few pixels at the rim, and the frame is 95% deep water. Home came back as
     one flat plate of blue three times running while the bathymetry shelves
     underneath it were working perfectly — the camera could not see them.
     A test frame's job is to show the thing under test, not to reproduce the
     default view; dev/shots.mjs already has three frames that do the latter. */
  S.surface.toWorld(best.x - Math.cos(best.ang) * 30,
                    21.0, best.z - Math.sin(best.ang) * 30, eye);
  S.surface.toWorld(best.x + Math.cos(best.ang) * 26,
                    -3.0, best.z + Math.sin(best.ang) * 26, aim);
  c.position.copyFrom(eye);
  /* THE CAMERA'S UP HAS TO BE THE LOCAL UP, not world Y.
     setTarget leaves roll to the camera's upVector, which defaults to world Y —
     fine at the boot frame's origin and wrong by however far you have travelled
     since. After driving 890m across Anvil that is 24 degrees of arc, and the
     frame came back with the horizon running diagonally across it. */
  const up = S.surface.frame.up;
  c.upVector.set(up.x, up.y, up.z);
  for (let i = 0; i < 24; i++) { c.setTarget(aim); await frame(); }
  return { shore: +found.toFixed(0) };
})()`;

/* THE AIR VIEW.
   Fog is authored at the surface, where on Shroud it is the antagonist and the
   whole point. From a jet it was the antagonist of the game: the world went to
   flat violet at 167m on a planet whose horizon from that altitude is 649m
   away, and there was nothing to navigate by. That is a thing you cannot see in
   any of the other four frames, because all of them stand on the ground.
   The craft is flown up rather than the camera, for the reason the shoreline
   frame drives there: terrain streams around the CRAFT, and a camera sent
   somewhere it is not photographs an unstreamed world and blames the fog.
   Altitude is a fraction of the RADIUS, not metres — 900m over Ember is four
   and a half planet radii and 900m over Anvil is a low pass. */
export const ALOFT = `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const S = window.SURVEYOR;
  const hud = document.getElementById('hud');
  if (hud) hud.style.visibility = 'hidden';
  const R = S.planet.radius;
  const alt = R * 0.10;

  S.craft.setMode('jet', true);
  S.craft.pos.y = alt;
  S.craft.vel.set(0, 0, 0);
  for (let i = 0; i < 4; i++) await frame();
  const t0 = performance.now();
  let settled = 0;
  while (performance.now() - t0 < 30000) {
    await frame();
    // The craft is in free flight and will sink; hold it up while the ground
    // streams in under it, or the frame is taken halfway through a fall.
    S.craft.pos.y = alt;
    S.craft.vel.y = 0;
    settled = S.field.queue.length === 0 ? settled + 1 : 0;
    if (settled > 20) break;
  }


  const c = S.cam.camera;
  S.cam.update = () => {};
  const up = S.surface.frame.up;
  c.upVector.set(up.x, up.y, up.z);
  const eye = new BABYLON.Vector3(), aim = new BABYLON.Vector3();
  S.surface.toWorld(0, alt, 0, eye);
  // Ahead and down, the angle you actually fly at when you are looking for
  // somewhere to land rather than admiring the sky.
  S.surface.toWorld(alt * 2.2, 0, 0, aim);
  c.position.copyFrom(eye);
  for (let i = 0; i < 24; i++) { c.setTarget(aim); await frame(); }

  /* LAST, after the craft has stopped being teleported.
     This harness holds craft.pos.y at altitude every frame while the ground
     streams in, which is a teleport per frame, and the wingtip TrailMesh draws
     a segment across every one of them. Resetting earlier does not hold:
     Trails.update rebuilds the ribbon on the next frame whenever the craft is
     in jet mode and the list is empty, which is correct behaviour.
     The ribbon that produced the cyan band across four of these sheets was a
     REAL bug and is fixed in swapTo; this is the harness's own teleport. */
  if (S.trails) S.trails.resetJetTrails();
  for (let i = 0; i < 3; i++) await frame();
  return { aloft: +alt.toFixed(0) };
})()`;
