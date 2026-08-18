// The seabed depth pass: how far the ground is from the eye, per pixel.
//
// WHY THIS EXISTS. The water shell carries a `depth` attribute per VERTEX, and
// the shell is 40 cells across a cube face — on Home that is one depth sample
// every forty metres. Every term the water shader draws off depth was being
// interpolated across that: the six bathymetry shelves, and the shoreline foam,
// whose entire job is to live in the first three metres of depth. Forty-metre
// linear interpolation is why the foam reads as a wide soft band rather than a
// line at the water's edge — not a choice, a resolution.
//
// Raising the mesh does not fix it. waterFaceRes 128 is 100k height() calls at
// 5.0us each — half a second of load per world, measured — and still samples the
// ground on a grid instead of following it. What the shader wants is not a finer
// grid but a different question, asked per pixel: how much water is between the
// eye and the ground along THIS ray. That is a depth pass.
//
// WHAT IT WRITES. Radial distance from the camera, in metres — the same
// quantity the water shader already computes for itself as length(uCam - vW),
// so thickness is one subtract with no projection inverse and no near/far
// reconstruction to get wrong. gl_FragCoord.z would have been cheaper to write
// and much worse to read.
//
// TERRAIN ONLY, and the render list is the whole meaning of the result. It says
// "the ground under the water", not "the nearest surface" — a list that
// included the water shell would report zero thickness everywhere. The chunk
// stream feeds it through the same onBuild/onDrop wiring the shadow pass uses,
// for the same reason: a render list holding disposed leaves grows without
// bound and Babylon will happily try to draw them.
//
// Modelled on shadows.js down to the two flags that are not obvious —
// noPrePassRenderer, and taking nothing on trust from Babylon's capability
// branches. See that file for what each one cost to find.

import { WATER } from '../tune.js';

/** Resolve the water settings for a planet, the way shadowOf and lightOf do. */
export function waterOf(planet) {
  const W = Object.assign({}, WATER, planet.water || {});
  const own = planet.water || {};
  W.depthPass = Object.assign({}, WATER.depthPass, own.depthPass || {});
  W.foam = Object.assign({}, WATER.foam, own.foam || {});
  W.reflect = Object.assign({}, WATER.reflect, own.reflect || {});
  return W;
}

export class Seabed {
  constructor(scene, planet) {
    this.scene = scene;
    this.cfg = waterOf(planet);
    this.notes = [];
    this.rtt = null;
    this.enabled = !!(this.cfg.enabled && this.cfg.depthPass.enabled && planet.hasWater);
    if (!this.enabled) return;

    const engine = scene.getEngine();
    const caps = engine.getCaps();
    /* FLOAT where the device renders it, and the reason is the range this
       stores. A half-float's eleven mantissa bits are one part in 2048, which at
       Anvil's 1906m fog line is most of a metre — the same order as the whole
       width of the shoreline foam. Near the camera, where the foam actually is,
       half-float is decimetres and fine; so the fallback is survivable rather
       than good, and it says so out loud. */
    let type = BABYLON.Constants.TEXTURETYPE_FLOAT;
    if (!caps.textureFloatRender) {
      type = BABYLON.Constants.TEXTURETYPE_HALF_FLOAT;
      this.notes.push('float render targets unsupported — seabed depth is half-float; ' +
                      'distant foam may crawl');
    }
    this.type = type;
    this.ratio = this.cfg.depthPass.ratio;
    this.far = this.cfg.depthPass.far;
    this._make(engine);

    /* One material for every mesh in the list, and it reads `position` and
       nothing else — a leaf's fissure attribute costs nothing here. */
    this.mat = new BABYLON.ShaderMaterial('svSeabed', scene,
      { vertex: 'svSeabed', fragment: 'svSeabed' },
      { attributes: ['position'], uniforms: ['world', 'worldViewProjection', 'uCam'] });
    /* Culling OFF. The chunk leaves carry skirts hanging off every edge, wound
       to be seen from above; a back-facing skirt that culled out would leave a
       seam of "no ground here" along a chunk border, which reads in the water
       as a foam line running down the middle of a lake. */
    this.mat.backFaceCulling = false;

    /* PER-TARGET, PER-MESH — setMaterialForRendering, NOT scene.overrideMaterial,
       and this one was found by measurement rather than reasoning.
       shadows.js swaps its depth material in through scene.overrideMaterial in
       the target's own onBeforeRender, and says so in a comment: two lines
       instead of a per-mesh registration. That works when there is ONE such
       target. With two, the second one's swap does not take: this pass came back
       holding terrain COLOUR — 0.1 to 0.9 on Home, 0.3 to 1.3 on Tarn, the red
       channel of the palette rather than any distance at all — which the water
       shader then read as a seabed less than a metre away, everywhere. The
       result was a lake rendered as solid foam over 99.3% of its surface, and it
       looked enough like "the foam term is too wide" to cost a tuning pass
       before the render target was read directly.
       setMaterialForRendering registers the substitution ON THIS TARGET, for
       these meshes, and touches no global state — so it cannot be cancelled by
       another target that happens to render in the same frame, and it will not
       start cancelling the shadow pass the day someone adds a third. */
    scene.customRenderTargets.push(this.rtt);
    this._cam = new BABYLON.Vector3();
    this._inv = new BABYLON.Vector2(1, 1);
  }

  _make(engine) {
    const w = Math.max(64, Math.round(engine.getRenderWidth() * this.ratio));
    const h = Math.max(64, Math.round(engine.getRenderHeight() * this.ratio));
    const old = this.rtt;
    this._w = w; this._h = h;
    // Six positional arguments and no more — see the note in shadows.js about
    // what the ten-argument form does to generateDepthBuffer.
    const rtt = new BABYLON.RenderTargetTexture('svSeabed', { width: w, height: h },
      this.scene, false, true, this.type);
    rtt.updateSamplingMode(BABYLON.Texture.NEAREST_SAMPLINGMODE);
    rtt.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    rtt.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    /* No prepass on this target. T1's SSAO2 follows every entry in
       scene.customRenderTargets, finds one with no prepass configuration, and
       throws on an index of -1 inside Babylon during the MAIN camera's post
       chain — with nothing of ours in the stack. See shadows.js. */
    rtt.noPrePassRenderer = true;
    rtt.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME;
    rtt.renderList = [];
    // "Nothing here" is very far away, which makes thickness enormous — and the
    // shader reads enormous as "no ground behind this water" and falls back to
    // the per-vertex depth rather than painting a lake black.
    rtt.clearColor = new BABYLON.Color4(this.far, 0, 0, 1);
    this.rtt = rtt;
    if (old) {
      const i = this.scene.customRenderTargets.indexOf(old);
      if (i >= 0) this.scene.customRenderTargets[i] = rtt;
      old.dispose();
    }
  }

  /** Register a leaf. Safe to call for every mesh the chunk stream builds.
   *  The second line is what makes this target draw DISTANCE instead of the
   *  terrain's own colour — see the note above setMaterialForRendering. */
  add(mesh) {
    if (!this.rtt || !mesh) return;
    this.rtt.renderList.push(mesh);
    this.rtt.setMaterialForRendering(mesh, this.mat);
  }

  remove(mesh) {
    if (!this.rtt) return;
    const i = this.rtt.renderList.indexOf(mesh);
    if (i >= 0) this.rtt.renderList.splice(i, 1);
    // ...and drop the substitution with it, or the map grows for the life of
    // the session over a chunk stream that disposes leaves constantly.
    this.rtt.setMaterialForRendering(mesh, undefined);
  }

  clear() {
    if (!this.rtt) return;
    for (const mesh of this.rtt.renderList) this.rtt.setMaterialForRendering(mesh, undefined);
    this.rtt.renderList.length = 0;
  }

  /**
   * Per frame: the camera position the pass measures against, and the screen
   * size the water shader divides gl_FragCoord by.
   *
   * The render target is rebuilt on a resize rather than stretched. A stale size
   * does not merely soften the result — gl_FragCoord * uInvScreen would address
   * the wrong texels entirely, and the foam would slide off the shoreline.
   */
  update(camPos) {
    if (!this.rtt) return;
    const engine = this.scene.getEngine();
    const w = Math.max(64, Math.round(engine.getRenderWidth() * this.ratio));
    const h = Math.max(64, Math.round(engine.getRenderHeight() * this.ratio));
    if (w !== this._w || h !== this._h) {
      /* A resize builds a NEW target, so both things that point at the old one
         have to be moved across: the meshes' per-target material substitutions,
         which live on the target, and the water material's sampler, which would
         otherwise be left holding a disposed texture and reading black. */
      const list = this.rtt.renderList.slice();
      this._make(engine);
      for (const mesh of list) this.add(mesh);
      if (this.onRebuild) this.onRebuild(this.rtt);
    }
    this._cam.copyFrom(camPos);
    this.mat.setVector3('uCam', this._cam);
    this._inv.set(1 / engine.getRenderWidth(), 1 / engine.getRenderHeight());
  }

  get invScreen() { return this._inv; }

  describe() {
    if (!this.enabled) return ['no seabed depth pass on this world'];
    return [`seabed depth: ${this._w}x${this._h}, ${this.rtt.renderList.length} meshes`,
            ...this.notes];
  }

  dispose() {
    if (!this.rtt) return;
    const i = this.scene.customRenderTargets.indexOf(this.rtt);
    if (i >= 0) this.scene.customRenderTargets.splice(i, 1);
    this.rtt.dispose();
    this.mat.dispose();
    this.rtt = null;
  }
}
