#!/usr/bin/env python3
"""Bake assets/icons/favicon.svg into two artifacts.

An .ico is a static raster. It cannot read --accent and nothing can make it
follow the theme, so the live favicon has to be an SVG data URI rebuilt in JS on
every accent change. That leaves two outputs from one source:

  script.js   FAVICON_SVG, a template string with the glyph's fill replaced by
              an %ACCENT% token. Baked rather than fetched: no request, no flash
              of the wrong colour on first paint, and it still works over
              file://, where fetching a local SVG is blocked outright.

  favicon.ico multi-size 16/32/48, frozen at the default lime accent. Purely a
              fallback for browsers with no SVG-favicon support. It does not
              follow the theme; that is the format's limit, not a bug here.

Emits .ico only, never PNG: bake_images.py auto-discovers every .png in the repo
and would bake a favicon PNG into six widths of AVIF/WebP that nothing
references. .ico is not in its RASTER_EXTS, so it is skipped for free.

Usage:
    python tools/bake_favicon.py            regenerate both outputs
    python tools/bake_favicon.py --check    report staleness, write nothing
"""

from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
SVG = ROOT / "assets" / "icons" / "favicon.svg"
JS = ROOT / "script.js"
ICO = ROOT / "favicon.ico"

BEGIN = "/* >>> GENERATED FAVICON"
END = "/* <<< GENERATED FAVICON <<< */"

DEFAULT_ACCENT = "#9EE02B"       # lime — matches ACCENTS[2] in script.js
ICO_SIZES = (16, 32, 48)
RENDER_AT = 256                  # render big, downsample with LANCZOS

# The two ids the rest of this script keys off. Renaming either one in
# Illustrator would otherwise silently produce a favicon that never themes.
REQUIRED_IDS = ("favicon_bg", "favicon_icon")


def fail(msg: str) -> int:
    print(f"ERROR: {msg}", file=sys.stderr)
    return 1


def read_svg() -> str:
    if not SVG.exists():
        raise SystemExit(fail(f"missing {SVG.relative_to(ROOT)}"))
    svg = SVG.read_text(encoding="utf-8")
    svg = re.sub(r"<\?xml[^>]*\?>", "", svg).strip()

    missing = [i for i in REQUIRED_IDS if f'id="{i}"' not in svg]
    if missing:
        raise SystemExit(fail(
            f"{SVG.relative_to(ROOT)} is missing id(s): {', '.join(missing)}.\n"
            f"       The favicon contract needs exactly these two ids:\n"
            f'         #favicon_bg   the rounded <rect>, dark page colour, static\n'
            f'         #favicon_icon the glyph <path>, accent-driven\n'
            f"       Re-export from Illustrator with those layer names, or fix the ids by hand."))

    # A template literal would break on either of these, and the failure would be
    # a syntax error in script.js rather than anything pointing back here.
    if "`" in svg or "${" in svg:
        raise SystemExit(fail("favicon.svg contains ` or ${ — cannot bake into a JS template string"))
    return svg


def tokenize(svg: str) -> str:
    """Replace #favicon_icon's fill with %ACCENT%, leaving #favicon_bg alone."""
    def sub(match: re.Match) -> str:
        return re.sub(r'fill="[^"]*"', 'fill="%ACCENT%"', match.group(0))

    out, count = re.subn(r'<path[^>]*id="favicon_icon"[^>]*/?>', sub, svg)
    if count != 1:
        raise SystemExit(fail(f"expected exactly one #favicon_icon element, found {count}"))
    if "%ACCENT%" not in out:
        raise SystemExit(fail('#favicon_icon has no fill attribute to tokenize'))
    return out


def js_block(tokenized: str) -> str:
    return "\n".join([
        f"{BEGIN} — do not edit by hand.",
        "   Source: assets/icons/favicon.svg — regenerate with: python tools/bake_favicon.py",
        "   %ACCENT% is substituted in applyAccent(); see the .ico note there. >>> */",
        "const FAVICON_SVG = `" + tokenized + "`;",
        END,
    ])


def render_png(svg: str, size: int) -> bytes:
    """SVG -> PNG bytes. cairosvg where it works, headless Chrome where it does not."""
    try:
        import cairosvg
        return cairosvg.svg2png(bytestring=svg.encode("utf-8"),
                                output_width=size, output_height=size)
    except Exception as exc:
        # cairosvg's cffi bindings need a native libcairo-2.dll, which pip cannot
        # supply on Windows — it ships with the GTK runtime. Rather than make a
        # system-wide install a prerequisite for regenerating one icon, fall back
        # to Chrome, which this repo already requires for verification.
        note = f"cairosvg unavailable ({type(exc).__name__}), rendering via headless Chrome"
        if not getattr(render_png, "_warned", False):
            print(f"note: {note}", file=sys.stderr)
            print("      to use cairosvg instead: pip install cairosvg + the GTK3 runtime "
                  "(https://github.com/tschoonj/GTK-for-Windows-Runtime-Environment-Installer)",
                  file=sys.stderr)
            render_png._warned = True
        return render_png_chrome(svg, size)


def find_chrome() -> str:
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        "/usr/bin/google-chrome", "/usr/bin/chromium",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    raise SystemExit(fail("no cairosvg and no Chrome found — cannot rasterize favicon.svg"))


def render_png_chrome(svg: str, size: int) -> bytes:
    chrome = find_chrome()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        # margin:0 and an exact-size <svg> so the screenshot is the artwork and
        # nothing else — no scrollbars, no page background bleeding in.
        page = ("<!doctype html><meta charset=utf-8>"
                "<style>html,body{margin:0;padding:0;background:transparent}"
                f"svg{{display:block;width:{size}px;height:{size}px}}</style>" + svg)
        html = tmp / "favicon.html"
        html.write_text(page, encoding="utf-8")
        out = tmp / "shot.png"
        proc = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars",
             f"--user-data-dir={tmp / 'profile'}", "--no-first-run",
             "--default-background-color=00000000",
             f"--window-size={size},{size}",
             f"--screenshot={out}", html.as_uri()],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
        if not out.exists():
            raise SystemExit(fail(f"Chrome failed to rasterize favicon.svg (exit {proc.returncode})"))
        return out.read_bytes()


def write_ico(svg: str) -> None:
    try:
        from PIL import Image
    except ImportError:
        raise SystemExit(fail("Pillow not installed — pip install Pillow"))
    import io

    if "%ACCENT%" not in svg:
        raise SystemExit(fail("write_ico expects the tokenized SVG, not the raw source"))
    baked = svg.replace("%ACCENT%", DEFAULT_ACCENT)
    master = Image.open(io.BytesIO(render_png(baked, RENDER_AT))).convert("RGBA")
    # Downsample from RENDER_AT with LANCZOS rather than rasterizing at 16px:
    # the glyph's arms are ~1px there, and a direct render drops them entirely.
    frames = [master.resize((s, s), Image.LANCZOS) for s in ICO_SIZES]
    frames[-1].save(ICO, format="ICO", sizes=[(s, s) for s in ICO_SIZES],
                    append_images=frames[:-1])


def main(argv: list[str]) -> int:
    check = "--check" in argv
    svg = read_svg()
    tokenized = tokenize(svg)
    block = js_block(tokenized)

    js = JS.read_text(encoding="utf-8")
    start, stop = js.find(BEGIN), js.find(END)
    if start == -1 or stop == -1:
        return fail("GENERATED FAVICON markers not found in script.js")
    current = js[start:stop + len(END)]

    stale = []
    if current != block:
        stale.append("script.js FAVICON_SVG block is out of date")
    if not ICO.exists():
        stale.append("favicon.ico is missing")
    elif ICO.stat().st_mtime < SVG.stat().st_mtime:
        stale.append("favicon.ico is older than favicon.svg")

    if check:
        if stale:
            for s in stale:
                print(f"bake_favicon --check: {s}", file=sys.stderr)
            print("Run: python tools/bake_favicon.py", file=sys.stderr)
            return 1
        print("bake_favicon --check: favicon outputs present and current")
        return 0

    JS.write_text(js[:start] + block + js[stop + len(END):], encoding="utf-8")
    write_ico(tokenized)      # tokenized, not svg — write_ico fills in the default accent
    sizes = "/".join(str(s) for s in ICO_SIZES)
    print(f"Baked FAVICON_SVG into script.js and favicon.ico ({sizes}) at {DEFAULT_ACCENT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
