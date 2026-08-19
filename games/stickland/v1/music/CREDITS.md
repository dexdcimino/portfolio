# Stickland music — audition rack, batch 2

**Temporary.** The first batch of twelve went through audition and ten were
rejected; `w5` / `w6` survived and carry over. This batch replaces the other
ten: `w*` are chill explore tracks for the open world, `p*` energetic tracks
for platform mode. Judged in-game through the previous / next control in the
Esc menu's Audio section, same as before.

Every file below is CC0, licence confirmed on the source page itself rather
than from a search result. (Mysterious Ambience and Cave-adjacent pages are
multi-licensed; CC0 is among the offered licences and is the one relied on.)
Attribution is not required by CC0; the authors are credited anyway because it
costs a line.

| # | Shipped as | Track | Author | Source |
| - | ---------- | ----- | ------ | ------ |
| 1 | `w1-crystal-cave.mp3` | Crystal Cave (song18) | cynicmusic | https://opengameart.org/content/crystal-cave-song18 |
| 2 | `w2-mysterious-ambience.mp3` | Mysterious Ambience (song21) | cynicmusic | https://opengameart.org/content/mysterious-ambience-song21 |
| 3 | `w3-field-of-dreams.mp3` | The Field of Dreams | pauliuw | https://opengameart.org/content/the-field-of-dreams |
| 4 | `w4-snowfall.ogg` | Snowfall (looped ver.) | Kistol | https://opengameart.org/content/snowfall |
| 5 | `w5-calm-theme.ogg` | Calm Theme | pebonius | https://opengameart.org/content/calm-theme |
| 6 | `w6-a-path.ogg` | A Path Which Leads to Somewhere | Centurion_of_war | https://opengameart.org/content/a-path-which-leads-to-somewhere |
| 7 | `w7-observing-the-star.ogg` | Observing the Star | yd | https://opengameart.org/content/another-space-background-track |
| 8 | `p1-junkala-level-1.ogg` | 5 Chiptunes (Action) — Level 1 | Juhani Junkala (SubspaceAudio) | https://opengameart.org/content/5-chiptunes-action |
| 9 | `p2-junkala-level-2.ogg` | 5 Chiptunes (Action) — Level 2 | Juhani Junkala (SubspaceAudio) | https://opengameart.org/content/5-chiptunes-action |
| 10 | `p3-nes-venus.ogg` | NES Shooter Music — Venus | SketchyLogic | https://opengameart.org/content/nes-shooter-music-5-tracks-3-jingles |
| 11 | `p4-fast-fight.ogg` | Fast Fight / Battle Music | Ville Nousiainen (Xythe / mutkanto) | https://opengameart.org/content/fast-fight-battle-music |
| 12 | `p5-awake.mp3` | Awake! (Megawall-10) | cynicmusic | https://opengameart.org/content/awake-megawall-10 |

Most files are byte-identical to their sources. Three are **not**: the Junkala
pack and the NES Shooter pack ship WAV-only (68 MB between them), so tracks
8–10 were transcoded WAV → Ogg Vorbis locally (libsndfile defaults). Hash-check
those against a fresh download of the source *zip*, not the shipped ogg.

## Levels

Each track's gain in `src/music.js` is measured, not guessed: its loudest
300 ms window scaled to one shared reference (the quietest of the twelve reads
1.00), capped so nothing post-gain peaks above 0.95. Re-measured for this
batch, which is why the two carried-over tracks' numbers changed: the
reference moved with the new family.

## What this costs, so it is a decision and not a surprise

- **~14 MB** of audio in the repo (down from 21), and git keeps every batch in
  history even after losers are deleted. Still the price of auditioning
  in-game rather than in a browser tab.
- The built `index.html` **fetches these at runtime**, so it is no longer the
  fully self-contained file `README.md` promises. Opened straight from disk
  (`file://`) the fetch fails, the game runs exactly as before with no music
  and no error, and the Esc menu says the track is unavailable. The standalone
  promise degrades rather than breaks — but it is no longer strictly true
  while this rack exists.
