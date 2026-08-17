// Every surface in the game is drawn by one of four shaders in this file.
// The through-line: the planet is rendered as a live survey chart. Contour
// lines are cut into the rock, the waterline gets a drawn coastline stroke,
// and light is quantised into flat bands so form reads as shape, not shading.

import { COLORS, WORLD, ATMO } from '../tune.js';

const V3 = (c) => new BABYLON.Vector3(c[0], c[1], c[2]);
const C3 = (c) => new BABYLON.Color3(c[0], c[1], c[2]);

// Shared GLSL: banded lambert + the contour engine.
const COMMON = `
  precision highp float;

  // Flat steps instead of a gradient. This is the whole cel look. Five steps
  // rather than four, with a hot top band, so form still reads on a shallow
  // slope where the old four-step ramp collapsed everything into one tone.
  float bandLight(float d) {
    if (d > 0.85) return 1.04;
    if (d > 0.60) return 0.97;
    if (d > 0.24) return 0.83;
    if (d > -0.10) return 0.63;
    return 0.47;
  }

  // Cheap value noise. Two octaves is enough for surface grain and it keeps
  // the fragment shader affordable on a mid-range GPU.
  float h21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
               mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm2(vec2 p) {
    return vnoise(p) * 0.65 + vnoise(p * 2.17 + 19.3) * 0.35;
  }

  // Aerial perspective: haze warms up as you look into the sun and stays cool
  // away from it. One line, and suddenly there is air between you and that
  // mountain instead of a flat grey wash.
  vec3 hazeColor(vec3 fogc, vec3 sunc, vec3 V, vec3 L, float amount) {
    float toward = clamp(dot(-V, L), 0.0, 1.0);
    return mix(fogc, sunc, pow(toward, 3.0) * amount);
  }

  // Contour lines at a fixed vertical interval, widened with distance so they
  // never alias into noise, and faded out entirely on cliffs and at range.
  float contourMask(float h, float dist, float slope, float interval) {
    float w = 0.020 + dist * 0.00019;
    float c = abs(fract(h / interval) - 0.5) * interval;
    float line = 1.0 - smoothstep(w, w * 2.6, c);
    line *= 1.0 - smoothstep(0.42, 0.80, slope);
    line *= 1.0 - smoothstep(300.0, 720.0, dist);
    return line;
  }
`;

function registerShaders() {
  const S = BABYLON.Effect.ShadersStore;

  // ---- terrain + baked rock -------------------------------------------
  S.svTerrainVertexShader = `
    precision highp float;
    attribute vec3 position;
    attribute vec3 normal;
    uniform mat4 world;
    uniform mat4 worldViewProjection;
    varying vec3 vN;
    varying vec3 vW;
    void main() {
      vec4 wp = world * vec4(position, 1.0);
      vW = wp.xyz;
      vN = normalize(mat3(world) * normal);
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }
  `;

  S.svTerrainFragmentShader = COMMON + `
    varying vec3 vN;
    varying vec3 vW;
    uniform vec3 uCam, uLight, uFog, uFogSun;
    uniform vec3 uDeep, uSilt, uShore, uFlats, uStone, uPeak, uCoast, uContour;
    uniform vec2 uFogRange;
    uniform float uSurfaceR, uScatter, uWash, uDetail, uRelief;

    void main() {
      vec3 N = normalize(vN);
      vec3 toCam = uCam - vW;
      float dist = length(toCam);
      vec3 V = toCam / max(dist, 0.001);
      // On a sphere "up" is the radial and "height" is distance from the
      // centre. Reading either off vW.y put the whole palette on a plane
      // through the planet, so one hemisphere came out as sea floor.
      vec3 up = normalize(vW);
      float slope = 1.0 - clamp(dot(N, up), 0.0, 1.0);
      float h = length(vW) - uSurfaceR;

      // Height-banded palette, then steep faces forced back to stone.
      //
      // Every breakpoint is a fraction of the planet's relief rather than an
      // absolute metre count. The old fixed bands were tuned against a world
      // with 180m of range; dropped onto 52m they put nearly everything in the
      // "shore" band and the whole planet came out pale bone.
      float e = h / uRelief;
      vec3 col = uDeep;
      col = mix(col, uSilt,  smoothstep(-0.50, -0.135, e));
      col = mix(col, uShore, smoothstep(-0.116, -0.006, e));
      col = mix(col, uFlats, smoothstep(0.008, 0.097, e));
      col = mix(col, uStone, smoothstep(0.174, 0.480, e));
      col = mix(col, uPeak,  smoothstep(0.620, 0.950, e));
      col = mix(col, uStone * 0.88, smoothstep(0.32, 0.66, slope));

      // ---- surface detail -------------------------------------------------
      // Macro mottling drifts the palette over a few hundred metres, so no two
      // hillsides come out the same flat colour.
      float macro = fbm2(vW.xz * 0.0055);
      col *= 0.90 + macro * 0.22;
      col = mix(col, col * vec3(1.07, 0.99, 0.90), smoothstep(0.46, 0.86, macro));

      // Strata. Rock breaks in horizontal beds, and they show up on exactly
      // the steep faces where the contour lines get faded out — so the cliffs
      // stop being blank grey panels.
      float bed = fract(e * 16.6 + vnoise(vW.xz * 0.021) * 2.2);
      float bedLine = smoothstep(0.40, 0.50, bed) * (1.0 - smoothstep(0.50, 0.60, bed));
      col = mix(col, col * 0.78, bedLine * slope * 1.4 * uDetail);

      // Grain, faded out with distance so it can never crawl or alias.
      float near = 1.0 - smoothstep(40.0, 260.0, dist);
      col *= 1.0 + (fbm2(vW.xz * 1.35) - 0.5) * 0.30 * near * uDetail;

      // Gravel speckle on the flats only. Keeps the terraces from reading as
      // painted card without touching the cliff faces.
      float flatness = 1.0 - smoothstep(0.10, 0.34, slope);
      col = mix(col, col * 1.18,
        step(0.82, vnoise(vW.xz * 3.1)) * flatness * near * 0.5 * uDetail);

      // Survey chart: minor contours at relief/8.7, index at relief/1.7 — on
      // Home that lands on the 6m and 30m the flat world used.
      float minor = contourMask(h, dist, slope, uRelief * 0.115);
      float major = contourMask(h, dist, slope, uRelief * 0.580);
      col = mix(col, uContour, minor * 0.30);
      col = mix(col, uContour, major * 0.55);

      // The coastline is stroked in, the way it would be on paper.
      float coast = 1.0 - smoothstep(0.0, uRelief * 0.022, abs(h));
      coast *= 1.0 - smoothstep(420.0, 900.0, dist);
      col = mix(col, uCoast, coast * 0.80);

      // Banded key light. uLight is a direction in planet space, so the sun
      // is genuinely fixed and one side of the world is in shadow.
      float d = dot(N, uLight);
      float band = bandLight(d);
      col *= band;
      col = mix(col, col * vec3(0.72, 0.86, 1.0), (1.0 - band) * 0.7);

      // Cool rim so silhouettes separate from the fog at speed.
      float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.5);
      col += vec3(0.10, 0.24, 0.26) * rim * 0.55;

      // Distance eats saturation before it eats the colour outright — that is
      // most of what makes a far ridge read as far.
      float fog = smoothstep(uFogRange.x, uFogRange.y, dist);
      float wash = smoothstep(uFogRange.x * 0.35, uFogRange.y, dist);
      col = mix(col, vec3(dot(col, vec3(0.30, 0.59, 0.11))), wash * uWash);
      gl_FragColor = vec4(mix(col, hazeColor(uFog, uFogSun, V, uLight, uScatter), fog), 1.0);
    }
  `;

  // ---- water ------------------------------------------------------------
  // 'depth' is a per-vertex attribute the CPU fills from height(). It is how
  // flat water knows where the shallows are without a depth pre-pass. On a
  // finite world it is a property of the planet, so it is filled once at
  // construction rather than refilled on every snap.
  S.svWaterVertexShader = `
    precision highp float;
    attribute vec3 position;
    attribute float depth;
    uniform mat4 world;
    uniform mat4 worldViewProjection;
    uniform float uTime, uWaveK, uWaveAmp;
    varying vec3 vW;
    varying float vDepth;
    varying vec3 vN;

    void main() {
      vec4 wp = world * vec4(position, 1.0);
      // The shell is centred on the planet, so the outward radial is just the
      // normalised position — no matrix inverse needed (GLSL ES 1.00 has none).
      vec3 up = normalize(wp.xyz);
      // Swell driven by the direction, so it stays continuous all the way round
      // instead of tearing at the antipode the way a world-space field would.
      float w =
        sin(up.x * uWaveK + uTime * 1.15) * 0.30 +
        sin(up.z * uWaveK * 0.79 - uTime * 0.87) * 0.26 +
        sin((up.x + up.y + up.z) * uWaveK * 0.40 + uTime * 0.55) * 0.20;
      w *= uWaveAmp;
      // Flatten the swell as the shore comes up so waves don't pierce sand.
      float shoal = smoothstep(0.0, 3.0, depth);
      float lift = w * shoal;

      // Tilt the normal from the swell gradient, in the tangent plane.
      vec3 tx = normalize(cross(up, vec3(0.0, 1.0, 0.0)) + vec3(1e-5));
      vec3 tz = cross(up, tx);
      float dx = cos(up.x * uWaveK + uTime * 1.15) * 0.30 * uWaveK * 0.02;
      float dz = cos(up.z * uWaveK * 0.79 - uTime * 0.87) * 0.26 * uWaveK * 0.02;
      vN = normalize(up - (tx * dx + tz * dz) * shoal * uWaveAmp);

      vW = wp.xyz + up * lift;
      vDepth = depth;
      gl_Position = worldViewProjection * vec4(position + normalize(position) * lift, 1.0);
    }
  `;

  S.svWaterFragmentShader = COMMON + `
    varying vec3 vW;
    varying float vDepth;
    varying vec3 vN;
    uniform vec3 uCam, uLight, uFog, uFogSun, uDeepW, uShallowW, uCoast;
    uniform vec2 uFogRange;
    uniform float uTime, uScatter, uMaxDepth;

    void main() {
      vec3 toCam = uCam - vW;
      float dist = length(toCam);
      vec3 V = toCam / max(dist, 0.001);
      vec3 N = normalize(vN);

      // Depth banded into discrete shelves — a bathymetric chart, not a gradient.
      float d = vDepth;
      // Six shelves spread across whatever depth this planet actually reaches,
      // instead of a fixed 0-24m that a shallow world never gets out of.
      float shelf = floor(clamp(d / uMaxDepth, 0.0, 0.999) * 6.0) / 6.0;
      vec3 col = mix(uShallowW, uDeepW, shelf);

      // Foam ring in the shallows, plus a broken second line further out.
      float foam = 1.0 - smoothstep(0.0, uMaxDepth * 0.14, d);
      float ripple = sin(d * (30.0 / uMaxDepth) - uTime * 2.2) * 0.5 + 0.5;
      foam = max(foam, (1.0 - smoothstep(uMaxDepth * 0.12, uMaxDepth * 0.32, d)) *
        step(0.72, ripple) * 0.7);
      col = mix(col, uCoast, foam * 0.85);

      // Toon glint: a hard-edged specular that pops on and off, no falloff.
      vec3 H = normalize(uLight + V);
      float spec = pow(clamp(dot(N, H), 0.0, 1.0), 60.0);
      col += vec3(0.85, 1.0, 0.98) * step(0.30, spec) * 0.40;

      // A sun path on the water, stretched along the view. Cheap, and it
      // gives an otherwise flat lake a direction.
      float path = pow(clamp(dot(-V, uLight), 0.0, 1.0), 8.0);
      col += uFogSun * path * 0.22 * smoothstep(0.0, 3.0, d);

      float band = bandLight(dot(N, uLight));
      col *= mix(0.86, 1.0, band);

      float fog = smoothstep(uFogRange.x, uFogRange.y, dist);
      col = mix(col, hazeColor(uFog, uFogSun, V, uLight, uScatter), fog);
      float alpha = mix(0.72, 0.93, smoothstep(0.0, uMaxDepth * 0.6, d));
      gl_FragColor = vec4(col, mix(alpha, 1.0, fog));
    }
  `;

  // ---- sky --------------------------------------------------------------
  S.svSkyVertexShader = `
    precision highp float;
    attribute vec3 position;
    uniform mat4 worldViewProjection;
    varying vec3 vP;
    void main() {
      vP = position;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }
  `;

  S.svSkyFragmentShader = `
    precision highp float;
    varying vec3 vP;
    uniform vec3 uLow, uHigh, uLight, uCoast, uFog, uFogSun, uUp, uEast, uNorth;
    uniform float uTime, uHaze;

    void main() {
      vec3 D = normalize(vP);
      // Elevation is measured against the LOCAL up. Using D.y would keep the
      // sky's horizon fixed to world Y while yours rotated under you, so the
      // ground would meet the sky at a different angle on every continent.
      float el = dot(D, uUp);
      float t = clamp(el * 1.25 + 0.06, 0.0, 1.0);
      // Quantised sky bands, softened just enough to avoid hard stepping. Ten
      // steps at a lighter blend: seven was coarse enough that the seams read
      // as geometry edges once the horizon haze was laid over them.
      float q = floor(t * 10.0) / 10.0;
      vec3 col = mix(uLow, uHigh, mix(t, q, 0.42));

      float s = dot(D, normalize(uLight));

      // Three cloud strata, drifting at different rates so the ceiling has
      // depth rather than reading as one printed layer.
      //
      // Laid out in the LOCAL horizon frame, not in world X/Z. Driven by world
      // axes the pattern does not rotate with you, and wherever your local up
      // lines up with the pattern's own axis the bands degenerate into one
      // enormous hard-edged slab hanging in the sky. Azimuth around the local
      // up is the only stable parametrisation.
      float cu = dot(D, uEast);
      float cv = dot(D, uNorth);
      // smoothstep, not step: a hard threshold on a sine gives razor-straight
      // cloud edges, which is what made the artefact so obviously wrong.
      float band1 = sin(cu * 5.0 + uTime * 0.020) * sin(cv * 4.0 - uTime * 0.014);
      float h1 = smoothstep(0.10, 0.16, el) * (1.0 - smoothstep(0.30, 0.46, el));
      col = mix(col, uCoast * 0.94, smoothstep(0.40, 0.56, band1) * h1 * 0.42);

      float band2 = sin(cu * 2.4 - uTime * 0.011 + 1.7) * sin(cv * 2.9 + uTime * 0.009);
      float h2 = smoothstep(0.26, 0.34, el) * (1.0 - smoothstep(0.54, 0.72, el));
      col = mix(col, uCoast * 0.88, smoothstep(0.52, 0.70, band2) * h2 * 0.30);

      float band3 = sin(cu * 1.3 + uTime * 0.006 - 0.9) * sin(cv * 1.6 - uTime * 0.005);
      float h3 = smoothstep(0.44, 0.56, el) * (1.0 - smoothstep(0.78, 0.96, el));
      col = mix(col, uCoast * 0.80, smoothstep(0.58, 0.76, band3) * h3 * 0.22);

      // The horizon has to sit down into the same haze the terrain fades to,
      // or the two meet at a visible seam and the world looks like a diorama.
      float low = 1.0 - smoothstep(-0.03, 0.24, el);
      vec3 hz = mix(uFog, uFogSun, pow(clamp(s, 0.0, 1.0), 2.0) * 0.75);
      col = mix(col, hz, low * uHaze);

      // Sun last, so nothing hazes over it. Deliberately above 1.0: the bloom
      // pass is what turns this into glare.
      col += vec3(0.30, 0.46, 0.44) * smoothstep(0.945, 0.9970, s) * 0.55;
      col += uCoast * smoothstep(0.9970, 0.9992, s) * 2.6;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  // ---- craft / props (vertex-coloured toon) ------------------------------
  S.svCraftVertexShader = `
    precision highp float;
    attribute vec3 position;
    attribute vec3 normal;
    attribute vec4 color;
    uniform mat4 world;
    uniform mat4 worldViewProjection;
    varying vec3 vN;
    varying vec3 vW;
    varying vec4 vC;
    void main() {
      vec4 wp = world * vec4(position, 1.0);
      vW = wp.xyz;
      vN = normalize(mat3(world) * normal);
      vC = color;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }
  `;

  // Alpha channel of the vertex colour is used as an emissive flag, so glowing
  // engine parts and painted hull panels live in the same mesh.
  S.svCraftFragmentShader = COMMON + `
    varying vec3 vN;
    varying vec3 vW;
    varying vec4 vC;
    uniform vec3 uCam, uLight, uFog;
    uniform vec2 uFogRange;
    uniform float uHeat;

    void main() {
      vec3 N = normalize(vN);
      vec3 toCam = uCam - vW;
      float dist = length(toCam);
      vec3 V = toCam / max(dist, 0.001);

      float emissive = vC.a;
      vec3 col = vC.rgb * bandLight(dot(N, uLight));

      float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.6);
      col += vec3(0.16, 0.42, 0.44) * rim * 0.55;

      // Emissive parts ignore lighting and ramp with boost heat.
      col = mix(col, vC.rgb * (1.4 + uHeat * 1.8), emissive);

      float fog = smoothstep(uFogRange.x, uFogRange.y, dist);
      gl_FragColor = vec4(mix(col, uFog, fog * 0.9), 1.0);
    }
  `;
}

let registered = false;

export function createMaterials(scene, planet) {
  if (!registered) { registerShaders(); registered = true; }

  // Fog is per-planet now, derived from radius. The old fixed 1180m far plane
  // was longer than the diameter of half the worlds in the system.
  const fogRange = new BABYLON.Vector2(planet.fogNear, planet.fogFar);
  const light = new BABYLON.Vector3(0.42, 0.74, 0.52).normalize();

  const terrain = new BABYLON.ShaderMaterial('svTerrain', scene,
    { vertex: 'svTerrain', fragment: 'svTerrain' },
    {
      attributes: ['position', 'normal'],
      uniforms: ['world', 'worldViewProjection', 'uCam', 'uLight', 'uFog',
        'uFogSun', 'uDeep', 'uSilt', 'uShore', 'uFlats', 'uStone', 'uPeak',
        'uCoast', 'uContour', 'uFogRange', 'uSurfaceR', 'uScatter', 'uWash',
        'uDetail', 'uRelief'],
    });
  terrain.setVector3('uLight', light);
  terrain.setVector3('uFog', V3(COLORS.fog));
  terrain.setVector3('uFogSun', V3(COLORS.fogSun));
  terrain.setFloat('uScatter', ATMO.sunScatter);
  terrain.setFloat('uWash', ATMO.distanceWash);
  terrain.setFloat('uDetail', ATMO.terrainDetail);
  terrain.setFloat('uRelief', planet.relief);
  terrain.setVector3('uDeep', V3(COLORS.deep));
  terrain.setVector3('uSilt', V3(COLORS.silt));
  terrain.setVector3('uShore', V3(COLORS.shore));
  terrain.setVector3('uFlats', V3(COLORS.flats));
  terrain.setVector3('uStone', V3(COLORS.stone));
  terrain.setVector3('uPeak', V3(COLORS.peak));
  terrain.setVector3('uCoast', V3(COLORS.coast));
  terrain.setVector3('uContour', V3(COLORS.contour));
  terrain.setVector2('uFogRange', fogRange);
  terrain.setFloat('uSurfaceR', planet.surfaceR);

  const water = new BABYLON.ShaderMaterial('svWater', scene,
    { vertex: 'svWater', fragment: 'svWater' },
    {
      attributes: ['position', 'depth'],
      uniforms: ['world', 'worldViewProjection', 'uCam', 'uLight', 'uFog',
        'uFogSun', 'uDeepW', 'uShallowW', 'uCoast', 'uFogRange', 'uTime',
        'uScatter', 'uWaveK', 'uWaveAmp', 'uMaxDepth'],
      needAlphaBlending: true,
    });
  water.setVector3('uLight', light);
  water.setVector3('uFog', V3(COLORS.fog));
  water.setVector3('uFogSun', V3(COLORS.fogSun));
  water.setFloat('uScatter', ATMO.sunScatter);
  water.setVector3('uDeepW', V3(COLORS.deep));
  water.setVector3('uShallowW', V3(COLORS.shallow));
  water.setVector3('uCoast', V3(COLORS.coast));
  water.setVector2('uFogRange', fogRange);
  water.setFloat('uWaveK', planet.waveFreq);
  water.setFloat('uWaveAmp', planet.waveAmp);
  // How deep this planet's water actually gets, so the bathymetry bands spread
  // across the real range rather than a fixed 24m.
  water.setFloat('uMaxDepth', Math.max(3, planet.relief * 0.42));
  // Culling ON. The water is a closed shell now, not a plane: with culling off
  // the far side of the sphere draws straight through the sky above the
  // horizon, as a hard-edged grey quad hanging over the world.
  water.backFaceCulling = true;
  water.alpha = 0.9;

  const sky = new BABYLON.ShaderMaterial('svSky', scene,
    { vertex: 'svSky', fragment: 'svSky' },
    {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'uLow', 'uHigh', 'uLight', 'uCoast',
        'uTime', 'uFog', 'uFogSun', 'uHaze', 'uUp', 'uEast', 'uNorth'],
    });
  sky.setVector3('uLow', V3(COLORS.skyLow));
  sky.setVector3('uHigh', V3(COLORS.skyHigh));
  sky.setVector3('uLight', light);
  sky.setVector3('uCoast', V3(COLORS.coast));
  sky.setVector3('uFog', V3(COLORS.fog));
  sky.setVector3('uFogSun', V3(COLORS.fogSun));
  sky.setFloat('uHaze', ATMO.horizonHaze);
  sky.setVector3('uUp', new BABYLON.Vector3(0, 1, 0));
  sky.setVector3('uEast', new BABYLON.Vector3(1, 0, 0));
  sky.setVector3('uNorth', new BABYLON.Vector3(0, 0, 1));
  sky.backFaceCulling = false;
  sky.disableDepthWrite = true;

  const craft = new BABYLON.ShaderMaterial('svCraft', scene,
    { vertex: 'svCraft', fragment: 'svCraft' },
    {
      attributes: ['position', 'normal', 'color'],
      uniforms: ['world', 'worldViewProjection', 'uCam', 'uLight', 'uFog',
        'uFogRange', 'uHeat'],
    });
  craft.setVector3('uLight', light);
  craft.setVector3('uFog', V3(COLORS.fog));
  craft.setVector2('uFogRange', fogRange);
  craft.setFloat('uHeat', 0);

  const mats = { terrain, water, sky, craft, light, fogColor: C3(COLORS.fog) };

  let time = 0;
  const upVec = new BABYLON.Vector3(0, 1, 0);
  const eastVec = new BABYLON.Vector3(1, 0, 0);
  const northVec = new BABYLON.Vector3(0, 0, 1);
  mats.update = (dt, camPos, heat, up, east, north) => {
    time += dt;
    const cam = camPos;
    terrain.setVector3('uCam', cam);
    water.setVector3('uCam', cam);
    water.setFloat('uTime', time);
    sky.setFloat('uTime', time);
    craft.setVector3('uCam', cam);
    craft.setFloat('uHeat', heat);
    if (up) {
      upVec.set(up.x, up.y, up.z);
      sky.setVector3('uUp', upVec);
    }
    if (east) {
      eastVec.set(east.x, east.y, east.z);
      northVec.set(north.x, north.y, north.z);
      sky.setVector3('uEast', eastVec);
      sky.setVector3('uNorth', northVec);
    }
  };

  return mats;
}
