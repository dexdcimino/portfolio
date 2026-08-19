// Which mesh is that, and does it move when the camera turns?
//
//   node dev/whatisthat.mjs ember
//
// A general-purpose "name the thing in the middle of my screen" probe, written
// because three rounds of reasoning about a reported artifact produced three
// wrong candidates. It enumerates every mesh Babylon is drawing, projects each
// one's centre through the camera, and reports the ones that land near the
// middle of the frame with a large screen extent — then turns the camera and
// does it again. Anything whose screen position does not move is attached to
// the view rather than to the world, and it is now named rather than guessed.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { launch, serve, evaluate } from './cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '../../..');
const GAME = '/games/surveyor/';
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const { PLANETS } = await import('../js/tune.js');
const KEYS = Object.keys(PLANETS).filter((k) => !only.length || only.includes(k));

const SETUP = `(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const t0 = performance.now();
  let drained = 0;
  while (performance.now() - t0 < 40000) {
    await frame();
    const S = window.SURVEYOR;
    if (!S) continue;
    drained = S.field.queue.length === 0 ? drained + 1 : 0;
    if (drained > 20) break;
  }
  const S = window.SURVEYOR;
  if (!S) return { ok: false };
  document.getElementById('begin').click();
  document.getElementById('start').style.display = 'none';
  for (let i = 0; i < 60; i++) await frame();
  S.scene.getEngine().stopRenderLoop();
  S.cam.update = () => {};
  S.scene.render();
  return { ok: true };
})()`;

const scan = (deg) => `(() => {
  const S = window.SURVEYOR;
  const c = S.cam.camera;
  const V = BABYLON.Vector3;
  const up0 = S.surface.frame.up;
  const up = new V(up0.x, up0.y, up0.z).normalize();
  const f0 = c.getForwardRay().direction;
  let f = f0.subtract(up.scale(V.Dot(f0, up)));
  if (f.length() < 1e-3) f = new V(1, 0, 0);
  f = f.normalize();
  const r = V.Cross(up, f).normalize();
  const a = ${deg} * Math.PI / 180;
  const dir = f.scale(Math.cos(a)).add(r.scale(Math.sin(a))).normalize();
  c.upVector.copyFrom(up);
  c.setTarget(c.position.add(dir.scale(400)));
  S.scene.render();

  const eng = S.scene.getEngine();
  const w = eng.getRenderWidth(), h = eng.getRenderHeight();
  const vp = c.viewport.toGlobal(w, h);
  const tm = S.scene.getTransformMatrix();
  const fwd = c.getForwardRay().direction;
  const out = [];
  for (const m of S.scene.meshes) {
    if (!m.isEnabled() || !m.isVisible) continue;
    const bb = m.getBoundingInfo().boundingBox;
    const toIt = bb.centerWorld.subtract(c.position);
    if (V.Dot(toIt, fwd) <= 0) continue;
    const p = BABYLON.Vector3.Project(bb.centerWorld, BABYLON.Matrix.Identity(), tm, vp);
    const dx = p.x - w / 2, dy = p.y - h / 2;
    const off = Math.hypot(dx, dy);
    if (off > h * 0.45) continue;
    const rad = bb.extendSizeWorld.length();
    const dist = toIt.length() || 1;
    const ang = 2 * Math.atan(rad / dist) * 180 / Math.PI;
    out.push({ name: m.name, x: Math.round(p.x), y: Math.round(p.y),
               off: Math.round(off), deg: +ang.toFixed(1),
               dist: Math.round(dist), group: m.renderingGroupId });
  }
  out.sort((a, b) => b.deg - a.deg);
  return out.slice(0, 6);
})()`;

const { port, close } = await serve(SITE);
const chrome = await launch({ width: 900, height: 560 });
console.log(`${chrome.version}, serving on :${port}\n`);

for (const key of KEYS) {
  const page = await chrome.newPage();
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride',
    { width: 900, height: 560, deviceScaleFactor: 1, mobile: false });
  await page.send('Page.navigate', { url: `http://127.0.0.1:${port}${GAME}?planet=${key}` });
  let info;
  try { info = await evaluate(page, SETUP); } catch (e) { info = { ok: false, err: e.message }; }
  if (!info.ok) { console.log(`${key} never ready`); await page.close(); continue; }
  console.log(key);
  for (const deg of [0, 90, 180]) {
    const rows = await evaluate(page, scan(deg));
    console.log(`  turned ${String(deg).padStart(3)}°`);
    for (const r of rows) {
      console.log(`    ${r.name.padEnd(26)} at (${String(r.x).padStart(4)},${String(r.y).padStart(4)}) ` +
        `off-centre ${String(r.off).padStart(4)}px  ${String(r.deg).padStart(6)}°  ` +
        `${String(r.dist).padStart(6)}m  group ${r.group}`);
    }
  }
  await page.close();
}

await chrome.close();
close();
