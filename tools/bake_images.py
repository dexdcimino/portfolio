#!/usr/bin/env python3
"""Bake responsive AVIF/WebP derivatives from the raster masters.

Layout rule: `assets/` holds MASTERS — the only copy of some of this art, hand
authored and never generated. `assets/derived/` holds GENERATED OUTPUT and this
script is the only thing that should ever write there. Nothing else reads or
writes that folder; delete it and a single run rebuilds it exactly.

Workflow: drop a new master into assets/mascots/ or assets/images/, add it to
SOURCES below if it needs a width set of its own, then run

    python tools/bake_images.py

and reference the results from a <picture> in index.html. The masters stay in
the markup as the final <img> fallback, never as the served image.

Encoder settings were validated against the source art at 100% crop. They are
already visually lossless on this material — raising them "to be safe" only
inflates the payload, so don't.
"""

from pathlib import Path
import sys

try:
    from PIL import Image, features
except ImportError:
    print("ERROR: Pillow is required — python -m pip install 'pillow>=11.3'", file=sys.stderr)
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parent.parent
DERIVED = ROOT / "assets" / "derived"

AVIF_OPTS = {"quality": 58}
WEBP_OPTS = {"quality": 76, "method": 6}

# glob (relative to assets/) -> widths, widest first
SOURCES = {
    "mascots/mascot_*.png":      (900, 600, 400),
    "mascots/lava_goblin.png":   (600, 400),
    "mascots/bone_archer.png":   (600, 400),
    "images/featured-*.png":     (800, 500),
    # profile.jpg fills two very different slots: the 42px sidebar avatar and
    # the ~420px About portrait. 200/84 cover the avatar; without 840/420 the
    # About photo would be upscaled from 200w and visibly soft even at 1x.
    "images/profile.jpg":        (840, 420, 200, 84),
}


def collect() -> list[tuple[Path, tuple[int, ...]]]:
    """Resolve globs to concrete masters. Later patterns win, so a specific
    filename can override a wildcard that would otherwise also match it."""
    found: dict[Path, tuple[int, ...]] = {}
    for pattern, widths in SOURCES.items():
        matches = sorted((ROOT / "assets").glob(pattern))
        if not matches:
            print(f"  warning: no master matched assets/{pattern}", file=sys.stderr)
        for path in matches:
            found[path] = widths
    return sorted(found.items())


def is_stale(src: Path, out: Path) -> bool:
    """Skip work when the derivative is already newer than its master."""
    return not out.exists() or out.stat().st_mtime <= src.stat().st_mtime


def bake(src: Path, widths: tuple[int, ...]) -> tuple[int, int, int]:
    """Return (bytes written, files written, files skipped) for one master."""
    with Image.open(src) as im:
        # Alpha is load-bearing on the mascots; only flatten mode P/LA oddities
        # up into something both encoders accept losslessly.
        im = im.convert("RGBA" if "A" in im.getbands() or im.mode == "P" else "RGB")
        source_width = im.width
        written = files = skipped = 0

        for width in widths:
            if width > source_width:      # never upscale — the master is the ceiling
                continue
            height = round(im.height * width / source_width)
            resized = im.resize((width, height), Image.LANCZOS)

            for ext, opts in (("avif", AVIF_OPTS), ("webp", WEBP_OPTS)):
                out = DERIVED / f"{src.stem}-{width}.{ext}"
                if not is_stale(src, out):
                    skipped += 1
                    written += out.stat().st_size
                    continue
                resized.save(out, **opts)
                written += out.stat().st_size
                files += 1

        return written, files, skipped


def main() -> int:
    if not features.check("avif"):
        print("ERROR: this Pillow has no AVIF encoder. Upgrade: "
              "python -m pip install 'pillow>=11.3'", file=sys.stderr)
        return 1

    DERIVED.mkdir(parents=True, exist_ok=True)
    masters = collect()
    if not masters:
        print("ERROR: no masters found under assets/", file=sys.stderr)
        return 1

    print(f"{'source':38s} {'master':>10s} {'derived':>10s} {'saved':>7s}  files")
    print("-" * 78)
    total_src = total_out = total_files = total_skip = 0

    for src, widths in masters:
        src_bytes = src.stat().st_size
        out_bytes, files, skipped = bake(src, widths)
        total_src += src_bytes
        total_out += out_bytes
        total_files += files
        total_skip += skipped
        saved = 100 * (1 - out_bytes / src_bytes) if src_bytes else 0
        note = f"{files} new" + (f", {skipped} cached" if skipped else "")
        print(f"{src.relative_to(ROOT).as_posix()[-38:]:38s} "
              f"{src_bytes/1024:9.0f}K {out_bytes/1024:9.0f}K {saved:6.1f}%  {note}")

    print("-" * 78)
    print(f"{'TOTAL':38s} {total_src/1024:9.0f}K {total_out/1024:9.0f}K "
          f"{100*(1-total_out/total_src):6.1f}%  {total_files} written, {total_skip} cached")
    print(f"\nDerivatives in {DERIVED.relative_to(ROOT).as_posix()}/ — "
          f"regenerate any time with: python tools/bake_images.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
