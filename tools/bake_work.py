#!/usr/bin/env python3
"""Build assets/work/work.json — the manifest the work overlay renders from.

WHY THIS EXISTS RATHER THAN MORE <!-- img --> DIRECTIVES
The featured-work overlay shows every piece in assets/work/, which is 350 files
and climbing. Eight of them — frame 1 of each card's carousel — are named in
index.html the normal way and go through bake_markup.py. The other 342 cannot:
40 <picture> blocks in the home page would be 40 images the browser fetches for
one visible card, and 350 would be a 30,000-line index.html.

So the gallery is data. But CLAUDE.md's rule stands — **never build a
derivative URL in JS at all** — because a hand-built URL is a second cache entry
for identical bytes and a hand-picked width goes stale against `sizes`. The way
both are true at once is that THIS script writes the finished srcset strings,
using bake_markup's own derivative() and stamp(), and script.js only ever
injects strings it was handed. Nothing in the browser concatenates a filename.

    assets/work/work-index.json   <- written by a person: the taxonomy
    assets/work/<category>/*.webp <- the masters
    assets/work/work.json         <- written HERE, read by script.js

Flags:
    (none)     rebuild work.json
    --check    report that it is stale and exit 1; writes nothing
    --cases    prove --check can still refuse (see cases())
"""

from pathlib import Path
import json
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bake_markup import derivative, usable_widths                  # noqa: E402
from image_slots import SLOTS                                      # noqa: E402

try:
    from PIL import Image
except ImportError:                                                # pragma: no cover
    print("ERROR: Pillow is required — python -m pip install 'pillow>=11.3'", file=sys.stderr)
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "assets" / "work"
INDEX = WORK / "work-index.json"
MANIFEST = WORK / "work.json"

MASTER_EXTS = {".webp", ".png", ".jpg", ".jpeg"}

# A piece's project is its stem without the trailing sequence number, so
# brigadier-bluebeard-3 and brigadier-bluebeard-5 are two views of one project
# and share a title. Files with no number are their own project.
SEQ = re.compile(r"-(\d+)$")


def project_of(stem: str) -> tuple[str, int]:
    m = SEQ.search(stem)
    return (stem[: m.start()], int(m.group(1))) if m else (stem, 1)


def titlecase(project: str) -> str:
    """Fallback title for a project with no override in work-index.json."""
    return " ".join(w.upper() if len(w) <= 2 and w.isalpha() else w.capitalize()
                    for w in project.split("-"))


def load_index() -> dict:
    if not INDEX.exists():
        raise SystemExit(f"ERROR: {INDEX.relative_to(ROOT).as_posix()} is missing")
    return json.loads(INDEX.read_text(encoding="utf-8"))


# The three places a gallery piece is drawn. All three read the SAME ladder, so
# a piece has one srcset per format and the three differ only in `sizes` — which
# is why sizes is hoisted to the top of the manifest and written once instead of
# 343 x 3 x 2 times. (That duplication was 560 KB of manifest for 200 KB of
# facts.) If one of these ever moves to its own ladder, this stops being true
# and srcset has to come back down into the item; the assert below is what will
# say so rather than the page quietly serving the wrong widths.
SLOT_FOR = {"hero": "work-hero", "thumb": "work-thumb", "card": "work-card-frame"}


def srcsets(master: Path) -> dict[str, str]:
    """One finished srcset per format for one master, or {} if it has no rungs.

    Same URLs bake_markup.render_picture() writes into index.html, from the
    same derivative()/stamp() — as data rather than as markup, so that the
    browser is handed strings instead of assembling them.

    EMPTY IS A LEGAL ANSWER, unlike in render_picture(). A master narrower than
    the ladder's smallest rung has no derivative to offer — never upscale — and
    the right thing to serve is the master itself, which is already the <img>
    fallback every item carries. Two pieces are in that position today
    (gizmo-td-4 at 315px, random-works-4 at 374).
    """
    widths = usable_widths(master, "work-hero")
    if not widths:
        return {}
    return {ext: ", ".join(f"{derivative(master, w, ext)} {w}w" for w in widths)
            for ext in ("avif", "webp")}


def build() -> tuple[dict, list[str]]:
    """Return (manifest, notes). Raises on anything that would ship broken."""
    index = load_index()
    notes, cats = [], []

    # COUNT THE SUBJECT before the loop, not after it (CLAUDE.md). A loop over
    # an empty list emits nothing, finds nothing wrong, and returns a manifest
    # that renders an empty overlay — indistinguishable from a healthy run.
    if not index.get("categories"):
        raise SystemExit("ERROR: work-index.json declares no categories")

    # The one assumption the hoisted `sizes` rests on. Checked here rather than
    # trusted, because breaking it is a one-word edit in image_slots.py and the
    # symptom would be silently wrong widths, not an error.
    ladders = {SLOTS[s]["ladder"] for s in SLOT_FOR.values()}
    if len(ladders) != 1:
        raise SystemExit(f"ERROR: the work slots no longer share one ladder "
                         f"({sorted(ladders)}); srcset must move back into each item")

    for spec in index["categories"]:
        folder = WORK / spec["id"]
        if not folder.is_dir():
            raise SystemExit(f"ERROR: no folder for category {spec['id']!r}")

        on_disk = sorted(p for p in folder.iterdir()
                         if p.is_file() and p.suffix.lower() in MASTER_EXTS)
        if not on_disk:
            raise SystemExit(f"ERROR: {spec['id']}/ holds no masters — a category "
                             f"that renders nothing is a broken walk, not an empty one")

        omit = set(spec.get("omit", ()))
        titles = spec.get("titles", {})
        notes_by = spec.get("notes", {})
        shown = [p for p in on_disk if p.stem not in omit]
        if not shown:
            raise SystemExit(f"ERROR: every piece in {spec['id']}/ is omitted")

        # Card frames first and in the order given, then the rest alphabetically.
        # Frame 1 is the card's thumbnail, so it is also item 0 of the category:
        # clicking the card lands on the piece it was showing.
        frames = spec["frames"]
        missing = [f for f in frames if not any(p.stem == f for p in shown)]
        if missing:
            raise SystemExit(f"ERROR: {spec['id']} frames name pieces that are not "
                             f"shown: {', '.join(missing)}")
        order = {stem: i for i, stem in enumerate(frames)}
        shown.sort(key=lambda p: (order.get(p.stem, len(frames)), p.stem))

        items = []
        for p in shown:
            project, _n = project_of(p.stem)
            with Image.open(p) as im:
                w, h = im.size
            items.append({
                "stem": p.stem,
                "title": titles.get(project, titlecase(project)),
                "desc": notes_by.get(project, spec["label"]),
                # The <img> fallback, and the whole picture for a master too
                # small to have derivatives. No ?v= stamp: only assets/derived/
                # is served immutable (vercel.json), so a master re-export
                # reaches people on its own.
                "src": p.relative_to(ROOT).as_posix(),
                "w": w, "h": h,
                "srcset": srcsets(p),
            })

        by_stem = {it["stem"]: i for i, it in enumerate(items)}
        cats.append({
            "id": spec["id"],
            "label": spec["label"],
            "blurb": spec.get("blurb", ""),
            # The carousel's frames are POINTERS into items, not copies of
            # them: `index` is both where the frame's art lives and the piece
            # the overlay opens on when that card is clicked. Frame 0 is also
            # written into index.html, and the JS leaves that one alone — it
            # reads the markup's own <picture>, so the card's first paint is
            # one file and one cache entry either way.
            "frames": [{"index": by_stem[f], "pos": spec.get("pos", {}).get(f, "")}
                       for f in frames],
            "items": items,
        })

        skipped = len(on_disk) - len(shown)
        notes.append(f"  {spec['id']:12s} {len(shown):3d} shown, {skipped:2d} omitted, "
                     f"{len(frames)} card frame(s)")

    if len(cats) != len(index["categories"]):
        raise SystemExit("ERROR: built fewer categories than the index declares")

    return {"sizes": {k: SLOTS[s]["sizes"] for k, s in SLOT_FOR.items()},
            "categories": cats}, notes


def render(manifest: dict) -> str:
    return json.dumps(manifest, indent=1, ensure_ascii=False) + "\n"


def check() -> int:
    manifest, notes = build()
    total = sum(len(c["items"]) for c in manifest["categories"])
    frames = sum(len(c["frames"]) for c in manifest["categories"])

    # COUNT THE SUBJECT, ASSERT THE COUNT (CLAUDE.md). build() already refuses
    # an empty category and an empty walk, so by here the only way to reach a
    # positive claim is with real pieces behind it — but say the numbers out
    # loud anyway, because the failure this guards against looks exactly like
    # success from the outside.
    if not manifest["categories"] or not total:
        print("bake_work --check: FAIL — no categories or no pieces. Discovery "
              "is broken, not the manifest.", file=sys.stderr)
        return 1

    print("\n".join(notes))
    if not MANIFEST.exists():
        print(f"bake_work --check: FAIL — {MANIFEST.relative_to(ROOT).as_posix()} "
              f"is missing; run: python tools/bake_work.py", file=sys.stderr)
        return 1
    if MANIFEST.read_text(encoding="utf-8") != render(manifest):
        print(f"bake_work --check: FAIL — {MANIFEST.relative_to(ROOT).as_posix()} "
              f"is stale (masters, ladder or index changed); run: "
              f"python tools/bake_work.py", file=sys.stderr)
        return 1

    print(f"bake_work --check: {len(manifest['categories'])} categor(ies), "
          f"{total} piece(s), {frames} card frame(s), manifest current")
    return 0


def cases() -> int:
    """Drive build()/render() through the states they must refuse.

    Not a copy of the logic — these call the real functions against a real
    index, with one thing wrong at a time. Every gate in this repo has this
    mode and a new one is not finished without it (CLAUDE.md).
    """
    import copy
    real = load_index()

    def refuses(mutate, why):
        global load_index
        keep = load_index
        bad = copy.deepcopy(real)
        mutate(bad)
        load_index = lambda: bad                             # noqa: E731
        try:
            build()
        except SystemExit:
            return True
        except (KeyError, ValueError, StopIteration):
            return True
        finally:
            load_index = keep
        print(f"  NOT REFUSED: {why}", file=sys.stderr)
        return False

    checks = [
        (lambda i: i["categories"][0].update(id="does-not-exist"),
         "a category with no folder"),
        (lambda i: i["categories"][0].update(frames=["nope-99"]),
         "a card frame naming a piece that is not there"),
        (lambda i: i["categories"][0].update(
            omit=[p.stem for p in (WORK / i["categories"][0]["id"]).iterdir()
                  if p.suffix.lower() in MASTER_EXTS]),
         "a category with every piece omitted"),
        (lambda i: i.__setitem__("categories", []),
         "an index that declares no categories at all"),
    ]
    # The size of the table is itself asserted: a loop that emits checks emits
    # none when its subject is empty, and everything still passes.
    assert len(checks) == 4, "the refusal table lost a case"

    ok = sum(refuses(m, w) for m, w in checks)

    # ...and one control, proving the live subject is still discovered. Without
    # this the four above would pass just as happily against an empty repo.
    manifest, _ = build()
    total = sum(len(c["items"]) for c in manifest["categories"])
    live = len(manifest["categories"]) >= 4 and total >= 100
    if not live:
        print(f"  CONTROL FAILED: only {len(manifest['categories'])} categor(ies) "
              f"and {total} piece(s) found", file=sys.stderr)

    print(f"bake_work --cases: {ok}/{len(checks)} refusals, control "
          f"{'ok' if live else 'FAILED'} ({total} live pieces)")
    return 0 if ok == len(checks) and live else 1


def main() -> int:
    if "--check" in sys.argv:
        return check()
    if "--cases" in sys.argv:
        return cases()

    manifest, notes = build()
    MANIFEST.write_text(render(manifest), encoding="utf-8")
    total = sum(len(c["items"]) for c in manifest["categories"])
    print("\n".join(notes))
    print(f"bake_work: wrote {MANIFEST.relative_to(ROOT).as_posix()} — "
          f"{len(manifest['categories'])} categor(ies), {total} piece(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
