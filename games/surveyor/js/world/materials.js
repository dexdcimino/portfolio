// Every surface in the game is drawn by one of four shaders in this file.
// The through-line: the planet is rendered as a live survey chart. Contour
// lines are cut into the rock, the waterline gets a drawn coastline stroke,
// and light is quantised into flat bands so form reads as shape, not shading.

import { COLORS, WORLD, ATMO, SKY, LIGHT, TERRAIN, SHADOW, FOG, TIER, FLORA, WIND } from '../tune.js';
import { meltDepth } from './water.js';
import { waterOf } from './seabed.js';

const V3 = (c) => new BABYLON.Vector3(c[0], c[1], c[2]);
const C3 = (c) => new BABYLON.Color3(c[0], c[1], c[2]);
const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** Hermite, so the fog lifts into altitude rather than switching on. */
const smooth01 = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** This planet's palette: the system default with the profile merged over it. */
export function paletteOf(planet) {
  return Object.assign({}, COLORS, planet.palette || {});
}

/**
 * The three triplanar maps, loaded once for the whole session — T3.
 *
 * Every world samples the same three: what changes per world is the tile scale,
 * the blend thresholds and the strength, none of which is a texture. Six worlds
 * loading six copies of the same 470KB map would be the obvious way to do it
 * and the wrong one.
 *
 * `noMipmap: false` and WRAP on both axes, because these tile. `gammaSpace` is
 * FALSE and that is load-bearing: two of the three channels are a normal's XY,
 * and sRGB-decoding a normal bends every surface toward the light by an amount
 * that looks like a lighting bug rather than a decoding one.
 */
let triMaps = null;
function triplanarMaps(scene) {
  if (triMaps) return triMaps;
  triMaps = {};
  for (const layer of TERRAIN.layers) {
    const tex = new BABYLON.Texture(
      `${TERRAIN.path}${layer}.webp`, scene, false, false,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.gammaSpace = false;
    tex.anisotropicFilteringLevel = 4;
    triMaps[layer] = tex;
  }
  return triMaps;
}

/** This planet's terrain-material settings, resolved like skyOf and lightOf. */
export function terrainOf(planet) {
  const T = Object.assign({}, TERRAIN, planet.terrain || {});
  for (const k of ['scale', 'slope', 'altitude', 'detailFade', 'macroFade', 'coast']) {
    T[k] = Object.assign({}, TERRAIN[k], (planet.terrain || {})[k] || {});
  }
  return T;
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
/**
 * WHAT THIS MACHINE CAN AFFORD, resolved once and remembered.
 *
 * Two signals, because a browser will not tell you anything better: the number
 * of logical cores, and the unmasked WebGL renderer string. Neither is
 * trustworthy alone — hardwareConcurrency is capped and lied about for
 * fingerprinting reasons, and the renderer string is a free-text field — but a
 * two-way split is all that is being bought, and the failure modes are not
 * symmetric: guessing low costs a slightly plainer sky, guessing high costs
 * frame time on the machine least able to give it. So the tie goes to low.
 *
 * SwiftShader is called out by name because it is what every screenshot
 * harness in dev/ runs on, and a software rasteriser drawing three octaves of
 * noise per sky pixel is the slowest thing in this game by a wide margin.
 *
 * ?tier=low|high forces it, which is how the sheets compare like with like.
 */
/**
 * THE ELEVATION OF THE TRUE SKYLINE, as a dot with the local up.
 *
 * Zero on the ground and negative in the air. At altitude h on a planet of
 * radius R the horizon sits below local level by the dip angle acos(R/(R+h)),
 * and what the sky shader wants is the elevation of that direction, -sin(dip).
 *
 * Written exactly rather than as the small-angle sqrt(2h/R) the fog rule uses
 * for its horizon DISTANCE, because these worlds are small enough that the
 * approximation stops being one: 15% of Ember's radius is 31 metres and the
 * dip there is already 29.6 degrees.
 *
 * Exported so the suite can assert on the function the game actually calls,
 * rather than on a restatement of it that could agree with a broken original.
 */
export function horizonElevation(planet, alt) {
  const R = planet.surfaceR;
  const h = Math.max(0, alt || 0);
  return -Math.sin(Math.acos(Math.min(1, R / (R + h))));
}

let tierCache = null;
export function tierOf() {
  if (tierCache) return tierCache;
  let name = TIER.force;
  if (!name && typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search).get('tier');
    if (q === 'low' || q === 'high') name = q;
  }
  if (!name) {
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 0;
    let renderer = '';
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    } catch (err) { /* no context, no opinion */ }
    const software = TIER.softwareIsLow &&
      /swiftshader|llvmpipe|software|basic render/i.test(renderer);
    name = (software || (cores && cores < TIER.minCores)) ? 'low' : 'high';
    tierCache = { name, cores, renderer };
  } else {
    tierCache = { name, cores: 0, renderer: 'forced' };
  }
  tierCache.cloudDetail = TIER.cloudDetail[tierCache.name];
  tierCache.cloudStrata = TIER.cloudStrata[tierCache.name];
  return tierCache;
}

export function skyOf(planet) {
  const COL = paletteOf(planet);
  const S = Object.assign({}, SKY, planet.sky || {});
  /* NESTED BLOCKS MERGE PER KEY, and a flat Object.assign does not do it.
     A world that states only `scatter: { gain: 0.4 }` would otherwise get an
     object with one key and four undefined uniforms, which reaches the GPU
     as NaN and blacks out that world and no other. */
  S.scatter = Object.assign({}, SKY.scatter, (planet.sky || {}).scatter || {});
  return Object.assign(S, {
    zenith: S.zenith || COL.skyHigh,
    horizon: S.horizon || COL.skyLow,
    below: S.below || scale(COL.fog, 0.55),
    bandColor: S.bandColor || COL.fogSun,
    cloudColor: S.cloudColor || COL.coast,
    underglowColor: S.underglowColor || COL.fogSun,
    sunColor: S.sunColor || COL.fogSun,
    /* The middle of the gradient, resolved HERE like every other null, so
       the shader is handed three real stops and nothing downstream has to
       know what a default mid is. null = the midpoint of the two ends at
       midAt, which with curve 1 is exactly the two-stop linear ramp this
       replaced — the neutral case stated rather than assumed. */
    mid: S.mid || (() => {
      const lo = S.horizon || COL.skyLow, hi = S.zenith || COL.skyHigh, k = S.midAt;
      return [lo[0] + (hi[0] - lo[0]) * k,
        lo[1] + (hi[1] - lo[1]) * k,
        lo[2] + (hi[2] - lo[2]) * k];
    })(),
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

  /* TRIPLANAR — transplanted from the lookdev testbed, T3.
     Its version is a PBRMaterial plugin and there is no PBRMaterial here, so
     what came across is the technique: project world position onto the three
     axis planes, blend by the surface normal, and let one plane dominate so the
     other two branch out of the shader entirely.

     WHY IT IS NOT DECORATION. The surface grain below this already existed and
     was sampled on vW.xz — a single planar projection, on a cube-sphere. That
     is correct on the two caps and smears everywhere the surface turns to face
     sideways, which is most of a planet. Triplanar is the fix, and the reason
     lookdev's note calls it mandatory on a sphere.

     WHAT THE MAPS HOLD. One RGBA per layer, not two: normal X and Y in RG, and
     the albedo's LUMINANCE in B. The scan's colour is thrown away — six worlds
     carry authored palettes and a marble scan has no business overruling Vault's
     ice. See tools/bake_terrain_maps.py. Three samplers, nine fetches worst
     case, nearer two on flat ground. */
  vec3 triUnpack(vec2 xy, float strength) {
    vec2 n = (xy * 2.0 - 1.0) * strength;
    return vec3(n, sqrt(max(0.0001, 1.0 - dot(n, n))));
  }

  /* One layer. Each plane's tangent normal is rotated into world space
     explicitly rather than by a swizzle trick — a wrong swizzle here is
     invisible until the light moves, which is the worst way to find it. */
  void triLayer(sampler2D map, vec3 pos, vec3 gn, vec3 pw, float scale,
                float nStr, out vec3 outN, out float outD) {
    vec3 n = vec3(0.0);
    float d = 0.0, used = 0.0;
    if (pw.x > 0.02) {
      vec3 t = texture2D(map, pos.zy / scale).rgb;
      vec3 v = triUnpack(t.rg, nStr);
      float sx = gn.x >= 0.0 ? 1.0 : -1.0;
      n += vec3(v.z * sx, v.y, v.x) * pw.x; d += t.b * pw.x; used += pw.x;
    }
    if (pw.y > 0.02) {
      vec3 t = texture2D(map, pos.xz / scale).rgb;
      vec3 v = triUnpack(t.rg, nStr);
      float sy = gn.y >= 0.0 ? 1.0 : -1.0;
      n += vec3(v.x, v.z * sy, v.y) * pw.y; d += t.b * pw.y; used += pw.y;
    }
    if (pw.z > 0.02) {
      vec3 t = texture2D(map, pos.xy / scale).rgb;
      vec3 v = triUnpack(t.rg, nStr);
      float sz = gn.z >= 0.0 ? 1.0 : -1.0;
      n += vec3(v.x, v.y, v.z * sz) * pw.z; d += t.b * pw.z; used += pw.z;
    }
    float inv = 1.0 / max(used, 0.0001);
    outN = n * inv;
    outD = d * inv;
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
    /* VEGETATION, and the wind that moves it. -1 is not vegetation at all,
       which is every terrain vertex, every skirt and every baked rock; 0 is a
       blade's base and 1 is its tip. One float doing three jobs: the sign is
       the flag, the magnitude is how far the wind carries this vertex, and
       together they bend a blade from its base instead of sliding it. */
    attribute float sway;
    uniform mat4 world;
    uniform mat4 worldViewProjection;
    /* x speed, y amplitude in metres, z gust speed, w gust depth. */
    uniform vec4 uWind;
    // The wind's heading in WORLD space, and the phase wavelength in w.
    uniform vec4 uWindDir;
    uniform float uTime;
    varying vec3 vN;
    varying vec3 vW;
    varying float vFis;
    varying float vVeg;
    void main() {
      vec3 p = position;
      // The attribute travels to the fragment stage UNCHANGED, because its
      // magnitude is the root-to-tip gradient there and its sign is the flag.
      // A flora triangle never has a terrain vertex, so interpolating across
      // the -1 boundary cannot happen.
      vVeg = sway;
      float isVeg = step(0.0, sway);

      /* The phase is HASHED FROM POSITION rather than stored. A per-blade phase
         attribute would be a second float on every terrain vertex in the game to
         serve the handful that are grass; the blade's own place in the world is
         already a unique number and costs nothing to read. Using the WORLD
         position rather than the leaf-local one is what keeps a clump moving
         together across a chunk boundary, where the local origin jumps. */
      vec4 wp0 = world * vec4(p, 1.0);
      float phase = dot(wp0.xyz, vec3(uWindDir.w, uWindDir.w * 0.61, uWindDir.w * 0.83));
      float gust = 1.0 - uWind.w + uWind.w * (0.5 + 0.5 * sin(uTime * uWind.z + phase * 0.23));
      float bend = max(sway, 0.0);
      // Squared, so the tip travels and the base does not: linear weighting
      // shears the whole blade sideways and reads as a sliding decal.
      float amt = bend * bend * uWind.y * gust * isVeg;
      p += uWindDir.xyz * (sin(uTime * uWind.x + phase) * amt);

      vec4 wp = world * vec4(p, 1.0);
      vW = wp.xyz;
      vN = normalize(mat3(world) * normal);
      vFis = fissure;
      gl_Position = worldViewProjection * vec4(p, 1.0);
    }
  `;

  S.svTerrainFragmentShader = COMMON + `
    varying vec3 vN;
    varying vec3 vW;
    varying float vFis;
    // The sway attribute, carried through: negative is not vegetation, and 0
    // to 1 is a blade's root to its tip.
    varying float vVeg;
    // rgb the vegetation colour, a how far it covers the ground's own band.
    uniform vec4 uFlora;
    // How much darker a blade's root is than its tip.
    uniform float uFloraRoot;
    uniform vec3 uCam, uLight, uFog, uFogSun;
    uniform vec3 uDeep, uSilt, uShore, uFlats, uStone, uPeak, uCoast, uContour;
    // x the coastline stroke's half-width in metres OF GROUND, y the gradient
    // below which there is no shoreline worth drawing.
    uniform vec2 uCoastP;
    uniform vec3 uShade, uRim, uEmitCol, uEmitHot;
    uniform vec2 uFogRange;
    uniform float uSurfaceR, uScatter, uWash, uDetail, uRelief;
    uniform float uSpec, uEmit, uEmitFrom;
    // T2: x = ambient fill, y = key, z = how hard the unlit bands take uShade.
    uniform vec3 uLightMix, uSunCol, uRimP;
    /* T3 — triplanar. One packed map per layer; see the helpers in COMMON.
       uTriScale  metres per tile: flat, steep, high, detail
       uTriSlope  slope start/end, then altitude start/end as fractions of relief
       uTriMix    overall strength, normal strength, blend sharpness, steep bias
       uTriFade   detail fade start/end, macro relax start/end, in metres */
    uniform sampler2D uTriFlat, uTriSteep, uTriHigh;
    uniform vec4 uTriScale, uTriSlope, uTriMix, uTriFade;
    /* Cast shadows.
       uShadowP  x strength, y normal offset in METRES, z depth bias,
                 w half the box, so the term fades before the box edge rather
                 than ending at a visible square
       uShadowS  PCF tap spacing, in shadow-map UV
       uContact  xyz the craft's ground point, w how far above or below it the
                 shape is allowed to paint
       uContactF  xyz the heading, flattened onto the ground; w unused
       uContactS  x half length, y half width, z soft edge, w superellipse power
       uContactK  strength, already faded by altitude */
    uniform sampler2D uShadowMap;
    uniform mat4 uShadowMat;
    uniform vec4 uShadowP, uContact, uContactS;
    uniform vec3 uContactF;
    uniform vec3 uShadowAt;
    uniform float uShadowS, uContactK;
    /* 0 off, 1 the shadow term alone, 2 the cast term without the contact blob,
       3 shadow-map texels per metre. Read with the post stack disabled or the
       grade will flatten the very thing being looked at. */
    uniform float uShadowDebug;
    /* Split from uTriMix.x on purpose. The perturbed NORMAL and the detail
       LUMINANCE do very different things to a chart: the normal changes how the
       ground catches light, which the contour lines do not care about, while
       the luminance draws the scan's own crack network — line work, competing
       directly with the line work that is the point of this game. One knob for
       both meant Home could not take relief without also taking cracks. */
    uniform float uTriDetail;

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
      float e0 = h / uRelief;

      /* ---- T3: triplanar detail and surface normal --------------------------
         Sampled here and used twice: the detail luminance goes into the grain
         term below, and the perturbed normal goes into the light bands. It has
         to be computed before either, and it costs nothing when uTriMix.x is 0
         — the default, and what makes this provably a no-op until a world opts
         in.

         Both inputs are ones this shader already computed for its own palette,
         and both are the SPHERE'S versions rather than lookdev's: slope is
         1 - dot(N, radial) and not 1 - normal.y, and altitude is a fraction of
         the planet's relief and not a metre count off pos.y. That is the T1/T2
         lesson — anything with a metre in it gets re-derived — and here it is
         the difference between a cap on the high ground and one on a
         hemisphere. */
      vec3 triN = vec3(0.0);
      float triD = 0.5;
      if (uTriMix.x > 0.001 || uTriDetail > 0.001) {
        vec3 pw = pow(abs(N), vec3(uTriMix.z));
        pw /= max(pw.x + pw.y + pw.z, 0.0001);

        float wSteep = smoothstep(uTriSlope.x, uTriSlope.y, slope);
        float wHigh = smoothstep(uTriSlope.z, uTriSlope.w, e0)
                    * (1.0 - wSteep * uTriMix.w);
        float aHigh = wHigh;
        float aSteep = wSteep * (1.0 - wHigh);
        float aFlat = (1.0 - wSteep) * (1.0 - wHigh);

        vec3 n; float d;
        vec3 acc = vec3(0.0); float accD = 0.0;
        if (aFlat > 0.02) {
          triLayer(uTriFlat, vW, N, pw, uTriScale.x, uTriMix.y, n, d);
          acc += n * aFlat; accD += d * aFlat;
        }
        if (aSteep > 0.02) {
          triLayer(uTriSteep, vW, N, pw, uTriScale.y, uTriMix.y, n, d);
          acc += n * aSteep; accD += d * aSteep;
        }
        if (aHigh > 0.02) {
          triLayer(uTriHigh, vW, N, pw, uTriScale.z, uTriMix.y, n, d);
          acc += n * aHigh; accD += d * aHigh;
        }

        /* Detail fade — grain close, macro far — then the macro relax, which is
           what stops the tiling aliasing into a visible square lattice from the
           air. Both are metres and both are per world: Ember's fog ends at
           162m, so lookdev's 450-1400m relax would never once have engaged. */
        float fade = 1.0 - smoothstep(uTriFade.x, uTriFade.y, dist);
        if (fade > 0.02) {
          triLayer(uTriFlat, vW, N, pw, uTriScale.w, uTriMix.y, n, d);
          acc += (n - N) * (0.55 * fade);
          accD = mix(accD, accD * 0.5 + d * 0.5, fade);
        }
        float relax = smoothstep(uTriFade.z, uTriFade.w, dist);
        triN = mix(acc - N, vec3(0.0), relax) * uTriMix.x;
        triD = mix(accD, 0.5, relax);
      }

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

      /* Grain, faded out with distance so it can never crawl or alias.
         T3 HANDS THIS OVER. fbm2(vW.xz) is a single planar projection, right on
         the two caps of a cube-sphere and smearing everywhere the surface turns
         to face sideways — most of a planet. As uTriMix.x comes up the planar
         term fades out and the triplanar detail takes its place, so the two
         never double up and the projection stops being wrong. */
      float near = 1.0 - smoothstep(40.0, 260.0, dist);
      col *= 1.0 + (fbm2(vW.xz * 1.35) - 0.5) * 0.30 * near * uDetail
                 * (1.0 - clamp(uTriDetail, 0.0, 1.0));
      col *= 1.0 + (triD - 0.5) * uTriDetail * near;

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
      /* THE COASTLINE STROKE, AND IT IS A WIDTH ON THE GROUND NOW.
         It used to be a band in HEIGHT — |h| under relief * 0.022 — which is a
         constant only if the shore is a constant steepness, and no shore is.
         Measured across all six worlds at 160 samples a face, the median ground
         width that produced was 31m on Home, 33m on Vault, 39m on Shroud and
         81m on Anvil, with a fifth to a half of it running past 100m. On Tarn
         it covered 56.8% of the land. A coastline stroke that is eighty metres
         wide is not a stroke, it is a fill — and it is the broad near-white
         apron that reads as neither foam nor shallows because it is neither.
         The contour engine three lines up already solved this: divide by the
         slope. Height band = desired ground width times the local gradient, so
         a cliff gets a thin band in height and a beach gets a wide one, and
         both come out the same number of metres across. Ground too flat to have
         a definable shoreline is faded out entirely rather than flooded. */
      float grad = sqrt(2.0 * clamp(slope, 0.0, 1.0));
      float coast = 1.0 - smoothstep(0.0, uCoastP.x * max(grad, uCoastP.y), abs(h));
      coast *= smoothstep(uCoastP.y * 0.45, uCoastP.y, grad);
      coast *= 1.0 - smoothstep(420.0, 900.0, dist);
      col = mix(col, uCoast, coast * 0.80);

      /* ---- cast shadow ------------------------------------------------------
         Sampled here, applied to the KEY only a few lines below. That is the
         physical reading and it is also what keeps this from wrecking the cel
         look: the fill is sky light and sky light does not care what is between
         this pixel and the sun, so a shadowed face drops to the world's ambient
         floor rather than to black. On Vault, whose fill is 0, that is a hard
         shadow; on Tarn, whose fill is 0.22, it is a soft one. The light rig
         from T2 decides which without being asked.

         Three by three PCF at one texel. Anything less aliases into a staircase
         on a low sun, anything more costs more than it shows at this map size. */
      float shadow = 1.0;
      if (uShadowP.x > 0.001) {
        /* NORMAL-OFFSET BIAS. The sample position is pushed along the surface
           normal before it is projected, rather than the depth being nudged
           after. A constant depth bias fails at grazing angles by construction
           — the error across a texel goes as 1/cos, so the value that stops
           acne on a slope has already detached the shadow on the flats — and
           this moves the sample in the direction the error actually lies, so
           one number holds everywhere. Scaled up as the surface turns away from
           the light, which is where a texel spans the most depth. */
        float ndl = clamp(dot(N, uLight), 0.0, 1.0);
        vec3 sp = vW + N * uShadowP.y * (1.0 + 2.0 * (1.0 - ndl));
        vec4 ls = uShadowMat * vec4(sp, 1.0);
        vec3 sc = ls.xyz / ls.w * 0.5 + 0.5;
        if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) {
          /* 4x4 PCF. A hard shadow-map edge on a cel-banded surface reads as an
             artifact and not as a shadow: everything else in this frame has
             deliberate hard edges, and this one is the wrong shape for them. */
          float lit = 0.0;
          for (int yy = 0; yy < 4; yy++) {
            for (int xx = 0; xx < 4; xx++) {
              vec2 o = (vec2(float(xx), float(yy)) - 1.5) * uShadowS;
              lit += step(sc.z - uShadowP.z, texture2D(uShadowMap, sc.xy + o).r);
            }
          }
          lit /= 16.0;
          float far = smoothstep(uShadowP.w * 0.72, uShadowP.w, distance(vW, uShadowAt));
          shadow = mix(mix(1.0 - uShadowP.x, 1.0, lit), 1.0, far);
        }
      }

      float castOnly = shadow;

      /* The craft's contact shadow, and it is not the cast shadow's job.
         Independent of the sun, of the world, and of whether this world has
         cast shadows at all — Ember has none and the rover still has to sit on
         the ground there. Drawn here rather than as a decal because the terrain
         already knows its own world position, so this follows every fold of the
         ground instead of clipping into slopes and hovering over hollows. */
      if (uContactK > 0.001) {
        /* A SUPERELLIPSE IN THE GROUND PLANE, oriented to the heading — not a
           disc. This is the craft's only shadow now, on every world, so it has
           to be the shape of the thing casting it: |u/a|^n + |v/b|^n = 1, with
           n at 2 an ellipse, at 4 nearly a rectangle, and at 2.6 the rounded
           rectangle a tracked hull actually occupies.
           The basis is built from the LOCAL RADIAL, so it lies along the ground
           on a sphere rather than along some world axis, and the vertical guard
           stops a cliff face beside the rover taking its shadow. */
        vec3 dv = vW - uContact.xyz;
        vec3 f = uContactF - up * dot(uContactF, up);
        f = normalize(f + vec3(1e-5));
        vec3 rt = cross(up, f);
        float a = abs(dot(dv, f)) / uContactS.x;
        float bq = abs(dot(dv, rt)) / uContactS.y;
        float t = pow(a, uContactS.w) + pow(bq, uContactS.w);
        float blob = 1.0 - smoothstep(1.0 - uContactS.z, 1.0 + uContactS.z, t);
        blob *= 1.0 - smoothstep(uContact.w * 0.5, uContact.w, abs(dot(dv, up)));
        shadow *= 1.0 - uContactK * blob;
      }

      if (uShadowDebug > 0.5) {
        if (uShadowDebug < 1.5) { gl_FragColor = vec4(vec3(shadow), 1.0); return; }
        if (uShadowDebug < 2.5) { gl_FragColor = vec4(vec3(castOnly), 1.0); return; }
        // Texels per metre: green is plenty, red is a shadow map that cannot
        // resolve what is standing on it.
        vec4 lsd = uShadowMat * vec4(vW, 1.0);
        float tpm = 1.0 / max(uShadowP.y / 1.4, 0.0001);
        gl_FragColor = vec4(clamp(1.0 - tpm / 12.0, 0.0, 1.0),
                            clamp(tpm / 12.0, 0.0, 1.0), 0.0, 1.0);
        return;
      }

      /* VEGETATION takes its own colour over the terrain's band rather than
         replacing it, so the ground still reads through and a field does not
         look like a sticker laid on the chart.

         MIXED HERE, BEFORE THE LIGHT BANDS, and that position is the whole of
         it. The first cut mixed after them, which meant a blade was a flat
         unlit colour sitting on a cel-shaded hillside: it read as bright paint
         and it did not turn with the sun. This is an ALBEDO, and it goes where
         the other albedos go.

         The root is darker than the tip. That gradient does more work than the
         colour does - a flat green reads as a decal at any density. */
      if (vVeg >= 0.0) {
        col = mix(col, uFlora.rgb * mix(uFloraRoot, 1.0, clamp(vVeg, 0.0, 1.0)),
          uFlora.a);
      }

      /* T3: the surface normal the LIGHT sees. Perturbed after the palette and
         the chart have been drawn off the geometric normal, and before the
         bands — so texture changes how the ground catches light without ever
         moving a contour line or a colour band. That ordering is the whole
         reason the chart survives this transplant. */
      N = normalize(N + triN);

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
      col *= (uLightMix.x + uLightMix.y * band * shadow) * uSunCol;
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
    uniform float uTime, uWaveK, uWaveAmp, uShoal;
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
      // Three metres was hardcoded; it is WATER.shoal now, because on the boat
      // world it is also the reason the swell dies before it reaches the beach.
      float shoal = smoothstep(0.0, uShoal, depth);
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

    /* THE SEABED DEPTH PASS. view and projection are Babylon's own names and
       are bound automatically; they are here so the refraction offset can be
       stated in METRES at the surface and then projected, rather than in screen
       UVs that would mean something different at every distance and fov.
       (No backticks in this file's GLSL comments. They close the template
       literal the shader is written in, and the error you get names a GLSL
       identifier at a JS parse site. Fifth time.) */
    uniform mat4 view, projection;
    uniform sampler2D uSeabed;
    uniform vec2 uInvScreen;
    // x absorb (metres to halve), y absorbMax, z refract (metres), w the pass's
    // "nothing here" distance.
    uniform vec4 uWaterP;
    // x shore width and y edge width, both in metres, z strength.
    // NO SEMICOLON IN A COMMENT ON A UNIFORM LINE: Babylon's shader processor
    // splits these lines on ';' before it strips comments, and the tail comes
    // back as a statement. This one cost a FRAGMENT SHADER ERROR reading
    // "'z' : syntax error" pointing at a line of prose.
    uniform vec3 uFoamP;
    // 1 when the depth pass is live and bound. 0 falls the whole thing back to
    // the per-vertex depth, which is what the water always did.
    uniform float uWaterOn, uWaterDebug;
    // x opaque, y reflection mix, z reflection fresnel, w sharpen.
    uniform vec4 uWaterP2;
    // x soften the shelf edge, y tilt within the band, z blur the depth read
    // in pixels.
    uniform vec3 uBandP;
    // x strength, y scale, z,w the metres over which it fades out with range.
    uniform vec4 uRippleP;
    // x how much of the legacy foam ring survives, y how soft its broken second
    // line is, z how much of the old hard step is kept.
    uniform vec3 uRingP;
    // The swell, per pixel. Same three sines as waveAt() in js/world/noise.js.
    uniform float uWaveK, uWaveAmp, uShoal, uWaveN;
    // x glint, y the ceiling on everything the sky adds, z the Fresnel ceiling,
    // w how far the ice darkens with depth.
    uniform vec4 uGlareP;
    // The sky's own horizon stops, so the reflection is this world's sky and
    // not a second palette that has to be kept in step with it by hand.
    uniform vec3 uSkyLow, uSkyHigh, uSkyBandCol;
    uniform vec3 uSkyP;   // x band, y bandWidth, z haze

    void main() {
      vec3 toCam = uCam - vW;
      float dist = length(toCam);
      vec3 V = toCam / max(dist, 0.001);
      vec3 N = normalize(vN);

      /* ---- THE SWELL, PER PIXEL, AND TIED TO waveAt BY CONSTRUCTION ----
         The mesh cannot carry this. Samples per wavelength is 4 * waterFaceRes
         / waveFreq — independent of radius, and it comes out at 1.78 on Home,
         1.45 on Shroud, 1.23 on Anvil and 2.58 on Tarn. Every world with a
         swell samples it BELOW NYQUIST, so the surface the vertex shader
         displaces is not the wave, it is an alias of the wave. Meanwhile the
         boat rides waveAt() on the CPU, which evaluates the function exactly.
         The hull has been riding a swell the sea does not have.
         Raising the mesh cannot fix it: eight samples a wavelength needs
         waterFaceRes = 2 * waveFreq, which is 180 on Home — 196k vertices and a
         second of height() at load, for one world.
         So the NORMAL is computed here instead, analytically, from the same
         three sines with the same coefficients. Geometry stays coarse and the
         silhouette with it; everything that reads the surface as a direction —
         the toon glint, the sun path, the band, the refraction bend — reads the
         true swell at pixel resolution and for three cosines.
         The gradient is exact rather than sampled: a1..a3 are the phases,
         g is d(w)/d(up), and one tangential metre moves up by 1/R, which is
         what turns a gradient in direction-space into a slope in metres. */
      if (uWaveN > 0.0 && uWaveAmp > 0.0) {
        vec3 up0 = normalize(vW);
        float R = max(length(vW), 1.0);
        float a1 = up0.x * uWaveK + uTime * 1.15;
        float a2 = up0.z * uWaveK * 0.79 - uTime * 0.87;
        float a3 = (up0.x + up0.y + up0.z) * uWaveK * 0.40 + uTime * 0.55;
        float c3 = 0.20 * uWaveK * 0.40 * cos(a3);
        vec3 g = vec3(0.30 * uWaveK * cos(a1) + c3,
                      c3,
                      0.26 * uWaveK * 0.79 * cos(a2) + c3);
        // Same shoal the vertex shader flattens the displacement with, so the
        // shading and the geometry agree about where the swell stops.
        float sh = smoothstep(0.0, uShoal, vDepth);
        vec3 gt = (g - up0 * dot(g, up0)) * (uWaveAmp * sh / R);
        N = normalize(mix(N, normalize(up0 - gt), uWaveN));
      }

      float d = vDepth;

      /* A FINE RIPPLE, so a still sea is still a SURFACE.
         The swell is the only thing perturbing this normal, and three of the
         five worlds have a swell amplitude at or near zero — Vault's is exactly
         zero — so their water had no variation anywhere across it and read as a
         flat sheet of colour. This is a metre-scale wrinkle, sampled as a
         gradient so it tilts the normal rather than tinting the surface, which
         means it reaches the band, the glint and the refraction and does not
         have to be drawn twice.
         It fades out with distance for the same reason the foam lace does: past
         the point where a feature is smaller than a pixel there is nothing to
         draw but aliasing. */
      if (uRippleP.x > 0.0) {
        float rf = 1.0 - smoothstep(uRippleP.z, uRippleP.w, dist);
        vec2 q = vW.xz * uRippleP.y + vec2(uTime * 0.31, uTime * -0.19);
        float e = 0.6;
        float n0 = fbm2(q);
        vec3 upR = normalize(vW);
        vec3 tx = normalize(cross(upR, vec3(0.0, 1.0, 0.0)) + vec3(1e-5));
        vec3 tz = cross(upR, tx);
        N = normalize(N - (tx * (fbm2(q + vec2(e, 0.0)) - n0) +
                           tz * (fbm2(q + vec2(0.0, e)) - n0)) * (uRippleP.x * rf));
      }

      /* ---- how much water is between the eye and the ground, per pixel ----
         The shell samples depth every 40m; this asks the same question along
         the actual view ray and gets a per-pixel answer. Note what falls out of
         it for free: the swell already moves this surface up and down, and the
         seabed does not move, so the thickness — and therefore the foam line —
         breathes with the wave without a single term saying so. */
      vec3 upW = normalize(vW);
      /* The ray's angle off vertical, which is what converts between a VERTICAL
         depth and a PATH LENGTH — and it is kept twice on purpose.
         cosDiv is floored hard, because it is a DIVISOR and a horizon-grazing
         ray would otherwise return infinity. cosTrue is not, because it is also
         a MULTIPLIER on the way back, and there the floor is not a safety net,
         it is an error: at 1000m the true cosine is 0.009, so multiplying by a
         floor of 0.08 reports the seabed nine times deeper than it is. That
         saturated every bathymetry shelf on the far half of every lake and
         photographed as one flat plate of deep blue — the chart gone, from a
         guard clause in the wrong place. */
      float cosTrue = abs(dot(V, upW));
      float cosDiv = max(0.08, cosTrue);
      float fallback = d / cosDiv;

      // Screen-space refraction. Stated as a displacement in metres along the
      // surface's tilt and then projected, so it is the same physical bend at
      // any distance. duv is EXACTLY zero when uWaterP.z is, which is what makes
      // the neutral default a genuine no-op rather than a small resample.
      vec2 uv = gl_FragCoord.xy * uInvScreen;
      vec2 duv = vec2(0.0);
      if (uWaterP.z > 0.0) {
        vec3 tilt = N - upW * dot(N, upW);
        vec4 c0 = projection * view * vec4(vW, 1.0);
        vec4 c1 = projection * view * vec4(vW + tilt * uWaterP.z, 1.0);
        duv = (c1.xy / max(abs(c1.w), 1e-4) - c0.xy / max(abs(c0.w), 1e-4)) * 0.5;
      }
      vec2 uvR = clamp(uv + duv, 0.0, 1.0);

      float thick = fallback;
      bool measured = false;
      if (uWaterOn > 0.5) {
        /* BLURRED, because the thing being measured is faceted.
           The seabed is flat-shaded triangle soup, so the distance this pass
           reports is piecewise flat and its shelf boundaries follow triangle
           EDGES — which is why the ladder came back as hard-edged polygonal
           blobs rather than as contours, and why turning the water fully opaque
           did not remove them. Four taps across a couple of pixels round the
           facet edge off without touching depth that was smooth to begin with. */
        float seabed = texture2D(uSeabed, uvR).r;
        if (uBandP.z > 0.0) {
          vec2 o = uInvScreen * uBandP.z;
          seabed = (seabed
            + texture2D(uSeabed, clamp(uvR + vec2( o.x, 0.0), 0.0, 1.0)).r
            + texture2D(uSeabed, clamp(uvR + vec2(-o.x, 0.0), 0.0, 1.0)).r
            + texture2D(uSeabed, clamp(uvR + vec2(0.0,  o.y), 0.0, 1.0)).r
            + texture2D(uSeabed, clamp(uvR + vec2(0.0, -o.y), 0.0, 1.0)).r) * 0.2;
        }
        // Past the pass's clear value there is no ground behind this water at
        // all — the shell's far side against the sky. Fall back rather than
        // paint the horizon black.
        measured = seabed < uWaterP.w * 0.5;
        thick = measured ? max(0.0, seabed - dist) : fallback;
      }

      /* PATH LENGTH IS NOT DEPTH, and keeping them apart is the whole reason
         this pass is worth having. thick is how far the ray travels through
         water; pdepth is how far the seabed it lands on sits below the
         surface. They are the same looking straight down and nothing like each
         other at a grazing angle — on Tarn, whose mean depth is 2.6m, a ray ten
         degrees above the horizon crosses FIFTEEN metres of water.
         That is not a nicety. Shoreline foam written against thick measured
         zero moving pixels on Tarn, Vault and Anvil with the term turned up to
         three metres: every ray that could have fired it was grazing, so
         nothing anywhere was ever within 3m. Absorption wants the path.
         Anything that has to be a fixed WIDTH ON THE GROUND — the foam line,
         the bathymetry shelves — wants the depth. */
      // Back the other way. When the pass measured this ray, the vertical drop
      // is the path times the TRUE cosine; when it did not, the fallback was
      // built from the vertex depth and the honest answer is that depth itself
      // rather than a number round-tripped through a floored divisor.
      float pdepth = measured ? thick * cosTrue : d;
      // The shelves, per pixel, at the point the ray actually lands. sharpen
      // is 0 until a world asks: at 0 this is the 40m-interpolated vertex depth
      // the shelves have always been drawn from.
      d = mix(d, pdepth, uWaterP2.w);
      // Depth banded into discrete shelves — a bathymetric chart, not a gradient.
      // Six of them spread across whatever depth this planet actually reaches,
      // instead of a fixed 0-24m that a shallow world never gets out of.
      /* SIX SHELVES, BUT NOT SIX SLABS.
         A bare floor() gives a bathymetric chart and also gives cut paper: flat
         regions of solid colour meeting at a hard edge, with nothing inside a
         band to say it is lying on a surface. Two terms fix that without
         giving up the ladder. One rounds the step so the edge reads as a
         contour rather than a seam; the other puts a little of the continuous
         depth back inside each band so the band itself has somewhere to go.
         Both are 0 by default, which is the bare floor() this shipped with. */
      float bt = clamp(d / uMaxDepth, 0.0, 0.999) * 6.0;
      float bf = fract(bt);
      float sub = uBandP.x > 0.0
        ? smoothstep(0.5 - uBandP.x, 0.5 + uBandP.x, bf) : 0.0;
      float shelf = (floor(bt) + mix(sub, bf, uBandP.y)) / 6.0;
      vec3 col = mix(uShallowW, uDeepW, shelf);

      /* ABSORPTION, AND IT IS SPLIT IN TWO — colour off DEPTH, transparency off
         PATH. That split is the whole of what makes this survivable on a world
         whose water is a bathymetric chart.
         Written the obvious way, both halves come off the path length, and the
         first version was. At a grazing angle the path through even shallow
         water runs to tens of metres, so every lake seen from the shore went to
         a single flat deep colour and took all six bathymetry shelves with it.
         Home's lake came back as one plate of blue. That is the one thing this
         pass was told not to do.
         So: COLOUR reads pdepth, which is a property of the seabed and not of
         where you are standing, and the chart therefore does not change as you
         turn your head. TRANSPARENCY reads thick, which genuinely is a path
         property — a long slant through water really does hide the bottom.
         uWaterP.y caps only the colour half. The alpha half is uncapped because
         its natural limit is 1, and because "you cannot see the bottom" is a
         statement about water, not a look. */
      float absorbed = 0.0;
      if (uWaterP.x > 0.0) {
        col = mix(col, uDeepW,
          (1.0 - exp(-pdepth * 0.6931 / uWaterP.x)) * uWaterP.y);
        absorbed = 1.0 - exp(-thick * 0.6931 / uWaterP.x);
      }

      /* THE LEGACY FOAM RING, and it is the cut paper.
         It predates the depth pass: a shallow ring plus a "broken second line
         further out" made with step(0.72, ripple) — a HARD binary threshold on
         a sine of depth, mixed 0.7 toward bone. On a piecewise-flat depth field
         a binary threshold does not make a broken line, it makes solid
         polygons with hard edges, in a pale colour that reads as neither foam
         nor shallows because it is neither. That is the near-white banding, and
         it is why softening the shelves, blurring the depth read and halving
         sharpen all changed nothing: none of them touch this.
         The smoothstep is what it should always have been, and uRingP is what
         lets a world turn it off now that per-pixel foam does the shoreline
         properly. 1.0 reproduces the old ring, hard edge and all. */
      float foam = 1.0 - smoothstep(0.0, uMaxDepth * 0.14, d);
      float ripple = sin(d * (30.0 / uMaxDepth) - uTime * 2.2) * 0.5 + 0.5;
      float brk = mix(smoothstep(0.72 - uRingP.y, 0.72 + uRingP.y, ripple),
                      step(0.72, ripple), uRingP.z);
      foam = max(foam, (1.0 - smoothstep(uMaxDepth * 0.12, uMaxDepth * 0.32, d)) *
        brk * 0.7);
      col = mix(col, uCoast, foam * 0.85 * uRingP.x);

      /* THE SHORELINE, per pixel, and intersection foam for nothing extra.
         Both are the same test — thickness going to zero — at two widths. The
         wide one is the water's edge, where the ground rises to meet the
         surface. The tight one fires wherever ANYTHING is close behind the
         surface, which is what a rock breaking the water or a hull sitting in
         it looks like from here, so intersection foam is not a second system.
         Nothing in it is animated: the swell moves this surface and the seabed
         does not, so the line breathes in and out with the wave already. */
      // DEPTH for the shoreline, so the band is a fixed width on the ground and
      // not a function of how obliquely you happen to be looking at it...
      float shoreF = uFoamP.x > 0.0
        ? (1.0 - smoothstep(0.0, uFoamP.x, pdepth)) : 0.0;
      // ...and PATH for the collar, because "something is just behind this
      // surface along this ray" is what a hull sitting in the water and a rock
      // breaking through it have in common.
      float edgeF = uFoamP.y > 0.0
        ? (1.0 - smoothstep(0.0, uFoamP.y, thick)) : 0.0;
      /* Broken up, so a per-pixel line does not read as a vector stroke on a
         surface where everything else is drawn.
         0.15 is metres, not taste: vW is in world metres, so this is noise with
         features about seven metres across — a few paces of broken water. The
         first cut used 0.9, which is features ONE METRE wide being viewed from
         up to four hundred, and at that ratio it is not lace, it is aliasing.
         It also fades out with distance for the same reason: past the point
         where a feature is smaller than a pixel there is nothing to draw but
         noise, so the line goes clean instead. */
      float laceFade = 1.0 - smoothstep(60.0, 220.0, dist);
      float lace = mix(1.0, 0.72 + 0.28 * fbm2(vW.xz * 0.15 + vec2(uTime * 0.35, 0.0)),
                       laceFade);
      float pfoam = clamp(max(shoreF * lace, edgeF), 0.0, 1.0) * uFoamP.z;
      col = mix(col, uCoast, pfoam);

      /* EVERYTHING THE SKY ADDS TO THE SURFACE, COLLECTED AND THEN CAPPED.
         These used to be two independent additions straight onto col, which is
         fine until a surface normal gets sharper. The per-pixel analytic
         swell made the
         glint fire on every crest instead of on the few the mesh could
         represent, and additive terms with no ceiling do not shade a surface,
         they erase it — the bathymetry shelves and the depth ladder are chart
         information, and no amount of weather is allowed to take them off the
         page. Summing first and clamping once is what makes that a guarantee
         rather than a hope, and it holds for whatever gets added here next. */
      vec3 H = normalize(uLight + V);
      float spec = pow(clamp(dot(N, H), 0.0, 1.0), 60.0);
      // Toon glint: a hard-edged specular that pops on and off, no falloff.
      vec3 sky = vec3(0.85, 1.0, 0.98) * step(0.30, spec) * uGlareP.x;

      // A sun path on the water, stretched along the view. Cheap, and it
      // gives an otherwise flat lake a direction.
      float path = pow(clamp(dot(-V, uLight), 0.0, 1.0), 8.0);
      sky += uFogSun * path * 0.22 * smoothstep(0.0, 3.0, d);
      col += min(sky, vec3(uGlareP.y));

      // Water's response to the bands is shallower than the ground's by design,
      // but it takes the same key and fill — T2 — or a world whose shadows lift
      // would have its sea stay put and the two would disagree at the shore.
      float band = bandLight(dot(N, uLight));
      col *= (uLightMix.x + uLightMix.y * mix(0.86, 1.0, band)) * uSunCol;

      /* REFLECTION — THE SKY, AND DELIBERATELY NOT A PLANAR MIRROR.
         A planar reflection needs a plane, and this water is a closed shell
         around a planet. Measured with the eye at 9.5m, which is where the
         chase camera sits: the horizon is 89m away on Tarn and 198m on Anvil,
         and over that distance the surface falls away from its own tangent
         plane by 9.5m on EVERY world — the drop at the horizon is just the eye
         height. That is four times Tarn's swell and thirty times Shroud's. A
         mirror plane would therefore be wrong by more than the waves it is
         reflecting, and wrong worst at the skyline, which is the one place a
         sea reflection is read. It would also cost a second render of the world
         per frame to be wrong there.
         So the reflected ray is traced against the SKY instead, which is an
         analytic function of direction and therefore correct on a sphere at any
         range, for about ten instructions and no extra pass. It reflects the
         sky and not the terrain, and on a world whose horizon is a hundred
         metres away and hazed to the fog colour, the sky is very nearly all
         there is to reflect.
         Fresnel does the rest: looking down you see through the water, looking
         along it you see the sky, and the crossover moves with the swell
         because N is now per-pixel. */
      if (uWaterP2.y > 0.0) {
        vec3 Rv = reflect(-V, N);
        float rel = dot(Rv, upW);
        vec3 refl = mix(uSkyLow, uSkyHigh, clamp(rel * 1.25 + 0.06, 0.0, 1.0));
        refl = mix(refl, uSkyBandCol,
          uSkyP.x * (1.0 - smoothstep(0.0, max(uSkyP.y, 0.005), abs(rel))));
        refl = mix(refl, hazeColor(uFog, uFogSun, -Rv, uLight, uScatter),
          (1.0 - smoothstep(-0.03, 0.24, rel)) * uSkyP.z);
        /* FRESNEL, WITH A CEILING. Physically it runs to 1.0 at grazing
           incidence, and at 1.0 the reflection IS the surface — the water's own
           colour is gone and with it every band of the chart. A real sea gets
           away with that because a real sea has nothing to say; this one is a
           bathymetric chart and has to stay readable from the deck of a boat,
           which is the most grazing view in the game. So the mix is capped, and
           the cap is the thing that keeps the depth ladder visible rather than
           any particular exponent. */
        float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), uWaterP2.z);
        col = mix(col, refl, min(clamp(fres, 0.0, 1.0) * uWaterP2.y, uGlareP.z));
      }

      /* FROZEN (Vault). The same shelves, but read as a solid surface: pale,
         opaque, and with the melt line stroked across it in the chart's own
         hand. Past that line the ice does not hold the rover, so this stroke is
         not decoration — it is the hazard, drawn where the hull can still turn
         around. Everything here is multiplied by uFrozen, which is 0 on the
         other five worlds. */
      float lineNow = 0.0;
      if (uFrozen > 0.0) {
        /* THE ICE CARRIES A DEPTH LADDER TOO, and on this world that ladder
           is the hazard: depth is ice thickness is whether it holds the rover.
           0.55 was as far as the ice was allowed to darken and it left the
           sheet reading as one flat white plate with only the melt line on it —
           a stroke you can drive past. */
        vec3 ice = mix(uCoast, uShallowW, smoothstep(0.0, uMaxDepth, d) * uGlareP.w);
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
      /* OPACITY, and it only ever goes UP from here — which is the invariant
         that protects the bone waterline stroke. That stroke is drawn in the
         TERRAIN shader at |h| near zero and reaches the eye through this
         surface, so the one thing this pass must not do is make the shallows
         less transparent. uOpaque is 0 on every world that has a readable
         seabed and is turned up only where the water is SUPPOSED to hide what
         is under it — Shroud, where a pool whose depth you cannot read is the
         hazard. Foam is exempt: a foam line you can see through is a smear. */
      alpha = mix(alpha, 1.0, uWaterP2.x);
      /* ...and the OTHER half of absorption, which is the half that makes water
         behave like water. Tinting deep water toward the deep colour without
         also thickening it just paints a darker window: you would still see the
         seabed perfectly through eight metres of ocean. Absorption raises the
         alpha by exactly as much as it took out of the colour.
         It is safe against the waterline stroke by construction: the term
         comes off THICKNESS, thickness goes to zero at the shore, and so
         does this. The one place this pass could have damaged the chart is
         the one place it provably cannot reach. */
      alpha = max(alpha, absorbed);
      /* Foam thickens the water but does not close it. At 0.9 the shallows went
          fully opaque, which on a world with a wide flat shelf means a white
          plate where there should be pale water you can see the sand through —
          and it would have hidden the bone waterline stroke, which is drawn in
          the terrain shader and reaches the eye THROUGH this surface. */
      alpha = max(alpha, pfoam * 0.6);
      gl_FragColor = vec4(col, mix(mix(alpha, 1.0, uFrozen), 1.0, fog));

      /* Read with the post stack off — see WATER.debug. */
      if (uWaterDebug > 0.5) {
        if (uWaterDebug < 1.5) {
          gl_FragColor = vec4(vec3(clamp(thick / 20.0, 0.0, 1.0)), 1.0);
        } else if (uWaterDebug < 2.5) {
          float sb = uWaterOn > 0.5 ? texture2D(uSeabed, uvR).r : 0.0;
          gl_FragColor = vec4(vec3(clamp(sb / uFogRange.y, 0.0, 1.0)), 1.0);
        } else if (uWaterDebug < 3.5) {
          gl_FragColor = vec4(vec3(pfoam), 1.0);
        } else if (uWaterDebug > 4.5) {
          // MODE 5: the VERTICAL depth the chart is drawn from, over 20m. This
          // is the quantity "can you tell shallow from deep" is a question
          // about, so it is the one dev/waterangles.mjs buckets by.
          gl_FragColor = vec4(vec3(clamp(pdepth / 20.0, 0.0, 1.0)), 1.0);
        } else {
          /* MODE 4: a flat magenta mask, and it is here because measuring the
             other three was giving wrong answers.
             A debug mode that writes a ramp tells you nothing unless you can
             say which pixels are water, and reading the red channel cannot:
             terrain and sky have red channels too. The first pass at
             dev/waterstats.mjs reported foam over 99.9% of the frame on Home,
             which was the terrain and the sky being counted as foam. This is
             the mask that separates them, and it is read with alpha blending
             forced off so it comes back as exactly (255, 0, 255). */
          gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
        }
      }
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
    uniform vec3 uSunCol, uFog, uFogSun, uUp, uEast, uNorth, uMid;
    uniform float uTime, uHaze, uBand, uBandW, uClouds, uCeil, uUnder;
    uniform float uSunSize, uGlare;
    /* The sun's two edges, as COSINES of half-angles, computed on the CPU from
       degrees. x,y are the halo's outer and inner; z,w the core's. See SKY. */
    uniform vec4 uSunCos;
    uniform vec4 uGrad;      // curve, midAt, bands, bandMix
    uniform vec4 uScat;      // airmass falloff, sun power, sun mix, added gain
    uniform vec4 uCloudP;    // cover, soft, scale, octaves
    /* x: the elevation of the TRUE horizon, zero on the ground and negative in
       the air. y: 1 / (1 - x), which renormalises the gradient so the zenith is
       still the zenith however far the skyline has dropped. z: how many cloud
       strata this machine is drawing. */
    uniform vec3 uHoriz;

    /* Value noise, and it replaced a product of two sines.
       sin(a) * sin(b) through a smoothstep is a level set of sin*sin: a rounded
       quadrilateral with a boundary 0.16 wide in a quantity that swings over 2.
       On a world whose cloud colour is darker than the sky behind it and whose
       underglow is authored past 1.0, that boundary is a hard-edged bright SLAB
       across the lower sky rather than a cloud. This is three cheap octaves. */
    float h21(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
                 mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    /* The octave count is a UNIFORM, not a constant, because it is the one
       thing in this game bought with frame time per machine. GLSL ES 1.0 wants
       a constant loop bound, so the loop is fixed at three and breaks early. */
    float fbm(vec2 p, float oct) {
      float amp = 0.5, sum = 0.0, norm = 0.0;
      for (int i = 0; i < 3; i++) {
        if (float(i) >= oct) break;
        sum += amp * vnoise(p);
        norm += amp;
        p *= 2.03;
        amp *= 0.5;
      }
      return sum / max(norm, 1e-4);
    }

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
      float elRaw = dot(D, uUp);

      /* THE TRUE SKYLINE, and this is the defect that was left for this pass.
         At altitude h on a planet of radius R the horizon sits BELOW local
         level by acos(R / (R + h)) - eight degrees at 103m over Home.
         Everything horizon-referenced used zero elevation instead, which is the
         visual horizon at ground level and nowhere else, so the band, the haze
         and the underglow all floated above the real skyline as you climbed.
         hzn is elevation measured from the true horizon. On the ground
         uHoriz.x is zero and this is elRaw to the bit, which is what makes the
         whole term a no-op at zero altitude by construction. */
      float hzn = elRaw - uHoriz.x;

      /* The gradient, over the WHOLE sky.
         The old ramp was clamp(el * 1.25 + 0.06, 0, 1) and reached the zenith
         colour at an elevation of 0.75, so the top forty-one degrees of every
         sky was one flat field. uHoriz.y renormalises against the dropped
         skyline so climbing opens the sky downward rather than rescaling it. */
      float t = clamp(hzn * uHoriz.y, 0.0, 1.0);
      float g = pow(t, uGrad.x);
      // Quantised sky bands, softened just enough to avoid hard stepping. This
      // was ten steps at 42%, hardcoded; it is SKY.bands and SKY.bandMix now,
      // and bands 0 turns it off for a world that wants a smooth sky.
      float q = uGrad.z > 0.5 ? floor(g * uGrad.z) / uGrad.z : g;
      g = mix(g, q, uGrad.w);
      // Three stops rather than two, so a world can put its own colour in the
      // middle of the sky instead of only at its two ends.
      vec3 col = g < uGrad.y
        ? mix(uLow, uMid, g / max(uGrad.y, 1e-4))
        : mix(uMid, uHigh, (g - uGrad.y) / max(1.0 - uGrad.y, 1e-4));

      // What the dome does BELOW the skyline. Without it a dark world gets a
      // bright sky wrapping under its own horizon, which is visible off every
      // cliff edge and from the air.
      col = mix(col, uBelow, smoothstep(0.03, -0.12, hzn));

      float s = dot(D, normalize(uLight));

      /* THE CLOUD DECK, laid out as a flat layer seen in perspective.
         Dividing the horizontal direction by the elevation is what projects the
         view ray onto a plane at a fixed height, so shapes compress toward the
         skyline the way a real deck does. The divide is clamped because the
         projection diverges at the horizon, and the strata are faded out below
         it anyway by strat(). Driven by the LOCAL east and north: in world axes
         the pattern does not rotate with you, and wherever your local up lines
         up with the pattern's own axis the bands degenerate into one enormous
         hard-edged slab hanging in the sky. */
      float ev = max(elRaw, 0.12);
      vec2 cp = vec2(dot(D, uEast), dot(D, uNorth)) / ev * uCloudP.z;
      float cover = uCloudP.x, soft = max(uCloudP.y, 0.01), oct = uCloudP.w;

      float n1 = fbm(cp * 1.7 + vec2(uTime * 0.006, uTime * -0.004), oct);
      float c1 = smoothstep(cover, cover + soft, n1) * strat(hzn, 0.10, 0.30, uCeil);
      col = mix(col, uCloudCol * 0.94, c1 * 0.42 * uClouds);

      if (uHoriz.z > 1.5) {
        float n2 = fbm(cp * 0.95 + vec2(uTime * -0.0035, uTime * 0.005) + 11.3, oct);
        float c2 = smoothstep(cover, cover + soft, n2) * strat(hzn, 0.26, 0.54, uCeil);
        col = mix(col, uCloudCol * 0.88, c2 * 0.30 * uClouds);
      }
      if (uHoriz.z > 2.5) {
        float n3 = fbm(cp * 0.55 + vec2(uTime * 0.002, uTime * -0.0015) + 27.7, oct);
        float c3 = smoothstep(cover, cover + soft, n3) * strat(hzn, 0.44, 0.78, uCeil);
        col = mix(col, uCloudCol * 0.80, c3 * 0.22 * uClouds);
      }

      // A band hugging the skyline. Narrow and faint it is a horizon line; wide
      // and strong it is sea haze, and Tarn is nothing but sea haze.
      col = mix(col, uBandCol, uBand * (1.0 - smoothstep(0.0, max(uBandW, 0.005), abs(hzn))));

      /* SCATTERING AT THE HORIZON.
         airmass stands in for how much air the view ray crosses: 1 at the
         skyline, falling with elevation at SKY.scatter.falloff. It replaces a
         smoothstep that cut off hard at fourteen degrees, which is why the
         horizon used to meet the sky at a readable seam from the air.
         The horizon has to sit down into the same haze the terrain fades to, or
         the two meet at a visible line and the world looks like a diorama. */
      float airmass = pow(1.0 - t, max(uScat.x, 0.001));
      float fwd = pow(clamp(s, 0.0, 1.0), uScat.y);
      vec3 air = mix(uFog, uFogSun, fwd * uScat.z);
      col = mix(col, air, airmass * uHaze);
      /* ...and the one genuinely new term, ADDED rather than mixed so it can
         push past 1.0 and bloom: forward-scattered light piling up along the
         horizon on the sun's side. This is the bright band behind the mesas.
         Ships at gain 0 on every world until authored. */
      col += uFogSun * fwd * airmass * uScat.w;

      // Underglow: the ground lighting the sky from beneath, for a world whose
      // light source is at your feet. Added rather than mixed, and authored
      // past 1.0, so Ember's ceiling blooms like the cracks do.
      col += uUnderCol * uUnder * smoothstep(0.34, -0.16, hzn);

      /* Sun last, so nothing hazes over it. Deliberately above 1.0: the bloom
         pass is what turns this into glare. The edges are cosines of real
         half-angles, computed on the CPU from degrees - see SKY.haloAngle,
         which is 5 and stays there. */
      col += uSunCol * smoothstep(uSunCos.x, uSunCos.y, s) * 0.55 * uGlare;
      col += uSunCol * smoothstep(uSunCos.z, uSunCos.w, s) * 2.6 * uGlare;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  /* ---- the shadow depth pass ---------------------------------------------
     Every caster is drawn with this and nothing else, so a terrain leaf's
     fissure attribute and a hull's colour attribute are simply not read. What
     lands in the map is gl_FragCoord.z — the ortho camera's depth in 0..1 —
     which is exactly what the terrain shader compares against after taking its
     own light-space position through the same matrix. One encoding, chosen
     here, decoded there, with nothing in between deciding for us. */
  /* The seabed pass. Writes RADIAL DISTANCE FROM THE CAMERA in metres, which
     is the same quantity the water shader computes for itself as
     length(uCam - vW) — so the water thickness along a view ray is one subtract,
     with no projection inverse and no near/far reconstruction to get wrong.
     gl_FragCoord.z would have been cheaper to write and much worse to read.
     See js/world/seabed.js for what the render list means. */
  S.svSeabedVertexShader = `
    precision highp float;
    attribute vec3 position;
    uniform mat4 world, worldViewProjection;
    uniform vec3 uCam;
    varying float vDist;
    void main() {
      vec4 wp = world * vec4(position, 1.0);
      vDist = length(wp.xyz - uCam);
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }
  `;
  S.svSeabedFragmentShader = `
    precision highp float;
    varying float vDist;
    void main() { gl_FragColor = vec4(vDist, 0.0, 0.0, 1.0); }
  `;

  S.svDepthVertexShader = `
    precision highp float;
    attribute vec3 position;
    uniform mat4 worldViewProjection;
    void main() { gl_Position = worldViewProjection * vec4(position, 1.0); }
  `;

  S.svDepthFragmentShader = `
    precision highp float;
    void main() { gl_FragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0); }
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

  /* Alpha channel of the vertex colour is the FINISH flag, so glowing engine
     parts, matte rubber and painted hull panels all live in the same mesh with
     no extra attribute: 0 ordinary paint, 0.5 matte, 1 emissive. Every colour
     constant in meshes.js, colony.js and raiders.js is exactly one of those
     three, and each triangle carries one colour on all three of its vertices,
     so nothing interpolates into the gaps between them. */
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

      float emissive = step(0.75, vC.a);
      // 1 for paint and for emissive parts, 0 for the matte flag.
      float gloss = 1.0 - step(0.25, vC.a) + emissive;
      // Same key/fill split as the ground — T2. The hull has to sit in the
      // world's light, not in its own.
      float d = dot(N, uLight);
      vec3 col = vC.rgb * (uLightMix.x + uLightMix.y * bandLight(d)) * uSunCol;

      float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), uRimP.x) * uRimP.y;
      rim *= mix(1.0, clamp(d * 0.5 + 0.5, 0.0, 1.0), uRimP.z);
      /* Matte surfaces keep a trace of the rim rather than none of it: taken
         to zero the tyres lose their silhouette against dark ground and read as
         holes in the wheel. At an eighth they still turn, and they are plainly
         the least reflective thing on the craft, which is what rubber is. */
      col += uRim * rim * mix(0.12, 1.0, gloss);

      // Hull specular. Hard-edged like everything else here, and zero on five
      // worlds — the point is that the craft visibly catches the light on Vault
      // and catches nothing anywhere else. Rubber is excluded outright: a hard
      // white glint is the one thing tread must never do, on Vault or anywhere.
      if (uSpec > 0.0) {
        vec3 H = normalize(uLight + V);
        col += uSpecCol * step(0.30, pow(clamp(dot(N, H), 0.0, 1.0), 30.0))
          * uSpec * (1.0 - emissive) * gloss;
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
  const TR = terrainOf(planet);
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
      attributes: ['position', 'normal', 'fissure', 'sway'],
      uniforms: ['world', 'worldViewProjection', 'uCam', 'uLight', 'uFog',
        'uFogSun', 'uDeep', 'uSilt', 'uShore', 'uFlats', 'uStone', 'uPeak',
        'uCoast', 'uContour', 'uCoastP', 'uFogRange', 'uSurfaceR', 'uScatter', 'uWash',
        'uDetail', 'uRelief', 'uShade', 'uRim', 'uSpec', 'uEmit', 'uEmitFrom',
        'uEmitCol', 'uEmitHot', 'uLightMix', 'uSunCol', 'uRimP',
        'uTriScale', 'uTriSlope', 'uTriMix', 'uTriFade', 'uTriDetail',
        'uShadowMat', 'uShadowP', 'uShadowAt', 'uShadowS',
        'uContact', 'uContactF', 'uContactS', 'uContactK', 'uShadowDebug',
        'uWind', 'uWindDir', 'uTime', 'uFlora', 'uFloraRoot'],
      samplers: ['uTriFlat', 'uTriSteep', 'uTriHigh', 'uShadowMap'],
    });
  /* T3 — triplanar. Fade distances arrive as fractions of the fog range so a
     207m world and a 2072m one both get a detail field sized to what they can
     actually see, rather than to a 4km plane neither of them is. */
  const maps = triplanarMaps(scene);
  terrain.setTexture('uTriFlat', maps.flat);
  terrain.setTexture('uTriSteep', maps.steep);
  terrain.setTexture('uTriHigh', maps.high);
  terrain.setVector4('uTriScale', new BABYLON.Vector4(
    TR.scale.flat, TR.scale.steep, TR.scale.high, TR.scale.detail));
  terrain.setVector4('uTriSlope', new BABYLON.Vector4(
    TR.slope.start, TR.slope.end, TR.altitude.start, TR.altitude.end));
  terrain.setVector4('uTriMix', new BABYLON.Vector4(
    TR.strength, TR.normalStrength, TR.blendSharpness, TR.steepBias));
  terrain.setFloat('uTriDetail', TR.detail);
  terrain.setVector4('uTriFade', new BABYLON.Vector4(
    planet.fogFar * TR.detailFade.start, planet.fogFar * TR.detailFade.end,
    planet.fogFar * TR.macroFade.start, planet.fogFar * TR.macroFade.end));
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
  terrain.setVector2('uCoastP', new BABYLON.Vector2(TR.coast.width, TR.coast.minGrad));
  terrain.setVector2('uFogRange', fogRange);
  terrain.setFloat('uSurfaceR', planet.surfaceR);

  const water = new BABYLON.ShaderMaterial('svWater', scene,
    { vertex: 'svWater', fragment: 'svWater' },
    {
      attributes: ['position', 'depth'],
      uniforms: ['world', 'worldViewProjection', 'uCam', 'uLight', 'uFog',
        'uFogSun', 'uDeepW', 'uShallowW', 'uCoast', 'uFogRange', 'uTime',
        'uScatter', 'uWaveK', 'uWaveAmp', 'uMaxDepth', 'uFrozen', 'uMelt',
        'uLightMix', 'uSunCol',
        // The water pass. `view` and `projection` are Babylon's own names and
        // are bound automatically once they are declared here.
        'view', 'projection', 'uInvScreen', 'uWaterP', 'uWaterP2', 'uFoamP',
        'uWaterOn', 'uWaterDebug', 'uShoal', 'uWaveN',
        'uSkyLow', 'uSkyHigh', 'uSkyBandCol', 'uSkyP', 'uGlareP',
        'uBandP', 'uRippleP', 'uRingP'],
      samplers: ['uSeabed'],
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

  /* THE WATER PASS, WIRED LIVE AND NEUTRAL.
     Every term below is at the value that reproduces the water this game
     already shipped, so the first measurement answers "is the plumbing right"
     with the colour held still — the habit that caught all four scale errors in
     T1-T3. uWaterOn stays 0 until a Seabed pass is actually bound; an unbound
     sampler reads black, which would mean a seabed distance of zero, which
     would mean foam over the entire ocean. */
  const WA = waterOf(planet);
  water.setVector2('uInvScreen', new BABYLON.Vector2(1 / 1280, 1 / 720));
  water.setVector4('uWaterP', new BABYLON.Vector4(
    WA.absorb, WA.absorbMax, WA.refract, WA.depthPass.far));
  water.setVector4('uWaterP2', new BABYLON.Vector4(
    WA.opaque || 0, WA.reflect.mix, WA.reflect.fresnel, WA.sharpen || 0));
  water.setVector3('uFoamP', new BABYLON.Vector3(
    WA.foam.shore, WA.foam.edge, WA.foam.strength));
  water.setFloat('uWaterOn', 0);
  water.setFloat('uWaterDebug', WA.debug || 0);
  water.setFloat('uShoal', WA.shoal);
  water.setFloat('uWaveN', WA.waveNormal);
  // Read straight off this world's sky rather than restated: a reflection that
  // could disagree with the sky it is reflecting is a bug waiting for someone
  // to retune SKY and not this.
  water.setVector3('uSkyLow', V3(SK.horizon));
  water.setVector3('uSkyHigh', V3(SK.zenith));
  water.setVector3('uSkyBandCol', V3(SK.bandColor));
  water.setVector3('uSkyP', new BABYLON.Vector3(SK.band, SK.bandWidth, SK.haze));
  water.setVector4('uGlareP', new BABYLON.Vector4(
    WA.glint, WA.skyCap, WA.reflect.maxMix, WA.iceDepth));
  water.setVector3('uBandP', new BABYLON.Vector3(WA.bandSoft, WA.bandTilt, WA.depthBlur));
  water.setVector4('uRippleP', new BABYLON.Vector4(
    WA.ripple, WA.rippleScale, WA.rippleFade[0], WA.rippleFade[1]));
  water.setVector3('uRingP', new BABYLON.Vector3(
    WA.ringFoam, WA.ringSoft, WA.ringHard));
  // Culling ON. The water is a closed shell now, not a plane: with culling off
  // the far side of the sphere draws straight through the sky above the
  // horizon, as a hard-edged grey quad hanging over the world.
  water.backFaceCulling = true;
  water.alpha = 0.9;

  /* ---- vegetation and the wind that moves it ----------------------------
     THE WHOLE SYSTEM IS A NO-OP UNTIL A WORLD OPTS IN. FLORA.density is 0 by
     default, appendFlora returns before it seeds an rng, no vertex ever carries
     a sway other than -1, and the branch in the terrain shader is never taken.
     Three of the six worlds pay nothing at all for this existing. */
  {
    const FL = Object.assign({}, FLORA, planet.flora || {});
    terrain.setVector4('uFlora', new BABYLON.Vector4(
      ...(FL.color || COL.flats), FL.density ? FL.colorMix : 0));
    terrain.setFloat('uFloraRoot', FL.root);
    terrain.setVector4('uWind', new BABYLON.Vector4(
      WIND.speed, WIND.amplitude, WIND.gustSpeed, WIND.gust));
    /* The wind's heading is refreshed per frame in mats.update from the local
       east: on a sphere there is no world-space wind direction that means the
       same thing on two continents. w is the phase wavelength. */
    terrain.setVector4('uWindDir', new BABYLON.Vector4(1, 0, 0, WIND.wavelength));
    terrain.setFloat('uTime', 0);
  }

  const sky = new BABYLON.ShaderMaterial('svSky', scene,
    { vertex: 'svSky', fragment: 'svSky' },
    {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'uLow', 'uHigh', 'uBelow', 'uLight',
        'uBandCol', 'uCloudCol', 'uUnderCol', 'uSunCol', 'uTime', 'uFog',
        'uFogSun', 'uHaze', 'uBand', 'uBandW', 'uClouds', 'uCeil', 'uUnder',
        'uSunSize', 'uGlare', 'uSunCos', 'uUp', 'uEast', 'uNorth',
        'uMid', 'uGrad', 'uScat', 'uCloudP', 'uHoriz'],
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
  /* Degrees in, cosines out, once. The inner ratios are the ones the old magic
     numbers implied — 0.23 of the halo's half-angle and 0.52 of the core's —
     kept so the falloff still looks like itself at the new size. */
  {
    const halo = 0.5 * SK.haloAngle * SK.sunSize * Math.PI / 180;
    const core = 0.5 * SK.sunAngle * SK.sunSize * Math.PI / 180;
    sky.setVector4('uSunCos', new BABYLON.Vector4(
      Math.cos(halo), Math.cos(halo * 0.233),
      Math.cos(core), Math.cos(core * 0.516)));
  }
  sky.setFloat('uGlare', SK.glare);

  /* ---- the sky pass's own uniforms --------------------------------------
     THE MIDDLE OF THE GRADIENT. A world that says nothing gets the midpoint of
     its own two ends at its own midAt, which is exactly a two-stop linear ramp
     and therefore states the neutral case rather than assuming it. */
  {
    sky.setVector3('uMid', V3(SK.mid));
    sky.setVector4('uGrad', new BABYLON.Vector4(
      SK.curve, SK.midAt, SK.bands, SK.bandMix));
    const SC = SK.scatter;
    sky.setVector4('uScat', new BABYLON.Vector4(
      SC.falloff, SC.sunPower, SC.sunMix, SC.gain));
    /* CLOUD DETAIL AND STRATUM COUNT ARE THE TIER, and they are the only
       things it buys today. Resolved once here rather than per frame: a
       machine does not change between frames, and a uniform that could would
       be a shader recompile risk for nothing. */
    sky.setVector4('uCloudP', new BABYLON.Vector4(
      SK.cloudCover, SK.cloudSoft, SK.cloudScale, tierOf().cloudDetail));
    /* The true horizon, refreshed per frame in mats.update. Zero here is
       ground level, which is the value that makes the whole term a no-op
       until something climbs. */
    sky.setVector3('uHoriz', new BABYLON.Vector3(0, 1, tierOf().cloudStrata));
  }
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
    /* The shadow pass hands itself over here rather than the other way round:
       materials.js knows the terrain material and shadows.js knows the map, and
       neither has to import the other. Called once when a world is built. */
    bindShadows(sh) {
      terrain.setVector4('uContact', new BABYLON.Vector4(0, 0, 0, 1));
      terrain.setVector3('uContactF', new BABYLON.Vector3(0, 0, 1));
      terrain.setVector4('uContactS', new BABYLON.Vector4(1, 1, 0.4, 2.6));
      terrain.setFloat('uContactK', 0);
      if (!sh || !sh.rtt) {
        terrain.setVector4('uShadowP', new BABYLON.Vector4(0, 0, 0, 0));
        terrain.setFloat('uShadowS', 0);
        terrain.setFloat('uShadowDebug', SHADOW.debug || 0);
        return;
      }
      terrain.setTexture('uShadowMap', sh.rtt);
      /* The normal offset arrives in METRES: tune states it in texels, because
         that is the unit the error is actually in, and the texel's world size
         is a property of this world's box. One multiply here rather than a
         second uniform and a divide in every fragment. */
      terrain.setVector4('uShadowP', new BABYLON.Vector4(
        sh.cfg.strength, sh.texelWorld * sh.cfg.normalOffset,
        sh.cfg.depthBias, sh.cfg.range * 0.5));
      terrain.setFloat('uShadowS', sh.cfg.softness / sh.cfg.mapSize);
      terrain.setFloat('uShadowDebug', SHADOW.debug || 0);
    },

    /** The craft's ground point, per frame. Zero strength when it is nowhere
     *  near the ground, or when there is no craft yet. */
    setContact(at, fwd, size, strength) {
      terrain.setVector4('uContact', at);
      terrain.setVector3('uContactF', fwd);
      terrain.setVector4('uContactS', size);
      terrain.setFloat('uContactK', strength);
    },

    /** The range the six bathymetry shelves spread across, in metres.
     *  Called once, after the shell exists — see WATER.measureDepth for what
     *  the guess it replaces was costing. Ignored unless the world opted in, so
     *  a world that has not is untouched. */
    setMaxDepth(m) {
      if (waterOf(planet).measureDepth && m > 0.5) water.setFloat('uMaxDepth', m);
    },

    /** Hand the water the seabed depth pass, once, at construction.
     *  Until this is called uWaterOn is 0 and the shader uses the per-vertex
     *  depth exactly as it always did — which is also what a dry world and a
     *  device with no float targets get. */
    bindSeabed(sb) {
      if (!sb || !sb.enabled || !sb.rtt) { water.setFloat('uWaterOn', 0); return; }
      water.setTexture('uSeabed', sb.rtt);
      water.setFloat('uWaterOn', 1);
      // A resize rebuilds the target; without this the sampler keeps the
      // disposed one and reads black, which is a seabed at zero distance and a
      // lake rendered as solid foam.
      sb.onRebuild = (rtt) => water.setTexture('uSeabed', rtt);
      seabed = sb;
    },

    /** Per frame: the box moves with the craft, so the matrix does too. */
    syncShadows(sh) {
      if (!sh || !sh.rtt) return;
      terrain.setMatrix('uShadowMat', sh.matrix);
      terrain.setVector3('uShadowAt', sh._centre);
    },

    terrain, water, sky, craft, light, palette: COL, skyParams: SK,
    fogColor: C3(COL.fog),
  };

  let time = 0;
  let seabed = null;
  const upVec = new BABYLON.Vector3(0, 1, 0);
  const horizVec = new BABYLON.Vector3(0, 1, 1);
  const windVec = new BABYLON.Vector4(1, 0, 0, WIND.wavelength);
  const eastVec = new BABYLON.Vector3(1, 0, 0);
  const northVec = new BABYLON.Vector3(0, 0, 1);
  /* THE FOG RANGE IS ONE OBJECT, SHARED BY THREE MATERIALS ON PURPOSE.
     terrain, water and craft were all handed the same Vector2 at construction,
     and Babylon binds whatever that object holds at draw time — so writing to
     it here updates all three and cannot leave one of them lit for a different
     atmosphere than the other two. That failure mode is not hypothetical: the
     hull fogging on a different curve from the ground it is standing on is
     exactly the sort of thing nobody sees until it is shipped. */
  const fogAlt = { lift: -1 };
  mats.update = (dt, camPos, heat, up, east, north, alt) => {
    time += dt;
    const cam = camPos;
    if (FOG.enabled && alt !== undefined) {
      const R = planet.radius;
      /* Clamped to two radii, and the clamp is for hyper rather than for
         flight. main.js calls this every frame including during a transit,
         when the craft's y is a system-space number in the hundreds of
         thousands — and sqrt(2 * R * that) would hand the fog a range wider
         than the solar system on the frame you arrive. Nothing above two radii
         is a world you are flying over. */
      const a = Math.min(Math.max(0, alt), R * 2);
      const t = smooth01((a - FOG.from * R) / Math.max(1e-6, (FOG.to - FOG.from) * R));
      // The distance to your own horizon from here. Fog is allowed to reach it
      // and no further, because past it there is no world to draw anyway.
      const horizon = Math.sqrt(2 * R * a) * FOG.horizonK;
      const far = Math.max(planet.fogFar, planet.fogFar + (horizon - planet.fogFar) * t);
      /* NEAR LIFTS WITH THE ALTITUDE, and this is the half that actually made
         the difference. At height a, NOTHING IN FRAME IS NEARER THAN a — the
         ground straight below you is exactly a away. Leave the fog starting at
         its surface value and every pixel of the world is already inside it
         before the gradient begins: from 193m over Tarn the whole frame,
         land and water alike, came back as one sheet of pale grey with the
         coastline barely legible through it.
         So the near plane is pushed out to the altitude. On the ground a is
         zero and this is the profile's own number, untouched; in the air it
         puts the start of the fog at the closest thing there is to fog. */
      const near = Math.max(planet.fogNear, planet.fogNear + (a - planet.fogNear) * t);
      if (Math.abs(t - fogAlt.lift) > 1e-4 || far !== planet.fogFar) {
        fogAlt.lift = t;
        fogRange.set(Math.min(near, far * 0.85), far);
      }
    }
    terrain.setVector3('uCam', cam);
    terrain.setFloat('uTime', time);
    water.setVector3('uCam', cam);
    water.setFloat('uTime', time);
    /* The screen size the water divides gl_FragCoord by, refreshed from the
       pass itself rather than assumed: a stale one does not soften the result,
       it addresses the wrong texels and slides the foam off the shoreline. */
    if (seabed) water.setVector2('uInvScreen', seabed.invScreen);
    sky.setFloat('uTime', time);

    /* THE TRUE SKYLINE, per frame.
       At altitude h on a planet of radius R the horizon is below local level
       by the dip angle acos(R / (R + h)), and what the sky shader wants is the
       ELEVATION of that direction, which is -sin(dip). The small-angle form
       sqrt(2h/R) is the same number the fog rule uses for its horizon
       distance, and it is written exactly here rather than approximated
       because the cost is one acos a frame and Ember is a 207m world where a
       jet at 300m is not a small angle at all: the dip there is 55 degrees.
       ZERO ALTITUDE GIVES EXACTLY ZERO, which is what makes every
       horizon-referenced term in that shader a no-op on the ground — the same
       guarantee the fog altitude rule carries, and the reason this could be
       shipped without touching six approved surface skies. */
    if (alt !== undefined) {
      const el = horizonElevation(planet, alt * SKY.trueHorizon);
      horizVec.set(el, 1 / (1 - el), tierOf().cloudStrata);
      sky.setVector3('uHoriz', horizVec);
    }
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
      /* The wind blows along the local EAST. There is no world-space
         direction that means the same thing on two continents of a sphere,
         and a wind that did would blow uphill on one of them. */
      windVec.set(east.x, east.y, east.z, WIND.wavelength);
      terrain.setVector4('uWindDir', windVec);
    }
  };

  return mats;
}
