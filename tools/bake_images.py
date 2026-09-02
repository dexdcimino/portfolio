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
    --cases          prove --check can still refuse (see cases())

Encoder settings were validated against the source art at 100% crop. They are
already visually lossless on this material — raising them "to be safe" only
inflates the payload, so don't.
"""

from pathlib import Path
import os
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

# THE BUDGET IS THE AVIF, and only the AVIF (Dex, 2026-08-20). That is the file
# a modern browser actually downloads, so it is the number that describes what a
# visitor pays. The WebP beside it is the fallback for browsers too old for
# AVIF; holding it to the same ceiling would mean either degrading the AVIF or
# dropping a rung for a shrinking minority, so its size is reported below and
# never gated on.
#
# Reported rather than written down, because a hand-counted list of what is over
# goes stale silently: assets/ai/wallpapers/README.md said "the three busiest
# pieces" while naming four of them, and the real count was six.
BUDGET_BYTES = 150 * 1024

# Fallback ladder for a master that no slot in index.html claims — a file
# dropped in ahead of the markup that will use it, or art referenced only from
# somewhere this script cannot see. Anything the page does place gets exactly
# the widths its slot asks for instead; see tools/image_slots.py.
DEFAULT_WIDTHS = (1600, 1200, 900, 600, 400, 200)

# .webp is a MASTER extension as well as an output one. The work gallery's 350
# pieces carry real alpha on 213 of them, which rules JPEG out, and PNG at
# 1600px is 349 MB against WebP's 57 — so those masters are WebP. Two of the
# files in that drop arrived as .webp already and would have been walked past
# in silence before this. Safe against baking the bakes because assets/derived/
# is in SKIP_DIRS, and outputs land in a mirrored folder, never beside a master.
RASTER_EXTS = {".png", ".jpg", ".jpeg", ".webp"}

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
    #
    # Discovery is repo-wide but the output layout is anchored at assets/, so a
    # raster ANYWHERE ELSE has nowhere to go. That used to surface as a bare
    # ValueError from relative_to() naming two absolute paths and no reason —
    # which is what a 525 MB folder of art dropped at the repo root produced on
    # 2026-09-01, after the walk had already done its real work. Say what is
    # wrong and what to do instead.
    try:
        rel = src.relative_to(ROOT / "assets").parent
    except ValueError:
        raise SystemExit(
            f"ERROR: {src.relative_to(ROOT).as_posix()} is a raster master "
            f"outside assets/, and derived output mirrors assets/. Move it under "
            f"assets/, or put it somewhere the walk skips "
            f"({', '.join(sorted(SKIP_DIRS))}).") from None
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
    masters = rungs = 0
    for src, widths in collect():
        masters += 1
        for _width, _ext, out in expected(src, widths):
            rungs += 1
            if not out.exists():
                stale.append((out, "missing"))
            elif out.stat().st_mtime <= src.stat().st_mtime:
                stale.append((out, "older than master"))

    # COUNT THE SUBJECT, ASSERT THE COUNT. Everything below reports on what
    # collect() walked, and an empty walk produces an empty `stale` — so a
    # discovery that found nothing printed "all derivatives present and current"
    # and exited 0, which is what a healthy repo prints. A checker that examined
    # nothing must never be able to say something positive. This is not
    # hypothetical: three of Surveyor's harnesses had the same shape and one of
    # them had been measuring nothing for its whole life.
    if not masters:
        print("bake_images --check: FAIL — walked assets/ and found no masters "
              "at all. Discovery is broken (wrong root, SKIP_DIRS, or a partial "
              "checkout), not the derivatives.", file=sys.stderr)
        return 1

    # Orphans do not break the site, so they are a note rather than a failure —
    # --check's exit code should mean "the page will render", nothing else.
    extra = orphans()
    if extra:
        print(f"bake_images --check: note — {len(extra)} orphaned derivative(s) "
              f"no ladder produces; clear with: python tools/bake_images.py --prune")

    # Same reasoning for the weight note. Over-budget rungs render perfectly;
    # they just cost more than they should, and some of them do so knowingly —
    # the wallpapers tab exists to show art at size. A note keeps the number
    # current without turning a judgement call into a build failure.
    heavy = sorted(((p.stat().st_size, p) for p in DERIVED.rglob("*.avif")
                    if p.stat().st_size > BUDGET_BYTES), reverse=True)
    if heavy:
        print(f"bake_images --check: note — {len(heavy)} AVIF rung(s) over the "
              f"{BUDGET_BYTES // 1024} KB budget (WebP is not gated; see CLAUDE.md)")
        for size, out in heavy:
            print(f"  {out.relative_to(ROOT).as_posix():52s} {size / 1024:5.0f} KB")

    if not stale:
        print(f"bake_images --check: {masters} master(s), {rungs} derivative(s), "
              f"all present and current")
        return 0

    print(f"bake_images --check: {len(stale)} derivative(s) stale or missing")
    for out, why in stale:
        print(f"  {out.relative_to(ROOT).as_posix():52s} {why}")
    print("Run: python tools/bake_images.py")
    return 1


def cases() -> int:
    """Prove --check can still refuse. Doctrine rule 12; CLAUDE.md, "Count the subject".

    This checker is the reason that rule is written down. On 2026-08-20 it printed
    "all derivatives present and current" over an EMPTY WALK: collect() found no masters,
    so the stale list was empty, so it said what a healthy repo says and exited 0. The
    guard against that is in check() now — and until this mode existed, nothing anywhere
    demonstrated that the guard fires. A guard nobody has seen fire is a comment.

    Three things are driven, all of them the real functions:
      1. check() with discovery broken, which must FAIL rather than congratulate itself.
      2. is_stale(), the staleness decision, over real files with real mtimes.
      3. the live walk, which must find the masters this repo actually has.
    """
    import contextlib
    import io as _io
    import tempfile
    import time as _time

    bad = 0

    def say(ok, name, detail=""):
        nonlocal bad
        bad += 0 if ok else 1
        print(f"  {'ok  ' if ok else 'WRONG'} {name:<58} {detail}")

    # ---- 1. the incident itself -------------------------------------------------------
    global collect
    real_collect = collect
    try:
        collect = lambda: []                                  # noqa: E731 — discovery broken
        out = _io.StringIO()
        err = _io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = check()
        text = out.getvalue() + err.getvalue()
        say(rc == 1, "an EMPTY WALK fails", f"exit {rc} (wanted 1)")
        say("all present and current" not in text,
            "an empty walk never prints the healthy sentence",
            "clean" if "all present and current" not in text else "IT STILL SAYS IT")
        say("iscovery is broken" in text, "and it says discovery is broken, not the images")
    finally:
        collect = real_collect

    # ---- 2. the staleness decision ----------------------------------------------------
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        src = tmp / "master.png"
        src.write_bytes(b"x")
        out_file = tmp / "derived.avif"

        say(is_stale(src, out_file), "a MISSING derivative is stale", "no file")

        out_file.write_bytes(b"y")
        old = src.stat().st_mtime - 100
        os.utime(out_file, (old, old))
        say(is_stale(src, out_file), "a derivative OLDER than its master is stale")

        newer = src.stat().st_mtime + 100
        os.utime(out_file, (newer, newer))
        say(not is_stale(src, out_file), "a derivative newer than its master is not")

        same = src.stat().st_mtime
        os.utime(out_file, (same, same))
        say(is_stale(src, out_file),
            "EQUAL mtimes count as stale, not fresh",
            "a rebuild in the same second must not be trusted")

    # ---- 3. the live walk -------------------------------------------------------------
    masters = real_collect()
    say(len(masters) >= 50, "the live walk finds this repo's masters", f"{len(masters)} found")
    rungs = sum(1 for src, widths in masters for _ in expected(src, widths))
    say(rungs >= len(masters), "and every master resolves to at least one rung",
        f"{rungs} rung(s)")

    if bad:
        print(f"bake_images --cases: {bad} case(s) WRONG", file=sys.stderr)
        return 1
    print(f"bake_images --cases: 9 of 9 as expected (5 of them proving it still refuses; "
          f"live walk {len(masters)} masters, {rungs} rungs)")
    return 0


def install_hooks() -> int:
    """Copy the versioned hooks into .git/hooks/ and mark them executable.

    Five of them now. pre-commit bakes images and markup and refuses a stale context pack;
    commit-msg refuses a commit that reaches across unrelated projects — see
    tools/check_scope.py; and three keep the context pack honest against every ordinary way
    HEAD moves — post-commit for a commit, post-rewrite for a rebase or an amend, and
    post-checkout for a branch switch. They are separate hooks because they need different
    things: one runs before the message exists, one cannot work without it, and the last
    three have to wait until the tree is settled.

    The three pack hooks all ASK check_pack.py rather than deciding for themselves, so the
    definition of "current" lives in one function and each of them does nothing at all when
    there is nothing to do. That matters more than it sounds: an amend fires two of them.

    Still not covered, and left that way on purpose: `git merge` and `git reset` move HEAD
    without firing any of these. check_pack.py at the next pre-commit is the backstop for
    both, and a backstop is the right weight for two operations that are rare here — unlike
    a branch switch, which is not, and which is why post-checkout was added the day one
    left a stale pack behind on main.

    This is deliberately the one installer for all of them. CLAUDE.md and docs/ONBOARDING.md
    both send a fresh clone here, and a second installer script would be a second thing to
    remember and the one nobody runs.
    """
    hooks = ROOT / ".git" / "hooks"
    if not hooks.is_dir():
        print("ERROR: .git/hooks not found — run this from inside the repo", file=sys.stderr)
        return 1

    for name in ("pre-commit", "commit-msg", "post-commit", "post-rewrite",
                 "post-checkout"):
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
    if "--cases" in sys.argv[1:]:
        return cases()

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
