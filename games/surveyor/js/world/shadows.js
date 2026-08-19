// Cast shadows: one orthographic depth pass, hand-rolled.
//
// NOT Babylon's ShadowGenerator, and the reason is the same one that has shaped
// every transplant in this game. ShadowGenerator exists to inject itself into
// StandardMaterial and PBRMaterial, and Surveyor has neither — six hand-written
// ShaderMaterials carry the whole look. Using it would have meant sampling a map
// whose encoding Babylon chooses at runtime: standard or exponential, packed
// RGBA or float R, depending on the device's capabilities. That is a decode that
// works on the machine you tested and fails somewhere else, silently, as either
// no shadows or black ones.
//
// So this owns the whole thing: a render target, an orthographic camera parked
// on the sun's axis, a depth material that writes gl_FragCoord.z, and a compare
// in the terrain shader. Seventy lines, one encoding, no capability branches.
//
// WHAT THE FRUSTUM COVERS. Not the world — the near field. Shadows are a contact
// and silhouette cue and they stop mattering long before the fog does, so the
// box is `range` metres across, centred on the craft and following it, and the
// shadow term fades out over the last fifth of it. A 2048 map over 400m is 20cm
// a texel; the same map stretched over Anvil's 1906m fog range would be a metre,
// which is wider than most of the things casting.
//
// THE SUN IS NOT A NEW VALUE. It is sky.sunDir, the same one the ground shading,
// the discs and the baked disc relief already read through skyOf(). A shadow
// that disagreed with the banded light would be the worst kind of wrong: it
// looks deliberate.

import { SHADOW } from '../tune.js';

const V3 = (c) => new BABYLON.Vector3(c[0], c[1], c[2]);

/** Resolve the shadow settings for a planet, the way skyOf and lightOf do. */
export function shadowOf(planet) {
  return Object.assign({}, SHADOW, planet.shadows || {});
}

export class Shadows {
  constructor(scene, planet, sunDir) {
    this.scene = scene;
    this.cfg = shadowOf(planet);
    this.enabled = !!this.cfg.enabled;
    this.notes = [];
    this.rtt = null;
    if (!this.enabled) return;

    const size = this.cfg.mapSize;
    const caps = scene.getEngine().getCaps();
    /* FLOAT, and it matters. The depth written here spans the whole ortho box,
       so half-float's eleven mantissa bits are about 2000 steps across `range`
       — decimetres on a 400m box, which is the same order as the bias and
       produces acne that looks like noise in the shadow rather than precision
       loss. Half-float is the fallback and it says so out loud. */
    let type = BABYLON.Constants.TEXTURETYPE_FLOAT;
    if (!caps.textureFloatRender) {
      type = BABYLON.Constants.TEXTURETYPE_HALF_FLOAT;
      this.notes.push('float render targets unsupported — shadow depth is half-float and may band');
    }

    /* Six positional arguments and no more. The full signature runs to ten, and
       passing all of them put `generateDepthBuffer` where it did not belong:
       the pass came up with no depth buffer at all — so nothing depth-tested
       and the map held whichever caster drew last rather than the nearest — and
       Babylon threw on an internal render-pass id before that could even be
       seen. Defaults are correct for everything after the type. */
    this.rtt = new BABYLON.RenderTargetTexture('svShadow', size, scene, false, true, type);
    this.rtt.updateSamplingMode(BABYLON.Texture.NEAREST_SAMPLINGMODE);
    this.rtt.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    this.rtt.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    /* NO PREPASS ON THIS TARGET.
       T1's SSAO2 runs off the scene prepass, and the prepass follows every
       render target in scene.customRenderTargets — including this one, which
       has no prepass configuration and therefore leaves the prepass render
       target without textures. SSAO then reads that in its own onApply, on the
       MAIN camera, and throws on an index of -1 inside Babylon with nothing of
       ours in the stack. One flag, and it is the difference between shadows and
       a first frame that never arrives. */
    this.rtt.noPrePassRenderer = true;
    this.rtt.refreshRate = BABYLON.RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME;
    this.rtt.renderList = [];
    // Depth 1.0 is "nothing here", which reads as fully lit — so a fragment
    // outside the box or behind nothing is never in shadow by accident.
    this.rtt.clearColor = new BABYLON.Color4(1, 1, 1, 1);

    /* One orthographic camera on the sun's axis, and then TAKEN BACK OUT of the
       scene's camera list.
       Babylon's Camera constructor registers every camera it makes, whatever
       the setActiveOnSceneIfNoneActive argument says — that flag only decides
       whether it becomes the active one. Leaving it registered crashed T1's
       SSAO on the first frame: SSAO2 runs off the prepass, the prepass keys its
       buffers by camera, and it went looking for a render pass belonging to a
       camera that never renders a normal frame. The error surfaces inside
       Babylon's own post-process apply and names nothing of ours, which is a
       long way to walk back from a missing line.
       Removing it costs nothing — a render target holds its own activeCamera
       reference and does not need the scene to know about it. */
    this.cam = new BABYLON.TargetCamera('svShadowCam', BABYLON.Vector3.Zero(), scene, false);
    scene.removeCamera(this.cam);
    this.cam.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    this.cam.minZ = 1;
    this.cam.maxZ = this.cfg.range * 4;
    this.rtt.activeCamera = this.cam;

    /* Every caster is drawn with this one material, so a leaf's fissure
       attribute and a hull's colour attribute cost nothing here: the depth pass
       reads `position` and nothing else. scene.overrideMaterial is honoured
       during a render target's own pass, which is what makes this two lines
       instead of a per-mesh registration. */
    this.depthMat = new BABYLON.ShaderMaterial('svDepth', scene,
      { vertex: 'svDepth', fragment: 'svDepth' },
      { attributes: ['position'], uniforms: ['worldViewProjection'] });
    this.depthMat.backFaceCulling = false;

    let restore = null;
    this.rtt.onBeforeRenderObservable.add(() => {
      restore = scene.overrideMaterial;
      scene.overrideMaterial = this.depthMat;
    });
    this.rtt.onAfterRenderObservable.add(() => {
      scene.overrideMaterial = restore;
    });

    scene.customRenderTargets.push(this.rtt);

    // One texel's width on the ground, which is the unit the depth error is
    // actually in and therefore the unit the normal offset is stated in.
    this.texelWorld = this.cfg.range / this.cfg.mapSize;
    this.sun = V3(sunDir).normalize();
    this.matrix = BABYLON.Matrix.Identity();
    this._centre = new BABYLON.Vector3();
    this._eye = new BABYLON.Vector3();
    this.casters = [];
  }

  /** Register a caster. Safe to call for every leaf the chunk stream builds.
   *  Casters live in a master set; the RTT's renderList is refilled per frame
   *  in update() with only the ones near enough to reach the box. Measured on
   *  the revamped Home: the caster pass costs ~0 GPU and ~1.4ms of CPU — it
   *  is draw submission, so the whole win is submitting fewer casters, and a
   *  leaf 600m from a 180m box cannot cast into it from any sun angle. */
  addCaster(mesh) {
    if (this.rtt && mesh) this.casters.push(mesh);
  }

  /** ...and drop one, because the chunk stream disposes leaves constantly and a
   *  caster set holding disposed meshes grows without bound. */
  removeCaster(mesh) {
    if (!this.rtt) return;
    const i = this.casters.indexOf(mesh);
    if (i >= 0) this.casters.splice(i, 1);
  }

  clearCasters() {
    if (!this.rtt) return;
    this.casters.length = 0;
    this.rtt.renderList.length = 0;
  }

  /**
   * Follow the craft. The box is re-centred every frame, and SNAPPED to a texel
   * grid before it is: without that, moving half a texel re-rasterises every
   * edge in the map and the shadows crawl and shimmer as you drive. Snapping is
   * the whole difference between a shadow that sits on the ground and one that
   * swims over it.
   */
  update(centre) {
    if (!this.rtt) return;
    const R = this.cfg.range * 0.5;
    const texel = this.cfg.range / this.cfg.mapSize;
    this._centre.set(
      Math.round(centre.x / texel) * texel,
      Math.round(centre.y / texel) * texel,
      Math.round(centre.z / texel) * texel);

    this._eye.copyFrom(this.sun).scaleInPlace(this.cfg.range * 1.5)
      .addInPlace(this._centre);
    this.cam.position.copyFrom(this._eye);
    this.cam.setTarget(this._centre);
    this.cam.orthoLeft = -R;
    this.cam.orthoRight = R;
    this.cam.orthoTop = R;
    this.cam.orthoBottom = -R;
    this.cam.getViewMatrix().multiplyToRef(this.cam.getProjectionMatrix(), this.matrix);

    /* Refill the render list with only the casters that can reach the box:
       centre within 1.1x the range, which covers a finest or next-finest leaf
       overlapping the box edge with margin (coarser leaves cannot overlap it —
       the quadtree has already split everything this close to the craft). The
       distance test is ~100 subtractions a frame; the draws it saves are 12us
       each, and they were most of what the caster pass cost. */
    const list = this.rtt.renderList;
    list.length = 0;
    const rr = this.cfg.range * 1.1, r2 = rr * rr;
    for (const m of this.casters) {
      const p = m.position;
      const dx = p.x - this._centre.x;
      const dy = p.y - this._centre.y;
      const dz = p.z - this._centre.z;
      if (dx * dx + dy * dy + dz * dz < r2) list.push(m);
    }
  }

  describe() {
    if (!this.enabled) return ['no cast shadows on this world'];
    return [`cast shadows: ${this.cfg.mapSize} map over ${this.cfg.range}m, ` +
            `${this.rtt.renderList.length} casters`, ...this.notes];
  }

  dispose() {
    if (!this.rtt) return;
    const i = this.scene.customRenderTargets.indexOf(this.rtt);
    if (i >= 0) this.scene.customRenderTargets.splice(i, 1);
    this.rtt.dispose();
    this.depthMat.dispose();
    this.cam.dispose();
    this.rtt = null;
  }
}
