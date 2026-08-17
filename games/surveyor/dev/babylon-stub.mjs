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
  static Distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  static Cross(a, b) {
    return new Vector3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }
}
class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } }
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
  dispose() { this.disposed = true; }
  getChildMeshes() { return []; }
  freezeWorldMatrix() {}
  getWorldMatrix() { return {}; }
  clone(name) { const n = new Mesh(name); n._vd = this._vd; return n; }
}
class TransformNode extends Node {}
class AbstractMesh extends Node {}
class Mesh extends Node {
  getVerticesData(kind) { return this._vd && this._vd[kind]; }
  setVerticesData(kind, data) { (this._vd = this._vd || {})[kind] = data; }
  updateVerticesData(kind, data) { (this._vd = this._vd || {})[kind] = data; }
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
  setVector3() {} setVector2() {} setFloat() {} setColor3() {}
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
class Scene {
  constructor() { this._nodes = []; }
  render() {}
}
class Engine {
  constructor() {}
  runRenderLoop() {} resize() {} getDeltaTime() { return 16; }
  setHardwareScalingLevel() {}
}

export const BABYLON = {
  Vector3, Vector2, Color3, Color4, Quaternion, Matrix,
  Node, TransformNode, AbstractMesh, Mesh, VertexData, MeshBuilder,
  Material, StandardMaterial, ShaderMaterial, ParticleSystem, TrailMesh,
  GlowLayer, DynamicTexture, Scene, Engine,
  VertexBuffer: { PositionKind: 'position' },
  Effect: { ShadersStore: {} },
};
