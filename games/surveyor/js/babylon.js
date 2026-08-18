/**
 * Single point of contact with the Babylon namespace, for the transplanted
 * render stack.
 *
 * Everything Surveyor wrote itself reaches for the `BABYLON` global directly —
 * that is the house style here and it is not changing. This file exists for
 * `js/render/`, which came from the lookdev testbed with one rule: those modules
 * import only from themselves and from this file, so nothing in them has a hard
 * edge to either project. Keeping the shim means the next transplant (lighting,
 * materials, sky) drops in without a single edited import line.
 *
 * The vendored UMD build (vendor/babylon.js, pinned 9.21.2) attaches itself to
 * globalThis.BABYLON before the module graph loads — see the two script tags at
 * the bottom of index.html, and note their order is load-bearing.
 */

const BABYLON = globalThis.BABYLON;

if (!BABYLON) {
  throw new Error(
    '[surveyor] BABYLON global missing. vendor/babylon.js must load before the ' +
    'module graph (see index.html).'
  );
}

export default BABYLON;
export const B = BABYLON;
