// Inverted dome drawn first with depth writes off, so it costs nothing and
// everything else lands on top of it.

export function createSky(scene, material, planet) {
  // 32 segments rather than 20: the dome's own facets were showing through as
  // curved seams once the horizon haze gave the sky a gradient to break up.
  // Sized off the planet so it always sits outside the far plane.
  const mesh = BABYLON.MeshBuilder.CreateSphere('sky',
    { diameter: planet.farPlane * 1.6, segments: 32 }, scene);
  mesh.material = material;
  mesh.infiniteDistance = true;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.renderingGroupId = 0;
  return mesh;
}
