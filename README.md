# Dex Portfolio — V31

Clean, static HTML/CSS/JS portfolio. No dependencies.

## Run
Double-clicking `index.html` works. A local server also works:

```bash
python -m http.server 8000
```

## Structure

```text
/
├── index.html
├── styles.css
├── script.js
├── README.md
├── CHANGELOG.md
├── tools/
│   └── bake_icons.py   (regenerates the icon block in styles.css)
└── assets/
    ├── icons/          (UI + nav icons, social/ subfolder — masters for baking)
    ├── images/         (photos, featured work)
    ├── logos/          (DEX.svg, CIMINO.svg)
    └── mascots/        (theme-colored mascot variants)
```

## How theming works
The accent system is one CSS variable: `--accent`. Every accent-tinted graphic is a
CSS **mask** — the SVG provides the shape, `background-color` provides the color.
That means:

- Colors are always the exact accent hex (no filter approximation).
- Theme switches crossfade smoothly (`background-color` transitions cleanly; filter
  chains do not — that was the old "flash" bug).
- The `fill` color inside icon/logo SVG files does not matter; only the shape does.

Mask shapes are **baked into `styles.css` as `data:` URIs** (the `GENERATED ICONS`
block). This is required: browsers fetch `mask-image` with CORS enforced, so external
mask URLs silently fail when the site is opened via `file://` (double-click).

## Editing artwork
- **Mascots, photos, DEX.svg** — replace the file at the same path, refresh. Done.
- **Icons and CIMINO.svg** — the files in `assets/` are the editable masters.
  After editing or replacing one, run:

  ```bash
  python tools/bake_icons.py
  ```

  then refresh. To add a new icon: drop the SVG in `assets/icons/`, add one line to
  `MANIFEST` in `tools/bake_icons.py`, run it, and use
  `<span class="icon" data-icon="name"></span>` with a width/height.

## Theme mascot names

```text
mascot_red.png  mascot_yellow.png  mascot_limegreen.png  mascot_cyan.png
mascot_blue.png  mascot_purple.png  mascot_white.png
```

Keep these filenames stable so theme switching requires no code changes.

## Social links
The four social buttons (YouTube, Instagram, LinkedIn, GitHub) live at the bottom of
the sidebar in `index.html` — replace the `#` hrefs with real profile URLs.

## Image pipeline

`assets/` holds **masters** — hand-authored art, the only copy of some of it.
`assets/derived/` holds **generated output**; `tools/bake_images.py` is the only
thing that writes there. Delete the folder and one run rebuilds it exactly.

Any new image must be run through the baker before it ships:

```
python tools/bake_images.py
```

It emits AVIF (`quality=58`) and WebP (`quality=76, method=6`) at the widths
declared in `SOURCES`, skipping anything already newer than its master. Those
settings were validated against the source art at 100% crop — they are visually
lossless on this material, so don't raise them.

Rules:

- Raw PNG/JPG is **never referenced directly** except as the final `<picture>`
  fallback. Every raster image on the page is a `<picture>` with AVIF, then
  WebP, then the master.
- Every raster `<img>` carries intrinsic `width`/`height` (source pixel
  dimensions, not CSS size) so the layout never shifts as images arrive.
- The hero mascot is `fetchpriority="high"`, is preloaded in `<head>`, and must
  **never** be lazy-loaded — it is the largest contentful paint.
- Everything below the fold keeps `loading="lazy"` and `decoding="async"`.
- Get `sizes` right per slot. A wrong `sizes` makes the browser pick a width far
  larger than it renders, which throws away the whole exercise.
- **Budget: no single image over 150 KB on the wire**, hero LCP under 1.2 s on a
  cold 4G load.
- Video is **not** self-hosted — it goes to an external streaming host.

### Adding new art

Drop masters into `assets/` and commit normally — the pre-commit hook bakes the
derivatives and stages them into the same commit as the art that produced them.
It stays silent on commits that touch no raster masters.

One-time setup on a new machine (`.git/hooks/` is not tracked by git):

```
python tools/bake_images.py --install-hooks
```

To verify by hand at any point:

```
python tools/bake_images.py --check      # exit 0 = current, exit 1 = stale/missing
```

The hook is convenience, not a guarantee — it can be skipped with `--no-verify`
and a fresh clone has none until installed. `--check` is the guarantee; treat a
non-zero exit as a blocking failure. Budget is unchanged: **no image over
150 KB on the wire**.

`assets/derived/` is served with `Cache-Control: immutable` for a year
(`vercel.json`). Derivatives are content-addressed by width and never mutate in
place, so a changed image means a new filename, not a new body at the same URL.
