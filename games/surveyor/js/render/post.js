/**
 * The post stack: ACES tonemapping, bloom, SSAO, colour-grading LUT, vignette
 * and grain.
 *
 * TRANSPLANTED from the lookdev testbed (T1), essentially unchanged. It imports
 * only from ./ and ../babylon.js and takes its whole configuration as the
 * `tune` argument, which is why it needed no adapter layer to land here. Keep
 * that property: the next transplants (lighting, materials, sky) rely on it.
 *
 * Two additions, both Surveyor's:
 *   - setGrade(url, level), because Surveyor has SIX worlds with authored
 *     palettes and each one gets its own LUT slot. lookdev had one world and
 *     one grade, so a single url in tune was enough there.
 *   - vignetteCameraFov, which Surveyor's own vignette was pinned to and which
 *     otherwise tracks the chase camera's FOV and breathes during hyper.
 *
 * This runs before the lighting work, not after, because PBR emits HDR values
 * that are meaningless untonemapped — you cannot judge a light rig through an
 * unmapped buffer.
 *
 * ORDER MATTERS, and it is Babylon's, not ours. Inside the image-processing
 * shader the chain is:
 *
 *     exposure -> vignette -> ACES -> to gamma space -> contrast -> LUT
 *
 * Two consequences worth knowing before touching anything here:
 *   - the LUT operates on display-referred sRGB values, which is why
 *     tools/bake_lut.py authors the grade in gamma space
 *   - the vignette multiplies *scene-linear* colour before tonemapping, so it
 *     darkens rather than washes, which is what the look target wants
 *
 * SSAO is a separate pipeline created first, so its occlusion multiplies
 * scene-linear colour before any of the above.
 *
 * No depth of field: it fights a game where you look at terrain at all
 * distances.
 */

import B from '../babylon.js';

const TONE_MAPPING = {
  none: null,
  standard: 1,
  aces: 2,
  neutral: 3,
};

export function createPostStack(scene, camera, tune) {
  const P = tune.post;
  const notes = [];
  let ssao = null;
  let pipeline = null;
  let lut = null;
  let identityLut = null;
  let enabled = false;
  let usingIdentity = false;

  if (P.ssao.enabled) {
    if (B.SSAO2RenderingPipeline.IsSupported) {
      // The sixth argument is the AO buffer's texture type, and Babylon
      // defaults it to UNSIGNED_BYTE. 256 levels across a smooth occlusion
      // gradient contours into concentric rings over every large slope — it
      // reads as a terrain bug, not an AO bug. Half float fixes it outright.
      const bufferType = resolveTextureType(scene.getEngine(), P.ssao.textureType, notes);
      ssao = new B.SSAO2RenderingPipeline('lookdevSSAO', scene, {
        ssaoRatio: P.ssao.ssaoRatio,
        blurRatio: P.ssao.blurRatio,
      }, [camera], P.ssao.forceGeometryBuffer, bufferType);
      applySsao(ssao, P.ssao);
    } else {
      notes.push('SSAO2 unsupported on this device (needs WebGL2) — skipped');
    }
  }

  pipeline = new B.DefaultRenderingPipeline('lookdevPost', P.hdr, scene, [camera]);
  pipeline.depthOfFieldEnabled = P.depthOfField;
  pipeline.sharpenEnabled = false;
  pipeline.chromaticAberrationEnabled = false;
  pipeline.fxaaEnabled = P.fxaa;
  pipeline.samples = Math.max(1, P.msaaSamples);

  pipeline.bloomEnabled = P.bloom.enabled;
  pipeline.bloomThreshold = P.bloom.threshold;
  pipeline.bloomWeight = P.bloom.weight;
  pipeline.bloomKernel = P.bloom.kernel;
  pipeline.bloomScale = P.bloom.scale;

  pipeline.grainEnabled = P.grain.enabled;
  pipeline.grain.intensity = P.grain.intensity;
  pipeline.grain.animated = P.grain.animated;

  const ip = pipeline.imageProcessing;
  const toneMappingType = TONE_MAPPING[P.toneMapping] ?? TONE_MAPPING.aces;
  ip.toneMappingEnabled = toneMappingType !== null;
  if (toneMappingType !== null) ip.toneMappingType = toneMappingType;
  ip.exposure = P.exposure;
  ip.contrast = P.contrast;

  ip.vignetteEnabled = P.vignette.enabled;
  ip.vignetteWeight = P.vignette.weight;
  ip.vignetteStretch = P.vignette.stretch;
  ip.vignetteColor = new B.Color4(...P.vignette.colour);
  ip.vignetteBlendMode = P.vignette.blend === 'opaque'
    ? B.ImageProcessingConfiguration.VIGNETTEMODE_OPAQUE
    : B.ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
  /* Pinned, not tracked. Babylon computes the vignette from the camera's FOV,
     and Surveyor's chase camera changes FOV per craft and again all the way up
     the hyper ramp — which made the corners breathe every time the speed did.
     null keeps Babylon's behaviour for a host that wants it. */
  if (P.vignette.cameraFov !== null && P.vignette.cameraFov !== undefined) {
    ip.vignetteCameraFov = P.vignette.cameraFov;
  }

  // Deferred: the first world's LUT is set through setGrade below, so the
  // construction path and the arrival path are the same one line of code.
  if (P.colorGrading.enabled) ip.colorGradingEnabled = true;

  enabled = true;
  let ssaoEnabled = !!ssao;

  // Attach state is tracked so a pipeline is never double-attached: Babylon
  // pushes the camera onto a list without checking.
  const attached = { lookdevSSAO: !!ssao, lookdevPost: true };

  function attach(name, on) {
    if (attached[name] === on) return;
    attached[name] = on;
    const manager = scene.postProcessRenderPipelineManager;
    if (on) manager.attachCamerasToRenderPipeline(name, camera);
    else manager.detachCamerasFromRenderPipeline(name, camera);
  }

  function sync() {
    if (ssao) attach('lookdevSSAO', enabled && ssaoEnabled);
    attach('lookdevPost', enabled);
  }

  /** A/B the whole stack against the Phase 0 baseline. */
  function setEnabled(on) {
    enabled = on;
    sync();
    return enabled;
  }

  /** A/B occlusion alone. On untextured terrain SSAO is the largest single win
   *  in this phase, which is only checkable by turning it off. */
  function setSsaoEnabled(on) {
    ssaoEnabled = on;
    sync();
    return ssaoEnabled;
  }

  /**
   * Swap the grade — Surveyor's addition, because a world arrives with its own.
   *
   * Cached by url, so the six worlds shipping the same neutral LUT cost one
   * upload and one texture between them, and a return trip costs nothing.
   * Passing the url already in use is free and is the common case.
   */
  const grades = new Map();
  function setGrade(url, level = 1.0) {
    if (!url) {
      ip.colorGradingEnabled = false;
      lut = null;
      return null;
    }
    let tex = grades.get(url);
    if (!tex) {
      tex = loadLut(scene, url, level);
      grades.set(url, tex);
    }
    tex.level = level;
    lut = tex;
    if (!usingIdentity) ip.colorGradingTexture = tex;
    ip.colorGradingEnabled = true;
    return tex;
  }

  /** A/B the grade alone, against a baked identity LUT. Proves the plumbing is
   *  neutral before any look gets judged through it. */
  function setIdentityGrade(on) {
    if (!lut) return false;
    usingIdentity = on;
    if (on && !identityLut) {
      identityLut = loadLut(scene, P.colorGrading.identityUrl, 1.0);
    }
    ip.colorGradingTexture = on ? identityLut : lut;
    return usingIdentity;
  }

  /* The boot world's grade, through the same call an arrival makes. It has to
     sit AFTER setGrade's own `grades` map is initialised — a hoisted function
     reading a const from the temporal dead zone throws, and it throws at boot,
     which is the worst place for it. */
  if (P.colorGrading.enabled && P.colorGrading.url) {
    setGrade(P.colorGrading.url, P.colorGrading.level);
  }

  return {
    pipeline,
    ssao,

    get exposure() { return ip.exposure; },
    setExposure(value) {
      ip.exposure = Math.min(P.viewer.exposureMax, Math.max(P.viewer.exposureMin, value));
      return ip.exposure;
    },
    nudgeExposure(direction) {
      return this.setExposure(ip.exposure + direction * P.viewer.exposureStep);
    },

    setGrade,
    get grade() { return lut ? lut.url : null; },

    setEnabled,
    get enabled() { return enabled; },
    setSsaoEnabled,
    get ssaoEnabled() { return ssaoEnabled; },
    setIdentityGrade,
    get identityGrade() { return usingIdentity; },

    /** Resolves once the LUT is uploaded. The screenshot harness must await
     *  this: scene.whenReadyAsync() does not cover colour-grading textures, so
     *  without it the first frames render ungraded. */
    async whenReadyAsync(timeoutMs = 5000) {
      if (!lut) return true;
      const deadline = performance.now() + timeoutMs;
      while (!lut.isReady()) {
        if (performance.now() > deadline) {
          notes.push(`LUT ${P.colorGrading.url} did not load within ${timeoutMs} ms`);
          return false;
        }
        // setTimeout rather than requestAnimationFrame: an unfocused window gets
        // no animation frames, and this poll must still time out there.
        await new Promise((r) => setTimeout(r, 16));
      }
      return true;
    },

    describe() {
      const features = [
        `${P.toneMapping.toUpperCase()} tonemapping${P.hdr ? ' (HDR pipeline)' : ''}`,
        P.bloom.enabled ? `bloom @ threshold ${P.bloom.threshold}` : 'bloom off',
        ssao ? `SSAO2 ${P.ssao.samples} samples, r=${P.ssao.radius} m, strength ${P.ssao.totalStrength}`
             : 'SSAO off',
        P.colorGrading.enabled ? `LUT ${P.colorGrading.url.split('/').pop()}` : 'no LUT',
        P.vignette.enabled ? 'vignette' : null,
        P.grain.enabled ? 'grain' : null,
        P.msaaSamples > 1 ? `MSAA x${P.msaaSamples}` : (P.fxaa ? 'FXAA' : 'no AA'),
        'no depth of field (deliberate)',
      ].filter(Boolean);
      return { features, notes, exposure: ip.exposure, lutReady: lut ? lut.isReady() : null };
    },

    dispose() {
      pipeline.dispose();
      ssao?.dispose();
      for (const tex of grades.values()) tex.dispose();
      grades.clear();
      identityLut?.dispose();
    },
  };
}

/** Maps a tune value to a Babylon texture type, degrading with a note rather
 *  than failing if the device cannot render to it. */
function resolveTextureType(engine, requested, notes) {
  const caps = engine.getCaps();
  if (requested === 'float' && caps.textureFloatRender) return B.Constants.TEXTURETYPE_FLOAT;
  if (requested === 'float') notes.push('float render targets unsupported — SSAO buffer fell back');
  if ((requested === 'float' || requested === 'half-float') && caps.textureHalfFloatRender) {
    return B.Constants.TEXTURETYPE_HALF_FLOAT;
  }
  if (requested !== 'byte') {
    notes.push('half-float render targets unsupported — SSAO buffer is 8-bit and will band');
  }
  return B.Constants.TEXTURETYPE_UNSIGNED_BYTE;
}

function applySsao(ssao, s) {
  ssao.samples = s.samples;
  ssao.radius = s.radius;
  ssao.totalStrength = s.totalStrength;
  ssao.base = s.base;
  ssao.maxZ = s.maxZ;
  ssao.minZAspect = s.minZAspect;
  ssao.epsilon = s.epsilon;
  ssao.expensiveBlur = s.expensiveBlur;
  ssao.bilateralSamples = s.bilateralSamples;
  ssao.bilateralSoften = s.bilateralSoften;
  ssao.bilateralTolerance = s.bilateralTolerance;
}

function loadLut(scene, url, level) {
  const texture = new B.ColorGradingTexture(url, scene);
  texture.level = level;
  return texture;
}
