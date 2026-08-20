#!/usr/bin/env python3
"""Bake responsive AVIF/WebP derivatives from the raster masters.

Layout rule: `assets/` holds MASTERS — the only copy of some of this art, hand
authored and never generated. `assets/derived/` holds GENERATED OUTPUT and this
script is the only thing that should ever write there. Nothing else reads or
writes that folder; delete it and a single run rebuilds it exactly.

Derived output mirrors the master's own subfolder, so filenames only have to be
unique within a folder rather than across the whole project:

    assets/mascots/mascot_red.png -> assets/derived/mascots/mascot_red-900.avif
    assets/about/profile.jpg     -> assets/derived/about/profile-420.avif

That is what makes per-project media folders safe to add later.

Workflow: drop a raster file anywhere in the repo, point one <!-- img --> line
at it, then run

    python tools/bake_images.py && python tools/bake_markup.py

(or just commit, and the pre-commit hook runs both). The masters stay in the
markup as the final <img> fallback, never as the served image.

Which widths a master bakes at is decided by the slots it occupies — see
tools/image_slots.py — not by a table in this file.

Flags:
    (none)           bake anything stale or missing
    --check          report staleness and exit 1; writes nothing
    --prune          delete derivatives no ladder produces any more
    --derived-for    read master paths on stdin, print the derivatives they own
    --install-hooks  copy tools/hooks/* into .git/hooks/

Encoder settings were validated against the source art at 100% crop. They are
already visually lossless on this material — raising them "to be safe" only
inflates the payload, so don't.
"""

from pathlib import Path
import shutil
import stat
import sys

try:
    from PIL import Image, features
except ImportError:
    print("ERROR: Pillow is required — python -m pip install 'pillow>=11.3'", file=sys.stderr)
    raise SystemExit(1)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bake_markup import used_by                       # noqa: E402
from image_slots import widths_for                    # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DERIVED = ROOT / "assets" / "derived"

AVIF_OPTS = {"quality": 58}
WEBP_OPTS = {"quality": 76, "method": 6}

# Fallback ladder for a master that no slot in index.html claims — a file
# dropped in ahead of the markup that will use it, or art referenced only from
# somewhere this script cannot see. Anything the page does place gets exactly
# the widths its slot asks for instead; see tools/image_slots.py.
DEFAULT_WIDTHS = (1600, 1200, 900, 600, 400, 200)

RASTER_EXTS = {".png", ".jpg", ".jpeg"}

# derived/ holds this script's own output — walking it would bake the bakes.
# _resources/ is .ai/.psd working files. _archive/ is songs kept in the repo
# but not on the site — same leading-underscore convention, same mechanism,
# so an archived cover never gets derivatives built for it.
# games/ ships self-contained builds whose textures are already optimised — see
# games/README.md. The rest is self-evident.
SKIP_DIRS = {"derived", "_resources", "_archive", "games", ".git", "node_modules", ".vercel"}

# Discovery is by extension and repo-wide, so the favicon rasters at the web root
# would otherwise be treated as masters and blown up into six widths of AVIF/WebP
# that nothing references. They are already the exact sizes they ship at, are
# written by tools/bake_favicon.py, and are fetched by crawlers at fixed URLs
# rather than through a <picture>. Skipped by name, not by folder, because the
# whole point is that they sit at the root. Keep in step with PNG_OUTPUTS there.
FAVICON_OUTPUTS = {"favicon-96.png", "favicon-192.png", "favicon-512.png",
                   "apple-touch-icon.png"}


def collect() -> list[tuple[Path, tuple[int, ...]]]:
    """Every raster master in the repo, with the widths it should bake at.

    The per-file ladder is no longer a table maintained here. It comes from the
    slots the image actually occupies in index.html (see image_slots.py), so
    the encode list follows the page. There is nothing to keep in sync: put an
    image in a slot that wants an 84px avatar and the 84px derivative appears.
    Masters the markup never names — the six accent mascots the theme picker
    swaps in at runtime, say — inherit a sibling's ladder, or fall back to the
    standard one.
    """
    used = used_by()
    found: dict[Path, tuple[int, ...]] = {}

    for path in sorted(ROOT.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in RASTER_EXTS:
            continue
        rel = path.relative_to(ROOT)
        if SKIP_DIRS & set(rel.parts):
            continue
        if len(rel.parts) == 1 and rel.name in FAVICON_OUTPUTS:
            continue
        found[path] = widths_for(rel.as_posix(), used, DEFAULT_WIDTHS)

    if not found:
        print("  warning: walk found no raster masters at all", file=sys.stderr)

    return sorted(found.items())


def expected(src: Path, widths: tuple[int, ...]):
    """Yield every (width, ext, output path) this master should produce.

    Single source of truth for the naming scheme so --check can never disagree
    with what a bake would actually write.
    """
    with Image.open(src) as im:
        source_width = im.width
    # Mirror the master's folder. A flat namespace collides the moment two
    # masters share a stem — assets/a/cover.png and assets/b/cover.png would
    # both bake to cover-800.avif and one would silently win.
    rel = src.relative_to(ROOT / "assets").parent
    for width in widths:
        if width > source_width:      # never upscale — the master is the ceiling
            continue
        for ext in ("avif", "webp"):
            yield width, ext, DERIVED / rel / f"{src.stem}-{width}.{ext}"


def is_stale(src: Path, out: Path) -> bool:
    """Skip work when the derivative is already newer than its master."""
    return not out.exists() or out.stat().st_mtime <= src.stat().st_mtime


def bake(src: Path, widths: tuple[int, ...]) -> tuple[int, int, int]:
    """Return (bytes written, files written, files skipped) for one master."""
    with Image.open(src) as im:
        # Alpha is load-bearing on the mascots; only flatten mode P/LA oddities
        # up into something both encoders accept losslessly.
        im = im.convert("RGBA" if "A" in im.getbands() or im.mode == "P" else "RGB")
        written = files = skipped = 0
        opts_for = {"avif": AVIF_OPTS, "webp": WEBP_OPTS}
        resized_at: dict[int, Image.Image] = {}

        for width, ext, out in expected(src, widths):
            if not is_stale(src, out):
                skipped += 1
                written += out.stat().st_size
                continue
            if width not in resized_at:
                height = round(im.height * width / im.width)
                resized_at[width] = im.resize((width, height), Image.LANCZOS)
            out.parent.mkdir(parents=True, exist_ok=True)
            resized_at[width].save(out, **opts_for[ext])
            written += out.stat().st_size
            files += 1

        return written, files, skipped


def orphans() -> list[Path]:
    """Derivatives on disk that no master's ladder produces any more.

    Harmless to serve but not to keep: they are invisible dead weight in the
    repo, and they multiply every time a ladder narrows. `--prune` clears them.
    """
    wanted = {out for src, widths in collect() for _w, _e, out in expected(src, widths)}
    found = {p for p in DERIVED.rglob("*") if p.suffix.lower() in {".avif", ".webp"}}
    return sorted(found - wanted)


def check() -> int:
    """Report missing/stale derivatives without writing anything."""
    stale = []
    for src, widths in collect():
        for _width, _ext, out in expected(src, widths):
            if not out.exists():
                stale.append((out, "missing"))
            elif out.stat().st_mtime <= src.stat().st_mtime:
                stale.append((out, "older than master"))

    # Orphans do not break the site, so they are a note rather than a failure —
    # --check's exit code should mean "the page will render", nothing else.
    extra = orphans()
    if extra:
        print(f"bake_images --check: note — {len(extra)} orphaned derivative(s) "
              f"no ladder produces; clear with: python tools/bake_images.py --prune")

    if not stale:
        print("bake_images --check: all derivatives present and current")
        return 0

    print(f"bake_images --check: {len(stale)} derivative(s) stale or missing")
    for out, why in stale:
        print(f"  {out.relative_to(ROOT).as_posix():52s} {why}")
    print("Run: python tools/bake_images.py")
    return 1


def install_hooks() -> int:
    """Copy the versioned hooks into .git/hooks/ and mark them executable.

    Two of them now. pre-commit bakes images and markup; commit-msg refuses a
    commit that reaches across unrelated projects — see tools/check_scope.py.
    They are separate hooks because they need different things: one runs before
    the message exists, the other cannot work without it.
    """
    hooks = ROOT / ".git" / "hooks"
    if not hooks.is_dir():
        print("ERROR: .git/hooks not found — run this from inside the repo", file=sys.stderr)
        return 1

    for name in ("pre-commit", "commit-msg"):
        src = ROOT / "tools" / "hooks" / name
        if not src.exists():
            print(f"ERROR: {src.relative_to(ROOT).as_posix()} not found", file=sys.stderr)
            return 1
        dest = hooks / name
        shutil.copyfile(src, dest)
        dest.chmod(dest.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        print(f"installed {src.relative_to(ROOT).as_posix()} -> .git/hooks/{name} (executable)")

    print("A fresh clone needs this once: python tools/bake_images.py --install-hooks")
    return 0


def prune() -> int:
    """Delete derivatives no ladder produces any more."""
    extra = orphans()
    if not extra:
        print("bake_images --prune: nothing to remove")
        return 0
    freed = sum(p.stat().st_size for p in extra)
    for p in extra:
        p.unlink()
    for d in sorted(DERIVED.rglob("*"), reverse=True):    # tidy up emptied folders
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
    print(f"bake_images --prune: removed {len(extra)} orphaned derivative(s), {freed/1024:.0f}K freed")
    return 0


def derived_for() -> int:
    """Print the derivatives owned by the masters named on stdin, one per line.

    This exists so the pre-commit hook can stage what the bake produced for THIS
    commit. It used to stage assets/derived/ whole, which is a different set: the
    bake is repo-wide, so a commit containing any raster also picked up whatever
    another session had left unbaked in the working tree. Two commits on
    2026-08-20 carried a third party's derivatives into the repo that way, master
    not included, which is the same shape as the b6ba02f incident.

    Masters arrive on stdin rather than in argv so a path with a space in it
    survives. Anything the walk does not consider a master — a favicon output at
    the root, a raster under games/ — yields nothing rather than erroring: the
    hook passes every staged raster and lets this decide which ones are ours.

    Paths are printed whether or not they exist; the hook bakes immediately
    before calling this, so a missing one means the bake did not do its job and
    git add failing on it is the correct loud answer.
    """
    # The consumer is a shell script, so the separator has to be LF. print()
    # would translate it to CRLF on Windows and the stray carriage return rode
    # into the path, so git add saw 'off-the-wall-1920.avif\r' and failed.
    sys.stdout.reconfigure(newline="\n")
    wanted = {(ROOT / line.strip()).resolve()
              for line in sys.stdin.read().splitlines() if line.strip()}
    if not wanted:
        return 0
    for src, widths in collect():
        if src.resolve() in wanted:
            for _, _, out in expected(src, widths):
                print(out.relative_to(ROOT).as_posix())
    return 0


def main() -> int:
    if "--install-hooks" in sys.argv[1:]:
        return install_hooks()
    if "--prune" in sys.argv[1:]:
        return prune()
    if "--derived-for" in sys.argv[1:]:
        return derived_for()

    if not features.check("avif"):
        print("ERROR: this Pillow has no AVIF encoder. Upgrade: "
              "python -m pip install 'pillow>=11.3'", file=sys.stderr)
        return 1

    if "--check" in sys.argv[1:]:
        return check()

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
