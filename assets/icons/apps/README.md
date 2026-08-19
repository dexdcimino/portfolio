# App icons — one folder, every app

The square product mark for anything that gets an `.ai-card` in the AI Lab, or
a card anywhere else on the site. **Drop new app icons here**, not beside the
app and not in a per-section folder — one place is the point.

```
assets/icons/apps/<slug>.svg    vector source, when there is one
assets/icons/apps/<slug>.png    512px master — what the pipeline bakes
```

## The contract

- **The PNG is the master the site serves.** `tools/bake_images.py` finds it
  the same way it finds every other master (discovery is repo-wide) and bakes
  the widths the `ai-icon` slot asks for: 420 / 200 / 84. Reference it from a
  one-line `<!-- img ... slot="ai-icon" -->` directive and let
  `tools/bake_markup.py` write the `<picture>`.
- **512px, square.** The slot renders at 84 CSS px, so 420 is the widest rung
  that can ever be selected; 512 leaves headroom and matches what the other
  icons already are. A 128px marketplace icon is NOT enough — widths above the
  source are skipped, so it would bake one soft 84 and nothing else.
- **The SVG is a source, not a served file.** Nothing links to it. It exists so
  the PNG can be re-rendered at any size without hunting for the original:

      node <scratch>/rasterize.mjs games/surveyor/dev/cdp.mjs \
           assets/icons/apps/<slug>.svg assets/icons/apps/<slug>.png 512

  Keep it when the app has one. An icon that only ever existed as a raster just
  has no `.svg` here.
- **These are NOT mask icons.** `tools/bake_icons.py` bakes every SVG under
  `assets/icons/` into `styles.css` as a `mask-image`, which paints every filled
  region a single colour — an app mark would flatten to a rounded square. This
  folder is in that script's `NOT_MASKS` set for the same reason `software/`
  is. Do not remove it.

`assets/icons/` (flat) is the UI icon set — single-colour glyphs that ARE
masks. `assets/icons/social/` is the same for social marks. `software/` is
third-party product logos in the Toolkit. This folder is our own products.
