
## Image pipeline (do not regress)

- `assets/` = masters (only copy of some art). `assets/derived/` = generated;
  `tools/bake_images.py` is the sole writer. Never hand-edit `assets/derived/`.
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
- Accent swaps retint the `<source>` srcsets, not just `img.src` — changing
  `src` alone does nothing inside a `<picture>`.
