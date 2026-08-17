# Audio credits

Every file under `assets/audio/` and each game's `assets/audio/` is listed here
with its source URL and licence. **A file with no row in this table must not
ship** — an unattributed asset is a licensing problem regardless of where it
came from.

Sources permitted: Freesound (CC0 filter only), OpenGameArt (CC0 entries only),
Kenney.nl (CC0 by default). CC-BY is *not* interchangeable with CC0 — it
requires attribution in a place users can see, not just a repo file, so it is
excluded here to keep the rule simple.

## Files

| File | Game | Used for | Source URL | Author | Licence |
| ---- | ---- | -------- | ---------- | ------ | ------- |
| `games/arena1/assets/audio/zap.ogg` | Arena 1 | Zap fire | https://kenney.nl/assets/sci-fi-sounds | Kenney | CC0 |
| `games/arena1/assets/audio/rocket-launch.ogg` | Arena 1 | Rocket launch | https://kenney.nl/assets/sci-fi-sounds | Kenney | CC0 |
| `games/arena1/assets/audio/explosion.ogg` | Arena 1 | Rocket detonation | https://kenney.nl/assets/sci-fi-sounds | Kenney | CC0 |
| `games/arena1/assets/audio/serpent-pop.ogg` | Arena 1 | Serpent segment destroyed | https://kenney.nl/assets/sci-fi-sounds | Kenney | CC0 |
| `games/arena1/assets/audio/serpent-death.ogg` | Arena 1 | Serpent death | https://kenney.nl/assets/sci-fi-sounds | Kenney | CC0 |
| `games/arena1/assets/audio/player-hit.ogg` | Arena 1 | Player takes damage | https://kenney.nl/assets/sci-fi-sounds | Kenney | CC0 |
| `games/arena1/assets/audio/player-death.ogg` | Arena 1 | Player death | https://kenney.nl/assets/sci-fi-sounds | Kenney | CC0 |
| `games/arena1/assets/audio/pickup.ogg` | Arena 1 | Fuel cell pickup | https://kenney.nl/assets/sci-fi-sounds | Kenney | CC0 |
| `games/arena1/assets/audio/crit.ogg` | Arena 1 | Double-pop tell | https://kenney.nl/assets/sci-fi-sounds | Kenney | CC0 |
| `games/arena1/assets/audio/land.ogg` | Arena 1 | Landing | https://kenney.nl/assets/sci-fi-sounds | Kenney | CC0 |
| `games/arena1/assets/audio/wall.ogg` | Arena 1 | Wall contact | https://kenney.nl/assets/sci-fi-sounds | Kenney | CC0 |
| `games/arena1/assets/audio/pad.ogg` | Arena 1 | Jump pad | https://kenney.nl/assets/sci-fi-sounds | Kenney | CC0 |
| `games/arena1/assets/audio/grapple.ogg` | Arena 1 | Grapple throw | https://kenney.nl/assets/sci-fi-sounds | Kenney | CC0 |
| `games/arena1/assets/audio/crack.ogg` | Arena 1 | Platform crack | https://kenney.nl/assets/sci-fi-sounds | Kenney | CC0 |
| `games/arena1/assets/audio/jet.ogg` | Arena 1 | Jetpack loop (5.00s, looped) | https://kenney.nl/assets/sci-fi-sounds | Kenney | CC0 |

All nine come from one pack — Kenney "Sci-Fi Sounds" v1.0, CC0, licence text
bundled in the download and quoted here: *"This content is free to use in
personal, educational and commercial projects."* Attribution is not required by
CC0; Kenney is credited anyway because they ask nicely and it costs a line.

Renamed on the way in, so the mapping back to the pack is recorded:

| Shipped as | Original in pack |
| ---------- | ---------------- |
| `zap.ogg` | `Audio/laserSmall_000.ogg` |
| `rocket-launch.ogg` | `Audio/laserLarge_002.ogg` |
| `explosion.ogg` | `Audio/explosionCrunch_000.ogg` |
| `serpent-pop.ogg` | `Audio/impactMetal_003.ogg` |
| `serpent-death.ogg` | `Audio/lowFrequency_explosion_001.ogg` |
| `player-hit.ogg` | `Audio/impactMetal_000.ogg` |
| `player-death.ogg` | `Audio/explosionCrunch_004.ogg` |
| `pickup.ogg` | `Audio/forceField_000.ogg` |
| `crit.ogg` | `Audio/laserRetro_001.ogg` |
| `land.ogg` | `Audio/doorClose_001.ogg` |
| `wall.ogg` | `Audio/doorClose_000.ogg` |
| `pad.ogg` | `Audio/forceField_002.ogg` |
| `grapple.ogg` | `Audio/laserRetro_003.ogg` |
| `crack.ogg` | `Audio/impactMetal_004.ogg` |
| `jet.ogg` | `Audio/thrusterFire_000.ogg` |

**Not yet sourced:** background music for either game (MD 26 item 3), and every
Chomp sound — Chomp has no audio engine yet, so there is nothing to play them
through.

Arena 1 sounds still running their synthesized version, because this pack has
no honest match for them: **jump**, **dash** and **slide**. The engine families
that looked right (`spaceEngineSmall`, `spaceEngineLow`) are all exactly 5.00s
loops — a five-second space engine on a dash would undo the deliberate 0.16s
tuning that sound was given. They want a foley/impact pack, not a sci-fi one.

## Checklist for adding a sound

1. Confirm the licence on the source page itself, not from a search result.
2. Drop the file in the owning game's `assets/audio/`.
3. Add a row above **in the same commit**.
4. Normalise to the same perceived level as its neighbours — the compressor on
   the master bus is a safety net, not a mixing tool.
