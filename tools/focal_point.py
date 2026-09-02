#!/usr/bin/env python3
"""Where the subject of a picture is, so a cover-crop can keep its head on.

THE PROBLEM. A featured card is `object-fit:cover` in a box near 1.175:1 and a
filmstrip thumb is one at exactly 1.5:1. A portrait master dropped into either
keeps its full width and loses the top and bottom EQUALLY, which on a standing
figure is precisely the head and the feet. Every full-body character in the
gallery came out cropped to a waist: Brigadier Bluebeard showed a belt buckle,
Nyxara and Nimp were headless (Dex, 2026-09-01).

WHAT IS MEASURED. Row and column ENERGY -- the variance WITHIN each line of
pixels, not its difference from a background colour. That distinction is the
whole method:

  A graded plate is a different colour on every row while staying flat across
  each one. The first version of this compared each pixel to the median of the
  border ring, which found the figures standing on flat dark plates and missed
  osseous-2, mecha-bot-3 and sandstone-guardian-1 -- three of the exact
  complaints -- because a gold border, a wide subject and a painted backdrop
  each put colour at the edges.

WHAT IS NOT MEASURED, deliberately. An earlier cut gated everything on "is
there an empty plate behind the subject", and refused to move anything that
failed. Measuring all fifteen vertically-cropped frames in the set instead:
aiming at the top of the subject is right on fourteen of them, and the one it
costs is an interior room where the top is ceiling. That one takes a `pos`
override in work-index.json. A gate that silently declines to fix
three-quarters of the reported problem is worse than a rule with one known
exception written down.

The y clamp is what makes it safe: this can pull a crop UP toward a head, never
push one DOWN past where the browser would have put it.

ONLY THE VERTICAL AXIS IS AIMED. A version that also re-centred horizontally on
the subject band was built and then measured against the set: not one landscape
frame had a framing problem to fix, and the rule produced gobbler-fish-2 at 92%
and bluebeards-blaster-2 pinned to 100% -- both worse than the centre they
replaced. Vertical is where the complaint was and where the geometry actually
bites, because these masters are portraits in a landscape box. x stays at 50%.
"""

from PIL import Image

# How much of the subject's own height to leave above it, as a fraction of the
# image. Zero puts the crop edge exactly on the topmost pixel of the subject,
# which reads as clipped even when nothing is actually lost.
HEADROOM = .03

# A line counts as subject when its energy reaches this fraction of the
# strongest line in the image. Low enough to catch a horn or an antenna against
# a plate, high enough that sensor noise and JPEG mush do not register.
THRESHOLD = .22

# Both crops in the work gallery, measured off the CSS rather than guessed:
# .work-card is clamp(200px,24vh,258px) tall in a 19vw cell (282x240 at a 1600
# viewport); .work-thumb is a fixed 96x64.
ASPECTS = {"card": 1.175, "thumb": 1.5}

# The profile is computed on a thumbnail. The bands only need to be accurate to
# a percent or so of the height, and a 1600px master would be 40x the work for
# an answer that rounds to the same percentage.
SAMPLE = 240

# Bumped whenever the measurement changes. bake_work.py stores it beside the
# results and recomputes everything when it moves -- without that, tuning
# THRESHOLD or HEADROOM would leave every cached position stale while --check
# went on reporting the manifest as current, which is the exact shape of
# failure CLAUDE.md's "count the subject" rule is about.
VERSION = 1


def _bands(path: str) -> tuple[tuple[float, float] | None, tuple[float, float] | None]:
    """(vertical, horizontal) subject extents as 0..1 fractions, or None.

    Variance within each line. A FIND_EDGES-plus-one-pixel-resize version of
    this ran entirely in Pillow's C code and was tried first because it looked
    obviously faster; it was measured instead, and it was both SLOWER (52s
    against 35s over the set, the filter costing more than the arithmetic it
    saved) and WRONG on the cases that prompted the work -- it left kittens-3
    at y=.36 and roblox-pets-1 at y=.42, which still cuts both their faces.

    This is nobody's idea of fast Python, and it does not need to be:
    bake_work.py caches the result against the master's content stamp, so a
    piece is measured once and never again until its bytes change.
    """
    with Image.open(path) as im:
        small = im.convert("L")
        small.thumbnail((SAMPLE, SAMPLE))
    w, h = small.size
    if w < 4 or h < 4:
        return None, None
    px = list(small.getdata())

    def spread(line):
        n = len(line)
        m = sum(line) / n
        return (sum((v - m) ** 2 for v in line) / n) ** .5

    rows = [spread(px[y * w:(y + 1) * w]) for y in range(h)]
    cols = [spread(px[x::w]) for x in range(w)]

    def band(profile):
        peak = max(profile)
        if not peak:
            return None
        on = [i for i, v in enumerate(profile) if v >= peak * THRESHOLD]
        return (on[0] / len(profile), (on[-1] + 1) / len(profile)) if on else None

    return band(rows), band(cols)


def position(w: int, h: int, vband, aspect: float) -> tuple[float, float]:
    """object-position as (x, y) in 0..1 for one image in one box aspect.

    x/y name the point of the IMAGE that cover pins to the same point of the
    box, so (.5, .5) is the browser default and a SMALLER y shows more of the
    top. x is always .5 -- see the note at the top of the module.
    """
    if not vband or w / h > aspect:
        # No signal, or wider than the box and therefore cropped sideways, which
        # is the one direction this does not have an opinion about.
        return .5, .5

    keep = w / aspect
    travel = h - keep
    if travel <= 1:
        return .5, .5
    # The window's TOP lands just above where the subject starts, so a head is
    # never the thing that falls outside it. Never past halfway: this only ever
    # raises a crop.
    top = min(max(vband[0] * h - HEADROOM * h, 0), travel * .5)
    return .5, top / travel


def positions(path: str, w: int, h: int) -> dict[str, str]:
    """Every crop's object-position for one master, as CSS strings.

    Only the ones that differ from the browser default are returned, so the
    manifest does not carry "50% 50%" 686 times and a reader can see at a
    glance which pieces needed aiming.
    """
    vband, _hband = _bands(path)
    out = {}
    for name, aspect in ASPECTS.items():
        x, y = position(w, h, vband, aspect)
        if abs(y - .5) > .015:
            out[name] = f"{round(x * 100)}% {round(y * 100)}%"
    return out


def cases() -> int:
    """Prove the rule still does the thing it exists for.

    Drives position() -- the real function -- through the geometry that caused
    the complaint, rather than re-deriving it. Synthetic bands, so this holds
    with no images on disk.
    """
    tall_figure = (.03, .97)      # a standing character filling a portrait plate
    checks = [
        # 1010x1600 is brigadier-bluebeard-3, the piece that showed a belt buckle.
        ("portrait figure is raised", position(1010, 1600, tall_figure, 1.175)[1] < .06),
        ("...and in the thumb too", position(1010, 1600, tall_figure, 1.5)[1] < .06),
        # A subject that starts halfway down must NOT be dragged up past it.
        ("low subject is not over-raised", position(1000, 1600, (.5, 1.0), 1.175)[1] > .3),
        # The clamp: never below the browser's own centre.
        ("never pushed below centre", position(1000, 1600, (.9, 1.0), 1.175)[1] <= .5),
        # Landscape masters are cropped sideways, which this has no opinion about.
        ("landscape keeps y centred", position(1600, 900, (.1, .9), 1.175)[1] == .5),
        # x is never touched, on any shape.
        ("x is always centred", all(position(w, h, tall_figure, a)[0] == .5
                                    for w, h in ((1010, 1600), (1600, 900), (1100, 899))
                                    for a in ASPECTS.values())),
        # No signal must mean no opinion.
        ("no band -> default", position(1000, 1600, None, 1.175) == (.5, .5)),
        # An image already at the box aspect has nowhere to move.
        ("no travel -> default", position(1175, 1000, tall_figure, 1.175) == (.5, .5)),
    ]
    assert len(checks) == 8, "the focal case table lost a case"
    bad = [name for name, ok in checks if not ok]
    for name in bad:
        print(f"  FAILED: {name}")
    print(f"focal_point --cases: {len(checks) - len(bad)}/{len(checks)} as expected")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(cases())
