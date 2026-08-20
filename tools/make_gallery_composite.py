#!/usr/bin/env python3
"""Build a multi-panel gallery master out of several source images.

    python tools/make_gallery_composite.py --preset chomp-progress

WHY THIS EXISTS RATHER THAN A ONE-OFF MERGE. `assets/gallery/themedock-panel.png`
— the precedent this follows — was merged by hand and the merge was not kept, so
re-exporting one of its four source panels means reconstructing the whole layout
from a commit message. A composite is a DERIVED image whose sources still exist;
the only honest place for the recipe is a file next to them.

It is deliberately NOT part of `bake_images.py`. That tool owns
`assets/derived/` and is the sole writer there; this one writes a MASTER into
`assets/gallery/`, which the baker then treats like any other master and bakes
derivatives from. Two tools, one direction, no shared state — and running this
twice with the same sources produces the same bytes, so a re-run is a no-op that
the `?v=` stamp will not even notice.

LAYOUT. A row is right for tall panels and wrong for wide ones. ThemeDock's
sources are 444x1556 VS Code sidebars, so four across gave each one a third of
the frame's height to be readable in. Chomp's are 16:9-ish gameplay frames, and
six of those across a 1920 master is 320px per panel — a narrow vertical slice
through a landscape composition, which throws away the thing each frame is of.
Hence `grid`: rows x columns, read left-to-right then top-to-bottom, which is
the order anything in English is read in and therefore the order a progress
sequence has to be laid out in.

The gutter and the background are `#0b0f12` because that is `.gal-stage`'s own
background in styles.css. The composite is 16:9 and the stage is 1440x690, so it
letterboxes — and a letterbox in the stage's own colour is invisible, which is
the whole reason the number is copied here rather than chosen.
"""

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit('needs Pillow: python -m pip install pillow')

ROOT = Path(__file__).resolve().parent.parent

# The gallery stage's own background (styles.css `.gal-stage`). Gutters and any
# letterbox are drawn in it so both disappear into the frame.
STAGE_BG = (0x0B, 0x0F, 0x12)

# Every gallery master on this site is 1920x1080; the stage contains rather than
# crops, so the shape is the site's convention and not this tool's opinion.
OUT_W, OUT_H = 1920, 1080
GUTTER = 6

PRESETS = {
    # The Chomp development sequence, six frames Dex kept while building it.
    # Six wide frames want 3x2, not 6x1 — see the LAYOUT note above.
    'chomp-progress': {
        'sources': [
            'CHOMP PROGRESS PICS/1.png',
            'CHOMP PROGRESS PICS/2.png',
            'CHOMP PROGRESS PICS/3.png',
            'CHOMP PROGRESS PICS/4.png',
            'CHOMP PROGRESS PICS/5.png',
            'CHOMP PROGRESS PICS/6.png',
        ],
        'from': 'desktop',
        'grid': (2, 3),           # rows, cols
        'out': 'assets/gallery/chomp-progress.png',
    },

    # Stickland's four-up: the same character four times, each panel differing
    # in BOTH build and weapon. Composed rather than captured — there is no
    # moment in the game where four differently-dressed players stand together
    # — so the four frames come out of dev/gallery.mjs, one boot each, seeded
    # with a different cosmetics/hotbar pair.
    #
    # 2x2 rather than 4x1. The sources are 16:9 gameplay frames: four across a
    # 1920 master is 480x1080 each, a tall slot through a wide picture, and the
    # figure would be cropped out of three of them. 2x2 gives every panel
    # 957x537, which is the same shape as the source and keeps the whole frame.
    'stickland-fourup': {
        'sources': [
            'games/stickland/dev/shots/gallery/four-up-cosmetics-and-weapons--slim-bow.png',
            'games/stickland/dev/shots/gallery/four-up-cosmetics-and-weapons--armor-smg.png',
            'games/stickland/dev/shots/gallery/four-up-cosmetics-and-weapons--robe-rocket.png',
            'games/stickland/dev/shots/gallery/four-up-cosmetics-and-weapons--coat-board.png',
        ],
        'from': 'repo',
        'grid': (2, 2),
        'out': 'assets/gallery/stickland-fourup.png',
        # CROP, DO NOT SCALE. The first build used the same cover() every
        # other preset uses, which scales a 1920x1080 frame down to fill a
        # 957x537 cell — halving the figure in a shot whose entire subject IS
        # the figure. What came back was four panels of mostly black with a
        # stick figure about thirty pixels tall in each, and no way to tell a
        # top hat from a viking helmet.
        # A 1:1 crop takes the cell straight out of the source at native
        # resolution, so the figure keeps every pixel the game drew and is
        # twice the share of the panel it was. The centre comes from the
        # sidecar the harness writes — the character is a DOM overlay, so its
        # on-screen box is known exactly rather than reconstructed from the
        # camera transform.
        'crop_around': 'games/stickland/dev/shots/gallery/fourup-boxes.json',
        'crop_keys': ['slim-bow', 'armor-smg', 'robe-rocket', 'coat-board'],
        # CROP AT 1:1 OUT OF A 3x CAPTURE, which is the only way this panel
        # is both tight and sharp. The game caps its own camera at
        # _ZOOM_MAX = 1.5 and the figure is 36x60 CSS pixels there, so a 1:1
        # crop of a 1920x1080 frame leaves it eleven per cent of the panel —
        # four builds that are technically distinguishable and that nobody
        # would distinguish. Upscaling that crop 2.4x fixed the size and cost
        # the edges: line art three pixels wide went soft, which is the one
        # thing line art cannot afford.
        # So dev/gallery.mjs captures these four at deviceScaleFactor 3. The
        # character is an SVG overlay, so it re-rasterises at the higher ratio
        # and comes back 108x180 in REAL pixels; cropping 957x537 straight out
        # of that puts the figure at a third of the panel with nothing
        # interpolated. `dpr` in the sidecar converts the CSS-pixel box the
        # browser reported into the device pixels the screenshot is in.
        'crop_zoom': 1.0,
    },
}

# `from: desktop` sources are Dex's own working files, outside the repo on
# purpose: they are inputs to a build, not site assets, and copying six PNGs in
# to generate one would leave six masters nothing references. The path is asked
# for rather than guessed at.
DESKTOP = Path.home() / 'OneDrive' / 'Desktop'


def cover(img, w, h):
    """Scale to fill w x h and centre-crop the overflow.

    Cover rather than contain: a contained panel leaves bars INSIDE the cell,
    and six cells of bars reads as a broken grid rather than as six pictures.
    Every source here has its subject near the middle, so the crop takes sky
    and floor off the long axis and nothing that carries the frame.
    """
    src_w, src_h = img.size
    scale = max(w / src_w, h / src_h)
    new = (max(1, round(src_w * scale)), max(1, round(src_h * scale)))
    img = img.resize(new, Image.LANCZOS)
    left = (new[0] - w) // 2
    top = (new[1] - h) // 2
    return img.crop((left, top, left + w, top + h))


def crop_at(img, w, h, cx, cy):
    """A w x h window out of `img` centred on (cx, cy), at native resolution.

    Clamped to the image, so a figure near an edge yields the nearest full-size
    window rather than a padded one — a black bar down the side of one panel
    would read as a broken merge rather than as a crop.
    """
    left = max(0, min(img.width - w, cx - w // 2))
    top = max(0, min(img.height - h, cy - h // 2))
    return img.crop((left, top, left + w, top + h))


def build(preset_name, preset, dry_run=False):
    rows, cols = preset['grid']
    sources = preset['sources']
    if len(sources) != rows * cols:
        sys.exit(f'{preset_name}: grid is {rows}x{cols} but {len(sources)} sources given')

    base = DESKTOP if preset.get('from') == 'desktop' else ROOT
    paths = [base / s for s in sources]
    missing = [p for p in paths if not p.exists()]
    if missing:
        sys.exit('missing source(s):\n  ' + '\n  '.join(str(p) for p in missing))

    cell_w = (OUT_W - GUTTER * (cols - 1)) // cols
    cell_h = (OUT_H - GUTTER * (rows - 1)) // rows
    # Whatever integer division dropped goes back into the last row/column, so
    # the composite reaches the edge instead of leaving a one-pixel seam.
    last_w = OUT_W - (cell_w + GUTTER) * (cols - 1)
    last_h = OUT_H - (cell_h + GUTTER) * (rows - 1)

    boxes = None
    if preset.get('crop_around'):
        import json
        bp = ROOT / preset['crop_around']
        if not bp.exists():
            sys.exit(f'{preset_name}: needs {bp} — run the game\'s dev/gallery.mjs first')
        boxes = json.loads(bp.read_text(encoding='utf-8'))

    canvas = Image.new('RGB', (OUT_W, OUT_H), STAGE_BG)
    for i, path in enumerate(paths):
        r, c = divmod(i, cols)
        w = last_w if c == cols - 1 else cell_w
        h = last_h if r == rows - 1 else cell_h
        x = c * (cell_w + GUTTER)
        y = r * (cell_h + GUTTER)
        with Image.open(path) as im:
            # RGBA sources composited onto the stage colour rather than
            # flattened onto white, which would put a bright halo around a
            # frame that is otherwise nearly black.
            im = im.convert('RGBA')
            flat = Image.new('RGB', im.size, STAGE_BG)
            flat.paste(im, mask=im.split()[3])
            if boxes is not None:
                key = preset['crop_keys'][i]
                b = boxes.get(key)
                if not b:
                    sys.exit(f'{preset_name}: no figure box for \'{key}\' in the sidecar')
                # Lifted a little: the crop centres on the figure's own middle,
                # which puts its feet and its hat equidistant from the edges and
                # leaves the hotbar out of frame.
                z = preset.get('crop_zoom', 1.0)
                # The box is CSS pixels; the capture is device pixels.
                r = b.get('dpr', 1)
                cw, ch = max(1, round(w / z)), max(1, round(h / z))
                # Lifted a little, so the figure's feet and its hat sit
                # equidistant from the edges and the hotbar stays out of frame.
                cell = crop_at(flat, cw, ch, round(b['x'] * r), round(b['y'] * r) - round(24 * r / z))
                if z != 1.0:
                    cell = cell.resize((w, h), Image.LANCZOS)
                note = (f"figure {b['w']}x{b['h']}css at {b['x']},{b['y']} dpr {r}"
                        + (f', crop {cw}x{ch}' + (f' up {z}x' if z != 1.0 else ' 1:1')))
            else:
                cell = cover(flat, w, h)
                note = 'cover'
            canvas.paste(cell, (x, y))
        print(f'  [{i + 1}] {path.name} -> {w}x{h} at ({x},{y})  [{note}]')

    out = ROOT / preset['out']
    if dry_run:
        print(f'(dry run) would write {out} at {OUT_W}x{OUT_H}')
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out, 'PNG', optimize=True)
    kb = out.stat().st_size / 1024
    print(f'wrote {out.relative_to(ROOT)}  {OUT_W}x{OUT_H}  {kb:.0f} KB')
    print('now run: python tools/bake_images.py && python tools/bake_markup.py')


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--preset', choices=sorted(PRESETS), required=True)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()
    print(f'{args.preset}:')
    build(args.preset, PRESETS[args.preset], args.dry_run)


if __name__ == '__main__':
    main()
