"""Bake the colour-grading LUTs. Authoring-time only.

    python tools/bake_lut.py

Writes assets/luts/*.3dl. These are the mood, and there are now two of them:

    home-golden-hour     the ACTIVE look. Golden-hour sun on warm earthy stone,
                         deep navy zenith grading to a warm cream horizon, open
                         blue shadows, full midtones. See docs/LOOK_TARGET.md
                         and art/reference/surveyor-art.png.
    night-bioluminescent the ARCHIVED look, kept and still baked. It is the
                         lighting reference for Ember and Shroud (the dark
                         worlds) and for the planned grey-and-cyan water world.
                         Nothing from that pass is wasted; it is just not Home.

WHERE THE GRADE LIVES. Babylon applies colour grading in *gamma space*, after
ACES tonemapping and contrast (verified against the shader in the vendored
build), so everything here operates on display-referred sRGB values in 0..1.
The parameters below are the grade; `js/tune.js` only chooses which file to load
and how strongly to apply it. Treat this script the way you would treat a .blend
file: it is the source, `assets/luts/` is the derivative.

A LUT authored in Resolve or Photoshop can replace these outright, as long as it
is 3DL and satisfies the max-value invariant below.

THE MAX-VALUE TRAP. Babylon's 3DL loader divides every entry by the largest
value found in the file, so a grade whose brightest output is 0.95 gets silently
rescaled back to 1.0 — you would author a crushed look and get a normal one.
Every LUT written here is asserted to contain a full-scale entry.
"""

from __future__ import annotations

from pathlib import Path

LUT_DIR = Path(__file__).resolve().parent.parent / "assets" / "luts"
SIZE = 33            # per axis; 33 is smooth enough for a hard shadow crush
MAX_CODE = 1023      # 10-bit, the usual 3DL convention

LUMA = (0.2126, 0.7152, 0.0722)


# ============================================================================
# ONE GRADE, SIX PARAMETER SETS
# ============================================================================
#
# Surveyor has six worlds with authored palettes and each wants its own mood, so
# what used to be two hand-written functions is now one function and a table.
# That is not tidiness for its own sake: the cyan protection below has to be
# identical on all six, and the surest way to keep six copies identical is to
# have one.
#
# WHERE THE GRADE LIVES. Babylon applies colour grading in *gamma space*, after
# ACES tonemapping and contrast, so everything here operates on display-referred
# sRGB values in 0..1. js/tune.js only chooses which file a world loads.
#
# WHITE MUST STAY WHITE. Babylon's 3DL loader divides every entry by the largest
# in the file, so a grade whose brightest output is 0.95 is silently rescaled
# back to 1.0 — you author a look and get a different one. Every set below keeps
# `contrast` at or above 1.0 and uses gamma rather than a black point for its
# darks, both of which map 1.0 to 1.0. write_3dl asserts it regardless.

# ---- the invariant, and the reason the table exists --------------------------
# CYAN IS RESERVED. It means technology — craft lights, colony beams, instrument
# readouts — and it is the only saturated hue in this palette. A grade that ate
# it would break that rule on every world at once, so cyan is protected the same
# way in all six: its saturation is pushed rather than pulled, and it is
# EXEMPTED FROM THE SPLIT TONE as well. That second part is new and it is what
# makes the warm worlds safe: without it, Ember's warm shadow tint would turn a
# cyan beacon standing in shade orange.
CYAN_SAT = 1.30
CYAN_LOW = 0.10              # chroma ratio where cyan protection starts
CYAN_HIGH = 0.42             # ...and where it is fully applied

# The wider cool band. Catches water, sky and haze — anything where green and
# blue sit above red at ordinary saturation — which warm grades otherwise eat.
# Warm rock scores zero on this test and is left entirely alone.
TEAL_SAT = 1.22
TEAL_LOW = 0.02
TEAL_HIGH = 0.20


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    t = min(1.0, max(0.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


# ---- the six moods -----------------------------------------------------------
# Each profile in js/tune.js already describes what its world is; these are that
# description as numbers. `toe` below 1 opens the midtones and above 1 darkens
# them, and it is used instead of a black point because gamma maps 1.0 to 1.0
# and a black point does not - see the note on the max-value trap above.
WORLDS = {
    # The reference the other five are read against, so it says as little as
    # possible: a touch of contrast, a touch of split tone, and nothing else.
    'home': dict(
        toe=0.98, lift=0.012, lift_tint=(0.85, 0.95, 1.15),
        pivot=0.46, contrast=1.06, sat=1.10,
        shadow_range=0.40, shadow_tint=(0.95, 1.00, 1.08),
        high_start=0.62, high_tint=(1.03, 1.00, 0.97)),

    # Hot and dark. The toe above 1 keeps the basalt near-black while leaving
    # 1.0 at 1.0, so the fissures - authored above 1 and already blooming - are
    # untouched and end up carrying the whole frame. Its shadow tint is WARM,
    # the one place this table contradicts the others: on a world lit from
    # underfoot the shade is fire-coloured, not sky-coloured.
    'ember': dict(
        toe=1.22, lift=0.004, lift_tint=(1.30, 0.80, 0.55),
        pivot=0.38, contrast=1.14, sat=1.18,
        shadow_range=0.46, shadow_tint=(1.14, 0.92, 0.78),
        high_start=0.50, high_tint=(1.06, 0.96, 0.84)),

    # Pale, washed, high-key. The wash comes from the toe and the lift rather
    # than from dropping contrast below 1, which would pull white down with it.
    'tarn': dict(
        toe=0.88, lift=0.030, lift_tint=(0.95, 1.02, 1.12),
        pivot=0.52, contrast=1.00, sat=0.92,
        shadow_range=0.42, shadow_tint=(0.98, 1.01, 1.06),
        high_start=0.55, high_tint=(1.02, 1.02, 1.00)),

    # Cold. The deepest blue shadow of the six, which is the same call the
    # palette makes - on ice the shadow is the colour information.
    'vault': dict(
        toe=0.97, lift=0.010, lift_tint=(0.62, 0.85, 1.40),
        pivot=0.46, contrast=1.12, sat=1.05,
        shadow_range=0.50, shadow_tint=(0.80, 0.92, 1.22),
        high_start=0.60, high_tint=(0.98, 1.00, 1.05)),

    # Violet murk. Both ends tinted toward violet rather than split warm against
    # cool, because the fog is the light here and it is all one colour.
    'shroud': dict(
        toe=1.06, lift=0.014, lift_tint=(1.05, 0.85, 1.25),
        pivot=0.44, contrast=1.04, sat=0.96,
        shadow_range=0.48, shadow_tint=(1.06, 0.88, 1.18),
        high_start=0.60, high_tint=(1.02, 0.97, 1.06)),

    # Rust and ochre, and the most saturated of the six - it is the world with
    # the most surface to carry it.
    'anvil': dict(
        toe=0.96, lift=0.014, lift_tint=(0.95, 0.92, 1.10),
        pivot=0.45, contrast=1.10, sat=1.22,
        shadow_range=0.44, shadow_tint=(1.00, 0.95, 1.05),
        high_start=0.55, high_tint=(1.10, 1.00, 0.86)),
}


def grade(P):
    """Build one world's transform from its parameter set."""

    def apply(rgb):
        r, g, b = rgb

        # --- tone: gamma and a tinted lift, never a black point --------------
        lum_in = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b
        lift = P['lift'] * (1.0 - smoothstep(0.0, 0.55, lum_in))
        r = r ** P['toe'] + lift * P['lift_tint'][0]
        g = g ** P['toe'] + lift * P['lift_tint'][1]
        b = b ** P['toe'] + lift * P['lift_tint'][2]

        # --- contrast: a gentle S about the pivot ---------------------------
        pv, c = P['pivot'], P['contrast']
        r = max(0.0, pv + (r - pv) * c)
        g = max(0.0, pv + (g - pv) * c)
        b = max(0.0, pv + (b - pv) * c)

        lum = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b

        # --- saturation, with the two protected cool bands ------------------
        # Both tests measure "green and blue above red"; they differ only in how
        # much of it is needed to fire.
        chroma = max(0.0, min(g, b) - r)
        peak = max(r, g, b, 1e-6)
        ratio = chroma / peak
        cyan = smoothstep(CYAN_LOW, CYAN_HIGH, ratio)
        teal = smoothstep(TEAL_LOW, TEAL_HIGH, ratio)
        sat = lerp(P['sat'], TEAL_SAT, teal)
        sat = lerp(sat, CYAN_SAT, cyan)

        r = lum + (r - lum) * sat
        g = lum + (g - lum) * sat
        b = lum + (b - lum) * sat

        # --- split tone, WITH CYAN EXEMPTED ---------------------------------
        # The exemption is why cyan survives six different moods. Saturating it
        # and then tinting it warm would hand back with one line what the line
        # above just protected - and on Ember, whose shade is deliberately
        # fire-coloured, that is exactly what would happen to a beacon in shadow.
        keep = 1.0 - cyan
        shadow = (1.0 - smoothstep(0.0, P['shadow_range'], lum)) * keep
        r *= lerp(1.0, P['shadow_tint'][0], shadow)
        g *= lerp(1.0, P['shadow_tint'][1], shadow)
        b *= lerp(1.0, P['shadow_tint'][2], shadow)

        high = smoothstep(P['high_start'], 1.0, lum) * keep
        r *= lerp(1.0, P['high_tint'][0], high)
        g *= lerp(1.0, P['high_tint'][1], high)
        b *= lerp(1.0, P['high_tint'][2], high)

        return (min(1.0, max(0.0, r)), min(1.0, max(0.0, g)), min(1.0, max(0.0, b)))

    return apply


def identity(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    return rgb


def write_3dl(path: Path, transform, size: int = SIZE) -> None:
    """3DL in the layout Babylon's loader expects.

    The loader takes the LUT size from the token count of the first line, then
    reads one 'r g b' triple per line with the BLUE axis varying fastest and RED
    slowest — index = red + green*N + blue*N*N. Written any other way, the
    channels come out transposed and everything goes magenta.
    """
    lines = [" ".join(str(round(i / (size - 1) * MAX_CODE)) for i in range(size))]

    largest = 0
    denominator = size - 1
    for red in range(size):                      # slowest
        for green in range(size):
            for blue in range(size):             # fastest
                out = transform((red / denominator, green / denominator, blue / denominator))
                codes = [round(c * MAX_CODE) for c in out]
                largest = max(largest, *codes)
                lines.append(f"{codes[0]} {codes[1]} {codes[2]}")

    if largest != MAX_CODE:
        raise SystemExit(
            f"{path.name}: brightest entry is {largest}, not {MAX_CODE}. Babylon "
            f"normalises by the file maximum, so this LUT would be silently "
            f"brightened by {MAX_CODE / largest:.3f}x. Keep white mapping to white."
        )

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n")
    print(f"wrote {path.relative_to(LUT_DIR.parent.parent)} "
          f"({size}^3, {len(lines)} lines, {path.stat().st_size / 1024:.0f} KB)")


def main() -> None:
    # Identity first: the A/B control that proves the plumbing is neutral before
    # any look is judged through it, and what every world shipped with from T1
    # until this pass.
    write_3dl(LUT_DIR / "identity.3dl", identity)
    for name, params in WORLDS.items():
        write_3dl(LUT_DIR / (name + ".3dl"), grade(params))

    # A few samples per world, so a change here can be read without opening a
    # game. Cyan is on every one of them on purpose: it is the invariant.
    probes = [
        ((0.18, 0.18, 0.18), "18% grey"),
        ((0.50, 0.50, 0.50), "midtone"),
        ((1.00, 1.00, 1.00), "white, must stay full scale"),
        ((0.45, 0.86, 0.88), "CYAN TECH, the reserved hue"),
        ((0.55, 0.40, 0.28), "lit warm stone"),
    ]
    for name, params in WORLDS.items():
        fn = grade(params)
        print("")
        print(name)
        for rgb, label in probes:
            out = fn(rgb)
            si = (max(rgb) - min(rgb)) / max(max(rgb), 1e-6)
            so = (max(out) - min(out)) / max(max(out), 1e-6)
            extra = ("   sat %.2f -> %.2f" % (si, so)) if "CYAN" in label else ""
            print("  %s -> %s   %s%s" % (
                tuple(round(c, 2) for c in rgb),
                tuple(round(c, 3) for c in out), label, extra))


if __name__ == "__main__":
    main()
