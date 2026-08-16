// render/scene.js — engine, lights, sky dome, fog, quality presets, and the
// frozen-material cache. Ported from the prototype's setup block (reference/
// prototype.html 235–282) with the same colors and intensities. Render-side
// only: Math.random and wall clock are legal here, sim files never import this.

export function createRenderScene(canvas) {
  const engine = new BABYLON.Engine(canvas, true, { stencil: false, antialias: true });
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = BABYLON.Color4.FromHexString('#FF9C6BFF');
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0036;
  scene.fogColor = BABYLON.Color3.FromHexString('#FF9C6B');
  scene.skipPointerMovePicking = true;

  const V3 = (x, y, z) => new BABYLON.Vector3(x, y, z);
  const hem = new BABYLON.HemisphericLight('hem', V3(0.2, 1, 0.1), scene);
  hem.intensity = 0.95;
  hem.diffuse = BABYLON.Color3.FromHexString('#FFEBD1');
  hem.groundColor = BABYLON.Color3.FromHexString('#5A3B7A');
  const sun = new BABYLON.DirectionalLight('sun', V3(-0.4, -0.75, 0.35), scene);
  sun.intensity = 0.55;
  sun.diffuse = BABYLON.Color3.FromHexString('#FFC58F');

  // sunset gradient dome + sun disc
  {
    const tex = new BABYLON.DynamicTexture('grad', { width: 4, height: 512 }, scene, false);
    const c2 = tex.getContext();
    const g = c2.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0.00, '#241243'); g.addColorStop(0.42, '#7A3B6E');
    g.addColorStop(0.72, '#FF7A59'); g.addColorStop(1.00, '#FFC58F');
    c2.fillStyle = g; c2.fillRect(0, 0, 4, 512); tex.update();
    const dome = BABYLON.MeshBuilder.CreateSphere('sky', { diameter: 900, segments: 12, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
    const m = new BABYLON.StandardMaterial('skym', scene);
    m.emissiveTexture = tex; m.disableLighting = true; m.diffuseColor = BABYLON.Color3.Black();
    dome.material = m; dome.isPickable = false; dome.applyFog = false;
    dome.infiniteDistance = true;
    const sunDisc = BABYLON.MeshBuilder.CreateDisc('sunD', { radius: 38, tessellation: 24 }, scene);
    const sm = new BABYLON.StandardMaterial('sunm', scene);
    sm.emissiveColor = BABYLON.Color3.FromHexString('#FFE7B0'); sm.disableLighting = true;
    sunDisc.material = sm; sunDisc.position = V3(-180, 55, 320); sunDisc.lookAt(V3(0, 40, 0));
    sunDisc.isPickable = false; sunDisc.infiniteDistance = true; sunDisc.applyFog = false;
  }

  const mats = {};
  function mat(hex, emissive = 0) {
    if (mats[hex + emissive]) return mats[hex + emissive];
    const m = new BABYLON.StandardMaterial('m' + hex, scene);
    m.diffuseColor = BABYLON.Color3.FromHexString(hex);
    m.specularColor = BABYLON.Color3.Black();
    if (emissive) m.emissiveColor = BABYLON.Color3.FromHexString(hex).scale(emissive);
    m.freeze();
    return (mats[hex + emissive] = m);
  }

  const cam = new BABYLON.FreeCamera('cam', V3(0, 5, 26), scene);
  cam.minZ = 0.05; cam.maxZ = 1200; cam.fov = 1.05;
  cam.inputs.clear();

  const QUAL = [{ n: 'LOW', s: 1.6 }, { n: 'MED', s: 1.0 }, { n: 'HIGH', s: 0.7 }];
  function setQuality(i) {
    engine.setHardwareScalingLevel(QUAL[i].s);
    const el = document.getElementById('qual');
    if (el) el.textContent = QUAL[i].n;
  }
  setQuality(1);

  return { engine, scene, cam, mat, setQuality, V3 };
}
