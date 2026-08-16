// core/pool.js — generic object pooling. Pooling is mandatory for anything
// spawned repeatedly (foods, enemies, FX, chunk meshes) — TECH.md perf budget.

// create() makes a fresh object; reset(obj, ...args) re-initializes one on acquire.
export function createPool(create, reset) {
  const free = [];
  return {
    acquire(...args) {
      const obj = free.length > 0 ? free.pop() : create();
      if (reset) reset(obj, ...args);
      return obj;
    },
    release(obj) {
      free.push(obj);
    },
    get size() {
      return free.length;
    },
  };
}
