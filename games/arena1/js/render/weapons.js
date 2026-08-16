// render/weapons.js — the ONE weapon geometry recipe (MD 14). The first-person
// viewmodel (fx.js) and every remote pill's held weapon (actors.js) build from
// these factories, so the two can never drift apart. Local positions are the
// viewmodel's original numbers, unchanged; callers position/scale the returned
// group, never its parts.

// Body ink gets a small emissive lift (the prototype's was flat #372052 with
// none): with black specular and the sunset light mostly overhead, the face
// toward the camera rendered near-black — half of the "dark slab" read.
export function makeZap({ mat, V3 }, scene, parent) {
  const root = new BABYLON.TransformNode('zapW', scene);
  root.parent = parent;
  const body = BABYLON.MeshBuilder.CreateBox('gb', { width: 0.13, height: 0.16, depth: 0.42 }, scene);
  body.parent = root; body.material = mat('#372052', 0.22); body.isPickable = false;
  const barrel = BABYLON.MeshBuilder.CreateCylinder('gbar', { height: 0.34, diameter: 0.075, tessellation: 8 }, scene);
  barrel.parent = root; barrel.rotation.x = Math.PI / 2; barrel.position = V3(0, 0.03, 0.34);
  barrel.material = mat('#FF7A59'); barrel.isPickable = false;
  const fin = BABYLON.MeshBuilder.CreateBox('gf', { width: 0.03, height: 0.12, depth: 0.16 }, scene);
  fin.parent = root; fin.position = V3(0, 0.12, 0.1); fin.material = mat('#3EC5B4'); fin.isPickable = false;
  const hookEmit = BABYLON.MeshBuilder.CreateBox('he', { width: 0.08, height: 0.08, depth: 0.2 }, scene);
  hookEmit.parent = root; hookEmit.position = V3(-0.09, -0.02, 0.3); hookEmit.material = mat('#FF3D81'); hookEmit.isPickable = false;
  return { root, hookEmit };
}

export function makeLauncher({ mat, V3 }, scene, parent) {
  const root = new BABYLON.TransformNode('launcherW', scene);
  root.parent = parent;
  const body = BABYLON.MeshBuilder.CreateBox('rlB', { width: 0.16, height: 0.18, depth: 0.34 }, scene);
  body.parent = root; body.material = mat('#372052', 0.22); body.isPickable = false;
  const tube = BABYLON.MeshBuilder.CreateCylinder('rlT', { height: 0.52, diameter: 0.15, tessellation: 10 }, scene);
  tube.parent = root; tube.rotation.x = Math.PI / 2; tube.position = V3(0, 0.04, 0.3);
  tube.material = mat('#B84D8F'); tube.isPickable = false;
  const rim = BABYLON.MeshBuilder.CreateCylinder('rlR', { height: 0.06, diameter: 0.19, tessellation: 10 }, scene);
  rim.parent = root; rim.rotation.x = Math.PI / 2; rim.position = V3(0, 0.04, 0.55);
  rim.material = mat('#FF7A59'); rim.isPickable = false;
  return { root };
}
