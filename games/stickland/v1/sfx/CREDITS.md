# Stickland sampled SFX

CC0 recordings layered over the synth engine in `src/audio.js`. Every sound
here has a synth fallback: over `file://` (or any fetch/decode failure) the
game sounds exactly like it did before this folder existed. Licence confirmed
CC0 on each source page, not from a search result. Attribution not required;
given anyway because it costs a line.

Audition history: the first batch also shipped creature vocals (grunts and
chirps for animal hurt/death, from the same author's creature pack) and a
sampled SMG crack. All were rejected in play — the vocals read as a person
being punched, the crack as thin — and deleted; those names now use synth
voices in `src/audio.js`.

Files were renamed from their pack names (mapping below) but are byte-identical
to the packs' contents — hash-check against a fresh download of the source zip.

| Shipped as | Pack file | Pack / source | Author |
| ---------- | --------- | ------------- | ------ |
| `shot-pistol.ogg` | `shoot_01.ogg` | [50 CC0 Sci-Fi SFX](https://opengameart.org/content/50-cc0-sci-fi-sfx) | rubberduck |
| `shot-rifle.ogg` | `retro_laser_01.ogg` | 50 CC0 Sci-Fi SFX | rubberduck |
| `shot-rocket.ogg` | `rocket_01.ogg` | 50 CC0 Sci-Fi SFX | rubberduck |
| `cast-spell.ogg` | `teleport_01.ogg` | 50 CC0 Sci-Fi SFX | rubberduck |
| `explosion-small.ogg` | `explosion_02.ogg` | 50 CC0 Sci-Fi SFX | rubberduck |
| `explosion-big.ogg` | `explosion_01.ogg` | 50 CC0 Sci-Fi SFX | rubberduck |
| `shot-shotgun.ogg` | `slam_04.ogg` | [100 CC0 SFX](https://opengameart.org/content/100-cc0-sfx) | rubberduck |
| `shot-puffer.ogg` | `spring_03.ogg` | 100 CC0 SFX | rubberduck |
| `gore-splat-1.ogg` | `splash_01.ogg` | 100 CC0 SFX | rubberduck |
| `gore-splat-2.ogg` | `splash_02.ogg` | 100 CC0 SFX | rubberduck |
| `body-thud-1.ogg` | `hit_03.ogg` | 100 CC0 SFX | rubberduck |
| `body-thud-2.ogg` | `hit_04.ogg` | 100 CC0 SFX | rubberduck |
| `ambience-forest.ogg` | `Birds and Wind - Ambient_1.ogg` | [Birds and Wind](https://opengameart.org/content/birds-and-wind-ambient-birds-wind-and-synth) | Spring Spring (bird sfx: isaiah658, syncopika, pauliuw — all public domain) |

## Levels

Per-sample `gain` values in `SAMPLES` (src/audio.js) are measured, not
guessed: each file's peak was measured and the gain normalizes it to a target
peak matched against the synth mix, so a sampled shot sits at the level the
synth shot used to.

## Cost

~2.2 MB, of which 1.8 MB is the ambience loop. Fetched at runtime like the
music rack, with the same degrade story over `file://` — synth everywhere,
no errors.
