# AI wallpapers

Masters for the **Wallpapers** tab in the AI Lab section. Drop full-size art
here; everything on the page is generated from it.

```
assets/ai/wallpapers/<slug>.png          the master  (2560x1600)
assets/derived/ai/wallpapers/<slug>-*.avif|webp   generated, never hand-made
```

## Adding one

1. Export at **2560x1600** and save it here as `<slug>.png` — lowercase, hyphens,
   no spaces. The slug is only an identity on disk; the name shown on the page
   comes from step 2.
2. Copy a `<figure class="wp-item">` in the Wallpapers panel of `index.html` and
   change three things — `data-title`, `data-file`, and the `src` and `alt`
   inside the one-line `<!-- img ... -->` directive.
3. Commit. The pre-commit hook bakes the derivatives and fills in the
   `<picture>` block.

That is all. The `x / y` counter, the thumbnail strip, the download button and
the lightbox are built from the figures at runtime, so **nothing counts the
wallpapers by hand** — adding a sixth needs no CSS or JS edit.

## Why the files look like this

- **The masters are what people download.** The download button links straight
  to the PNG here, which is the one place on the site that serves a raw master
  rather than a derivative — the whole point of the tab is handing over the
  original, and re-encoding it would defeat that.
- **The page never shows a master.** The carousel and the lightbox both use
  baked AVIF/WebP off the `wallpaper` ladder in `tools/image_slots.py`
  (2560/1920/1280/900/600). The top rung exists for the lightbox at 90vw, not
  for the card.
- **One picture, two sizes.** Thumbnails are the same `<picture>` cloned with a
  `120px` `sizes`, and the lightbox is the same one cloned with `90vw`. That is
  why there is no separate thumbnail master and no second slot.

## Current contents are PLACEHOLDERS

The five pieces here are generated gradient studies, each stamped
`PLACEHOLDER · <NAME>` in the corner. They exist so the carousel can be built
and reviewed against something real-sized. Delete them as actual art arrives —
they are not work, and the stamp is deliberate so they cannot be mistaken for it.

Real wallpapers will be photographic rather than smooth gradients, so expect
their derivatives to be much larger than these (these compress to ~10 KB at
2560 because a gradient is nearly free). Check the top rung against the site's
150 KB-per-image budget when the first real one lands.
