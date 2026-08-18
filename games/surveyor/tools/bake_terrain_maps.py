"""Bake the triplanar terrain maps. Authoring-time only.

    python tools/bake_terrain_maps.py --source <lookdev>/assets/textures

Writes assets/textures/{flat,steep,high}.webp. These are derivatives; the
sources are the lookdev testbed's CC0 scan family and they do not live here.

ONE MAP PER LAYER, NOT TWO. lookdev ships each layer as an sRGB albedo JPG plus
a linear PNG holding normal XY in RG and roughness in B — six samplers for three
layers, which was already the optimisation. Surveyor needs less than that and can
go further, because its palette is authored:

    R, G   normal X and Y, the same packing, Z reconstructed in the shader
    B      DETAIL, the albedo's luminance, normalised about its own mean
    A      unused, and dropped

The albedo's COLOUR is thrown away on purpose. Six worlds carry hand-authored
palettes that decide colour by height and slope, and a marble scan's ochre has no
business overruling Vault's ice or Ember's basalt. What the scan is here for is
the part the palette cannot invent: where the rock is locally lighter and darker,
and which way its surfaces face. Both survive as one channel each.

Three samplers instead of six, and at most nine texture fetches a pixel instead
of eighteen — on flat ground, where one projection plane dominates and the other
two branch out, it is nearer two.

ROUGHNESS IS DROPPED. Surveyor's terrain shader has no roughness term; its
specular is a hard toon step gated on a per-world constant. Packing a channel
nothing samples would cost bytes to no end.

RESOLUTION. 512, down from lookdev's 1024. At the scales derived in TERRAIN in
tune.js — 9 to 16 metres a tile — that is around 2.5cm a texel, which is finer
than the 4.5m terrain cell these sit on by more than two orders of magnitude. The
1024 source was authored for a 4km plane viewed from a standing height; the extra
mip buys nothing here and costs three quarters of the download.

WEBP, LOSSLESS. Lossy WebP subsamples chroma, and chroma on a normal map is the
X and Y of the normal — it reads as shading noise, which is the whole reason
lookdev keeps its normals as PNG rather than JPEG. Lossless WebP is the same
guarantee at roughly half a PNG's size.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageStat
except ImportError:
    sys.exit("Pillow is required: python -m pip install pillow")

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE.parent / "assets" / "textures"
LAYERS = ("flat", "steep", "high")
SIZE = 512

# How far the detail channel is allowed to swing about its own mean. The scans
# carry blotches an order of magnitude stronger than anything this look wants;
# without the clamp, one layer's dark patches tile into burnt marks across a
# whole dune — the failure that got marble_cliff_02 rejected upstream.
DETAIL_SPREAD = 0.42


def pack(src: Path, layer: str) -> Image.Image:
    alb_path = src / f"{layer}_alb.jpg"
    nrm_path = src / f"{layer}_nrm.png"
    for p in (alb_path, nrm_path):
        if not p.exists():
            sys.exit(f"missing source: {p}")

    nrm = Image.open(nrm_path).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
    alb = Image.open(alb_path).convert("L").resize((SIZE, SIZE), Image.LANCZOS)

    # Normalised about the layer's own mean, so a dark scan and a pale one both
    # arrive centred on 128 and the shader's one detail strength means the same
    # thing on every layer. Without this, `strength` would have to be re-tuned
    # per layer to say the same sentence three times.
    mean = ImageStat.Stat(alb).mean[0] or 128.0
    detail = alb.point(
        lambda v: max(0, min(255, round(128 + (v - mean) * DETAIL_SPREAD)))
    )

    r, g, _b = nrm.split()
    return Image.merge("RGB", (r, g, detail))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True,
                    help="lookdev assets/textures directory holding *_alb.jpg and *_nrm.png")
    args = ap.parse_args()
    src = Path(args.source).expanduser().resolve()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    total = 0
    for layer in LAYERS:
        img = pack(src, layer)
        out = OUT_DIR / f"{layer}.webp"
        img.save(out, "WEBP", lossless=True, quality=100, method=6)
        kb = out.stat().st_size / 1024
        total += kb
        print(f"wrote {out.relative_to(OUT_DIR.parent.parent)}  {SIZE}^2  {kb:.0f} KB")
    print(f"{total:.0f} KB total, against 6400 KB for the six source files")


if __name__ == "__main__":
    main()
