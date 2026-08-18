# Chomp audio credits

Every file in this folder is listed below with its source URL and licence.
**A file with no row in this table must not ship** — an unattributed asset is a
licensing problem regardless of where it came from.

Sources permitted: Kenney.nl (CC0 by default), OpenGameArt (CC0 entries only),
Freesound (CC0 filter only). Everything here is CC0; no CC-BY was needed, so
nothing in Chomp depends on user-visible attribution.

> Note: the repo-root `assets/audio/CREDITS.md` states that it lists every
> file under each game's `assets/audio/`. This file is the one MD 27 asked for.
> They are not in conflict yet — root covers Arena 1, this covers Chomp — but
> two registries is one too many. See the MD 27 report.

## Files

| File | Game | Used for | Source URL | Author | Licence |
| ---- | ---- | -------- | ---------- | ------ | ------- |
| `games/chomp/assets/audio/chomp.ogg` | Chomp | Maw snaps shut (`player:chomp`) | https://opengameart.org/content/crunchy-bite | fvcalderan | CC0 |
| `games/chomp/assets/audio/eat.ogg` | Chomp | Food swallowed (`player:eat`) | https://kenney.nl/assets/impact-sounds | Kenney | CC0 |
| `games/chomp/assets/audio/evolve.ogg` | Chomp | Stage up / growth (`player:evolve`) | https://kenney.nl/assets/impact-sounds | Kenney | CC0 |
| `games/chomp/assets/audio/death.ogg` | Chomp | Death (`player:death`) | https://kenney.nl/assets/impact-sounds | Kenney | CC0 |
| `games/chomp/assets/audio/ui-select.ogg` | Chomp | Pause-menu button press | https://kenney.nl/assets/interface-sounds | Kenney | CC0 |
| `games/chomp/assets/audio/music.mp3` | Chomp | Background music (72s, looped) | https://opengameart.org/content/boss-fight-bounce | Locomule | CC0 |

Three of the five come from one pack — Kenney **"Impact Sounds"**, CC0 — and the
UI sound from Kenney **"Interface Sounds"**, CC0. The chomp and the music are
single files from OpenGameArt, both CC0. Licence text is bundled in
both downloads and reads: *"This content is free to use in personal,
educational and commercial projects."* Attribution is not required by CC0;
Kenney is credited anyway because they ask nicely and it costs a line.

Renamed on the way in, so the mapping back to the pack is recorded:

| Shipped as | Original in pack | Pack |
| ---------- | ---------------- | ---- |
| `chomp.ogg` | `crunchybite_0.ogg` | OpenGameArt — Crunchy bite |
| `eat.ogg` | `Audio/impactSoft_heavy_003.ogg` | Impact Sounds |
| `evolve.ogg` | `Audio/impactBell_heavy_001.ogg` | Impact Sounds |
| `death.ogg` | `Audio/impactMining_003.ogg` | Impact Sounds |
| `ui-select.ogg` | `Audio/select_005.ogg` | Interface Sounds |
| `music.mp3` | `Boss Fight Bounce.mp3` | OpenGameArt — Boss Fight Bounce |

Files are byte-identical to the source originals. That is deliberate: it makes
the rename map above verifiable by hash against a fresh download, which it
would not be if they had been re-encoded. `music.ogg` was checked that way —
SHA-256 `9580618dc851f70c3a11b5ff87672867de44cd38…`, matching a fresh pull of
`https://opengameart.org/sites/default/files/qubodup-yd-DarkShrineLoop-OpenGameArt.ogg`
byte for byte (678,630 bytes).

The source page describes it as "a slight remix of yd's LMMS-made *Shrine*",
so both are credited above even though CC0 requires neither.

## Why these five, out of 180 auditioned

The brief was **doomy, gloomy, arcade** — lower, heavier and slower than
Arena 1. Rather than pick by filename, every candidate in the impact, RPG,
interface, UI and jingle packs was decoded with the same `decodeAudioData` the
game uses and measured for spectral centroid (where the energy sits — lower is
darker), the share of energy below 500 Hz, peak and windowed loudness.

| Slot | Chosen | Duration | Centroid | Energy < 500 Hz |
| ---- | ------ | -------- | -------- | --------------- |
| `eat` | `impactSoft_heavy_003` | 0.54s | **110 Hz** | 96% |
| `chomp` | `crunchybite_0` | 0.29s | 548 Hz | 71% |
| `evolve` | `impactBell_heavy_001` | 1.74s | 293 Hz | 81% |
| `death` | `impactMining_003` | 0.99s | 290 Hz | 76% |
| `ui-select` | `select_005` | 0.38s | 1239 Hz | 9% |

`eat.ogg` is the darkest sound in all 180 candidates. `ui-select` is the one
deliberate exception to "darker is better": a UI click has to cut through the
mix to read as feedback, so it is the darkest of the *select* family rather
than the darkest overall.

**Rejected on measurement, not taste:** `rpg/chop.ogg` was the obvious pick by
name for the chomp and it **clips** — peak 1.08 after decode. So do
`knifeSlice2`, all three `metalPot`s, `pluck_001`, `error_002` and nine of the
`ui-audio` switches. None of them ship.

## Levels

Normalised by measurement: each file's loudest 300 ms window was measured and
trimmed toward a common reference, then given a deliberate mix offset — `chomp`
fires on every input so it sits low, `death` happens once a run so it sits
proud. The trims live in `SAMPLES` in `js/systems/audio.js`:

| Sound | Measured loudness | Normalise | Mix offset | Shipped gain |
| ----- | ----------------- | --------- | ---------- | ------------ |
| `chomp` | 0.086 | ×2.20 | — | **1.01** |
| `eat` | 0.200 | ×0.80 | 0.85 | **0.68** |
| `evolve` | 0.128 | ×1.25 | 0.90 | **1.13** |
| `death` | 0.122 | ×1.31 | 1.00 | **1.31** |
| `ui-select` | 0.131 | ×1.22 | 0.60 | **0.73** |

Gain is applied at playback rather than baked into the files, which is what
keeps them byte-identical to the pack. The compressor on the master bus is a
safety net, not a mixing tool.

## Music

`music.mp3` is one looping `AudioBufferSourceNode` on the music bus, held at
**0.93 at source** and started once the context exists. `loop = true` on a
decoded buffer is a sample-accurate, gapless loop, which is why it is not an
`<audio>` element.

It is the only file here whose load result is awaited: a one-shot that decodes
late merely plays late, but music told to start before its buffer exists never
starts at all.

### Why this track — and the one measurement that decided it

Replacements are ranked by measurement, not by title. Every candidate was
decoded with the game's own `decodeAudioData` and scored for tempo, beat
strength, spectrum, and — the one that settled it — **how the loop joins**.

A looping `BufferSource` plays the seam on every pass, so a track whose end does
not meet its start is worse in use than its tempo suggests. `edgeGap` below is
the difference in energy between the opening 250 ms and the closing 250 ms,
relative to the track's own average: 0 is a seamless join, 1 is a restart you
hear every time.

| Track | Beat strength | Energy < 500 Hz | edgeGap | Size |
| ----- | ------------- | --------------- | ------- | ---- |
| **Boss Fight Bounce (shipped)** | **0.48** | **93%** | **0.01** | 2.75 MB |
| Dark Shrine Loop (previous) | 0.46 | 87% | 0.27 | 0.66 MB |
| 8-Bit Battle Loop | 0.69 | 83% | 0.26 | 0.86 MB |
| Krakatoa | 0.39 | 95% | 0.46 | 1.11 MB |
| Hunted by the Evil | 0.39 | 94% | 0.38 | 6.97 MB (wav) |
| Bleak Terminal | 0.23 | 92% | 0.63 | 3.60 MB |
| Cave Explorer | 0.26 | 90% | 0.53 | 1.18 MB |

Dark Shrine ends in silence and starts audible — an `edgeGap` of 0.27, which is
a hole in the music once a minute, every minute. Boss Fight Bounce is the only
candidate that beats it on pulse AND weight AND the seam: 0.01 is as close to
inaudible as a join gets.

The cost is honest and worth stating: **2.75 MB against 0.66 MB**, because
OpenGameArt hosts this one as MP3 and the only OGG there is a low-bitrate
preview. `decodeAudioData` takes MP3 everywhere the game runs, so the container
is not a compatibility problem — it is four times the download.

Runner-up: **8-Bit Battle Loop** has the strongest pulse of anything measured
(0.69) at 0.86 MB. It is chiptune, which is a different game's aesthetic than
this one's painterly cave, so it was not shipped on taste rather than on
numbers.

### Why 0.93 for the gain

The numbers above are all relative to the recording, so the mix gain moves with
it. Measured in the loudest 300 ms window this track sits at 0.1187 against Dark
Shrine's 0.193, so 0.57 × (0.193 / 0.1187) ≈ **0.93** puts it exactly where the
approved level was. It looks loud beside Arena 1's 0.45 and is not: the file is
simply quieter. Peak after gain is 0.34, well clear of 1.0.

### The chomp, and why the old one could not be heard

`impactSoft_medium_004` puts **2.7% of its energy above 500 Hz** (one-pole
high-pass, same filter for every number here) — it is a low thud with almost
nothing in the band a laptop or phone speaker can reproduce. It was picked when
the brief was "darker is better", and it is among the darkest things in the
pack; it is also, on any speaker without a woofer, close to silent.

`crunchybite_0` is an actual bite: 0.29s, **56.7% above 500 Hz**, with a 23 ms
attack. Still dark next to the UI click (78.6%), but with teeth in it — which is
the part you could not hear before. Peak decodes at 0.773, so at gain 1.01 it
lands at 0.78 with headroom to spare.

**`eat.ogg` has the same defect and was left alone:** `impactSoft_heavy_003`
measures 1.6% above 500 Hz. It was not in scope for this change, and unlike the
chomp it fires once per meal rather than on every input, but it is the next
thing to fix here.

### Superseded (kept for the record)

The first track (*Dark Place*, SkyleTheFrench) had the right mood but was too
slow, and was replaced by Dark Shrine Loop on this comparison — brightness and
tempo, measured the same way, before the loop seam was part of the test:

| Track | BPM | Beat strength | Centroid | Energy < 500 Hz | Size |
| ----- | --- | ------------- | -------- | --------------- | ---- |
| *Dark Place* (previous) | 140 | 0.40 | 3371 Hz | 48% | 1.68 MB |
| **Dark Shrine Loop (shipped)** | **178** | **0.49** | **2381 Hz** | 21% | **0.66 MB** |
| *Insistent* (runner-up) | 157 | 0.38 | 2116 Hz | 56% | 1.69 MB |
| *Chase in the Night* | 129 | 0.51 | 2240 Hz | 58% | 2.81 MB |
| *The Hunt* | 178 | 0.16 | 3888 Hz | 36% | 7.63 MB |
| *The Ritual* | 80 | 0.20 | 4511 Hz | 26% | 5.04 MB |

Dark Shrine is 27% faster than what it replaces, with a stronger pulse, a
*darker* spectrum, and a quarter of the file size. The one regression is
low-end weight — 21% of its energy sits under 500 Hz against the old track's
48%, so it is faster and darker but less heavy. *Insistent* is the swap if that
weight is missed: slower (157) but 56% low-end.

The gain is **0.57, not Arena 1's 0.45**, because matching the number does not
match the loudness. Measured in the loudest 300 ms window, the old track sat at
0.243 and this one at 0.193; holding 0.45 would have dropped the music about
20% purely as a side effect of the swap. 0.45 × (0.243 / 0.193) ≈ 0.57 puts it
back exactly where the approved track sat.

Worth knowing: Arena 1's own track measures 0.366 — half again as loud as
Chomp's — so the two games have never actually matched at a shared 0.45, whatever
the comments in either file claimed.

## Not sourced

- **Spawn, level start, level fail.** Not missing assets — Chomp emits no event
  for any of them. See the MD 27 report.

## Checklist for adding a sound

1. Confirm the licence on the source page itself, not from a search result.
2. Drop the file in this folder.
3. Add a row above **in the same commit**, plus a rename-map row.
4. Measure it before setting its gain — normalise to its neighbours rather than
   guessing, and check the decoded peak is below 1.0.
