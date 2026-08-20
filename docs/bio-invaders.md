# BIO INVADERS

**Status: parked.** A second toy in the About section, beside BREAK THE BIO.

---

## The idea

Same bio, same letters, different game. Where Breakout has you bouncing a ball
into the wall, **Bio Invaders has you shooting up at it.**

A ship at the bottom, left and right, and a fire button. The letters are the
invaders. Shoot them out of the paragraph until it is gone.

**Same twenty-second toy.** No score, no waves, no lives, no fail state. Someone
finds it, grins, clears the bio, and reads it. The moment it wants a difficulty
curve it has stopped being the thing it is.

## What it inherits, and must not rebuild

`about-breakout.js` already solved the hard half, and **the entire measurement
and restore layer is shared.** Do not write a second one.

- **Per-character `Range.getClientRects()`** for every glyph's true kerned
  position — the thing that makes any of this possible
- **The cover-patch design.** The paragraph is never hidden. Intact letters stay
  real DOM text; a hit letter is erased by an opaque patch over its measured
  cell, and canvas twins only exist in motion. This is why the accessible tree
  stays intact and why copy-paste still works.
- **The live background guard** — the erase colour is re-resolved from computed
  styles every 20 frames, and the game shuts down and restores if the background
  stops being one opaque colour
- **Restore on resize, error, scroll-away and stop**, pixel-identical
- **The shared audio panel and `MediaBus`**
- **The 1400px gate** and the reduced-motion gate

Everything above is measured, tested and shipping. Lift it into something both
toys use rather than forking it — **a bug fixed in one must be fixed in both,
and the only way to guarantee that is one implementation.**

## What is actually new

- **A ship** at the bottom. Left and right, and fire.
- **Bullets** travelling up, one letter per hit.
- **The letters advance.** Slowly, a step at a time, the way invaders do — that
  is the pressure and it is the whole reason this is not just Breakout with a
  gun. Reaching the ship ends the run and restores the text.
- **Letters shoot back**, occasionally. Rarely enough to be a surprise, not so
  often it becomes a game you can lose to.
- **Both paragraphs** are the wall, as Breakout now uses.

## Where the two live together

Two toys beside each other under the bio, and neither should feel like the
default. **A player picks one**, plays it, and the section restores when they
stop.

- Only one runs at a time. Starting one stops the other.
- Both restore to the same clean bio.
- The controls stack on the right is shared — mute, volume, pause, stop.

## Open questions

- **Do the letters descend, or does the ship climb?** Descending is the classic
  and the pressure is legible. Climbing keeps the paragraph where it is, which
  matters more here than in a real Space Invaders because the paragraph is
  content, not a level.
- **Firing:** auto-repeat while held, or one shot per press? Held is kinder;
  per-press makes each letter deliberate.
- **What ends it besides clearing the wall?** Breakout has no fail state on
  purpose. If letters reaching the bottom ends a run, that is a fail state — and
  it may be the right one here, because "the bio wins" is a decent joke.

---

## Constraints

No build step, no bundler, no npm, no CDN. No inline `<script>` or `<style>`.
Dynamic `import()` on first click so it costs nothing on load. Everything
root-level. Stage explicit paths — never `git add -A`.

**The bio must survive every path.** It is the most-read text on the site, and a
toy that can leave it broken is not worth shipping.
