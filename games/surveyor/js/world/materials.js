// Every surface in the game is drawn by one of four shaders in this file.
// The through-line: the planet is rendered as a live survey chart. Contour
// lines are cut into the rock, the waterline gets a drawn coastline stroke,
// and light is quantised into flat bands so form reads as shape, not shading.

import { COLORS, WORLD, ATMO, SKY, LIGHT } from '../tune.js';
import { meltDepth } from './water.js';

const V3 = (c) => new BABYLON.Vector3(c[0], c[1], c[2]);
const C3 = (c) => new BABYLON.Color3(c[0], c[1], c[2]);
const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** This planet's palette: the system default with the profile merged over it. */
export function paletteOf(planet) {
  return Object.assign({}, COLORS, planet.palette || {});
}

/**
 * This planet's light rig, fully resolved — T2.
 *
 * Same shape as skyOf: the system default merged under whatever the profile
 * says, so a world states only what it disagrees with. The nested rim blocks
 * are merged one level down as well, because a world that wants a tighter rim
 * should not have to restate its intensity to get it.
 *
 * Deliberately NOT holding a sun direction. That lives in `sky.sunDir` and is
 * read from there by the ground, by the discs and by the baked disc relief —
 * one value, three readers, nothing to fall out of step.
 */
export function lightOf(planet) {
  const L = Object.assign({}, LIGHT, planet.light || {});
  L.rim = Object.assign({}, LIGHT.rim, (planet.light || {}).rim || {});
  L.craftRim = Object.assign({}, LIGHT.craftRim, (planet.light || {}).craftRim || {});
  return L;
}

/**
 * This planet's sky, fully resolved.
 *
 * One model, six parameter sets. Every `null` in SKY means "derive it from the
 * palette", and that is what keeps the six from drifting apart: a world that
 * only states a mood inherits colours that already agree with its ground.
 *
 * Exported because the sky is not only the dome — the mote layer in trails.js
 * reads the same block, so the ash falling on Ember is part of the same
 * description as the ceiling it falls out of.
 */
export function skyOf(planet) {
  const COL = paletteOf(planet);
  const S = Object.assign({}, SKY, planet.sky || {});
  return Object.assign(S, {
    zenith: S.zenith || COL.skyHigh,
    horizon: S.horizon || COL.skyLow,
    below: S.below || scale(COL.fog, 0.55),
    bandColor: S.bandColor || COL.fogSun,
    cloudColor: S.cloudColor || COL.coast,
    underglowColor: S.underglowColor || COL.fogSun,
    sunColor: S.sunColor || COL.fogSun,
    haze: S.haze === null || S.haze === undefined ? ATMO.horizonHaze : S.haze,
    emit: S.emit || 0,
    emitFrom: S.emitFrom || 0.30,
  });
}

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
    // Baked on the CPU when the leaf is built: how deep inside a fissure this
    // vertex is, 0 on the intact plain. Zero-filled on the five worlds that
    // have no fissures, so the attribute is always present and the shader never
    // has to know which world it is drawing.
    attribute float fissure;
    uniform mat4 world;
    uniform mat4 worldViewProjection;
    varying vec3 vN;
    varying vec3 vW;
    varying float vFis;
    void main() {
      vec4 wp = world * vec4(position, 1.0);
      vW = wp.xyz;
      vN = normalize(mat3(world) * normal);
      vFis = fissure;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }
  `;

  S.svTerrainFragmentShader = COMMON + `
    varying vec3 vN;
    varying vec3 vW;
    varying float vFis;
    uniform vec3 uCam, uLight, uFog, uFogSun;
    uniform vec3 uDeep, uSilt, uShore, uFlats, uStone, uPeak, uCoast, uContour;
    uniform vec3 uShade, uRim, uEmitCol, uEmitHot;
    uniform vec2 uFogRange;
    uniform float uSurfaceR, uScatter, uWash, uDetail, uRelief;
    uniform float uSpec, uEmit, uEmitFrom;
    // T2: x = ambient fill, y = key, z = how hard the unlit bands take uShade.
    uniform vec3 uLightMix, uSunCol, uRimP;

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

      /* Banded key light, split into key and fill — T2. uLight is a direction
         in planet space, so the sun is genuinely fixed and one side of the
         world is in shadow.

             luminance = ambient + sunIntensity * band

         which is lookdev's own model with its own two numbers: uLightMix.x is
         the fill it gets from an IBL, uLightMix.y is the key. Defaults 0 and 1
         reproduce the pre-T2 image exactly. What the split buys is a world like
         Ember, where the fire underfoot is the light source and the sun barely
         is: lifting the fill and dropping the key flattens the shadows toward
         the ground's own glow without touching how bright a lit face comes out,
         because ambient + sunIntensity * 1.04 is held near 1.04. */
      float d = dot(N, uLight);
      float band = bandLight(d);
      col *= (uLightMix.x + uLightMix.y * band) * uSunCol;
      // The shade tint was a hardcoded cool blue. It is per-planet now, and it
      // is doing more work than any single band colour: Vault's shadow is deep
      // blue, Ember's is orange because the light comes off the ground, Anvil's
      // is iron.
      col = mix(col, col * uShade, (1.0 - band) * uLightMix.z);

      /* Rim, so silhouettes separate from the fog at speed — and, since T2,
         masked to the lit side. The mask is the whole difference between light
         grazing an edge and an outline drawn around everything: uRimP.z at 0
         rims every silhouette whatever it faces, at 1 only what the sun can
         see. Term for term from lookdev's rim.js. */
      float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), uRimP.x) * uRimP.y;
      rim *= mix(1.0, clamp(d * 0.5 + 0.5, 0.0, 1.0), uRimP.z);
      col += uRim * rim;

      // Hard toon glint on the flats. Zero everywhere but Vault, where the ice
      // sheen is half of what makes the ground read as frozen rather than pale.
      if (uSpec > 0.0) {
        vec3 H = normalize(uLight + V);
        float sp = pow(clamp(dot(N, H), 0.0, 1.0), 42.0);
        col += uFogSun * step(0.22, sp) * uSpec * (1.0 - smoothstep(0.06, 0.30, slope));
      }

      /* Fissure emission — Ember. The mask is the baked attribute, never
         recomputed here: the CPU and GPU noise would have to agree bit for bit
         across every driver in the world, and they do not.
         Authored deliberately past 1.0 so the bloom pass in main.js turns the
         cracks into glare. Applied after the light bands because the ground
         glowing is not a lit surface — it is the light. */
      if (uEmit > 0.0) {
        float hot = smoothstep(uEmitFrom, 0.92, vFis);
        vec3 fire = mix(uEmitCol, uEmitHot, hot * hot);
        col = mix(col, fire * (0.55 + uEmit * hot), hot);
      }

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
    uniform float uTime, uScatter, uMaxDepth, uFrozen, uMelt;
    uniform vec3 uLightMix, uSunCol;    // T2: see the terrain shader

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

      // Water's response to the bands is shallower than the ground's by design,
      // but it takes the same key and fill — T2 — or a world whose shadows lift
      // would have its sea stay put and the two would disagree at the shore.
      float band = bandLight(dot(N, uLight));
      col *= (uLightMix.x + uLightMix.y * mix(0.86, 1.0, band)) * uSunCol;

      /* FROZEN (Vault). The same shelves, but read as a solid surface: pale,
         opaque, and with the melt line stroked across it in the chart's own
         hand. Past that line the ice does not hold the rover, so this stroke is
         not decoration — it is the hazard, drawn where the hull can still turn
         around. Everything here is multiplied by uFrozen, which is 0 on the
         other five worlds. */
      float lineNow = 0.0;
      if (uFrozen > 0.0) {
        vec3 ice = mix(uCoast, uShallowW, smoothstep(0.0, uMaxDepth, d) * 0.55);
        // Wind-scoured streaks, so a frozen lake is not a flat panel of white.
        ice *= 0.94 + 0.10 * fbm2(vW.xz * 0.06);
        // Beyond the melt line the surface darkens back toward open water,
        // which is the second reading of the same information.
        ice = mix(ice, uDeepW * 1.25, smoothstep(uMelt, uMelt + uMaxDepth * 0.20, d));
        lineNow = 1.0 - smoothstep(0.0, max(uMaxDepth * 0.035, 0.15), abs(d - uMelt));
        ice = mix(ice, uCoast * 1.35, lineNow * 0.85);
        col = mix(col, ice, uFrozen);
      }

      float fog = smoothstep(uFogRange.x, uFogRange.y, dist);
      col = mix(col, hazeColor(uFog, uFogSun, V, uLight, uScatter), fog);
      float alpha = mix(0.72, 0.93, smoothstep(0.0, uMaxDepth * 0.6, d));
      gl_FragColor = vec4(col, mix(mix(alpha, 1.0, uFrozen), 1.0, fog));
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

  // ONE sky, parameterised. Every world drives the same twenty lines with a
  // different set of numbers — gradient stops, a horizon band, a cloud ceiling,
  // an optional underglow — which is the only way six skies stay maintainable.
  S.svSkyFragmentShader = `
    precision highp float;
    varying vec3 vP;
    uniform vec3 uLow, uHigh, uBelow, uLight, uBandCol, uCloudCol, uUnderCol;
    uniform vec3 uSunCol, uFog, uFogSun, uUp, uEast, uNorth;
    uniform float uTime, uHaze, uBand, uBandW, uClouds, uCeil, uUnder;
    uniform float uSunSize, uGlare;

    /* One stratum's elevation window.
       The window MOVES with the ceiling; its edges do not shrink with it. That
       distinction is the whole function: scaling elevation by 1/ceiling instead
       compresses the fades along with the band, and Ember's low lid came out as
       a hard-edged ring drawn across the sky. */
    float strat(float el, float lo, float hi, float ceil) {
      return smoothstep(lo * ceil, lo * ceil + 0.06, el) *
        (1.0 - smoothstep(hi * ceil, hi * ceil + 0.16, el));
    }

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

      // The third gradient stop: what the dome does BELOW the skyline. Without
      // it a dark world gets a bright sky wrapping under its own horizon, which
      // is visible off every cliff edge and from the air.
      col = mix(col, uBelow, smoothstep(0.03, -0.12, el));

      float s = dot(D, normalize(uLight));

      // Three cloud strata, drifting at different rates so the ceiling has
      // depth rather than reading as one printed layer. uCeil divides the
      // elevation windows: below 1.0 the whole stack is dragged down into a low
      // heavy lid, which is most of what makes Ember's sky feel like a roof.
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
      float h1 = strat(el, 0.10, 0.30, uCeil);
      col = mix(col, uCloudCol * 0.94, smoothstep(0.40, 0.56, band1) * h1 * 0.42 * uClouds);

      float band2 = sin(cu * 2.4 - uTime * 0.011 + 1.7) * sin(cv * 2.9 + uTime * 0.009);
      float h2 = strat(el, 0.26, 0.54, uCeil);
      col = mix(col, uCloudCol * 0.88, smoothstep(0.52, 0.70, band2) * h2 * 0.30 * uClouds);

      float band3 = sin(cu * 1.3 + uTime * 0.006 - 0.9) * sin(cv * 1.6 - uTime * 0.005);
      float h3 = strat(el, 0.44, 0.78, uCeil);
      col = mix(col, uCloudCol * 0.80, smoothstep(0.58, 0.76, band3) * h3 * 0.22 * uClouds);

      // A band hugging the skyline. Narrow and faint it is a horizon line; wide
      // and strong it is sea haze, and Tarn is nothing but sea haze.
      col = mix(col, uBandCol, uBand * (1.0 - smoothstep(0.0, max(uBandW, 0.005), abs(el))));

      // The horizon has to sit down into the same haze the terrain fades to,
      // or the two meet at a visible seam and the world looks like a diorama.
      float low = 1.0 - smoothstep(-0.03, 0.24, el);
      vec3 hz = mix(uFog, uFogSun, pow(clamp(s, 0.0, 1.0), 2.0) * 0.75);
      col = mix(col, hz, low * uHaze);

      // Underglow: the ground lighting the sky from beneath, for a world whose
      // light source is at your feet. Added rather than mixed, and authored
      // past 1.0, so Ember's ceiling blooms like the cracks do.
      col += uUnderCol * uUnder * smoothstep(0.34, -0.16, el);

      // Sun last, so nothing hazes over it. Deliberately above 1.0: the bloom
      // pass is what turns this into glare.
      col += uSunCol * smoothstep(1.0 - 0.055 * uSunSize, 1.0 - 0.003 * uSunSize, s)
        * 0.55 * uGlare;
      col += uSunCol * smoothstep(1.0 - 0.0030 * uSunSize, 1.0 - 0.0008 * uSunSize, s)
        * 2.6 * uGlare;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  // ---- the other worlds, seen from this one ------------------------------
  // Billboards rebuilt every frame in CAMERA-RELATIVE coordinates (see
  // discs.js), so nothing here ever sees a number in the hundreds of
  // kilometres. `quad` is the corner in -1..1 and the vertex colour carries the
  // world's tint in rgb and its honest core radius, as a fraction of the quad,
  // in alpha.
  S.svDiscVertexShader = `
    precision highp float;
    attribute vec3 position;
    attribute vec2 quad;
    attribute vec4 color;
    attribute vec3 dir;     // this world's direction, in planet space
    attribute vec3 sun;     // ...and ITS sun, which is not this world's sun
    attribute float slot;   // its row in the preview atlas
    attribute float spec;   // its toon ice sheen. 0 on five of the six
    uniform mat4 worldViewProjection;
    varying vec2 vQ;
    varying vec4 vC;
    varying vec3 vDir;
    varying vec3 vSun;
    varying float vSlot;
    varying float vSpec;
    void main() {
      vQ = quad;
      vC = color;
      vDir = dir;
      vSun = sun;
      vSlot = slot;
      vSpec = spec;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }
  `;

  S.svDiscFragmentShader = `
    precision highp float;
    varying vec2 vQ;
    varying vec4 vC;
    varying vec3 vDir;
    varying vec3 vSun;
    varying float vSlot;
    varying float vSpec;
    uniform vec3 uRight, uUp;
    uniform sampler2D uMap;
    uniform float uGlow, uLimb, uDisc, uNight, uEmit, uRows;

    void main() {
      float r = length(vQ);
      float core = max(vC.a, 0.001);
      float disc = 1.0 - smoothstep(core * 0.94, core * 1.06, r);
      float halo = pow(max(0.0, 1.0 - r), 3.2);

      /* THE SPHERE THE BILLBOARD STANDS FOR.
         The quad faces the camera, but the world it represents sits along vDir
         — which is NOT the camera's forward axis, and at 40-70px the difference
         is a visibly wrong terminator on any disc away from the centre of the
         screen. So the basis is built around vDir and only ORIENTED by the
         camera: e1/e2 are the screen's right and up flattened onto the plane
         across vDir, which is what makes the world hold still when you turn
         your head and roll when you tilt it, exactly as the real thing would. */
      vec3 C = normalize(vDir);
      vec3 e1 = uRight - C * dot(uRight, C);
      // Degenerate only if the world is exactly off the side of the screen, at
      // which point it is not in frame anyway; up is the fallback basis.
      e1 = normalize(mix(e1, uUp - C * dot(uUp, C), step(length(e1), 0.001)));
      vec3 e2 = normalize(cross(C, e1));

      vec2 q = vQ / core;
      float z = sqrt(max(0.0, 1.0 - min(1.0, dot(q, q))));
      // The outward normal at the point of that world's surface under this
      // pixel — which, on a unit sphere, IS the point.
      vec3 S = normalize(e1 * q.x + e2 * q.y - C * z);

      /* Its own map, its own row of the atlas. Longitude wraps, latitude is
         inset half a texel from the row edges so bilinear filtering cannot
         reach into the planet stacked above or below. */
      float lon = atan(S.z, S.x);
      float lat = asin(clamp(S.y, -1.0, 1.0));
      float v = (0.5 - lat / 3.14159265);
      vec2 uv = vec2(lon / 6.28318531 + 0.5, (vSlot + clamp(v, 0.002, 0.998)) / uRows);
      vec4 map = texture2D(uMap, uv);

      /* Phase, against THAT world's sun. Each planet has its own fixed sun
         direction, so the six do not all show the same crescent — and the one
         on the disc agrees with the light on that world's ground when you get
         there. */
      float lit = uNight + (1.0 - uNight) *
        smoothstep(-0.22, 0.30, dot(S, normalize(vSun)));
      // Limb darkening, off the sphere's own depth: 1.0 at the centre, uLimb at
      // the rim. At this size it is visible, and it is most of what makes the
      // thing read as a sphere rather than a sticker.
      float limb = mix(uLimb, 1.0, z);

      vec3 col = map.rgb * (lit * limb * uDisc);

      /* Ice sheen — Vault, and nowhere else. vSpec is that world's palette
         spec, which is 0 on the other five, and the terrain shader calls this
         half of what makes its ground read as frozen. The same is true up here:
         without it Vault is a grey ball with a pale palette, and grey balls are
         what every other world in the sky already looks like from far enough
         away. The view direction from the world is -C, because C points from
         here to there.

         Wider and weaker than the ground's version, which is a 42nd power under
         a hard step. Half a world away the highlight sits wherever the sun and
         the line of sight bisect, and at a right angle between them that is the
         LIMB — where a hard-edged chip of white reads as a rendering fault
         rather than as ice. A broad sheen carries the same information and
         cannot be mistaken for one. */
      if (vSpec > 0.0) {
        vec3 hv = normalize(normalize(vSun) - C);
        col += vC.rgb * vSpec * 0.34 * smoothstep(0.18, 0.55,
          pow(clamp(dot(S, hv), 0.0, 1.0), 12.0));
      }
      // Ember's cracks are a light source, not a lit surface, so they are added
      // after the terminator and past 1.0 for the bloom pass to find.
      col += map.rgb * map.a * uEmit;
      col *= disc;
      col += vC.rgb * halo * uGlow * 0.10;

      float a = clamp(disc * 0.97 + halo * 0.22, 0.0, 1.0);
      gl_FragColor = vec4(col, a);
    }
  `;

  // ---- velocity lines ----------------------------------------------------
  /* Star streaking, without stars. There is nothing out there to streak, so the
     streaks ARE the reference: short segments living in a box that scrolls past
     the camera along the travel axis, stretched by speed.
     Placed entirely in the vertex shader from a per-streak seed, so the whole
     field is one draw call and costs nothing per frame on the CPU — at the cap
     the game is already integrating a 33km step and rebuilding nothing else. */
  S.svStreakVertexShader = `
    precision highp float;
    attribute vec3 seed;      // position in a unit box, per streak
    attribute vec2 corner;    // x: along the streak, y: across it
    uniform mat4 viewProjection;
    uniform vec3 uCam, uDir, uRight, uUp;
    uniform float uBox, uPhase, uLen, uWidth;
    varying float vFade;

    void main() {
      // Scroll along the travel axis and wrap, so the field is endless without
      // ever being regenerated.
      float span = uBox * 2.0;
      float along = fract(seed.z + uPhase) * span - uBox;
      // Perpendicular offset, pushed off the axis so streaks never spawn inside
      // the craft: the near field is where they would read as noise.
      vec2 off = seed.xy * 2.0 - 1.0;
      float r = 0.22 + 0.78 * length(off);
      vec2 dirOff = normalize(off + vec2(1e-4)) * r * uBox;

      vec3 base = uCam + uDir * along + uRight * dirOff.x + uUp * dirOff.y;
      vec3 p = base + uDir * corner.x * uLen
        + normalize(cross(uDir, base - uCam) + vec3(1e-5)) * corner.y * uWidth;

      // Fade at both ends of the box so nothing pops in or out.
      vFade = (1.0 - abs(along) / uBox) * min(1.0, r * 1.6);
      gl_Position = viewProjection * vec4(p, 1.0);
    }
  `;

  S.svStreakFragmentShader = `
    precision highp float;
    varying float vFade;
    uniform vec3 uColor;
    uniform float uAlpha;
    void main() {
      float a = clamp(vFade, 0.0, 1.0) * uAlpha;
      // Above 1.0 at the top end so the bloom pass takes them.
      gl_FragColor = vec4(uColor * (0.6 + uAlpha * 1.4), a);
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
    uniform vec3 uCam, uLight, uFog, uRim;
    uniform vec2 uFogRange;
    uniform float uHeat, uSpec;
    /* uSunCol is the KEY light's tint, new at T2 and shared with the ground.
       uSpecCol is the sun DISC's colour and is what the glint has always been —
       two different colours that were briefly one name. */
    uniform vec3 uLightMix, uRimP, uSunCol, uSpecCol;

    void main() {
      vec3 N = normalize(vN);
      vec3 toCam = uCam - vW;
      float dist = length(toCam);
      vec3 V = toCam / max(dist, 0.001);

      float emissive = vC.a;
      // Same key/fill split as the ground — T2. The hull has to sit in the
      // world's light, not in its own.
      float d = dot(N, uLight);
      vec3 col = vC.rgb * (uLightMix.x + uLightMix.y * bandLight(d)) * uSunCol;

      float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), uRimP.x) * uRimP.y;
      rim *= mix(1.0, clamp(d * 0.5 + 0.5, 0.0, 1.0), uRimP.z);
      col += uRim * rim;

      // Hull specular. Hard-edged like everything else here, and zero on five
      // worlds — the point is that the craft visibly catches the light on Vault
      // and catches nothing anywhere else.
      if (uSpec > 0.0) {
        vec3 H = normalize(uLight + V);
        col += uSpecCol * step(0.30, pow(clamp(dot(N, H), 0.0, 1.0), 30.0))
          * uSpec * (1.0 - emissive);
      }

      // Emissive parts ignore lighting and ramp with boost heat.
      col = mix(col, vC.rgb * (1.4 + uHeat * 1.8), emissive);

      float fog = smoothstep(uFogRange.x, uFogRange.y, dist);
      gl_FragColor = vec4(mix(col, uFog, fog * 0.9), 1.0);
    }
  `;
}

let registered = false;

/** Shaders are global; anything that needs one before a world exists calls this. */
export function ensureShaders() {
  if (!registered) { registerShaders(); registered = true; }
}

export function createMaterials(scene, planet) {
  ensureShaders();

  /* Per-planet palette. COLORS stays the system default and each profile
     overrides only the bands it cares about, so a world that says nothing
     about colour still renders exactly as Home does — which is what keeps
     Home's approved look from drifting when another world is retuned. */
  const COL = paletteOf(planet);
  const SK = skyOf(planet);
  const LT = lightOf(planet);
  /* One vec3 rather than three floats: fill, key, shade-strength always move
     together and always go to the same three shaders, so they travel together.
     x + y * 1.04 is what a fully lit face comes out at — see LIGHT in tune.js. */
  const mix3 = new BABYLON.Vector3(LT.ambient, LT.sunIntensity, LT.shade);
  const sunCol = V3(LT.sunColour);
  const rimP = new BABYLON.Vector3(LT.rim.power, LT.rim.intensity, LT.rim.sunMask);
  const craftRimP = new BABYLON.Vector3(
    LT.craftRim.power, LT.craftRim.intensity, LT.craftRim.sunMask);

  // Fog is per-planet now, derived from radius. The old fixed 1180m far plane
  // was longer than the diameter of half the worlds in the system.
  const fogRange = new BABYLON.Vector2(planet.fogNear, planet.fogFar);
  // The sun is a fixed direction in PLANET space, and it is per-world now: it
  // decides which hemisphere is lit, so two worlds with the same palette still
  // read differently from the same spawn.
  const light = V3(SK.sunDir).normalize();

  const terrain = new BABYLON.ShaderMaterial('svTerrain', scene,
    { vertex: 'svTerrain', fragment: 'svTerrain' },
    {
      attributes: ['position', 'normal', 'fissure'],
      uniforms: ['world', 'worldViewProjection', 'uCam', 'uLight', 'uFog',
        'uFogSun', 'uDeep', 'uSilt', 'uShore', 'uFlats', 'uStone', 'uPeak',
        'uCoast', 'uContour', 'uFogRange', 'uSurfaceR', 'uScatter', 'uWash',
        'uDetail', 'uRelief', 'uShade', 'uRim', 'uSpec', 'uEmit', 'uEmitFrom',
        'uEmitCol', 'uEmitHot', 'uLightMix', 'uSunCol', 'uRimP'],
    });
  terrain.setVector3('uLightMix', mix3);
  terrain.setVector3('uSunCol', sunCol);
  terrain.setVector3('uRimP', rimP);
  terrain.setVector3('uShade', V3(COL.shade));
  terrain.setVector3('uRim', V3(COL.rim));
  terrain.setFloat('uSpec', COL.spec);
  terrain.setFloat('uEmit', SK.emit);
  terrain.setFloat('uEmitFrom', SK.emitFrom);
  terrain.setVector3('uEmitCol', V3(COL.emit));
  terrain.setVector3('uEmitHot', V3(COL.emitHot));
  terrain.setVector3('uLight', light);
  terrain.setVector3('uFog', V3(COL.fog));
  terrain.setVector3('uFogSun', V3(COL.fogSun));
  terrain.setFloat('uScatter', ATMO.sunScatter);
  terrain.setFloat('uWash', ATMO.distanceWash);
  terrain.setFloat('uDetail', ATMO.terrainDetail);
  terrain.setFloat('uRelief', planet.relief);
  terrain.setVector3('uDeep', V3(COL.deep));
  terrain.setVector3('uSilt', V3(COL.silt));
  terrain.setVector3('uShore', V3(COL.shore));
  terrain.setVector3('uFlats', V3(COL.flats));
  terrain.setVector3('uStone', V3(COL.stone));
  terrain.setVector3('uPeak', V3(COL.peak));
  terrain.setVector3('uCoast', V3(COL.coast));
  terrain.setVector3('uContour', V3(COL.contour));
  terrain.setVector2('uFogRange', fogRange);
  terrain.setFloat('uSurfaceR', planet.surfaceR);

  const water = new BABYLON.ShaderMaterial('svWater', scene,
    { vertex: 'svWater', fragment: 'svWater' },
    {
      attributes: ['position', 'depth'],
      uniforms: ['world', 'worldViewProjection', 'uCam', 'uLight', 'uFog',
        'uFogSun', 'uDeepW', 'uShallowW', 'uCoast', 'uFogRange', 'uTime',
        'uScatter', 'uWaveK', 'uWaveAmp', 'uMaxDepth', 'uFrozen', 'uMelt',
        'uLightMix', 'uSunCol'],
      needAlphaBlending: true,
    });
  water.setVector3('uLight', light);
  water.setVector3('uLightMix', mix3);
  water.setVector3('uSunCol', sunCol);
  water.setVector3('uFog', V3(COL.fog));
  water.setVector3('uFogSun', V3(COL.fogSun));
  water.setFloat('uScatter', ATMO.sunScatter);
  water.setVector3('uDeepW', V3(COL.deep));
  water.setVector3('uShallowW', V3(COL.shallow));
  water.setVector3('uCoast', V3(COL.coast));
  water.setVector2('uFogRange', fogRange);
  water.setFloat('uWaveK', planet.waveFreq);
  water.setFloat('uWaveAmp', planet.waveAmp);
  // How deep this planet's water actually gets, so the bathymetry bands spread
  // across the real range rather than a fixed 24m.
  water.setFloat('uMaxDepth', Math.max(3, planet.relief * 0.42));
  // Frozen, and where the ice stops holding. Both 0 unless the profile says
  // otherwise, so this costs the other five worlds a uniform and nothing else.
  water.setFloat('uFrozen', planet.iceThickness > 0 ? 1 : 0);
  water.setFloat('uMelt', meltDepth(planet));
  // Culling ON. The water is a closed shell now, not a plane: with culling off
  // the far side of the sphere draws straight through the sky above the
  // horizon, as a hard-edged grey quad hanging over the world.
  water.backFaceCulling = true;
  water.alpha = 0.9;

  const sky = new BABYLON.ShaderMaterial('svSky', scene,
    { vertex: 'svSky', fragment: 'svSky' },
    {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'uLow', 'uHigh', 'uBelow', 'uLight',
        'uBandCol', 'uCloudCol', 'uUnderCol', 'uSunCol', 'uTime', 'uFog',
        'uFogSun', 'uHaze', 'uBand', 'uBandW', 'uClouds', 'uCeil', 'uUnder',
        'uSunSize', 'uGlare', 'uUp', 'uEast', 'uNorth'],
    });
  sky.setVector3('uLow', V3(SK.horizon));
  sky.setVector3('uHigh', V3(SK.zenith));
  sky.setVector3('uBelow', V3(SK.below));
  sky.setVector3('uLight', light);
  sky.setVector3('uBandCol', V3(SK.bandColor));
  sky.setVector3('uCloudCol', V3(SK.cloudColor));
  sky.setVector3('uUnderCol', V3(SK.underglowColor));
  sky.setVector3('uSunCol', V3(SK.sunColor));
  sky.setVector3('uFog', V3(COL.fog));
  sky.setVector3('uFogSun', V3(COL.fogSun));
  sky.setFloat('uHaze', SK.haze);
  sky.setFloat('uBand', SK.band);
  sky.setFloat('uBandW', SK.bandWidth);
  sky.setFloat('uClouds', SK.clouds);
  sky.setFloat('uCeil', SK.ceiling);
  sky.setFloat('uUnder', SK.underglow);
  sky.setFloat('uSunSize', SK.sunSize);
  sky.setFloat('uGlare', SK.glare);
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
        'uFogRange', 'uHeat', 'uRim', 'uSunCol', 'uSpecCol', 'uSpec',
        'uLightMix', 'uRimP'],
    });
  craft.setVector3('uLight', light);
  craft.setVector3('uLightMix', mix3);
  craft.setVector3('uRimP', craftRimP);
  craft.setVector3('uFog', V3(COL.fog));
  craft.setVector2('uFogRange', fogRange);
  craft.setFloat('uHeat', 0);
  // The hull's rim was a fixed teal, which quietly made every world's craft
  // read as Home's craft. Scaled down against the terrain's because a hull
  // covers far less screen than a hillside does.
  craft.setVector3('uRim', V3(scale(COL.rim, 0.62)));
  craft.setVector3('uSpecCol', V3(SK.sunColor));
  craft.setVector3('uSunCol', sunCol);
  craft.setFloat('uSpec', COL.spec);

  const mats = {
    terrain, water, sky, craft, light, palette: COL, skyParams: SK,
    fogColor: C3(COL.fog),
  };

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
