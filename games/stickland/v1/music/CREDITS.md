# Stickland music — audition rack

**Temporary.** Twelve CC0 candidates so a track can be judged while playing the
game, through the previous / next control in the Esc menu's Audio section. When
one is chosen, the other eleven get deleted and `src/music.js` shrinks to the
survivor.

Every file below is CC0, licence confirmed on the source page itself rather than
from a search result. Attribution is not required by CC0; the authors are
credited anyway because it costs a line.

| # | Shipped as | Track | Author | Source |
| - | ---------- | ----- | ------ | ------ |
| 1 | `w1-adventure-theme.ogg` | Adventure Theme | CleytonKauffman | https://opengameart.org/content/adventure-theme |
| 2 | `w2-town-theme.mp3` | Town Theme | cynicmusic | https://opengameart.org/content/town-theme-rpg |
| 3 | `w3-a-start-to-space.ogg` | A Start to Space | Centurion_of_war | https://opengameart.org/content/a-start-to-space |
| 4 | `w4-picnic.mp3` | Children's Game Music 1 — Picnic | heartade | https://opengameart.org/content/childrens-game-music-1-picnic |
| 5 | `w5-calm-theme.ogg` | Calm Theme | pebonius | https://opengameart.org/content/calm-theme |
| 6 | `w6-a-path.ogg` | A Path Which Leads to Somewhere | Centurion_of_war | https://opengameart.org/content/a-path-which-leads-to-somewhere |
| 7 | `w7-frozen-in-time.mp3` | Frozen in Time | Bobjt | https://opengameart.org/content/frozen-in-time-0 |
| 8 | `p1-run-jump-duck.ogg` | Chiptune: Run Jump Duck | ansimuz | https://opengameart.org/content/chiptune-run-jump-duck |
| 9 | `p2-bravery-run.ogg` | Bravery Run | MintoDog | https://opengameart.org/content/bravery-run |
| 10 | `p3-chiptune-stage-1.ogg` | Chiptune Adventures — Stage 1 | Juhani Junkala | https://opengameart.org/content/4-chiptunes-adventure |
| 11 | `p4-chiptune-stage-2.ogg` | Chiptune Adventures — Stage 2 | Juhani Junkala | https://opengameart.org/content/4-chiptunes-adventure |
| 12 | `p5-chiptune-select.ogg` | Chiptune Adventures — Stage Select | Juhani Junkala | https://opengameart.org/content/4-chiptunes-adventure |

`w*` were shortlisted for the open world, `p*` for platform mode. Files are
byte-identical to their sources — nothing was re-encoded, so each one can be
hash-checked against a fresh download.

## Levels

Each track's gain in `src/music.js` is measured, not guessed: its loudest 300 ms
window scaled to one shared reference, capped so nothing peaks above 0.95.
Without that the loudest master wins the audition regardless of whether it is
the best track.

## What this costs, so it is a decision and not a surprise

- **21 MB** of audio in the repo, and git keeps it in history even after the
  losers are deleted. That is the price of auditioning in-game rather than in a
  browser tab; say the word and the rack goes back out.
- The built `index.html` **fetches these at runtime**, so it is no longer the
  fully self-contained file `README.md` promises. Opened straight from disk
  (`file://`) the fetch fails, the game runs exactly as before with no music and
  no error, and the Esc menu says the track is unavailable. The standalone
  promise degrades rather than breaks — but it is no longer strictly true while
  this rack exists.
