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
