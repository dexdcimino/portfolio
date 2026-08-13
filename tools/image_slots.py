#!/usr/bin/env python3
"""Where an image appears on the page, and therefore what has to be baked.

This is the single source of truth shared by both halves of the pipeline:

    bake_images.py   reads it to decide which widths to encode
    bake_markup.py   reads it to write the <picture> blocks in index.html

Keeping it in one file is the point. When `sizes` lived in the markup it was
typed twice per block (once per <source>) and the widths were typed a third
time in the srcset — three copies of one fact, none of them checked.

A SLOT is a place in the layout, not an image: "the featured-work grid cell",
"the rail avatar". It owns the two things only a human can know — how big the
slot renders (`sizes`) and how urgent it is (`eager`) — plus the LADDER that
suits its size. Images then just say which slot they sit in.
"""

# Width ladders by role. Grid thumbnails and full-bleed art want different
# ladders: a 19vw card never needs 1600px, and the sidebar avatar never needs
# anything above 420. Change a ladder here and every image in that role
# re-bakes and re-writes its markup on the next run.
LADDERS = {
    "hero":   (900, 600, 400),        # the mascot: big, but capped by its own source
    "card":   (900, 600, 400),        # featured-work grid cells
    "art":    (600, 400),             # secondary decorative art
    "accent": (400,),                 # small fixed-position flourishes
    "photo":  (840, 420, 200),        # the About portrait
    "avatar": (420, 200, 84),         # the sidebar avatar, down to 84px collapsed
    # Full-size viewing: an image that fills a lightbox rather than a grid cell.
    # Nothing uses this yet — it is here because the work overlay's hero is the
    # next thing to get real art, and a 19vw thumbnail ladder would visibly
    # under-serve it. Give that hero a slot pointing here when it lands.
    "gallery": (1600, 1200, 900, 600),
}

# `sizes` must describe the real rendered slot or the browser picks the wrong
# entry and the whole exercise is wasted — so it lives next to the ladder that
# serves it, written once.
SLOTS = {
    "hero-mascot": dict(
        ladder="hero",
        sizes="(max-width:1100px) 78vw, (max-width:1250px) 58vw, min(47vw, 800px)",
        eager=True,      # LCP element: no lazy, fetchpriority=high, and preloaded
    ),
    "hero-goblin": dict(
        ladder="art",
        sizes="min(50vw, 624px)",
    ),
    "hero-archer": dict(
        ladder="accent",
        sizes="min(26vw, 340px)",
    ),
    "work-card": dict(
        ladder="card",
        sizes="(max-width:760px) 88vw, (max-width:1100px) 41vw, 19vw",
    ),
    # Same grid cell, but the mascot is drawn contained rather than cover-cropped,
    # so it never needs the 900 the photographic cards do.
    "work-card-art": dict(
        ladder="art",
        sizes="(max-width:760px) 88vw, (max-width:1100px) 41vw, 19vw",
    ),
    "about-photo": dict(
        ladder="photo",
        sizes="(max-width:760px) min(90vw, 330px), min(32vw, 420px)",
    ),
    "rail-avatar": dict(
        ladder="avatar",
        sizes="200px",
    ),
}


def slot_widths(slot: str) -> tuple[int, ...]:
    """The widths one slot emits into its srcset, widest first."""
    if slot not in SLOTS:
        raise KeyError(f"unknown slot {slot!r} — add it to SLOTS in tools/image_slots.py")
    return tuple(sorted(LADDERS[SLOTS[slot]["ladder"]], reverse=True))


# Masters that never appear in the markup because they are swapped in by name
# at runtime. The accent picker rewrites `mascot_limegreen-900.avif` to
# `mascot_red-900.avif`, so all seven mascots need whatever ladder the slots
# give the one that IS named. Deriving each independently would leave six of
# them with the default ladder and no guarantee it still contains 900.
#   glob of followers -> the master whose ladder they copy
SIBLINGS = {
    "assets/mascots/mascot_*.png": "assets/mascots/mascot_limegreen.png",
}


def widths_for(master_rel: str, used_by: dict[str, set[str]], default: tuple[int, ...]) -> tuple[int, ...]:
    """Widths to BAKE for one master, given which slots reference it.

    `used_by` maps a master path to the slot names that use it, which
    bake_markup.py scrapes out of index.html — so the encode list is derived
    from the page rather than maintained beside it.

    An image is baked at exactly the widths its slots ask for. Anything else is
    dead weight: an image in a 19vw grid cell has no use for a 1600px
    derivative, and at a dozen new images that is a lot of files nothing will
    ever serve. Masters the markup never names fall back to a sibling's ladder
    if they have one, and to the standard ladder otherwise.
    """
    from fnmatch import fnmatch

    asked = {w for slot in used_by.get(master_rel, ()) for w in slot_widths(slot)}
    if asked:
        return tuple(sorted(asked, reverse=True))

    for pattern, leader in SIBLINGS.items():
        if fnmatch(master_rel, pattern) and leader != master_rel:
            inherited = {w for slot in used_by.get(leader, ()) for w in slot_widths(slot)}
            if inherited:
                return tuple(sorted(inherited, reverse=True))
    return default
