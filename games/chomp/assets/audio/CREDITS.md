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
| `games/chomp/assets/audio/eat.ogg` | Chomp | Food swallowed (`player:eat`) | https://opengameart.org/content/7-eating-crunches | tito | CC0 |
| `games/chomp/assets/audio/evolve.ogg` | Chomp | Stage up / growth (`player:evolve`) | https://kenney.nl/assets/impact-sounds | Kenney | CC0 |
| `games/chomp/assets/audio/death.ogg` | Chomp | Death (`player:death`) | https://kenney.nl/assets/impact-sounds | Kenney | CC0 |
| `games/chomp/assets/audio/ui-select.ogg` | Chomp | Pause-menu button press | https://kenney.nl/assets/interface-sounds | Kenney | CC0 |
| `games/chomp/assets/audio/music.mp3` | Chomp | Background music (29s, looped) | https://opengameart.org/content/dungeon-deep-0 | Alexandr Zhelanov | CC0 |

Two of the five come from Kenney **"Impact Sounds"**, CC0, and the UI sound from
Kenney **"Interface Sounds"**, CC0. The chomp, the eat and the music are single
files from OpenGameArt, all CC0. Licence text is bundled in
both downloads and reads: *"This content is free to use in personal,
educational and commercial projects."* Attribution is not required by CC0;
Kenney is credited anyway because they ask nicely and it costs a line.

Renamed on the way in, so the mapping back to the pack is recorded:

| Shipped as | Original in pack | Pack |
| ---------- | ---------------- | ---- |
| `chomp.ogg` | `crunchybite_0.ogg` | OpenGameArt — Crunchy bite |
| `eat.ogg` | `crunch.2.ogg` | OpenGameArt — 7 Eating Crunches |
| `evolve.ogg` | `Audio/impactBell_heavy_001.ogg` | Impact Sounds |
| `death.ogg` | `Audio/impactMining_003.ogg` | Impact Sounds |
| `ui-select.ogg` | `Audio/select_005.ogg` | Interface Sounds |
| `music.mp3` | `dungeon_deep.mp3` | OpenGameArt — Dungeon Deep |

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
| `eat` | `crunch.2` | 1.10s | — | 11% |
| `chomp` | `crunchybite_0` | 0.29s | 548 Hz | 71% |
| `evolve` | `impactBell_heavy_001` | 1.74s | 293 Hz | 81% |
| `death` | `impactMining_003` | 0.99s | 290 Hz | 76% |
| `ui-select` | `select_005` | 0.38s | 1239 Hz | 9% |

`eat.ogg` **was** the darkest sound in all 180 candidates, and that turned out
to be the problem rather than the achievement — see the chomp note below. `ui-select` is the one
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
| `eat` | 0.090 | peak-limited | — | **1.03** |
| `evolve` | 0.128 | ×1.25 | 0.90 | **1.13** |
| `death` | 0.122 | ×1.31 | 1.00 | **1.31** |
| `ui-select` | 0.131 | ×1.22 | 0.60 | **0.73** |

Gain is applied at playback rather than baked into the files, which is what
keeps them byte-identical to the pack. The compressor on the master bus is a
safety net, not a mixing tool.

## Music

`music.mp3` is one looping `AudioBufferSourceNode` on the music bus, held at
**0.73 at source** and started once the context exists. `loop = true` on a
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

Nineteen CC0 candidates, all decoded and scored the same way:

| Track | BPM | Beat | < 500 Hz | edgeGap | Size |
| ----- | --- | ---- | -------- | ------- | ---- |
| **Dungeon Deep (shipped — Dex picked it by ear)** | 171 | 0.15 | **96%** | 1.41 | **1.11 MB** |
| Boss Battle 6 Metal (rejected by Dex) | 146 | 0.52 | 91% | 0.47 | 2.40 MB |
| Boss Fight Bounce (rejected by Dex) | 60 | 0.48 | 93% | **0.01** | 2.75 MB |
| Dark Shrine Loop (rejected by Dex) | 130 | 0.46 | 87% | 0.27 | 0.66 MB |
| 8-Bit Battle Loop | 60 | **0.69** | 83% | 0.26 | 0.84 MB |
| Krakatoa | 120 | 0.39 | 95% | 0.46 | 1.11 MB |
| Cursed Tower Veranda | 90 | 0.31 | 85% | 0.34 | 2.29 MB |
| Deep Dive | 158 | 0.20 | 96% | 0.25 | 6.83 MB |
| Cave Explorer | 80 | 0.26 | 90% | 0.53 | 1.18 MB |
| Bleak Terminal | 72 | 0.23 | 92% | 0.63 | 3.60 MB |
| Dungeon Deep | 171 | 0.15 | 96% | 1.41 | 1.11 MB |
| Covert Operations | 95 | 0.14 | 92% | 0.73 | 2.29 MB |
| Determined Pursuit | 162 | 0.07 | 86% | 0.63 | 4.23 MB |

(BPM is autocorrelated onset strength and lands on a subharmonic for some
tracks — Boss Fight Bounce reads 60 where a listener would say 120. That is a
known limit of the method, not a property of the music.)

**Three picks by measurement were rejected by ear before Dex chose from a
listening page.** That is the useful fact in this table: these numbers rank
playability — pulse, weight, whether the loop joins — and they do not rank
taste. Dungeon Deep scores *worst* of the shortlist on beat strength (0.15) and
on the seam (1.41), and it is the one that sounds right, which is the whole
lesson.

Its two weaknesses are real and worth knowing, in case they ever come up as
complaints rather than numbers:

- **The seam.** 1.41 is the worst measured: the track ends near silence and
  restarts audible, so the join is a gap every 29 seconds. If that starts to
  grate, the fix is a shorter fade or a different track, not a gain change.
- **It is 29 seconds long**, the shortest thing here bar the drum loop, so it
  comes round often.

Nothing else needs saying about the rest of the shortlist — it was auditioned
and Dex picked from it.

### Why 0.53 for the gain

The mix gain moves with the recording. Measured in the loudest 300 ms window
this track sits at 0.2075 against Dark Shrine's 0.193, so
0.57 × (0.193 / 0.2075) ≈ **0.53** puts it exactly where the approved level was —
this one is louder than its predecessors, so the number goes down. Peak after
gain is 0.34, well clear of 1.0.

### The chomp and the eat, and why neither could be heard

Both were picked when the brief was "darker is better", and both were the
darkest thing in the pack — which is exactly what went wrong. Measured through a
one-pole 500 Hz high-pass (the same filter for every number here):

| Slot | Was | Above 500 Hz | Now | Above 500 Hz |
| ---- | --- | ------------ | --- | ------------ |
| `chomp` | `impactSoft_medium_004` | **2.7%** | `crunchybite_0` | **57%** |
| `eat` | `impactSoft_heavy_003` | **1.6%** | `crunch.2` | **89%** |

Almost all of their energy sat below 500 Hz, where a laptop or phone speaker
puts out essentially nothing. They were not quiet on a meter; they were quiet in
the only band most people can hear.

**Their gains are set by a different rule from the other three, and it matters.**
Normalising these to the same total loudness as the thuds they replace would
mean a gain of 2.5 and a peak of 2.29 — clipping badly, to chase a number that
describes energy nobody hears. They are set to the loudest a safe peak allows
instead:

| Sound | Peak | Gain | Peak after gain | Audible-band energy vs before |
| ----- | ---- | ---- | --------------- | ----------------------------- |
| `chomp` | 0.773 | 1.01 | 0.78 | — (it replaced a sound with none) |
| `eat` | 0.919 | 1.03 | 0.95 | **24×** |

On a meter the eat is quieter than what it replaces. On a speaker it is
dramatically louder, because the energy moved into a band that exists.

`crunch.2` is 1.10s against the old 0.54s, which suits the slot: eating is a
longer event than the snap that starts it, and it fires once a meal rather than
on every input. It comes from tito's *7 Eating Crunches* — a pack of literal
eating sounds, which is what this always wanted.

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
