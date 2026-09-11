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

**Everything in this folder is CC0 — public domain, commercial use, no
attribution required.** That is a rule, not a coincidence: a CC-BY sound puts a
credit obligation on the *game*, and a library where some files carry strings
and some do not is a trap to ship from. Plenty of good CC-BY packs were passed
over for exactly this. This file is the record of where things came from; the
page never claims any of it.

| what | who | where |
|---|---|---|
| footsteps, impacts, hurts, mining, arrow impacts | Kenney | <https://kenney.nl/assets/impact-sounds>, <https://kenney.nl/assets/rpg-audio> |
| pistols, SMGs, rifles — real guns, close mics | Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney, *The Free Firearm Sound Library* | <https://opengameart.org/content/the-free-firearm-sound-library> |
| longbow, recurve, crossbow, arrows | *Medieval Sound Effects / Weapon Textures* | <https://opengameart.org/content/medieval-sound-effects-weapon-textures> |
| cannon bangs and fireworks | *25 CC0 bang / firework SFX* | <https://opengameart.org/content/25-cc0-bang-firework-sfx> |
| water splashes and running water | *40 CC0 water splash / slime SFX* | <https://opengameart.org/content/40-cc0-water-splash-slime-sfx> |
| stones, thunder | *100 CC0 SFX vol. 2* | <https://opengameart.org/content/100-cc0-sfx-2> |
| whooshes | *Swishes sound pack* | <https://opengameart.org/content/swishes-sound-pack> |
| suppressed pistol, reloads | *Hollywood style silencer*, *Gun reload sounds* | <https://opengameart.org/content/gun-reload-sounds> |
| wet splatter | *2 wooden squish / splatter sequences* | <https://opengameart.org/content/2-wooden-squish-splatter-sequences> |
| low rumble | *Rumble FX* | <https://opengameart.org/content/rumble-fx> |

Kenney's own licence text: *"You may use these assets in personal and
commercial projects. Credit (Kenney or www.kenney.nl) would be nice but is not
mandatory."* The firearm library's: *"CC0 NO RIGHTS RESERVED for this library.
It may be used without royalty or credit."*

### What was done to them on the way in

The packs hold five or ten takes in one recording with seconds of air between
them, at 96 or 192 kHz. Each take here was cut out at a measured onset — never
a guessed one — and then:

- **summed to mono**, because positional audio wants a mono source: the engine
  puts the sound in the world, and a stereo file arrives with its own fixed
  image already baked in;
- **resampled down to a 48 kHz ceiling**, since nothing plays back above that
  to any benefit and the bitrate is spent either way;
- **trimmed, faded 3 ms in and 40 ms out, and normalised to −0.5 dBFS**, so a
  take does not read as a worse sound merely because it was recorded quieter.

Kenney's one-shots are already trimmed and short, so those are copied out of
the pack byte for byte and not re-encoded.

Every cut asserts how many event groups it contains before it is kept — one
for a one-shot, three for a reload that is mag-out/mag-in/slide. That check
exists because the first pass at the bow silently swallowed the *next* take:
the medieval pack puts six shots in four seconds, and a hold long enough for a
tail is long enough to catch the one after it.

### How good is it, honestly

Real recordings, free, and a genuine first draft. The guns and the bows are
proper field recordings and sound like it. The weaker corners are named rather
than hidden: the tank's coaxial gun is an AK-47, the rocket explosions are
cannon and firework bangs, and anything with no honest CC0 source — the magic
swell, the minigun spin-up, the ricochet, the bespoke death splat — is still
`-`. Two wet splatters sit next to that splat line as candidates; the line
itself stays open.

**`.ogg` does not play in Safari.** Everything here is `.ogg`; if this ever
needs to work outside Chrome, re-encode to `.m4a` or add a second take.
