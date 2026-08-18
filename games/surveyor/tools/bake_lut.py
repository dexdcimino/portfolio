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
# home-golden-hour — the active grade
# ============================================================================
#
# THE INVERSION. The night grade's whole job was removing midtones: crush to
# blue-black, desaturate broadly, let one cold key and an emissive cyan carry
# three separate value bands. This grade does the opposite in every term.
#
#   - Nothing is crushed. BLACK_POINT is 0 and the toe LIFTS instead, because
#     the target's shadows are open and filled by sky light, not empty.
#   - Saturation goes ABOVE 1. Colour now lives in the surface — warm ochre
#     stone — where before it lived only in the light.
#   - The tint is a SPLIT TONE, warm highlights against cool shadows, which is
#     what a low warm sun against a big blue sky physically does. The night
#     grade tinted both ends cold.
#
# What carries over unchanged is the idea of protecting one hue band by name.
# Cyan is still the reserved colour; its job changed from bioluminescence to
# technology, but the grade's treatment of it did not.

# Tone. A gentle lift, no crush: the darkest thing in the key art is open
# blue shadow, not black, and there is no value below it to recover.
BLACK_POINT = 0.0
TOE_GAMMA = 0.94             # <1 opens the midtones; >1 was pulling them down
SHADOW_LIFT = 0.018          # absolute lift into the darks, tinted by LIFT_TINT
LIFT_TINT = (0.55, 0.85, 1.35)     # the lift itself is blue — sky fill, not fog

# Contrast is put back as a gentle S around the pivot, so opening the shadows
# does not read as a flat, milky frame.
PIVOT = 0.44
CONTRAST = 1.09

SATURATION = 1.26            # up from 0.55; the surface carries colour now

# Cyan stays the reserved hue, and stays the most saturated thing in frame — it
# is the only colour allowed to read as manufactured.
CYAN_SAT = 1.30
CYAN_LOW = 0.10              # chroma ratio where cyan protection starts
CYAN_HIGH = 0.42             # ...and where it is fully applied

# TEAL WATER, protected explicitly. Warm rock against cool water is a big part
# of what the key art is doing, and a warm grade will happily eat the water if
# left to it. This is a second, wider protection band than the cyan one: it
# catches water (green and blue up, red down) at ordinary midtone saturation,
# where the tight cyan test does not fire.
# Measured against the key art, this had to go much further than it looks.
# A photographic HDRI sky lands around 0.24 display saturation where the painted
# key art sits at 0.72, because ACES sheds chroma exactly at the top end where
# the sky lives. This band is what puts it back, and it lifts the sky, the water
# and the cool side of the rock together - which is correct, since they are all
# the same sky light.
# The band has to fire at LOW chroma, which is the whole trick: a photographic
# sky is a desaturated blue (~0.11 chroma ratio), not a teal, so a band tuned
# for teal never caught it. Firing this low is safe precisely because the test
# is 'green and blue above red' - warm rock has zero chroma by it and is left
# completely alone, so the sky, the water and the haze can be pushed hard
# without touching the stone.
# 1.70 was overshooting badly: it turned the hazed distance neon cyan, which is
# further from the key art than the desaturated version it replaced. The key
# art's far mesas are a PALE BLUE-GREY at ~0.20 saturation, not a colour.
TEAL_SAT = 1.30
TEAL_LOW = 0.02
TEAL_HIGH = 0.20

# 0.36 was too tight to catch anything: with shadows this open, terrain in
# shadow measures around 0.45 luminance and was falling straight past the tint.
# The cool has to reach up into the lower midtones or the frame is warm
# everywhere and the warm/cool split the key art runs on never appears.
SHADOW_RANGE = 0.44          # luminance below which the shadow tint applies
SHADOW_TINT = (0.87, 0.97, 1.17)   # cool and blue, but nothing like a crush

HIGHLIGHT_START = 0.58       # luminance where the highlight warm begins
HIGHLIGHT_TINT = (1.05, 1.00, 0.93)   # warm sun, never cold


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    t = min(1.0, max(0.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def golden_hour(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    r, g, b = rgb

    # --- tone: lift, do not crush -------------------------------------------
    lum_in = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b
    lift = SHADOW_LIFT * (1.0 - smoothstep(0.0, 0.55, lum_in))
    r = r ** TOE_GAMMA + lift * LIFT_TINT[0]
    g = g ** TOE_GAMMA + lift * LIFT_TINT[1]
    b = b ** TOE_GAMMA + lift * LIFT_TINT[2]

    # --- contrast: a gentle S about the pivot --------------------------------
    def contrast(v: float) -> float:
        return max(0.0, PIVOT + (v - PIVOT) * CONTRAST)
    r, g, b = contrast(r), contrast(g), contrast(b)

    lum = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b

    # --- saturation, with the two protected cool bands ----------------------
    # Both tests measure "green and blue above red", i.e. how cyan/teal this
    # sample is; they differ only in how much of it is needed to fire.
    chroma = max(0.0, min(g, b) - r)
    peak = max(r, g, b, 1e-6)
    ratio = chroma / peak
    cyan = smoothstep(CYAN_LOW, CYAN_HIGH, ratio)
    teal = smoothstep(TEAL_LOW, TEAL_HIGH, ratio)
    sat = lerp(SATURATION, TEAL_SAT, teal)
    sat = lerp(sat, CYAN_SAT, cyan)

    r = lum + (r - lum) * sat
    g = lum + (g - lum) * sat
    b = lum + (b - lum) * sat

    # --- split tone ----------------------------------------------------------
    shadow = 1.0 - smoothstep(0.0, SHADOW_RANGE, lum)
    r *= lerp(1.0, SHADOW_TINT[0], shadow)
    g *= lerp(1.0, SHADOW_TINT[1], shadow)
    b *= lerp(1.0, SHADOW_TINT[2], shadow)

    high = smoothstep(HIGHLIGHT_START, 1.0, lum)
    r *= lerp(1.0, HIGHLIGHT_TINT[0], high)
    g *= lerp(1.0, HIGHLIGHT_TINT[1], high)
    b *= lerp(1.0, HIGHLIGHT_TINT[2], high)

    return (min(1.0, max(0.0, r)), min(1.0, max(0.0, g)), min(1.0, max(0.0, b)))


# ============================================================================
# night-bioluminescent — the archived grade, kept for Ember and Shroud
# ============================================================================
# Unchanged. Crush the shadows toward blue-black, desaturate broadly, protect
# the cyan band.

N_BLACK_POINT = 0.035
N_TOE_GAMMA = 1.35
N_SATURATION = 0.55
N_CYAN_SAT = 1.25
N_CYAN_LOW = 0.12
N_CYAN_HIGH = 0.45
N_SHADOW_RANGE = 0.32
N_SHADOW_TINT = (0.74, 0.90, 1.12)
N_HIGHLIGHT_START = 0.62
N_HIGHLIGHT_TINT = (0.94, 0.97, 1.00)


def night(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    def tone(v: float) -> float:
        v = max(0.0, (v - N_BLACK_POINT) / (1.0 - N_BLACK_POINT))
        return v ** N_TOE_GAMMA

    r, g, b = (tone(c) for c in rgb)
    lum = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b

    chroma = max(0.0, min(g, b) - r)
    peak = max(r, g, b, 1e-6)
    cyan = smoothstep(N_CYAN_LOW, N_CYAN_HIGH, chroma / peak)
    sat = lerp(N_SATURATION, N_CYAN_SAT, cyan)

    r = lum + (r - lum) * sat
    g = lum + (g - lum) * sat
    b = lum + (b - lum) * sat

    shadow = 1.0 - smoothstep(0.0, N_SHADOW_RANGE, lum)
    r *= lerp(1.0, N_SHADOW_TINT[0], shadow)
    g *= lerp(1.0, N_SHADOW_TINT[1], shadow)
    b *= lerp(1.0, N_SHADOW_TINT[2], shadow)

    high = smoothstep(N_HIGHLIGHT_START, 1.0, lum)
    r *= lerp(1.0, N_HIGHLIGHT_TINT[0], high)
    g *= lerp(1.0, N_HIGHLIGHT_TINT[1], high)
    b *= lerp(1.0, N_HIGHLIGHT_TINT[2], high)

    return (min(1.0, max(0.0, r)), min(1.0, max(0.0, g)), min(1.0, max(0.0, b)))


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
    # Identity first: it is the A/B control that proves the LUT plumbing is
    # neutral before any look is judged through it.
    write_3dl(LUT_DIR / "identity.3dl", identity)
    write_3dl(LUT_DIR / "home-golden-hour.3dl", golden_hour)
    write_3dl(LUT_DIR / "night-bioluminescent.3dl", night)

    print("\nhome-golden-hour (input -> output, sRGB 0..1):")
    probes = [
        ((0.0, 0.0, 0.0), "black — should LIFT off zero and go blue"),
        ((0.06, 0.07, 0.10), "deep shadow — open and blue, not crushed"),
        ((0.18, 0.18, 0.18), "18% grey"),
        ((0.5, 0.5, 0.5), "midtone"),
        ((1.0, 1.0, 1.0), "white — must stay full scale"),
        ((0.55, 0.40, 0.28), "lit warm stone — should stay warm"),
        ((0.16, 0.55, 0.60), "teal water — must not be eaten by the warm grade"),
        ((0.45, 0.86, 0.88), "cyan tech — the most saturated thing in frame"),
    ]
    for probe, note in probes:
        out = golden_hour(probe)
        print(f"  {tuple(f'{v:.2f}' for v in probe)} -> "
              f"{tuple(f'{v:.3f}' for v in out)}   {note}")


if __name__ == "__main__":
    main()
