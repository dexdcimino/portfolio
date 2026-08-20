// A world in the far band, as geometry rather than as a picture of one.
//
// The billboard is the cheapest LOD and it is correct while a body is a few
// pixels across. It stops being correct the moment the body is big enough that
// you can tell it is flat — and the whole point of seamless space is that you
// fly toward one until it fills the sky, so something has to take over.
//
// THIS IS THE SAME WORLD, COARSER. Not a textured ball: the vertices are
// displaced by that planet's own height() at that direction, so what you see
// growing in the window is the continent you are about to land on. It is the
// first rung of a chain that ends in the quadtree — billboard, this, coarse
// quadtree, fine quadtree — and every rung is the same height field read at a
// different resolution. A sphere with a painted texture would look fine and
// would be a different object, which is the thing that pops.
//
// GEOMETRY IS BUILT IN UNIT SPACE and scaled per frame. A body's drawn radius
// changes every frame as you approach it, and rebuilding 1280 triangles of
// noise per frame to chase that would be absurd; the mesh is built once at
// radius 1 with relief expressed as a fraction of the planet's own radius, and
// the per-frame work is a scale and a translate. That also means the relief
// stays proportionally correct at every distance, which is what stops the
// mountains inflating as the world grows.

import { height } from './noise.js';
import { HAZE } from './materials.js';

let registered = false;

/**
 * An icosahedron subdivided `n` times, as unit directions.
 *
 * Icosahedral rather than the UV sphere Babylon would give: a UV sphere puts
 * most of its vertices at the poles, which on a body you are looking at from an
 * arbitrary direction means the detail is in the wrong place and the seam is
 * somewhere in shot. Every triangle here is within a few percent of every
 * other.
 */
function icoDirections(n) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((v) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  });
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  for (let s = 0; s < n; s++) {
    const mid = new Map();
    const next = [];
    const midpoint = (a, b) => {
      const key = a < b ? a + ':' + b : b + ':' + a;
      if (mid.has(key)) return mid.get(key);
      const p = verts[a], q = verts[b];
      let x = p[0] + q[0], y = p[1] + q[1], z = p[2] + q[2];
      const l = Math.hypot(x, y, z) || 1;
      verts.push([x / l, y / l, z / l]);
      const i = verts.length - 1;
      mid.set(key, i);
      return i;
    };
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  return { verts, faces };
}

/**
 * The displaced shell for one planet, in unit space.
 *
 * Returns a NON-INDEXED triangle soup with flat normals, matching the terrain
 * and the rocks: this look is flat-shaded everywhere and a smooth-shaded body
 * in the same frame reads as a different game. It also means the facets stay
 * legible as the body grows, which is the point of a coarse LOD.
 *
 * `relief` is expressed against the planet's own radius, so scaling the mesh to
 * any drawn size keeps the mountains proportionally right.
 */
export function buildFarBody(planet, subdiv) {
  const { verts, faces } = icoDirections(subdiv);
  const D = { x: 0, y: 0, z: 0 };
  const R = planet.surfaceR;

  // Radius per vertex, in units of the planet's own surface radius.
  const rad = new Float32Array(verts.length);
  for (let i = 0; i < verts.length; i++) {
    D.x = verts[i][0]; D.y = verts[i][1]; D.z = verts[i][2];
    rad[i] = (R + height(D, planet)) / R;
  }

  const pos = new Float32Array(faces.length * 9);
  const nrm = new Float32Array(faces.length * 9);
  const dir = new Float32Array(faces.length * 9);
  let o = 0;
  const P = [0, 0, 0], Q = [0, 0, 0], S = [0, 0, 0];
  for (const [a, b, c] of faces) {
    for (const [k, idx] of [[P, a], [Q, b], [S, c]]) {
      k[0] = verts[idx][0] * rad[idx];
      k[1] = verts[idx][1] * rad[idx];
      k[2] = verts[idx][2] * rad[idx];
    }
    const ux = Q[0] - P[0], uy = Q[1] - P[1], uz = Q[2] - P[2];
    const vx = S[0] - P[0], vy = S[1] - P[1], vz = S[2] - P[2];
    /* Wound clockwise with the normal negated, exactly as the terrain and the
       rocks are. Getting this backwards on a closed body is invisible until the
       terminator lands on the wrong side, which is a slow thing to notice. */
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx = -nx / l; ny = -ny / l; nz = -nz / l;
    const tri = [[P, a], [S, c], [Q, b]];
    for (const [p, idx] of tri) {
      pos[o] = p[0]; pos[o + 1] = p[1]; pos[o + 2] = p[2];
      nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz;
      // The undisplaced direction, which is what the surface map is keyed on.
      dir[o] = verts[idx][0]; dir[o + 1] = verts[idx][1]; dir[o + 2] = verts[idx][2];
      o += 3;
    }
  }
  return { pos, nrm, dir, tris: faces.length };
}

/* THE FAR BODY'S OWN SHADER, and it lives here rather than in materials.js.
   The far band is one pass: its geometry, its placement and its lighting are
   one idea and they are in one file. That was only safe to do once
   dev/glslcheck.mjs stopped scanning materials.js by name and started walking
   js/ for anything that declares a shader — a backtick inside a shader body
   silently eats everything between it and the next one, and a guard that has to
   be told where to look is one the next file outruns.

   It is deliberately the SAME LOOK as svDisc: the same atlas, the same
   terminator against that world's own sun, the same limb darkening and the same
   emissive mask for Ember's cracks. The crossfade between them only reads as
   one object growing if the two agree on everything except the geometry. */
// The qualifier every fragment shader needs before anything using a float.
const PRECISION = 'precision highp float;\n';

function ensureFarShaders() {
  if (registered) return;
  registered = true;
  const S = BABYLON.Effect.ShadersStore;

  S.svFarBodyVertexShader = `
    precision highp float;
    attribute vec3 position;
    attribute vec3 normal;
    // The UNDISPLACED direction. The surface map is keyed on where a point is
    // on the sphere, not on how far the mountains pushed it out.
    attribute vec3 dir;
    uniform mat4 world;
    uniform mat4 worldViewProjection;
    varying vec3 vN;
    varying vec3 vDir;
    varying vec3 vView;
    void main() {
      vN = normalize(mat3(world) * normal);
      vDir = dir;
      vec4 wp = world * vec4(position, 1.0);
      vView = wp.xyz;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }
  `;

  /* HAZE GOES AFTER THE PRECISION STATEMENT, not before it. COMMON carries its
     own precision qualifier at the top, which is why materials.js can simply
     prepend it; this chunk does not, and a function taking floats declared
     ahead of the qualifier does not compile. It failed silently — the body
     stopped drawing and dev/handoff.mjs reported a zero-pixel far side rather
     than an error.
     Both halves are joined BEFORE the template rather than spliced into the
     middle of one, because dev/glslcheck.mjs scans shader bodies for backticks
     and a mid-template splice puts two of them inside what it is reading. */
  S.svFarBodyFragmentShader = PRECISION + HAZE + `
    varying vec3 vN;
    varying vec3 vDir;
    varying vec3 vView;
    uniform sampler2D uMap;
    // vN is the FLAT face normal and it is deliberately not used for lighting;
    // see the limb term below. It stays because the silhouette and the facet
    // edges are what make this read as the same flat-shaded game.
    uniform vec3 uSun, uCam, uTint;
    uniform float uSlot, uRows, uDisc, uNight, uEmit, uLimb, uFade, uSpec;
    /* THE AIR THIS WORLD IS SEEN THROUGH. Its own, not the one you are
       standing in: a far body is a picture of somewhere else, and the whole
       point of the term is that it converges on what that somewhere else
       actually looks like as you close on it.
       uFogRange arrives in DRAWN units — the far band scales distance about
       the camera, so the range is pre-multiplied by the same factor on the CPU
       and the comparison below happens in the space the geometry is in. */
    uniform vec3 uFog, uFogSun, uFogLight;
    uniform vec2 uFogRange;
    uniform float uScatter, uFogAmt;

    void main() {
      vec3 S = normalize(vDir);

      /* Its own row of the atlas. Longitude wraps; latitude is inset half a
         texel from the row edges so bilinear filtering cannot reach into the
         planet stacked above or below. Identical to svDisc, because the two
         have to be the same picture for the crossfade to read as one object. */
      float lon = atan(S.z, S.x);
      float lat = asin(clamp(S.y, -1.0, 1.0));
      float v = (0.5 - lat / 3.14159265);
      vec2 uv = vec2(lon / 6.28318531 + 0.5, (uSlot + clamp(v, 0.002, 0.998)) / uRows);
      vec4 map = texture2D(uMap, uv);

      /* Phase, against THAT world's sun rather than this one's. Each planet
         states a fixed sunDir in planet space, so the crescent you see from
         here is the one you will find when you land there. */
      vec3 N = normalize(vN);
      float lit = uNight + (1.0 - uNight) *
        smoothstep(-0.22, 0.30, dot(S, normalize(uSun)));

      /* LIMB DARKENING OFF THE SMOOTH DIRECTION, NOT THE FACET NORMAL.
         The billboard fakes a sphere and has an analytic normal everywhere, so
         its limb term is a smooth ramp from centre to edge. Taking this one off
         the flat per-face normal instead looked principled and was wrong by a
         lot: on a 1280-triangle ball a facet's normal can be twenty degrees off
         the surface it stands for, most facets come out darker than the smooth
         surface would, and the mean brightness of the body dropped by 56 to 69
         percent across the handoff — invisible to a check that only measured
         SIZE, which is what the first version of dev/lodcheck.mjs did.
         S is the undisplaced direction, which on an unrotated body is the
         outward normal in world space: the same quantity svDisc calls z. */
      vec3 V = normalize(uCam - vView);
      float limb = mix(uLimb, 1.0, clamp(dot(S, V), 0.0, 1.0));

      vec3 col = map.rgb * (lit * limb * uDisc);

      // Ice sheen, on the one world whose palette asks for it.
      if (uSpec > 0.0) {
        vec3 hv = normalize(normalize(uSun) + V);
        col += uTint * uSpec * 0.34 *
          smoothstep(0.18, 0.55, pow(clamp(dot(N, hv), 0.0, 1.0), 12.0));
      }

      // Ember's cracks are a light source, not a lit surface: added after the
      // terminator and past 1.0 so the bloom pass finds them.
      col += map.rgb * map.a * uEmit;

      /* ...and then the air, on exactly the terrain's curve.
         MEASURED, BECAUSE THE GEOMETRY WAS NOT THE PROBLEM. At the approach
         sphere the far body and the world it becomes agree on size and on
         silhouette to within three percent — the resolution jump the plan
         predicted is below a pixel at the only distance the swap happens. What
         did not agree was brightness: +928% arriving at Tarn, -59% at Ember,
         +1132% at Anvil, because this shader had no air in it at all and the
         ground it turns into is lit through its world's own fog.
         Same smoothstep, same hazeColor, same uniforms as svTerrain, so the
         two cannot drift; and at the range a disc is normally seen from the
         distance is far outside uFogRange and this is exactly zero. */
      float fogD = length(uCam - vView);
      float fog = smoothstep(uFogRange.x, uFogRange.y, fogD) * uFogAmt;
      col = mix(col, hazeColor(uFog, uFogSun, V, uFogLight, uScatter), fog);

      gl_FragColor = vec4(col, uFade);
    }
  `;
}

/**
 * SIGNED VOLUME of the shell, in units of a unit sphere's.
 *
 * The house rule is per-side signed-volume assertions on any closed solid, and
 * this is the one closed solid in the far band. A shell wound the wrong way
 * comes out negative; one with a torn seam comes out wrong by the size of the
 * hole. A unit sphere is 4/3 pi = 4.18879, and a displaced one should be within
 * a few percent of that because relief is a few percent of radius.
 */
export function shellVolume(mesh) {
  const p = mesh.pos;
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
    const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];
    v += ax * (by * cz - bz * cy)
       - ay * (bx * cz - bz * cx)
       + az * (bx * cy - by * cx);
  }
  return v / 6;
}

/**
 * A far body as a scene mesh, ready to be placed and scaled per frame.
 *
 * Built in UNIT SPACE. The caller sets `scaling` to the drawn radius and
 * `position` to where the band puts it, both of which change every frame as you
 * approach; the geometry does not, because rebuilding 1280 triangles of noise
 * to chase a scale factor would be absurd.
 */
export function farBodyMesh(scene, planet, subdiv, atlas, slot) {
  ensureFarShaders();
  const shell = buildFarBody(planet, subdiv);
  const mesh = new BABYLON.Mesh('far_' + planet.key, scene);
  const vd = new BABYLON.VertexData();
  vd.positions = shell.pos;
  vd.normals = shell.nrm;
  const idx = new Array(shell.pos.length / 3);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  vd.indices = idx;
  vd.applyToMesh(mesh, false);
  mesh.setVerticesData('dir', shell.dir, false, 3);

  const mat = new BABYLON.ShaderMaterial('svFarBody_' + planet.key, scene,
    { vertex: 'svFarBody', fragment: 'svFarBody' },
    {
      attributes: ['position', 'normal', 'dir'],
      uniforms: ['world', 'worldViewProjection', 'uSun', 'uCam', 'uTint',
        'uSlot', 'uRows', 'uDisc', 'uNight', 'uEmit', 'uLimb', 'uFade', 'uSpec',
        'uFog', 'uFogSun', 'uFogLight', 'uFogRange', 'uScatter', 'uFogAmt'],
      samplers: ['uMap'],
      /* BLENDED, for the crossfade. The handoff is continuous in size to about
         a percent and discontinuous in brightness by more than half, because a
         real terminator on real geometry covers a different share of the disc
         than the billboard's faked one — see SPACE.fadeBand. */
      needAlphaBlending: true,
    });
  if (atlas) {
    mat.setTexture('uMap', atlas.texture);
    mat.setFloat('uRows', atlas.rows);
  }
  mat.setFloat('uSlot', slot || 0);
  /* Culling ON and depth writes ON. This is a closed solid and the near half
     has to hide the far half — the billboard never needed either, which is
     exactly the difference between a picture of a world and a world. */
  mat.backFaceCulling = true;
  mat.disableDepthWrite = false;
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  /* Group 0, with the sky and the billboards: the far band draws before the
     depth buffer is cleared for the near world, which is what keeps it from
     interacting with anything at true scale. */
  mesh.renderingGroupId = 0;
  mesh.setEnabled(false);
  return { mesh, mat, tris: shell.tris };
}
