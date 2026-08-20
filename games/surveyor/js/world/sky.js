// Inverted dome drawn first with depth writes off, so it costs nothing and
// everything else lands on top of it.

export function createSky(scene, material, planet) {
  /* 32 segments rather than 20: the dome's own facets were showing through as
     curved seams once the horizon haze gave the sky a gradient to break up.
     Sized off the planet, but the size is not what keeps you inside it —
     `infiniteDistance` below re-centres the dome on the CAMERA every frame, so
     the camera is at its centre wherever it goes and the radius only has to
     land inside the far plane to be drawn at all. This comment used to say the
     dome sits outside the far plane; at 0.8 of it, it does not, and it does not
     need to. */
  const mesh = BABYLON.MeshBuilder.CreateSphere('sky',
    { diameter: planet.farPlane * 1.6, segments: 32 }, scene);
  mesh.material = material;
  mesh.infiniteDistance = true;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.renderingGroupId = 0;
  return mesh;
}
