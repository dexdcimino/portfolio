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
   inside the one-line `<!-- img ... -->` directive. Order in the markup is the
   order on the page.
3. Commit. The pre-commit hook bakes the derivatives and fills in the
   `<picture>` block.

That is all. The thumbnail strip, the download button and the lightbox are built
from the figures at runtime, so **nothing counts the wallpapers by hand** —
adding a sixth needs no CSS or JS edit.

## How the strip behaves

- **One row, always.** Five to a page; past that the next page slides in rather
  than wrapping to a second row. The page follows the selection, so the arrows
  carry the strip along and it needs no control of its own.
- Narrower screens drop to fewer per page instead of shrinking the thumbnails
  below the point where they read.
- **Hovering a thumbnail shows that piece in the hero** without selecting it, and
  leaving puts the selected one back. The title, resolution and download all
  follow what is on screen, so the button can never hand over a different file
  from the one you are looking at.
- Because of that hover, the hero-sized files are fetched once when the tab is
  first opened (`.wp-preload`), which is what makes the swap instant.

## Why the files look like this

- **The masters are what people download.** The download button serves the PNG
  here, which is the one place on the site that hands over a raw master rather
  than a derivative — the whole point of the tab is giving you the original, and
  re-encoding it would defeat that.
- **The page never shows a master.** The carousel and the lightbox both use
  baked AVIF/WebP off the `wallpaper` ladder in `tools/image_slots.py`
  (1920/1280/900/600). The top rung exists for the lightbox at 90vw, not for the
  card. **2560 was dropped on 2026-08-17** — see below.
- **One picture, two sizes.** Thumbnails are the same `<picture>` cloned with a
  `120px` `sizes`, and the lightbox is the same one cloned with `90vw`. That is
  why there is no separate thumbnail master and no second slot.

## Weight

The five pieces here are real art and painted, so they compress nothing like the
gradient placeholders they replaced. At the rung the carousel actually serves
(900 on a normal desktop) everything is 20–60 KB, well inside the site's
150 KB-per-image budget.

**The 2560 rung is gone** (Dex, 2026-08-17). It was the worst offender at
225–280 KB for the three busiest pieces, and it only ever served the lightbox on
a 2560-wide display. Dropping it means such a display now upscales the 1920 file
by about 20% in that one opt-in view — far cheaper than the budget breach.

What remains over budget is the **1920** rung on Amphibious (163 KB), Slick
Anarchy (171 KB) and BASE Jump (198 KB), reached by the lightbox and by a Retina
desktop. That is a knowing exception, not an oversight: this is a tab whose whole
job is showing art at size. If it needs closing later, the lever is the encoder
quality for this role, not another rung — and that is a pipeline-wide setting
(`AVIF q=58 / WebP q=76`) that CLAUDE.md says not to change casually.
