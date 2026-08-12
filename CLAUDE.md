## Git workflow

- After completing any MD or task that changes files, commit and push
  automatically. Do not wait to be asked.
- Commit message: short imperative summary of what changed.
- Never commit if verification steps failed — report the failure instead.
- Never use `--no-verify`, and never force-push.
- If the working tree has unrelated changes the user made by hand, mention them
  rather than sweeping them into the commit.

## Work overlay is a MOCKUP (do not mistake it for finished)

- The Work overlay ships with **generated filler images**, not artwork: SVG data
  URIs built in the `TEMPORARY MOCKUP DATA` block at the bottom of `script.js`.
  There is no `work.json`, nothing in `assets/media/`, and no real asset was
  added for it. The `FILLER — NOT REAL WORK` stamp on each image is deliberate.
- The categories, titles, tool/year lines and counts are placeholders, **not a
  settled taxonomy**. Do not build on them as if they were.
- Everything after that block is data-shape-agnostic: it renders a list of
  `{title, desc, src, w, h}` and does not care where the list came from. The
  real build replaces one block with `work.json` plus baked derivatives — the
  tab row, filmstrip, hero and caption need no changes.
- The hero is a **fixed 3:2 box** (the frame itself on phones) and images
  letterbox into it with `object-fit:contain`. Do not make the box track each
  image's aspect ratio: that is what makes the caption and filmstrip jump on
  every arrow press.

## Image pipeline (do not regress)

- `assets/` = masters (only copy of some art). `assets/derived/` = generated;
  `tools/bake_images.py` is the sole writer. Never hand-edit `assets/derived/`.
- Derived output **mirrors the master's subfolder** (`assets/mascots/x.png` ->
  `assets/derived/mascots/x-900.avif`), so stems only need to be unique within a
  folder. This is what keeps per-project media folders collision-free — do not
  flatten it back.
- New image? Run `python tools/bake_images.py` before shipping. AVIF q=58,
  WebP q=76/method=6 — validated at 100% crop, do not raise "to be safe".
- Raw PNG/JPG is only ever the final `<picture>` fallback, never the served image.
- Every raster `<img>` needs intrinsic `width`/`height` (source pixels) to
  prevent layout shift.
- Hero mascot: `fetchpriority="high"`, preloaded in `<head>`, **never**
  `loading="lazy"`. It is the LCP element.
- Below the fold: `loading="lazy"` + `decoding="async"`.
- `sizes` must match the real rendered slot, or the browser over-fetches and the
  optimisation is wasted.
- Budget: no single image over 150 KB on the wire; hero LCP < 1.2 s on cold 4G.
- Video is not self-hosted — external streaming host only.
- `assets/derived/` is served `immutable` for a year via `vercel.json`.
- **Any session touching images must run `python tools/bake_images.py --check`
  before declaring work complete. A non-zero exit is a blocking failure.**
- Discovery is **repo-wide**: the baker walks everything and compresses any
  `.png/.jpg/.jpeg` outside `derived/`, `_resources/`, `games/`, `.git/`,
  `node_modules/`, `.vercel/`. There is no `SOURCES` manifest — do not
  reintroduce one.
- `games/` is skipped **on purpose**: playable builds ship their own optimised
  textures, and baking them would write six widths of derivatives nothing
  references. Do not remove it from `SKIP_DIRS` — see `games/README.md` for the
  full folder contract.
- Standard ladder 1600/1200/900/600/400/200, minus widths above the source.
  `WIDTH_OVERRIDES` is the escape hatch and should stay near-empty.
- New masters: drop the file anywhere and commit; the hook bakes and stages
  derivatives. New machine needs `python tools/bake_images.py --install-hooks` once.
  The hook is convenience (skippable via `--no-verify`, absent on fresh clones);
  `--check` is the actual guarantee.
- Accent swaps retint the `<source>` srcsets, not just `img.src` — changing
  `src` alone does nothing inside a `<picture>`.
