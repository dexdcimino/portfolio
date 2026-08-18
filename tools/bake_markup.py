#!/usr/bin/env python3
"""Write the <picture> markup for every image on the page.

Same idea as bake_icons.py: a generated block between markers, regenerated
from the files on disk, never edited by hand. Here the marker is a one-line
HTML comment that says which image goes where:

    <!-- img src="assets/about/profile.jpg" slot="about-photo" alt="Dex Cimino" -->
    ...twelve generated lines...
    <!-- /img -->

Everything inside is derived: the AVIF and WebP srcsets from the slot's ladder,
`sizes` from the slot, the master as the final fallback, and width/height read
out of the actual file. That last one is the point of the exercise — typed
dimensions go stale silently the first time a master is re-exported, and the
only symptom is a layout shift nobody traces back to the markup.

Flags:
    (none)     rewrite index.html in place
    --check    exit 1 if the markup is stale, a derivative is missing, or a
               declared size no longer matches its file; writes nothing

Run it after adding an image, or let the pre-commit hook do it.
"""

from fnmatch import fnmatch
from pathlib import Path
import hashlib
import re
from functools import lru_cache
import sys

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow is required — python -m pip install 'pillow>=11.3'", file=sys.stderr)
    raise SystemExit(1)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from image_slots import SLOTS, slot_widths            # noqa: E402


def write_preserving_eol(path, text):
    """Write text back without touching the file's existing line endings.

    Path.write_text() opens in text mode with newline=None, which translates
    every "
" to os.linesep -- on Windows that silently rewrites the whole
    file to CRLF and turns a three-line markup regeneration into a
    thousand-line diff. newline="" writes the string through verbatim, so the
    file keeps whatever convention it already had.
    """
    path.write_text(text, encoding="utf-8", newline="")


ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "index.html"
DERIVED_URL = "assets/derived"

# <!-- img ...attrs... -->  generated body  <!-- /img -->
IMG_BLOCK = re.compile(r"([ \t]*)<!--[ \t]*img\s+(.*?)-->.*?<!--[ \t]*/img[ \t]*-->", re.S)
PRELOAD_BLOCK = re.compile(r"([ \t]*)<!--[ \t]*preload\s+(.*?)-->.*?<!--[ \t]*/preload[ \t]*-->", re.S)
ATTR = re.compile(r'([\w-]+)(?:="([^"]*)")?')


def parse_attrs(blob: str) -> dict[str, str]:
    """key="value" pairs, plus bare flags like data-theme-mascot."""
    return {k: ("" if v is None else v) for k, v in ATTR.findall(blob.strip())}


@lru_cache(maxsize=None)
def stamp(master: Path) -> str:
    """Eight hex characters of the master's own bytes.

    assets/derived/ is served `immutable, max-age=1y`, which tells every browser
    and CDN it never has to ask about that URL again — true only while the URL
    changes when the bytes do. Derivative names carry the width, not the
    content, so re-exporting a master under the same name left anyone who had
    already fetched a rung holding the OLD art for a year, with no way to
    correct it. That is not hypothetical: it happened to Shale Spire Crater,
    and it showed up in the lightbox rather than the card because the two views
    pull different rungs and only the card's rung is refetched by a reload.

    Hashing the MASTER rather than each derivative means every rung of one piece
    moves together, and it still works when a derivative has yet to be written.
    """
    return hashlib.sha256(master.read_bytes()).hexdigest()[:8]


def derivative(master: Path, width: int, ext: str) -> str:
    """URL of one derivative — the path must agree with bake_images.expected().

    The ?v= is a cache key, not a path: the file on disk is still
    <stem>-<width>.<ext>, so URLs built at runtime (script.js's mascot swap)
    keep resolving. It only means a changed master is a changed URL.
    """
    rel = master.relative_to(ROOT / "assets").parent
    stem = f"{master.stem}-{width}.{ext}"
    path = f"{DERIVED_URL}/{rel.as_posix()}/{stem}" if rel.parts else f"{DERIVED_URL}/{stem}"
    return f"{path}?v={stamp(master)}"


def usable_widths(master: Path, slot: str) -> list[int]:
    """Slot widths that this master can actually supply — never upscale."""
    with Image.open(master) as im:
        source_width = im.width
    return [w for w in slot_widths(slot) if w <= source_width]


def render_picture(attrs: dict[str, str], indent: str) -> tuple[str, list[str]]:
    """Return (markup, derivative URLs it references)."""
    src, slot = attrs["src"], attrs["slot"]
    master = ROOT / src
    if not master.exists():
        raise FileNotFoundError(src)
    spec = SLOTS[slot]
    widths = usable_widths(master, slot)
    if not widths:
        raise ValueError(f"{src}: no slot width fits a {Image.open(master).width}px master")

    with Image.open(master) as im:
        w, h = im.width, im.height

    pad = indent + "  "
    lines, urls = [], []
    picture_class = f' class="{attrs["picture-class"]}"' if "picture-class" in attrs else ""
    lines.append(f"{indent}<picture{picture_class}>")

    for ext in ("avif", "webp"):
        entries = []
        for width in widths:
            url = derivative(master, width, ext)
            urls.append(url)
            entries.append(f"{url} {width}w")
        # Continuation lines align under the opening quote, as the hand-written
        # markup did — long srcsets are unreadable as one line.
        head = f'{pad}<source type="image/{ext}" srcset='
        joiner = ",\n" + " " * (len(head) + 1)
        lines.append(head + '"' + joiner.join(entries) + '"')
        # sizes lines up under `type`, so the attributes read as a column
        lines.append(f'{pad}{" " * len("<source ")}sizes="{spec["sizes"]}">')

    img = []
    if "id" in attrs:
        img.append(f'id="{attrs["id"]}"')
    if "class" in attrs:
        img.append(f'class="{attrs["class"]}"')
    for flag in attrs:
        if flag.startswith("data-"):
            img.append(flag)
    img.append(f'src="{src}"')
    img.append(f'alt="{attrs.get("alt", "")}"')
    img.append(f'width="{w}"')
    img.append(f'height="{h}"')
    if spec.get("eager"):
        # LCP element: never lazy, and it asks to jump the queue.
        img.append('fetchpriority="high"')
    else:
        img.append('loading="lazy"')
    img.append('decoding="async"')
    if "draggable" in attrs:
        img.append(f'draggable="{attrs["draggable"]}"')
    lines.append(f"{pad}<img " + " ".join(img) + ">")
    lines.append(f"{indent}</picture>")
    return "\n".join(lines), urls


def render_preload(attrs: dict[str, str], indent: str) -> tuple[str, list[str]]:
    """The <head> preload for an eager slot, from the same ladder as its markup.

    Hand-written, this was a fourth copy of the mascot's srcset and the first
    thing to rot when the ladder changed.
    """
    src, slot = attrs["src"], attrs["slot"]
    master = ROOT / src
    spec = SLOTS[slot]
    widths = usable_widths(master, slot)
    urls = [derivative(master, w, "avif") for w in widths]

    head = f"{indent}      imagesrcset="
    joiner = ",\n" + " " * (len(head) + 1)
    entries = [f"{u} {w}w" for u, w in zip(urls, widths)]
    lines = [
        f'{indent}<link rel="preload" as="image" fetchpriority="high"',
        f'{indent}      href="{urls[0]}"',
        head + '"' + joiner.join(entries) + '"',
        f'{indent}      imagesizes="{spec["sizes"]}">',
    ]
    return "\n".join(lines), urls


def rebuild(html: str) -> tuple[str, list[str], list[tuple[str, str]]]:
    """Return (new html, referenced derivative URLs, [(master, slot)] pairs)."""
    urls: list[str] = []
    pairs: list[tuple[str, str]] = []

    def replace(match, renderer):
        indent, blob = match.group(1), match.group(2)
        attrs = parse_attrs(blob)
        body, found = renderer(attrs, indent)
        urls.extend(found)
        pairs.append((attrs["src"], attrs["slot"]))
        opener = f"{indent}<!-- {match.group(0).split('<!--',1)[1].split('-->',1)[0].strip()} -->"
        closer = "/img" if renderer is render_picture else "/preload"
        return f"{opener}\n{body}\n{indent}<!-- {closer} -->"

    html = IMG_BLOCK.sub(lambda m: replace(m, render_picture), html)
    html = PRELOAD_BLOCK.sub(lambda m: replace(m, render_preload), html)
    return html, urls, pairs


def used_by() -> dict[str, set[str]]:
    """master path -> the slots that reference it, scraped from index.html.

    bake_images.py imports this so the encode list follows the page instead of
    being maintained alongside it.
    """
    html = HTML.read_text(encoding="utf-8", newline="")
    out: dict[str, set[str]] = {}
    for pattern in (IMG_BLOCK, PRELOAD_BLOCK):
        for match in pattern.finditer(html):
            attrs = parse_attrs(match.group(2))
            if "src" in attrs and "slot" in attrs:
                out.setdefault(attrs["src"], set()).add(attrs["slot"])
    return out


# Files that build derivative URLs themselves instead of going through markup.
RUNTIME_FILES = ("script.js", "styles.css")
DERIVED_REF = re.compile(r"assets/derived/[\w./\-]*(?:\$\{[^}]+\})?[\w./\-]*\.(?:avif|webp)")


def check_runtime_refs() -> list[str]:
    """Verify every assets/derived URL built outside the markup resolves.

    A `${...}` in the path is a runtime substitution, so it stands for a whole
    family: expand it against the masters that could fill it and require the
    derivative for each. That is what ties script.js's mascot warming to the
    hero slot's ladder — narrow the ladder and this fails loudly instead of
    404ing for anyone who picks a non-default accent.
    """
    problems: list[str] = []
    for name in RUNTIME_FILES:
        path = ROOT / name
        if not path.exists():
            continue
        for ref in sorted(set(DERIVED_REF.findall(path.read_text(encoding="utf-8")))):
            if "${" not in ref:
                if not (ROOT / ref).exists():
                    problems.append(f"missing derivative   {ref}  (referenced by {name})")
                continue
            stem_glob = re.sub(r"\$\{[^}]+\}", "*", Path(ref).name)
            derived_dir = Path(ref).parent                       # assets/derived/<sub>
            source_dir = ROOT / "assets" / derived_dir.relative_to("assets/derived")
            width_ext = stem_glob.split("-")[-1]                 # e.g. 900.avif
            family = sorted(p for p in source_dir.glob("*")
                            if p.suffix.lower() in {".png", ".jpg", ".jpeg"}
                            and fnmatch(f"{p.stem}-{width_ext}", stem_glob))
            if not family:
                problems.append(f"unresolvable ref     {ref}  (referenced by {name})")
            for master in family:
                out = ROOT / derived_dir / f"{master.stem}-{width_ext}"
                if not out.exists():
                    problems.append(
                        f"missing derivative   {out.relative_to(ROOT).as_posix()}  "
                        f"(needed by {name}'s runtime swap)")
    return problems


def check() -> int:
    html = HTML.read_text(encoding="utf-8", newline="")
    try:
        rebuilt, urls, pairs = rebuild(html)
    except (FileNotFoundError, KeyError, ValueError) as exc:
        print(f"bake_markup --check: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    problems: list[str] = []

    # 1. Every derivative the page asks for has to exist on disk. The ?v= is a
    #    cache key, not part of the filename, so it comes off before looking.
    for url in sorted(set(urls)):
        if not (ROOT / url.split("?")[0]).exists():
            problems.append(f"missing derivative   {url}")

    # 2. Every declared size has to match the file it describes. Regenerating
    #    puts the real numbers in, so a mismatch can only mean the markup was
    #    edited by hand or a master was re-exported without a re-bake.
    for src in sorted({s for s, _ in pairs}):     # once per master, not per slot
        master = ROOT / src
        if not master.exists():
            problems.append(f"missing master       {src}")
            continue
        with Image.open(master) as im:
            real = (im.width, im.height)
        for m in re.finditer(rf'src="{re.escape(src)}"[^>]*?width="(\d+)"\s+height="(\d+)"', html):
            declared = (int(m.group(1)), int(m.group(2)))
            if declared != real:
                problems.append(
                    f"size mismatch        {src}: markup says {declared[0]}x{declared[1]}, "
                    f"file is {real[0]}x{real[1]}")

    # 3. Derivatives referenced from JS/CSS rather than markup. script.js builds
    #    mascot URLs at runtime — `mascot_${theme.mascot}-900.avif` — so those
    #    widths have to exist for EVERY mascot, not just the one the page names.
    #    Nothing in the markup can catch that; the six unnamed mascots would
    #    simply 404 the moment someone picked a different accent.
    problems += check_runtime_refs()

    # 4. Anything else that differs means the markup is simply out of date.
    if rebuilt != html and not problems:
        problems.append("markup is stale — a slot, ladder or master changed since it was written")

    if problems:
        print(f"bake_markup --check: {len(problems)} problem(s)")
        for p in problems:
            print(f"  {p}")
        print("Run: python tools/bake_markup.py")
        return 1

    blocks = len(pairs)
    print(f"bake_markup --check: {blocks} image block(s) current, "
          f"{len(set(urls))} derivative(s) referenced, all present")
    return 0


def main() -> int:
    if "--check" in sys.argv[1:]:
        return check()

    html = HTML.read_text(encoding="utf-8", newline="")
    try:
        rebuilt, urls, pairs = rebuild(html)
    except (FileNotFoundError, KeyError, ValueError) as exc:
        print(f"ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    if rebuilt == html:
        print(f"bake_markup: {len(pairs)} image block(s) already current")
        return 0

    write_preserving_eol(HTML, rebuilt)
    print(f"bake_markup: rewrote {len(pairs)} image block(s) in index.html "
          f"({len(set(urls))} derivatives referenced)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
