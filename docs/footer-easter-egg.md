# Footer easter egg — delete the website

Clone my portfolio repo — github.com/dexdcimino/portfolio — and read
`ARCHITECTURE.md` and `docs/ONBOARDING.md` first.

---

## The idea

A small **trash can in the bottom right of the footer.** Click it and a modal
comes up with one button.

**The button keeps changing.** Each click swaps its label for another
increasingly nervous attempt to talk you out of it — *Are you sure? · Don't do
it · Nooo · Last chance* — and the button is the only way forward. After four or
five clicks it gives up and the site goes.

**Then it breaks.** Cracks spread across the viewport, the page shatters into
shards and falls away, and behind it — in the dark — is **something with glowing
eyes.** A stylised monster, a creepy clown, whatever the art turns out to be.
Not a gag character; something that was apparently back there the whole time.

A modal fades in over it: *"Don't do that again."* One OK button. The site
returns.

**It is eerie, not punishing.** The joke is that something was behind the page,
not that the visitor is a bad person. Punishing curiosity reads sour on a
portfolio, and the unsettling version is the one people screenshot.

### The escalating button

This is the whole first half, so give it some care.

- **One button, no second option.** There is no cancel — closing the modal is
  the cancel, via Escape or the backdrop, exactly as every other overlay on this
  site already works. Do not add a No.
- **Four or five states**, each a shorter and more rattled version of the last.
  Write them so the escalation reads: reluctance, then alarm, then resignation.
- **The label change should be felt** — a small shake, a colour shift toward the
  warn hue, the text getting terser. It should look like the button is losing
  its nerve.
- **Fast.** Four clicks in about two seconds. Any slower and it becomes a chore
  rather than a bit.

---

## How to shatter it — do not use a screenshot library

The obvious approach is `html2canvas` and animating the bitmap. Do not. It is a
dependency, it is slow, it rasterises fonts and images imperfectly, and it fights
the CSP.

**Clone and clip instead.**

1. Clone the visible region into a `position: fixed` overlay, offset so it lines
   up exactly with what is on screen.
2. Make **6–8 copies** of that clone, each masked to a different `clip-path`
   polygon — the shards.
3. Hide the real page underneath.
4. Animate each shard independently with CSS transforms: rotate, translate,
   fall, fade.

Every shard is the **real page** — real fonts, real images, real layout — but
now an independent object. No library, no rasterisation, nothing renders wrong.

### Three things that will break it

- **Strip `iframe`, `video` and `canvas` from the clones.** A cloned iframe
  reloads its content; a cloned canvas comes out blank. Replace each with a flat
  block in a plausible colour, or remove it.
- **Cap the shard count.** Each is a full DOM copy of the visible region. Six to
  eight is plenty and reads better than twenty — big pieces look like breaking,
  small ones look like confetti.
- **The clone must not be interactive.** `pointer-events: none`, `inert`, and
  `aria-hidden` on the whole overlay. Nothing in it should be focusable, and no
  duplicate ids should reach the accessible tree.

### The beat

**Cracks first, then the fall.** One SVG overlay draws the crack lines across
the viewport, holds for a moment, and *then* the shards let go. The cracks are
what sells it; the falling is the punchline. Both at once reads as a glitch.

---

## Getting the site back

**Non-negotiable: this must always be recoverable, obviously and immediately.**
Someone will do this with a recruiter looking over their shoulder.

- The OK button restores everything.
- **Scroll position is preserved** — they come back exactly where they were.
- **Any error at any point restores the page and removes the overlay.** Wrap the
  whole thing so a failure cannot leave someone stranded.
- A reload always works, because nothing about this touches storage or the URL.

## Reduced motion

With `prefers-reduced-motion: reduce`, **skip the shatter entirely** — go
straight from the last click to the creature and its modal. The joke survives; the vestibular problem
does not happen.

## Cost

**Nothing loads until the trash can is clicked.** `import()` the module on that
first click. The root CSP is `script-src 'self'` with no inline allowance, so it
is an external file regardless, and a dynamic import keeps it off the initial
page load entirely.

---

## The pieces

**The trash can** — **bottom right of the footer**, small and quiet. It should
read as a real control someone might poke, not as a labelled joke. No tooltip
explaining it; finding it is the point.

**The modal** — one button, escalating labels. Use the site's existing modal
machinery (`openModal` / `bindModal` / `.contact-close`) rather than a new one,
so Escape, the backdrop click and focus trapping all work the way every other
overlay on the site does. **Escape and the backdrop are the way out** — there is
no cancel button.

**The creature** — Dex is supplying the art. Something in the dark with glowing
eyes: a stylised monster or a creepy clown. It sits in `assets/` and goes
through the image pipeline like everything else: a one-line `<!-- img ... -->`
directive, `bake_markup.py` writes the `<picture>`.

**Use a placeholder until it lands**, and say in the report exactly where to
drop the real file and what dimensions it wants — including how much of the
frame is safe to fill, since the modal sits over it.

**The reveal wants darkness.** Whatever is behind the page should be nearly
black with the eyes carrying it. A brightly-lit character behind a shattering
website is a cartoon; a shape in the dark is the thing that makes someone lean
back.

**No audio.** Something that shrieks unprompted is a fast way to get a tab
closed, and the silence is scarier anyway.

---

## Verification

- The trash can sits bottom right in the footer, findable but not signposted
- The button escalates through its labels and is the only way forward
- Escape and the backdrop close it at any point, with nothing broken
- The final click cracks, then shatters into 6–8 shards, then reveals the
  creature in the dark
- The "don't do that again" modal fades in over it, and OK restores the page
  **at the same scroll position**
- An error anywhere restores the page and clears the overlay
- Reduced motion skips straight to the modal
- **Nothing loads before the first click** — confirm on a cold load
- The overlay is inert, `aria-hidden`, and contributes no duplicate ids
- No iframe reloads and no blank canvases in the shards
- Works at 1280 and 900, and on a phone
- No CSP violations; no inline `<script>` or `<style>`
- Both bake checks pass
- `ARCHITECTURE.md` updated in the same commit

## Report — under 12 lines

- what shipped
- where the creature art goes, what size, and how much of the frame the modal covers
- shard count, and the frame cost of the shatter
- one line: does it read as breaking rather than as a glitch
- anything blocking

## Constraints

No build step, no bundler, no npm, no CDN. **No screenshot library.** Everything
root-level, so `check_scope.py` sees one unit. Cache-bust the `?v=` on anything
touched. Stage explicit paths — never `git add -A`. Line endings are mixed per
file; preserve each file's own.
