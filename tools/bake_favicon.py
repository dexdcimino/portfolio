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
  + PNG set   fallback for browsers with no SVG-favicon support, and the only
              thing a crawler ever sees. These do not follow the theme; that is
              the format's limit, not a bug here.

  site.webmanifest  points at the PNGs, so Android and the install prompt use
              the same artwork rather than inventing their own.

WHY THE RASTERS ARE NOT JUST THE SVG AT N PIXELS: Google's favicon crawler does
not execute JS. It reads raw HTML, and the accent-driven SVG above has an empty
href until applyAccent runs, so the crawler sees nothing there and falls back to
/favicon.ico. It then masks whatever it gets into a CIRCLE. The source artwork is
a rounded rect, which leaves the corners transparent and puts a pale fringe right
where that mask composites. So the crawlable set is re-cut full bleed with the
mark scaled to the safe circle — see CRAWL_SCALE. The tab keeps the rounded SVG,
which is correct there and unaffected by any of this.

The PNGs live at the web root and bake_images.py auto-discovers every .png in the
repo, so they are named in its FAVICON_OUTPUTS skip set. Without that they would
each get six widths of AVIF/WebP that nothing references. If you add an output
here, add it there too — bake_images --check will not tell you.

Usage:
    python tools/bake_favicon.py            regenerate every output
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
CSS = ROOT / "styles.css"
ICO = ROOT / "favicon.ico"

BEGIN = "/* >>> GENERATED FAVICON"
END = "/* <<< GENERATED FAVICON <<< */"

ICO_SIZES = (16, 32, 48)
RENDER_AT = 512                  # render big, downsample with LANCZOS

# The crawlable raster set. Stable filenames, no content hashes: Google caches
# favicons by URL, and a hashed name invalidates on every deploy, which is
# enough on its own to send the SERP back to the generic globe.
PNG_OUTPUTS = {
    "favicon-96.png": 96,        # Google's preferred fetch size
    "favicon-192.png": 192,      # manifest / Android
    "apple-touch-icon.png": 180, # iOS; must have no alpha channel at all
    "favicon-512.png": 512,      # manifest / master
}

MANIFEST = ROOT / "site.webmanifest"

# Google masks favicons into a CIRCLE, so the artwork has to change in two ways
# for the crawlable set — and only for it, since a browser TAB shows the whole
# square and the rounded rect is right there.
#
#   1. Full bleed. The source rect is rx=14, which leaves the four corners
#      transparent; anything compositing the icon on a light background gets a
#      pale fringe outside the rounded corner. Squared off here.
#
#   2. Scaled to the safe circle. MEASURED, not guessed: the glyph's furthest
#      point sits at radius 25.88 of 32 (80.9% of the half-width) while the
#      ~78%-diameter safe zone allows 24.96. So the mark is very slightly too
#      BIG for the circle, not too small — it already occupies 68.8% of the
#      width. 0.95 brings the extreme down to 24.59, inside the safe zone,
#      and leaves the mark at 65.3% of the width.
#
# Re-measure with getBBox()/getPointAtLength() if the artwork is ever redrawn;
# this number is a property of that path, not a general constant.
CRAWL_SCALE = 0.95
SAFE_ZONE_DIAMETER = 0.78

# The two ids the rest of this script keys off. Renaming either one in
# Illustrator would otherwise silently produce a favicon that never themes.
REQUIRED_IDS = ("favicon_bg", "favicon_icon")


def fail(msg: str) -> int:
    print(f"ERROR: {msg}", file=sys.stderr)
    return 1


def css_var(name: str) -> str:
    """Read a :root custom property out of styles.css.

    The accent and the page black are DEFINED in the stylesheet; duplicating
    either as a literal here is how a favicon ends up a different green from
    the site it belongs to. Read them instead, and fail loudly if the property
    is gone rather than silently falling back to a stale constant.
    """
    css = CSS.read_text(encoding="utf-8")
    root = css[css.find(":root{"):]
    match = re.search(rf"{re.escape(name)}\s*:\s*(#[0-9A-Fa-f]{{3,8}})\s*;", root)
    if not match:
        raise SystemExit(fail(f"{name} not found in styles.css :root — cannot bake the favicon"))
    return match.group(1).upper()


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


def crawlable(tokenized: str) -> str:
    """The tokenized SVG re-cut for the static raster set: full bleed, scaled mark.

    Takes the tokenized form so the caller can substitute the accent exactly as
    it does for the .ico — one artwork, two framings, never two source files to
    keep in step.
    """
    # Square the corners. rx/ry may appear in either order and either may be
    # absent, so strip both from that element rather than pattern-matching a
    # particular spelling.
    def square(match: re.Match) -> str:
        return re.sub(r'\s(rx|ry)="[^"]*"', "", match.group(0))

    out, n = re.subn(r'<rect[^>]*id="favicon_bg"[^>]*/?>', square, tokenized)
    if n != 1:
        raise SystemExit(fail(f"expected exactly one #favicon_bg element, found {n}"))
    if 'rx="' in out[:out.find("favicon_icon")]:
        raise SystemExit(fail("failed to square #favicon_bg — rx survived the rewrite"))

    # Scale the glyph about the canvas centre. The measured glyph centre is
    # (32.00, 32.05) in a 64 viewBox, i.e. centred by construction, so scaling
    # about (32,32) does not shift it off axis.
    def scale(match: re.Match) -> str:
        el = match.group(0)
        if "transform=" in el:
            raise SystemExit(fail("#favicon_icon already carries a transform — "
                                  "CRAWL_SCALE would compose with it unpredictably"))
        t = f' transform="translate(32,32) scale({CRAWL_SCALE}) translate(-32,-32)"'
        return el[:-2] + t + el[-2:] if el.endswith("/>") else el[:-1] + t + ">"

    out, n = re.subn(r'<path[^>]*id="favicon_icon"[^>]*/?>', scale, out)
    if n != 1:
        raise SystemExit(fail(f"expected exactly one #favicon_icon element, found {n}"))
    return out


def write_pngs(tokenized: str, accent: str, page_bg: str) -> list[str]:
    """Render the crawlable artwork to the static PNG set.

    Flattened onto the page black with the alpha channel DROPPED, not merely
    filled: apple-touch-icon is specified as having no transparency, and a
    full-bleed icon has no use for an alpha channel anywhere else either. This
    is also what guarantees the "no transparent border" requirement mechanically
    rather than by inspection.
    """
    from PIL import Image
    import io

    art = crawlable(tokenized).replace("%ACCENT%", accent)
    master = Image.open(io.BytesIO(render_png(art, RENDER_AT))).convert("RGBA")
    flat = Image.new("RGB", master.size, page_bg)
    flat.paste(master, mask=master.getchannel("A"))

    written = []
    for name, size in PNG_OUTPUTS.items():
        # Downsample from RENDER_AT rather than rasterizing at the target: the
        # glyph's arms are around a pixel wide at the small end and a direct
        # render drops them entirely.
        img = flat if size == RENDER_AT else flat.resize((size, size), Image.LANCZOS)
        img.save(ROOT / name, format="PNG", optimize=True)
        written.append(name)
    return written


def write_manifest(accent: str, page_bg: str) -> None:
    """Emit site.webmanifest pointing at the stable PNG paths.

    purpose "any maskable" on the 192 and 512: the artwork is full bleed with
    the mark inside the safe circle, which is exactly the maskable contract, so
    declaring it saves Android from adding its own letterbox around a square.
    """
    import json

    data = {
        "name": "Dex Cimino — Portfolio",
        "short_name": "Dex Cimino",
        "start_url": "/",
        "display": "standalone",
        "background_color": page_bg,
        "theme_color": page_bg,
        "icons": [
            {"src": "/favicon-96.png", "sizes": "96x96", "type": "image/png"},
            {"src": "/favicon-192.png", "sizes": "192x192", "type": "image/png",
             "purpose": "any maskable"},
            {"src": "/favicon-512.png", "sizes": "512x512", "type": "image/png",
             "purpose": "any maskable"},
        ],
    }
    # ensure_ascii=False so the em-dash stays an em-dash: the file is committed
    # and read by humans, and — in the app name helps nobody.
    MANIFEST.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")


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


def write_ico(svg: str, accent: str, page_bg: str) -> None:
    try:
        from PIL import Image
    except ImportError:
        raise SystemExit(fail("Pillow not installed — pip install Pillow"))
    import io

    if "%ACCENT%" not in svg:
        raise SystemExit(fail("write_ico expects the tokenized SVG, not the raw source"))
    # Same full-bleed cut as the PNGs: the .ico is what Google falls back to,
    # and a rounded .ico would put transparent corners right where the circle
    # mask composites against the SERP background.
    baked = crawlable(svg).replace("%ACCENT%", accent)
    master = Image.open(io.BytesIO(render_png(baked, RENDER_AT))).convert("RGBA")
    flat = Image.new("RGB", master.size, page_bg)
    flat.paste(master, mask=master.getchannel("A"))
    # Downsample from RENDER_AT with LANCZOS rather than rasterizing at 16px:
    # the glyph's arms are ~1px there, and a direct render drops them entirely.
    frames = [flat.resize((s, s), Image.LANCZOS) for s in ICO_SIZES]
    frames[-1].save(ICO, format="ICO", sizes=[(s, s) for s in ICO_SIZES],
                    append_images=frames[:-1])


def main(argv: list[str]) -> int:
    check = "--check" in argv
    accent = css_var("--accent")        # lime, the default before applyAccent runs
    page_bg = css_var("--page-bg")
    svg = read_svg()
    tokenized = tokenize(svg)
    block = js_block(tokenized)

    # The SVG hardcodes the page black in #favicon_bg. If someone retunes the
    # stylesheet and not the artwork, the tab icon and the crawlable set would
    # quietly disagree about what "black" is — so say so instead.
    bg_in_svg = re.search(r'<rect[^>]*id="favicon_bg"[^>]*fill="(#[0-9A-Fa-f]{3,8})"', svg)
    if bg_in_svg and bg_in_svg.group(1).upper() != page_bg:
        return fail(f"favicon.svg #favicon_bg is {bg_in_svg.group(1)} but styles.css "
                    f"--page-bg is {page_bg} — reconcile them before baking")

    js = JS.read_text(encoding="utf-8")
    start, stop = js.find(BEGIN), js.find(END)
    if start == -1 or stop == -1:
        return fail("GENERATED FAVICON markers not found in script.js")
    current = js[start:stop + len(END)]

    outputs = [ICO, MANIFEST] + [ROOT / name for name in PNG_OUTPUTS]

    stale = []
    if current != block:
        stale.append("script.js FAVICON_SVG block is out of date")
    for out in outputs:
        rel = out.relative_to(ROOT).as_posix()
        if not out.exists():
            stale.append(f"{rel} is missing")
        elif out.stat().st_mtime < SVG.stat().st_mtime:
            stale.append(f"{rel} is older than favicon.svg")

    if check:
        if stale:
            for s in stale:
                print(f"bake_favicon --check: {s}", file=sys.stderr)
            print("Run: python tools/bake_favicon.py", file=sys.stderr)
            return 1
        print(f"bake_favicon --check: {len(outputs)} favicon output(s) present and current")
        return 0

    JS.write_text(js[:start] + block + js[stop + len(END):], encoding="utf-8")
    write_ico(tokenized, accent, page_bg)   # tokenized, not svg — the accent is filled in there
    pngs = write_pngs(tokenized, accent, page_bg)
    write_manifest(accent, page_bg)
    sizes = "/".join(str(s) for s in ICO_SIZES)
    print(f"Baked FAVICON_SVG into script.js (rounded, accent-driven, for the tab)")
    print(f"Baked full-bleed crawler set at accent {accent} on {page_bg}, mark at {CRAWL_SCALE}x:")
    print(f"  favicon.ico ({sizes})")
    for name in pngs:
        print(f"  {name} ({PNG_OUTPUTS[name]}x{PNG_OUTPUTS[name]})")
    print(f"  site.webmanifest")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
