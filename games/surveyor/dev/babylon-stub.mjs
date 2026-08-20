// Minimal BABYLON shim — just enough surface for the gameplay modules to run
// in Node so physics, streaming and geometry can be tested without a GPU.

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setAll(v) { return this.set(v, v, v); }
  copyFrom(o) { return this.set(o.x, o.y, o.z); }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(o) { return new Vector3(this.x + o.x, this.y + o.y, this.z + o.z); }
  addInPlace(o) { this.x += o.x; this.y += o.y; this.z += o.z; return this; }
  scale(s) { return new Vector3(this.x * s, this.y * s, this.z * s); }
  scaleInPlace(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { const l = this.length() || 1; return this.scaleInPlace(1 / l); }
  subtract(o) { return new Vector3(this.x - o.x, this.y - o.y, this.z - o.z); }
  static Zero() { return new Vector3(0, 0, 0); }
  static Dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  static Distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  static Cross(a, b) {
    return new Vector3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }
}
class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; } }
class Vector4 {
  constructor(x = 0, y = 0, z = 0, w = 0) { Object.assign(this, { x, y, z, w }); }
  set(x, y, z, w) { Object.assign(this, { x, y, z, w }); return this; }
}
class Color3 { constructor(r = 0, g = 0, b = 0) { this.r = r; this.g = g; this.b = b; } }
class Color4 { constructor(r = 0, g = 0, b = 0, a = 1) { Object.assign(this, { r, g, b, a }); } }
// Real quaternion and matrix maths, not placeholders: the sphere conversion
// composes the tangent basis with the craft's own rotation, and a stub that
// returned junk here would let a broken orientation through the whole suite.
class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { Object.assign(this, { x, y, z, w }); }
  static RotationYawPitchRoll(yaw, pitch, roll) {
    if ([yaw, pitch, roll].some((v) => !Number.isFinite(v))) {
      throw new Error('NaN in rotation: ' + [yaw, pitch, roll]);
    }
    const hr = roll * 0.5, hp = pitch * 0.5, hy = yaw * 0.5;
    const sr = Math.sin(hr), cr = Math.cos(hr);
    const sp = Math.sin(hp), cp = Math.cos(hp);
    const sy = Math.sin(hy), cy = Math.cos(hy);
    return new Quaternion(
      cy * sp * cr + sy * cp * sr,
      sy * cp * cr - cy * sp * sr,
      cy * cp * sr - sy * sp * cr,
      cy * cp * cr + sy * sp * sr);
  }
  multiplyToRef(q, out) {
    const x = this.x * q.w + this.w * q.x + this.y * q.z - this.z * q.y;
    const y = this.y * q.w + this.w * q.y + this.z * q.x - this.x * q.z;
    const z = this.z * q.w + this.w * q.z + this.x * q.y - this.y * q.x;
    const w = this.w * q.w - (this.x * q.x + this.y * q.y + this.z * q.z);
    out.x = x; out.y = y; out.z = z; out.w = w;
    if (![x, y, z, w].every(Number.isFinite)) throw new Error('NaN in quaternion product');
    return out;
  }
  static FromRotationMatrixToRef(m, out) {
    const d = m.m;
    const tr = d[0] + d[5] + d[10];
    if (tr > 0) {
      const s = 0.5 / Math.sqrt(tr + 1);
      out.w = 0.25 / s;
      out.x = (d[6] - d[9]) * s; out.y = (d[8] - d[2]) * s; out.z = (d[1] - d[4]) * s;
    } else if (d[0] > d[5] && d[0] > d[10]) {
      const s = 2 * Math.sqrt(1 + d[0] - d[5] - d[10]);
      out.w = (d[6] - d[9]) / s;
      out.x = 0.25 * s; out.y = (d[1] + d[4]) / s; out.z = (d[8] + d[2]) / s;
    } else if (d[5] > d[10]) {
      const s = 2 * Math.sqrt(1 + d[5] - d[0] - d[10]);
      out.w = (d[8] - d[2]) / s;
      out.x = (d[1] + d[4]) / s; out.y = 0.25 * s; out.z = (d[6] + d[9]) / s;
    } else {
      const s = 2 * Math.sqrt(1 + d[10] - d[0] - d[5]);
      out.w = (d[1] - d[4]) / s;
      out.x = (d[8] + d[2]) / s; out.y = (d[6] + d[9]) / s; out.z = 0.25 * s;
    }
    if (![out.x, out.y, out.z, out.w].every(Number.isFinite)) {
      throw new Error('NaN from rotation matrix');
    }
    return out;
  }
}

class Matrix {
  constructor() { this.m = new Float64Array(16); }
  static Identity() {
    const m = new Matrix();
    m.m[0] = m.m[5] = m.m[10] = m.m[15] = 1;
    return m;
  }
  static FromValuesToRef(...args) {
    const out = args[16];
    for (let i = 0; i < 16; i++) out.m[i] = args[i];
    return out;
  }
}

let idc = 0;
class Node {
  constructor(name, scene) {
    this.name = name; this.id = ++idc;
    this.position = new Vector3();
    this.rotation = new Vector3();
    this.scaling = new Vector3(1, 1, 1);
    this.rotationQuaternion = null;
    this.parent = null;
    this.enabled = true;
    this.metadata = null;
    this.visibility = 1;
    this.disposed = false;
    if (scene && scene._nodes) scene._nodes.push(this);
  }
  setEnabled(v) { this.enabled = v; }
  isEnabled() { return this.enabled; }
  dispose() { this.disposed = true; }
  getChildMeshes() { return []; }
  freezeWorldMatrix() {}
  /* No-ops, because this stub has no transform hierarchy to recompute. They
     exist because game code legitimately calls them on a node it has just
     re-parented, and a missing method here reads as a crash in gameplay code
     rather than as a hole in the shim. */
  computeWorldMatrix() { return this.getWorldMatrix(); }
  markAsDirty() { return this; }
  getWorldMatrix() { return {}; }
  clone(name) { const n = new Mesh(name); n._vd = this._vd; return n; }
}
class TransformNode extends Node {}
class AbstractMesh extends Node {}
class Mesh extends Node {
  getVerticesData(kind) { return this._vd && this._vd[kind]; }
  setVerticesData(kind, data) { (this._vd = this._vd || {})[kind] = data; }
  updateVerticesData(kind, data) { (this._vd = this._vd || {})[kind] = data; }
  /* Enough of the real thing for colony.consolidate(): the sources become one
     mesh and are disposed. Transforms are not baked — the stub has no world
     matrices — so this is a concatenation, which is all the headless checks
     read (counts and disposal, never placement). */
  static MergeMeshes(meshes, disposeSource) {
    const m = new Mesh('merged');
    m._vd = { position: [], normal: [], color: [] };
    for (const src of meshes) {
      const vd = src._vd || {};
      for (const k of ['position', 'normal', 'color']) {
        if (vd[k]) m._vd[k] = m._vd[k].concat(Array.from(vd[k]));
      }
      if (disposeSource) src.dispose();
    }
    m.vertexCount = m._vd.position.length / 3;
    return m;
  }
}

export const opts = { validate: true };

class VertexData {
  applyToMesh(mesh) {
    if (!opts.validate) {
      mesh._vd = { position: this.positions, normal: this.normals, color: this.colors };
      mesh.vertexCount = this.positions ? this.positions.length / 3 : 0;
      return;
    }
    for (const arr of [this.positions, this.normals]) {
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        if (!Number.isFinite(arr[i])) throw new Error('non-finite vertex value at ' + i);
      }
    }
    // Indices may be a soup (one per vertex) or a real index buffer. Either
    // way every index has to point at a vertex that exists.
    if (this.positions && this.indices) {
      const n = this.positions.length / 3;
      for (let i = 0; i < this.indices.length; i++) {
        const v = this.indices[i];
        if (!Number.isInteger(v) || v < 0 || v >= n) {
          throw new Error('index ' + v + ' out of range (' + n + ' vertices)');
        }
      }
    }
    if (this.colors && this.positions &&
        this.colors.length / 4 !== this.positions.length / 3) {
      throw new Error('colour/vertex count mismatch: ' +
        (this.colors.length / 4) + ' vs ' + (this.positions.length / 3));
    }
    mesh._vd = { position: this.positions, normal: this.normals, color: this.colors };
    mesh.vertexCount = this.positions ? this.positions.length / 3 : 0;
  }
}

const MeshBuilder = {
  CreateGround(name, o, scene) {
    const m = new Mesh(name, scene);
    const sub = o.subdivisions, w = o.width, h = o.height;
    const pos = [];
    for (let j = 0; j <= sub; j++) {
      for (let i = 0; i <= sub; i++) {
        pos.push(-w / 2 + (i / sub) * w, 0, -h / 2 + (j / sub) * h);
      }
    }
    m._vd = { position: pos };
    return m;
  },
  CreateTorus(n, o, s) { return new Mesh(n, s); },
  CreateSphere(n, o, s) { return new Mesh(n, s); },
  CreatePolyhedron(n, o, s) { return new Mesh(n, s); },
  CreateCylinder(n, o, s) { return new Mesh(n, s); },
};

class Material {
  constructor(name) { this.name = name; }
  setVector3() {} setVector2() {} setVector4() {} setFloat() {} setFloats() {}
  setColor3() {} setColor4() {} setInt() {} setMatrix() {} setTexture() {}
  setArray3() {} setArray4() {}
  getEffect() { return null; }
  clone(n) { const m = new Material(n); return m; }
}
class StandardMaterial extends Material {}
class ShaderMaterial extends Material {}
class ParticleSystem {
  constructor() { this.emitRate = 0; }
  start() {} stop() {}
  static BLENDMODE_STANDARD = 0;
}
class TrailMesh extends Mesh {}
class GlowLayer { constructor() { this.intensity = 1; this.included = []; }
  addIncludedOnlyMesh(m) { this.included.push(m); } }
class DynamicTexture {
  constructor() {}
  getContext() {
    return {
      createRadialGradient: () => ({ addColorStop() {} }),
      fillRect() {}, set fillStyle(v) {},
    };
  }
  update() {}
}
/* TEXTURES. Nothing here samples anything — the suite has no GPU and no image
   decoder. What these exist for is CONSTRUCTION: shadows.js, seabed.js,
   preview.js and materials.js all build real texture objects on the way to
   building a World, and a World is what the "one world visible at a time"
   assertion needs. They hold the fields those files write back and read, and
   nothing else. */
class Texture {
  constructor(url, scene) { this.url = url; this.scene = scene; }
  static NEAREST_SAMPLINGMODE = 1;
  static BILINEAR_SAMPLINGMODE = 2;
  static TRILINEAR_SAMPLINGMODE = 3;
  static WRAP_ADDRESSMODE = 1;
  static CLAMP_ADDRESSMODE = 0;
  static MIRROR_ADDRESSMODE = 2;
  dispose() {}
}
class RawTexture extends Texture {
  static CreateRGBATexture(data, w, h, scene) {
    const t = new RawTexture(null, scene);
    Object.assign(t, { data, width: w, height: h });
    return t;
  }
  // preview.js writes its rows one at a time and pushes each one up.
  update(data) { this.data = data; }
}
class RenderTargetTexture extends Texture {
  constructor(name, size, scene) {
    super(null, scene);
    this.name = name;
    this.size = size;
    this.renderList = [];
    this.renderParticles = false;
    this.refreshRate = 1;
    this.onBeforeRenderObservable = { add() {} };
    this.onAfterRenderObservable = { add() {} };
    this.onClearObservable = { add() {} };
  }
  static REFRESHRATE_RENDER_ONEVERYFRAME = 1;
  updateSamplingMode() {}
  resize() {}
  getSize() { const n = typeof this.size === 'number' ? this.size : (this.size && this.size.width) || 1;
    const h = typeof this.size === 'number' ? this.size : (this.size && this.size.height) || 1;
    return { width: n, height: h }; }
}
class Camera extends Node {
  static ORTHOGRAPHIC_CAMERA = 1;
  static PERSPECTIVE_CAMERA = 0;
  setTarget() {}
  getViewMatrix() { return Matrix.Identity(); }
  getProjectionMatrix() { return Matrix.Identity(); }
}
class TargetCamera extends Camera {}
class UniversalCamera extends Camera {}

const Constants = {
  TEXTURETYPE_FLOAT: 1,
  TEXTURETYPE_HALF_FLOAT: 2,
  TEXTURETYPE_UNSIGNED_BYTE: 0,
};

class Scene {
  constructor(engine) {
    this._nodes = [];
    this.meshes = this._nodes;          // one array: the stub has only meshes
    this.customRenderTargets = [];
    this.particleSystems = [];
    this.overrideMaterial = null;
    this._engine = engine || new Engine();
  }
  getEngine() { return this._engine; }
  removeCamera() {}
  render() {}
}
class Engine {
  constructor() {}
  runRenderLoop() {} resize() {} getDeltaTime() { return 16; }
  setHardwareScalingLevel() {}
  getRenderWidth() { return 1280; }
  getRenderHeight() { return 720; }
  /* Both float paths reported unsupported, which is the CONSERVATIVE answer:
     shadows.js and seabed.js each fall back to a lower texture type rather
     than skipping construction, so the code under test still runs. */
  getCaps() {
    return {
      textureFloatRender: false, textureHalfFloatRender: false,
      textureFloat: false, textureHalfFloat: false,
      textureFloatLinearFiltering: false, textureHalfFloatLinearFiltering: false,
      maxTextureSize: 4096,
    };
  }
}

export const BABYLON = {
  Vector3, Vector2, Vector4, Color3, Color4, Quaternion, Matrix,
  Node, TransformNode, AbstractMesh, Mesh, VertexData, MeshBuilder,
  Material, StandardMaterial, ShaderMaterial, ParticleSystem, TrailMesh,
  GlowLayer, DynamicTexture, Scene, Engine,
  Texture, RawTexture, RenderTargetTexture,
  Camera, TargetCamera, UniversalCamera, Constants,
  VertexBuffer: { PositionKind: 'position' },
  Effect: { ShadersStore: {} },
};
