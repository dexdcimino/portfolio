# Stickland sampled SFX

CC0 recordings layered over the synth engine in `src/audio.js`. Every sound
here has a synth fallback: over `file://` (or any fetch/decode failure) the
game sounds exactly like it did before this folder existed. Licence confirmed
CC0 on each source page, not from a search result. Attribution not required;
given anyway because it costs a line.

Files were renamed from their pack names (mapping below) but are byte-identical
to the packs' contents — hash-check against a fresh download of the source zip.

| Shipped as | Pack file | Pack / source | Author |
| ---------- | --------- | ------------- | ------ |
| `shot-pistol.ogg` | `shoot_01.ogg` | [50 CC0 Sci-Fi SFX](https://opengameart.org/content/50-cc0-sci-fi-sfx) | rubberduck |
| `shot-smg.ogg` | `shoot_02.ogg` | 50 CC0 Sci-Fi SFX | rubberduck |
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
| `creature-hurt-1.ogg` | `hurt_03.ogg` | [80 CC0 creature SFX](https://opengameart.org/content/80-cc0-creature-sfx) | rubberduck |
| `creature-hurt-2.ogg` | `hurt_04.ogg` | 80 CC0 creature SFX | rubberduck |
| `creature-hurt-3.ogg` | `hurt_05.ogg` | 80 CC0 creature SFX | rubberduck |
| `creature-death-1.ogg` | `grunt_02.ogg` | 80 CC0 creature SFX | rubberduck |
| `creature-death-2.ogg` | `grunt_03.ogg` | 80 CC0 creature SFX | rubberduck |
| `bird-death-1.ogg` | `cute_05.ogg` | 80 CC0 creature SFX | rubberduck |
| `bird-death-2.ogg` | `cute_01.ogg` | 80 CC0 creature SFX | rubberduck |
| `ambience-forest.ogg` | `Birds and Wind - Ambient_1.ogg` | [Birds and Wind](https://opengameart.org/content/birds-and-wind-ambient-birds-wind-and-synth) | Spring Spring (bird sfx: isaiah658, syncopika, pauliuw — all public domain) |

## Levels

Per-sample `gain` values in `SAMPLES` (src/audio.js) are measured, not
guessed: each file's peak was measured and the gain normalizes it to a target
peak matched against the synth mix, so a sampled shot sits at the level the
synth shot used to.

## Cost

~2.3 MB, of which 1.8 MB is the ambience loop. Fetched at runtime like the
music rack, with the same degrade story over `file://` — synth everywhere,
no errors.
