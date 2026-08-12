#!/usr/bin/env python3
"""Bake mask SVGs into styles.css as data: URIs.

Why: CSS mask-image is fetched with CORS enforced. When the site is opened via
file:// (double-clicking index.html), external mask URLs are silently blocked
and every masked icon disappears. Data URIs load on any protocol.

Workflow: edit/replace any SVG listed in MANIFEST below, then run

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

# selector -> (custom property, source file)
MANIFEST = {
    ":root":                     ("--cimino-mask", "assets/logos/CIMINO.svg"),
    '[data-icon="brand"]':       ("--icon", "assets/icons/brand-mark.svg"),
    '[data-icon="home"]':        ("--icon", "assets/icons/home.svg"),
    '[data-icon="work"]':        ("--icon", "assets/icons/work.svg"),
    '[data-icon="games"]':       ("--icon", "assets/icons/games.svg"),
    '[data-icon="ai"]':          ("--icon", "assets/icons/ai.svg"),
    '[data-icon="about"]':       ("--icon", "assets/icons/about.svg"),
    '[data-icon="resume"]':      ("--icon", "assets/icons/resume.svg"),
    '[data-icon="contact"]':     ("--icon", "assets/icons/contact.svg"),
    '[data-icon="download"]':    ("--icon", "assets/icons/download.svg"),
    '[data-icon="zoom-in"]':     ("--icon", "assets/icons/zoom-in.svg"),
    '[data-icon="zoom-out"]':    ("--icon", "assets/icons/zoom-out.svg"),
    '[data-icon="arrow-ne"]':    ("--icon", "assets/icons/arrow-ne.svg"),
    '[data-icon="arrow-right"]': ("--icon", "assets/icons/arrow-right.svg"),
    '[data-icon="tick"]':        ("--icon", "assets/icons/tick_mark.svg"),
    '[data-icon="play"]':        ("--icon", "assets/icons/play.svg"),
    '[data-icon="youtube"]':     ("--icon", "assets/icons/social/youtube.svg"),
    '[data-icon="instagram"]':   ("--icon", "assets/icons/social/instagram.svg"),
    '[data-icon="linkedin"]':    ("--icon", "assets/icons/social/linkedin.svg"),
    '[data-icon="github"]':      ("--icon", "assets/icons/social/github.svg"),
}


def svg_data_uri(path: Path) -> str:
    svg = path.read_text(encoding="utf-8")
    svg = re.sub(r"<\?xml[^>]*\?>", "", svg)          # XML prolog is dead weight
    svg = re.sub(r"\s+", " ", svg).strip()             # collapse whitespace
    svg = svg.replace('"', "'")                        # ' survives unencoded
    encoded = quote(svg, safe="-_.~ '=:/()!*,;")
    return f"data:image/svg+xml,{encoded}"


def main() -> int:
    lines = [f"{BEGIN} — do not edit by hand.",
             "   Source SVGs listed per line; regenerate with: python tools/bake_icons.py >>> */"]
    for selector, (prop, rel) in MANIFEST.items():
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
    print(f"Baked {len(MANIFEST)} icons into styles.css")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
