#!/usr/bin/env python3
"""Bake mask SVGs into styles.css as data: URIs.

Why: CSS mask-image is fetched with CORS enforced. When the site is opened via
file:// (double-clicking index.html), external mask URLs are silently blocked
and every masked icon disappears. Data URIs load on any protocol.

Workflow: drop an SVG anywhere under assets/icons/ (subfolders are fine and
purely for humans — the data-icon key is the filename), then run

    python tools/bake_icons.py

and refresh the page. Everything between the GENERATED ICONS markers in
styles.css is rewritten from the files on disk; the SVG files remain the
editable source of truth.
"""

from pathlib import Path
from urllib.parse import quote
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "styles.css"

BEGIN = "/* >>> GENERATED ICONS"
END = "/* <<< GENERATED ICONS <<< */"

ICONS_DIR = ROOT / "assets" / "icons"

# The one mask that is not an icon: the CIMINO wordmark, which lives with the
# logos and carries its own custom property.
EXTRA = {":root": ("--cimino-mask", "assets/logos/CIMINO.svg")}

# data-icon key != filename in a couple of historical cases. Keeping the keys
# stable matters more than renaming the files — the markup uses them.
ALIASES = {"brand-mark": "brand", "tick_mark": "tick"}

# Owned by bake_favicon.py, which has its own <head> pipeline.
NOT_AN_ICON = {"favicon"}

# Folders whose SVGs are NOT masks. Third-party brand logos are full colour and
# define their mark by contrast inside a solid shape — Photoshop's "Ps" is light
# on dark, Unreal's "U" is white in a black circle. A mask paints every filled
# region one colour, so those flatten to featureless blobs. They ship as real
# <img> instead, in their own colours, and never enter this block.
NOT_MASKS = {"software"}


def manifest() -> dict[str, tuple[str, str]]:
    """selector -> (custom property, source file), discovered from disk.

    Every SVG under assets/icons/ becomes `[data-icon="<stem>"]`, subfolders
    included — they are only for humans, the key is the filename. Dropping a
    new icon in is the whole job; there is no list to remember to update, which
    is what a 46-entry hand-written table was heading for.
    """
    found = dict(EXTRA)
    for svg in sorted(ICONS_DIR.rglob("*.svg"), key=lambda p: p.relative_to(ICONS_DIR).as_posix()):
        stem = svg.stem
        if stem in NOT_AN_ICON or NOT_MASKS & set(svg.relative_to(ICONS_DIR).parts):
            continue
        key = ALIASES.get(stem, stem)
        selector = f'[data-icon="{key}"]'
        if selector in found:
            raise SystemExit(f"ERROR: two icons claim {key!r}: "
                             f"{found[selector][1]} and {svg.relative_to(ROOT).as_posix()}")
        found[selector] = ("--icon", svg.relative_to(ROOT).as_posix())
    return found


def svg_data_uri(path: Path) -> str:
    svg = path.read_text(encoding="utf-8")
    svg = re.sub(r"<\?xml[^>]*\?>", "", svg)          # XML prolog is dead weight
    svg = re.sub(r"\s+", " ", svg).strip()             # collapse whitespace
    svg = svg.replace('"', "'")                        # ' survives unencoded
    encoded = quote(svg, safe="-_.~ '=:/()!*,;")
    return f"data:image/svg+xml,{encoded}"


def main() -> int:
    icons = manifest()
    lines = [f"{BEGIN} — do not edit by hand.",
             "   Source SVGs listed per line; regenerate with: python tools/bake_icons.py >>> */"]
    for selector, (prop, rel) in icons.items():
        src = ROOT / rel
        if not src.exists():
            print(f"ERROR: missing {rel}", file=sys.stderr)
            return 1
        lines.append(f'{selector}{{{prop}:url("{svg_data_uri(src)}")}} /* src: {rel} */')
    lines.append(END)
    block = "\n".join(lines)

    css = CSS.read_text(encoding="utf-8")
    start, stop = css.find(BEGIN), css.find(END)
    if start == -1 or stop == -1:
        print("ERROR: GENERATED ICONS markers not found in styles.css", file=sys.stderr)
        return 1
    css = css[:start] + block + css[stop + len(END):]
    CSS.write_text(css, encoding="utf-8")
    print(f"Baked {len(icons)} icons into styles.css")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
