# assets/sfx — where the sounds live

`sfx.txt` is the manifest and the wishlist. `tools/bake_sfx.py` turns it into
`sfx.json`, which the FOLEY overlay fetches. **Never edit `sfx.json`** —
`--check` fails on a hand edit because the output is a byte comparison against
a rebuild.

## Adding a sound

1. Drop the file anywhere under `assets/sfx/` (a folder per category keeps it
   readable; nothing enforces that).
2. Add or edit one line in `sfx.txt`:

   ```
   Player|Death splat|Wet burst|player/splat-wet.ogg
   ```

3. `python tools/bake_sfx.py`

The baker refuses a line whose file is missing, is not audio, or climbs out of
this folder — so a broken reference fails at the gate rather than in the
overlay. A file of `-` means "wanted, not sourced yet": the card still appears
and the take says so in its dropdown.

Playable extensions: `.mp3 .ogg .wav .m4a .webm .flac`. **`.ogg` does not play
in Safari.** Everything here is `.ogg` today because that is what the source
packs ship; if this ever needs to work outside Chrome, re-encode to `.m4a` or
add a second take.

## What is here now, and where it came from

**Kenney.nl — `Impact Sounds` and `RPG Audio`, both Creative Commons Zero
(CC0).** Kenney's own licence text: *"You may use these assets in personal and
commercial projects. Credit (Kenney or www.kenney.nl) would be nice but is not
mandatory."* No attribution is required and none is claimed anywhere in the
page; this file is the record.

- <https://kenney.nl/assets/impact-sounds>
- <https://kenney.nl/assets/rpg-audio>

They are REAL RECORDINGS rather than synthesised tones, which is why they were
chosen over the easy alternative of generating something. They are also a good
free game pack rather than bespoke AAA foley — **treat them as the first draft**
of the library, not the finished thing. The names here say what a take
IS (`splat-heavy`, `hurt-punch`) rather than what it was called in the pack,
because the manifest reads better that way and the provenance lives here.

Everything not listed in `sfx.txt` with a real path is still `-`: wanted, and
not sourced.
