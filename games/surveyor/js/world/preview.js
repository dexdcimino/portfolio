// What each world looks like, baked once, so a disc in the sky is that place.
//
// The discs used to be flat tinted coins: you could tell one world from another
// but you could not tell anything ABOUT one. This bakes a small equirectangular
// map of every planet out of the same height(dir, planet) the terrain rides on,
// coloured by the same palette ladder the terrain shader uses, and hands the
// whole set to the disc shader as one atlas.
//
// Three things follow from doing it this way rather than with a shader on the
// disc.
//
// 1. IT CANNOT DISAGREE WITH THE PLACE. Same height field, same palette, same
//    waterline, same fissure term. A procedural stand-in would have to be kept
//    in step by hand, and would drift the first time a profile was retuned.
//
// 2. ONE BAKE, NOT ONE PER VIEW. Every world is drawn in five other skies, so a
//    per-disc bake would do the same work six times over. The worlds are also
//    at fixed points in one frame, so nothing here ever needs redoing.
//
// 3. IT IS AN ATLAS, so the five discs stay ONE draw call. Row `slot` is that
//    planet's map and the disc shader offsets v into its row.
//
// The cost is the height field, 2-4us a sample, so the resolution is the whole
// of the budget conversation. See PREVIEW in tune.js.

import { PLANETS, PREVIEW } from '../tune.js';
import { height, fissureAt } from './noise.js';
import { paletteOf, skyOf } from './materials.js';
import { makePlanet } from './sphere.js';
import { meltDepth } from './water.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// GLSL's smoothstep, so the ladder below is the terrain shader's ladder and can
// be read against it line for line.
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a || 1e-9));
  return t * t * (3 - 2 * t);
};
const mix3 = (out, a, b, t) => {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
};
const scale3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// A direction from longitude and latitude. Scratch object: this is called nine
// times a texel on the one world that has fissures and nowhere else.
const SUB = { x: 0, y: 0, z: 0 };
const sub = (lon, lat) => {
  const cl = Math.cos(lat);
  SUB.x = cl * Math.cos(lon); SUB.y = Math.sin(lat); SUB.z = cl * Math.sin(lon);
  return SUB;
};

/**
 * The colour of one point on one planet, from its height and its slope.
 *
 * This is svTerrainFragmentShader and svWaterFragmentShader with everything
 * that needs a camera taken out — no fog, no rim, no view-dependent glint, no
 * animated foam — because a world seen from another world has none of those.
 * What is left is the part that says which world it is: the height ladder, the
 * bathymetry shelves, the ice and its melt line, and Ember's cracks.
 *
 * Writes [r, g, b, emissive]. The emissive channel is kept separate so the
 * shader can add it back AFTER the terminator: ground that glows is a light
 * source, not a lit surface, and it has to show on the night side.
 */
function colourAt(out, dir, planet, COL, SK, maxDepth, melt, h, slope,
                  lon, lat, dLonRad, dLatRad, g, arc, nSun, upSun) {
  const e = h / planet.relief;
  let emit = 0;

  if (planet.hasWater && h < 0) {
    // Bathymetry, banded into shelves exactly as the water shader bands it.
    const d = -h;
    const shelf = Math.floor(clamp01(d / maxDepth) * 0.999 * 6) / 6;
    mix3(out, COL.shallow, COL.deep, shelf);
    mix3(out, out, COL.coast, (1 - smoothstep(0, maxDepth * 0.14, d)) * 0.85);
    if (planet.iceThickness > 0) {
      /* Frozen — Vault. Pale and opaque, with the melt line stroked across it:
         the one piece of surface detail here that is a hazard rather than a
         texture, and the reason Vault reads as ice and not as pale water. */
      const ice = mix3([0, 0, 0], COL.coast, COL.shallow, smoothstep(0, maxDepth, d) * 0.55);
      mix3(ice, ice, scale3(COL.deep, 1.25), smoothstep(melt, melt + maxDepth * 0.20, d));
      const line = 1 - smoothstep(0, Math.max(maxDepth * 0.035, 0.15), Math.abs(d - melt));
      mix3(ice, ice, scale3(COL.coast, 1.35), line * 0.85);
      out[0] = ice[0]; out[1] = ice[1]; out[2] = ice[2];
    }
  } else {
    // The height ladder, breakpoint for breakpoint.
    out[0] = COL.deep[0]; out[1] = COL.deep[1]; out[2] = COL.deep[2];
    mix3(out, out, COL.silt, smoothstep(-0.50, -0.135, e));
    mix3(out, out, COL.shore, smoothstep(-0.116, -0.006, e));
    mix3(out, out, COL.flats, smoothstep(0.008, 0.097, e));
    mix3(out, out, COL.stone, smoothstep(0.174, 0.480, e));
    mix3(out, out, COL.peak, smoothstep(0.620, 0.950, e));
    // Steep faces forced back to stone. This is what draws the canyon walls on
    // Anvil, and it is why slope is worth a finite difference.
    mix3(out, out, scale3(COL.stone, 0.88), smoothstep(0.32, 0.66, slope));

    /* THE THREE TERMS THAT MAKE RELIEF READ WHEN THE PALETTE WILL NOT.
       Vault is why these exist. Its land is 23% shore / 44% flats / 23% stone,
       and those three colours are 0.94 / 0.85 / 0.74 in luminance — a twentieth
       of the range Home's palette covers — so the height ladder above returns a
       flat pale disc and the world reads as a featureless ball. The palette
       cannot carry that world; the height field has to.

       None of this is invented: all three are in svTerrainFragmentShader
       already, and each one uses that planet's OWN colours, so a world with a
       contrasty palette gets them too and is simply less dependent on them. */

    // 1. BASIN SHADOW. The low ground takes the world's shade tint, which is
    //    the same colour its shadows are — Vault's is the deepest blue in the
    //    system, and blue in the hollows is most of what makes ice read as ice.
    mix3(out, out, mix3([0, 0, 0], out, COL.shade, 1),
      (1 - smoothstep(-0.02, 0.34, e)) * PREVIEW.basin);

    /* 2. RELIEF SHADING, from that planet's own sun.
       Only the terrain's DEPARTURE from a smooth sphere is baked in: the disc
       shader already lights the sphere, and baking the absolute dot product
       would light it twice. So this carries the difference between the ground's
       normal and the sphere's, which is exactly the crevasse-and-ridge signal
       and nothing else. Free — the gradient was already computed for slope. */
    const hs = 1 + PREVIEW.relief * (nSun - upSun);
    const k = hs < 0.40 ? 0.40 : hs > 1.55 ? 1.55 : hs;
    out[0] *= k; out[1] *= k; out[2] *= k;

    /* 3. CONTOURS — the survey chart's own hand, same intervals as the ground:
       minor at relief/8.7, index at relief/1.7.
       The shader keeps its lines one PIXEL wide with a distance term; the same
       job here is one TEXEL wide, and the honest width for that is half the
       height the ground climbs across a texel. That falls out of the gradient,
       so a line appears exactly where a contour crosses this texel and nowhere
       else — which is also why they cannot alias into dots the way a fixed
       width would.

       The fade on w/interval is what SELECTS between the two intervals, and it
       has to bite early. Measured at 128x64, the ground climbs 3.5m across a
       texel on Vault and 8m on Anvil, against minor intervals of 4.8m and 11.9m
       — so a minor contour crosses about seven texels in ten, which is not a
       line network, it is noise, and it was reading as dirt on the ice. Past a
       quarter of an interval per texel the lines are finer than the map can
       hold and they are dropped. At this resolution that silently leaves the
       index lines doing the work on every world, and brings the minor ones
       back on their own if PREVIEW ever gets wider. */
    const climb = g * arc;
    for (const [interval, weight] of [[planet.relief * 0.115, PREVIEW.contourMinor],
                                      [planet.relief * 0.580, PREVIEW.contour]]) {
      const w = 0.5 * climb;
      if (w <= 0) continue;
      const c = Math.abs(h / interval - Math.floor(h / interval) - 0.5) * interval;
      let line = 1 - smoothstep(w, w * 2.6, c);
      line *= 1 - smoothstep(0.08, 0.25, w / interval);
      line *= 1 - smoothstep(0.42, 0.80, slope);
      if (line > 0) mix3(out, out, COL.contour, line * weight);
    }

    /* Fissure emission — Ember, and only Ember. wFissure is 0 everywhere else,
       so this whole branch is skipped on the other five.

       `hot` is the SUPERSAMPLED maximum over the texel, not a point sample.
       Ember's cracks are narrower than a texel of this map, and point-sampling
       a network of thin lines catches it where it happens to land: the first
       bake came out as orange speckle, which reads as static rather than as
       cracks. Taking the max over the texel is the honest answer to "is there a
       fissure in here" at this resolution, and it is what turns the speckle
       back into the connected network the ground actually has.

       Max rather than mean because a mean dims every line to its coverage
       fraction, which at sub-texel width is most of the way to invisible. */
    if (SK.emit > 0 && planet.wFissure > 0) {
      let hot = 0;
      for (let sy = -1; sy <= 1; sy++) {
        for (let sx = -1; sx <= 1; sx++) {
          const p = sub(lon + sx * dLonRad / 3, lat + sy * dLatRad / 3);
          const v = smoothstep(SK.emitFrom, 0.92, fissureAt(p, planet));
          if (v > hot) hot = v;
        }
      }
      if (hot > 0) {
        mix3(out, out, mix3([0, 0, 0], COL.emit, COL.emitHot, hot * hot), hot);
        emit = hot;
      }
    }
  }
  out[3] = emit;
  return out;
}

/**
 * Bake every world into one atlas: PREVIEW.width across, one PREVIEW.height row
 * per planet, equirectangular — u is longitude, v is latitude within the row.
 *
 * Equirectangular rather than a per-disc orthographic face because a world is
 * seen from five different directions and this is the projection that serves
 * all five out of one bake. It over-samples the poles; that is the price.
 *
 * Returns { texture, slot, rows, ms } — `slot` maps a planet key to its row.
 */
export function bakePreviews(scene) {
  const clock = typeof performance !== 'undefined' ? performance : Date;
  const t0 = clock.now();
  const W = PREVIEW.width, H = PREVIEW.height;
  const keys = Object.keys(PLANETS);
  const data = new Uint8Array(W * H * keys.length * 4);
  const slot = {};
  const px = [0, 0, 0, 0];
  const dir = { x: 0, y: 0, z: 0 };

  keys.forEach((key, row) => {
    slot[key] = row;
    const planet = makePlanet(PLANETS[key]);
    const COL = paletteOf(planet);
    const SK = skyOf(planet);
    const maxDepth = Math.max(3, planet.relief * 0.42);
    const melt = meltDepth(planet);

    /* Height first, the whole row, then colour.
       Two passes because slope is a finite difference and needs its neighbours:
       one height() call per texel instead of five, which on a field costing
       2-4us a call is the difference between a bake you can afford at boot and
       one you cannot. */
    const h = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const lat = (0.5 - (y + 0.5) / H) * Math.PI;
      const cl = Math.cos(lat), sl = Math.sin(lat);
      for (let x = 0; x < W; x++) {
        const lon = ((x + 0.5) / W) * Math.PI * 2 - Math.PI;
        dir.x = cl * Math.cos(lon); dir.y = sl; dir.z = cl * Math.sin(lon);
        h[y * W + x] = height(dir, planet);
      }
    }

    // Metres of arc between neighbouring samples, which is what turns a height
    // difference into a gradient. Longitude steps shorten toward the poles.
    const dLat = (Math.PI * planet.radius) / H;
    // The same step in radians, for the sub-texel fissure sampling below.
    const dLonRad = (Math.PI * 2) / W, dLatRad = Math.PI / H;
    // That planet's own sun, for the relief shading. Its own, not this one's:
    // the crevasse that is in shadow on Vault is in shadow on Vault's disc.
    const sv = SK.sunDir, sl0 = Math.hypot(sv[0], sv[1], sv[2]) || 1;
    const sun = { x: sv[0] / sl0, y: sv[1] / sl0, z: sv[2] / sl0 };
    for (let y = 0; y < H; y++) {
      const lat = (0.5 - (y + 0.5) / H) * Math.PI;
      const cl = Math.cos(lat), sl = Math.sin(lat);
      const dLon = Math.max(1e-3, (2 * Math.PI * planet.radius * Math.abs(cl)) / W);
      const yUp = y > 0 ? y - 1 : y;
      const yDn = y < H - 1 ? y + 1 : y;
      for (let x = 0; x < W; x++) {
        const lon = ((x + 0.5) / W) * Math.PI * 2 - Math.PI;
        dir.x = cl * Math.cos(lon); dir.y = sl; dir.z = cl * Math.sin(lon);
        // Longitude wraps; latitude clamps at the poles.
        const gx = (h[y * W + ((x + 1) % W)] - h[y * W + ((x + W - 1) % W)]) / (2 * dLon);
        const gy = (h[yDn * W + x] - h[yUp * W + x]) / (Math.max(1, yDn - yUp) * dLat);
        const g = Math.hypot(gx, gy);

        /* The ground's normal, for the relief shading.
           The local frame falls straight out of the parameterisation: east is
           d(dir)/d(lon) normalised, north is d(dir)/d(lat), and both are unit
           already. `gy` above runs down the image, which is SOUTH, so it enters
           with the sign flipped. A heightfield's normal is then up minus the
           gradient laid along the two tangents. */
        const eX = -Math.sin(lon), eZ = Math.cos(lon);
        const nX = -sl * Math.cos(lon), nY = cl, nZ = -sl * Math.sin(lon);
        let Nx = dir.x - eX * gx + nX * gy;
        let Ny = dir.y + nY * gy;
        let Nz = dir.z - eZ * gx + nZ * gy;
        const nl = Math.hypot(Nx, Ny, Nz) || 1;
        Nx /= nl; Ny /= nl; Nz /= nl;
        const nSun = Nx * sun.x + Ny * sun.y + Nz * sun.z;
        const upSun = dir.x * sun.x + dir.y * sun.y + dir.z * sun.z;

        // slope in the terrain shader is 1 - dot(N, up), and for a heightfield
        // dot(N, up) is exactly 1 / sqrt(1 + |grad|^2).
        colourAt(px, dir, planet, COL, SK, maxDepth, melt,
          h[y * W + x], 1 - 1 / Math.sqrt(1 + g * g), lon, lat, dLonRad, dLatRad,
          g, dLat, nSun, upSun);
        const o = ((row * H + y) * W + x) * 4;
        data[o] = clamp01(px[0]) * 255;
        data[o + 1] = clamp01(px[1]) * 255;
        data[o + 2] = clamp01(px[2]) * 255;
        data[o + 3] = clamp01(px[3]) * 255;
      }
    }
  });

  const tex = BABYLON.RawTexture.CreateRGBATexture(
    data, W, H * keys.length, scene,
    false,            // no mipmaps: the disc magnifies this, it never minifies it
    false,            // no invertY — v is built top-down above
    BABYLON.Texture.BILINEAR_SAMPLINGMODE);
  // Longitude wraps the whole way round. Latitude must NOT, or the top of one
  // world bleeds into the bottom of the planet stacked above it.
  tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 1;

  return { texture: tex, slot, rows: keys.length, ms: clock.now() - t0 };
}

/* One set for the whole session, and ONE bake.
   Everything goes through here — main.js at boot and every world's Discs after
   it — because two callers of bakePreviews() would pay the cost twice and hold
   two atlases for identical worlds. main.js calls it first so that cost lands
   in front of the start card, where it can be measured, rather than in the
   middle of building the first world. */
let cached = null;
export function previews(scene) {
  if (!cached && scene) cached = bakePreviews(scene);
  return cached;
}
