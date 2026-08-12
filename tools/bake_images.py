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

Workflow: drop a raster file anywhere in the repo, then run

    python tools/bake_images.py

and reference the results from a <picture> in index.html. The masters stay in
the markup as the final <img> fallback, never as the served image.

Flags:
    (none)           bake anything stale or missing
    --check          report staleness and exit 1; writes nothing
    --install-hooks  copy tools/hooks/pre-commit into .git/hooks/

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

ROOT = Path(__file__).resolve().parent.parent
DERIVED = ROOT / "assets" / "derived"

AVIF_OPTS = {"quality": 58}
WEBP_OPTS = {"quality": 76, "method": 6}

# Everything raster, anywhere in the repo, gets baked at DEFAULT_WIDTHS. The
# baker cannot know what slot an image fills, so it makes a standard ladder and
# lets the browser's `sizes` pick. Extra widths cost disk, not bandwidth — the
# browser downloads exactly one entry from a srcset.
DEFAULT_WIDTHS = (1600, 1200, 900, 600, 400, 200)

RASTER_EXTS = {".png", ".jpg", ".jpeg"}

# derived/ holds this script's own output — walking it would bake the bakes.
# _resources/ is .ai/.psd working files.
# games/ ships self-contained builds whose textures are already optimised — see
# games/README.md. The rest is self-evident.
SKIP_DIRS = {"derived", "_resources", "games", ".git", "node_modules", ".vercel"}

# Escape hatch: a folder or exact file that needs a different ladder. Longest
# matching path wins, so a specific file beats the folder it sits in. Only add
# an entry when a default width is demonstrably wrong for a slot.
WIDTH_OVERRIDES = {
    "assets/about/profile.jpg": (840, 420, 200, 84),   # 84px sidebar avatar
}


def collect() -> list[tuple[Path, tuple[int, ...]]]:
    """Every raster master in the repo, with the widths it should bake at."""
    found: dict[Path, tuple[int, ...]] = {}

    for path in sorted(ROOT.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in RASTER_EXTS:
            continue
        rel = path.relative_to(ROOT)
        if SKIP_DIRS & set(rel.parts):
            continue

        key = rel.as_posix()
        # Longest match wins: exact file, else deepest parent folder listed.
        match = max(
            (k for k in WIDTH_OVERRIDES if key == k or key.startswith(k.rstrip("/") + "/")),
            key=len,
            default=None,
        )
        found[path] = WIDTH_OVERRIDES[match] if match else DEFAULT_WIDTHS

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


def check() -> int:
    """Report missing/stale derivatives without writing anything."""
    stale = []
    for src, widths in collect():
        for _width, _ext, out in expected(src, widths):
            if not out.exists():
                stale.append((out, "missing"))
            elif out.stat().st_mtime <= src.stat().st_mtime:
                stale.append((out, "older than master"))

    if not stale:
        print("bake_images --check: all derivatives present and current")
        return 0

    print(f"bake_images --check: {len(stale)} derivative(s) stale or missing")
    for out, why in stale:
        print(f"  {out.relative_to(ROOT).as_posix():52s} {why}")
    print("Run: python tools/bake_images.py")
    return 1


def install_hooks() -> int:
    """Copy the versioned hook into .git/hooks/ and mark it executable."""
    src = ROOT / "tools" / "hooks" / "pre-commit"
    hooks = ROOT / ".git" / "hooks"
    if not src.exists():
        print(f"ERROR: {src.relative_to(ROOT).as_posix()} not found", file=sys.stderr)
        return 1
    if not hooks.is_dir():
        print("ERROR: .git/hooks not found — run this from inside the repo", file=sys.stderr)
        return 1

    dest = hooks / "pre-commit"
    shutil.copyfile(src, dest)
    dest.chmod(dest.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    print(f"installed {src.relative_to(ROOT).as_posix()} -> .git/hooks/pre-commit (executable)")
    print("A fresh clone needs this once: python tools/bake_images.py --install-hooks")
    return 0


def main() -> int:
    if "--install-hooks" in sys.argv[1:]:
        return install_hooks()

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
