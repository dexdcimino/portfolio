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
    # Top Picks cover art. Five across, so these are small: 282px at a 1920
    # viewport, 297px three-up on a tablet, ~224px two-up on a phone. 600 is
    # 2x the widest case and 3x the phone case; the `card` ladder's 900 could
    # never be selected here and would bake 30 files nothing serves.
    "cover":  (600, 400, 200),
    # Square album art. Same grid as `cover`, so the CSS widths are identical --
    # but measuring what the browser can actually select turns up a case the
    # cover ladder does not serve: at a 560px viewport the grid is 2-up at
    # 225px, and a 3x screen there asks for 675px. 600 would upscale. 800 is
    # both the fix and the master's native size, so it costs nothing to reach.
    # Kept separate rather than widening `cover`: adding 800 there would re-bake
    # every 2:3 game and movie cover at full width for a case they never hit.
    "song":   (800, 600, 400, 200),
    # Games section thumbnail. Measured, not inherited: the preview is 476px at
    # a 1920 desktop but jumps to its 520px cap below 1100, where the split
    # collapses to one column and the left half goes full width. That 520 at 2x
    # is 1040 device px — the widest ask on the page for this slot, and none of
    # the existing ladders reach it.
    "thumb":  (1200, 900, 600, 400),
    # Full-size viewing: an image that fills a lightbox rather than a grid cell.
    # Nothing uses this yet — it is here because the work overlay's hero is the
    # next thing to get real art, and a 19vw thumbnail ladder would visibly
    # under-serve it. Give that hero a slot pointing here when it lands.
    "gallery": (1600, 1200, 900, 600),
    # AI wallpapers. Sources are 2560x1600, and unlike every other ladder here
    # the top rung is not for the layout — the carousel's main image is only
    # ~856px wide. 2560 exists because the lightbox shows the piece at 90vw,
    # which on a 2560 display asks for 2304 device px, and because these are
    # smooth gradients that cost far less at width than a photograph would.
    "wallpaper": (2560, 1920, 1280, 900, 600),
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
    # Every Top Picks cover — games, movies and songs share one 2:3 grid, so
    # they share one slot. Declared a touch wider than measured at each
    # breakpoint, which is the safe direction to round `sizes`.
    "pick-cover": dict(
        ladder="cover",
        sizes="(max-width:560px) 42vw, (max-width:1100px) 28vw, 15vw",
    ),
    # Songs are 1:1, not 2:3 -- album art is natively square and cropping it to
    # the portrait cell would be wrong. Same grid cell, so the same `sizes`;
    # different ladder, per the note above.
    "song-cover": dict(
        ladder="song",
        sizes="(max-width:560px) 42vw, (max-width:1100px) 28vw, 15vw",
    ),
    # The preview is capped at 520px and otherwise tracks its column, so `sizes`
    # is the cap below the one-column breakpoint and a slightly generous vw
    # above it — rounding up is the safe direction.
    "game-art": dict(
        ladder="thumb",
        sizes="(max-width:1100px) 520px, min(520px, 26vw)",
    ),
    # Gallery overlay hero: near-full-bleed inside the modal. The gallery
    # ladder has been reserved for exactly this since it was defined.
    "game-shot": dict(
        ladder="gallery",
        sizes="(max-width:1100px) 92vw, min(1200px, 78vw)",
    ),
    # AI Lab app icon: a square badge in the corner of a card, sized off the
    # card's height rather than its width, so it never gets large. The avatar
    # ladder already covers exactly this range (420/200/84) and a third small
    # ladder would be one more thing to keep in step for no gain.
    "ai-icon": dict(
        ladder="avatar",
        sizes="(max-width:700px) 64px, 84px",
    ),
    # The wallpaper carousel's main image. It fills the AI panel, which is the
    # wide column of a split section — about 856px at 1920 and the full width
    # once the split collapses below 1100. `sizes` describes THAT, not the
    # lightbox: the lightbox rewrites sizes on its own copy at runtime, which
    # is how one picture element serves a 500px card and a 2300px overlay
    # without baking two sets.
    "wallpaper": dict(
        ladder="wallpaper",
        sizes="(max-width:1100px) 92vw, min(56vw, 900px)",
    ),
    # Clip posters. Same stage and therefore the same `sizes` as a wallpaper —
    # only the aspect differs (16:9 against 16:10), and aspect is a CSS concern,
    # not a width one. They share the wallpaper ladder too: the sources are
    # 1920 wide, so the 2560 rung is simply skipped for being above the master.
    "clip-poster": dict(
        ladder="wallpaper",
        sizes="(max-width:1100px) 92vw, min(56vw, 900px)",
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
