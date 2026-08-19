## Reporting

- End every report with a block titled **NEEDS DEX** listing only decisions I
  must make or questions I must answer. One line each, no context, no
  reasoning. If nothing is needed, write `NEEDS DEX: nothing.`
- Full detail goes above that block.

### Briefing chat

- A separate AI session receives pasted briefings and replies with ONLY one of:
  `Paste to Claude Code:` (a copy-ready block, nothing else), `Dex does this:`
  (numbered steps on his end), `Answer these:` (questions only he can answer),
  or `All good` (nothing needed, next task). Combine when a briefing needs more
  than one.
- One line per item, decision only. Rationale only if Dex asks.
- Write NEEDS DEX lines so they survive that round trip: each must stand alone
  as a decision, with no reference to context above it.

## Git workflow

- After completing any MD or task that changes files, commit and push
  automatically. Do not wait to be asked.
- Commit message: short imperative summary of what changed.
- Never commit if verification steps failed — report the failure instead.
- Never use `--no-verify`, and never force-push.
- If the working tree has unrelated changes the user made by hand, mention them
  rather than sweeping them into the commit.
- **Never `git add -A`, `git add .`, or `git commit -a`.** Run `git status`
  first, then stage the explicit paths you changed and nothing else.
  More than one session works in this repo at a time. `git add -A` cannot tell
  your work from someone else's in-progress edits, and on 2026-08-16 it swept
  another session's half-finished Chomp files into an unrelated commit and
  pushed them. Nothing was lost that time; the rule exists so there is no next
  time. Staging by name also means the diff you commit is the diff you read.
- **This is now enforced, because the rule above failed twice.** On 2026-08-18
  commit `55e52cb` — subject "AI Lab: stop the thumbnail hover being clipped" —
  also reverted ten files under `games/surveyor/`, 544 deletions including a
  whole pause menu, in a commit that meant to change `styles.css`.
  `.git/hooks/commit-msg` now refuses a commit that reaches across unrelated
  projects, where a project is each `games/<name>`, each other top-level
  directory, and the repo root. See `tools/check_scope.py` for why it is not
  simply "one top-level directory" — that rule would not have caught either
  incident. Deliberate reach is allowed and must say so:

      Spans: games/chomp, games/surveyor — one shared panel, both games

  A fresh clone installs both hooks once:
  `python tools/bake_images.py --install-hooks`.

## Work overlay is a MOCKUP (do not mistake it for finished)

- The Work overlay ships with **generated filler images**, not artwork: SVG data
  URIs built in the `TEMPORARY MOCKUP DATA` block at the bottom of `script.js`.
  There is no `work.json`, nothing in `assets/media/`, and no real asset was
  added for it. The `FILLER — NOT REAL WORK` stamp on each image is deliberate.
- The categories, titles, tool/year lines and counts are placeholders, **not a
  settled taxonomy**. Do not build on them as if they were.
- Everything after that block is data-shape-agnostic: it renders a list of
  `{title, desc, src, w, h}` and does not care where the list came from. The
  real build replaces one block with `work.json` plus baked derivatives — the
  tab row, filmstrip, hero and caption need no changes.
- The hero is a **fixed 3:2 box** (the frame itself on phones) and images
  letterbox into it with `object-fit:contain`. Do not make the box track each
  image's aspect ratio: that is what makes the caption and filmstrip jump on
  every arrow press.

## An object that caches the world it was built for (three times now)

This has cost three separate bugs in `games/surveyor/`, and each one looked like
something else first. The shape is always the same:

```js
constructor(scene, craft) {
  this.planet = craft.surf.planet;   // read once, at boot
}
```

Nothing writes it again. The object then answers for **whichever world the tab
opened on, forever**, and because most sessions never leave the first world it
does not show up in play or in the harnesses.

What it has cost:

- **Sky domes.** `Worlds.get()` built a whole World per saved world at boot and
  only `enter()` ever hid one, so a cold load with a save file drew six sky
  domes at once. Read as a sun bug for three sessions.
- **`Trails`.** Ember's ash and Shroud's murk were authored, resolved correctly,
  and only ever built against the boot world. Flying to Ember got you Home's
  drift in an ash storm.
- **`SURVEYOR.surface`.** A module-level `const surface` in `main.js`, handed to
  the dev harnesses, still pointing at the boot planet after any warp.
  `dev/frames.mjs` frames its shots from it.

**The rules that follow:**

- **Anything per-world is constructed inside `World`, or it is re-pointed in
  `swapTo`. There is no third option.** `World` is rebuilt per planet, so
  everything it owns is correct by construction.
- **Never expose a cached copy of something that changes.** `SURVEYOR.surface`
  is a getter onto `craft.surf` now. A getter cannot go stale.
- **Anything that moves the craft without flying it must say so.** A hyper
  arrival teleports across the solar system in one frame, and objects that
  integrate position — the wingtip `TrailMesh` was the one that bit — will
  happily draw the jump. `Trails.resetJetTrails()` exists for exactly this.
- **When a bug reproduces in a browser and not in a harness, suspect this
  first**, then suspect the harness's own profile: every harness in `dev/`
  launches Chrome on a throwaway `--user-data-dir`, so `localStorage` is empty
  and every returning-player path is dark. `dev/savedworlds.mjs` and the
  `--save` flag in `dev/savefile.mjs` exist to close that gap.

Before adding a class that takes a `planet`, a `surface` or a palette: grep for
`this.planet =` and `this.surf =` and check the new one against the list above.

## Image pipeline (do not regress)

- `assets/` = masters (only copy of some art). `assets/derived/` = generated;
  `tools/bake_images.py` is the sole writer. Never hand-edit `assets/derived/`.
- Derived output **mirrors the master's subfolder** (`assets/mascots/x.png` ->
  `assets/derived/mascots/x-900.avif`), so stems only need to be unique within a
  folder. This is what keeps per-project media folders collision-free — do not
  flatten it back.
### Adding an image — the whole manual step

1. Put the file anywhere under `assets/`.
2. Write **one line** in `index.html` saying where it goes:

   ```html
   <!-- img src="assets/images/thing.png" slot="work-card" alt="What it shows" -->
   <!-- /img -->
   ```
3. Commit. The hook bakes the derivatives, fills in the block, and stages both.

That is the entire job. `<picture>`, both srcsets, `sizes`, `loading`,
`decoding`, the fallback `src` and the intrinsic `width`/`height` are all
generated. Outside a commit, `python tools/bake_images.py && python
tools/bake_markup.py` does the same thing.

Optional attributes on the directive, passed through to the `<img>`: `id`,
`class`, `picture-class` (goes on the `<picture>`), `draggable`, and any bare
`data-*` flag. Anything else, add to `render_picture()` — do not hand-patch the
output.

### Rules that follow from that

- **Never edit between `<!-- img -->` and `<!-- /img -->`.** It is generated and
  the next run overwrites it; `bake_markup.py --check` fails on hand edits.
- **Never type `width`/`height`.** They are read from the file, which is what
  makes a stale dimension — and the layout shift it causes — impossible rather
  than merely unlikely.
- `sizes` and the width ladder live in `tools/image_slots.py`, once, per SLOT.
  A slot is a place in the layout ("the work-card grid cell"), not an image. New
  layout position = new slot; new image in an existing position = just reference
  the slot.
- LADDERS are per role because a 19vw grid thumbnail and a full-bleed hero want
  different widths: `card` 900/600/400, `avatar` 420/200/84, `gallery`
  1600/1200/900/600 (unused until the work overlay gets real art — use it there).
  Change a ladder and every image in that role re-bakes and re-writes itself.
- A master is baked at exactly the widths its slots ask for. Masters no slot
  names fall back to the standard ladder, or inherit a sibling's (see below).
- AVIF q=58, WebP q=76/method=6 — validated at 100% crop, do not raise "to be
  safe".
- Raw PNG/JPG is only ever the final `<picture>` fallback, never the served image.
- Hero mascot: `fetchpriority="high"`, preloaded in `<head>`, **never**
  `loading="lazy"`. It is the LCP element — that comes from `eager: True` on its
  slot, and the `<head>` preload is generated from the same ladder.
- Below the fold: `loading="lazy"` + `decoding="async"`, applied automatically.
- Budget: no single image over 150 KB on the wire; hero LCP < 1.2 s on cold 4G.
- Video is not self-hosted — external streaming host only.
- `assets/derived/` is served `immutable` for a year via `vercel.json`, so every
  generated URL carries a `?v=<8 hex>` stamp of its **master's** bytes. That is
  what makes re-exporting a master under the same name actually reach people:
  without it, `immutable` means a browser that already fetched a rung keeps the
  old art for a year. It bit Shale Spire Crater on 2026-08-17 and showed up only
  in the lightbox, because the card and the lightbox pull different rungs and a
  reload refetches just the card's. The stamp is a query, not a filename — the
  file on disk is still `<stem>-<width>.<ext>`.
- **Never build a derivative URL in JS at all.** A hand-built URL is a second
  cache entry for identical bytes (this briefly double-fetched the LCP image),
  and a hand-picked width/format goes stale against `sizes` (the idle mascot
  warm fetched the 600 rung while nearly every screen's click needed the 900 —
  the accent swap always hit the network). `probeMascot()` in `script.js` is
  the pattern: clone the real `<picture>`, rewrite the stems in place (stamps
  ride along), and let the browser's own negotiation fetch the one true file.
- **Any session touching images must run both checks before declaring work
  complete. A non-zero exit from either is a blocking failure:**

  ```
  python tools/bake_images.py --check     # derivatives present and newer than their master
  python tools/bake_markup.py --check     # markup current, every reference resolves, sizes match
  ```

  `bake_markup --check` is the one that catches the failures you cannot see:
  markup edited by hand, a master re-exported at a new size, a slot or ladder
  changed without regenerating, a `<picture>` pointing at a derivative that was
  never baked.
- Derivatives nothing references are reported by `bake_images --check` as a
  note, not a failure — they do not break the page. Clear them with
  `python tools/bake_images.py --prune`.
- Discovery is **repo-wide**: the baker walks everything and compresses any
  `.png/.jpg/.jpeg` outside `derived/`, `_resources/`, `games/`, `.git/`,
  `node_modules/`, `.vercel/`. There is no `SOURCES` manifest — do not
  reintroduce one.
- `games/` is skipped **on purpose**: playable builds ship their own optimised
  textures, and baking them would write six widths of derivatives nothing
  references. Do not remove it from `SKIP_DIRS` — see `games/README.md` for the
  full folder contract.
- Fallback ladder 1600/1200/900/600/400/200, minus widths above the source, for
  masters no slot claims. There is no `WIDTH_OVERRIDES` any more — a bespoke
  ladder is a property of the slot, not a table to keep in sync.
- New machine needs `python tools/bake_images.py --install-hooks` once. The hook
  is convenience (skippable via `--no-verify`, absent on fresh clones); the two
  `--check`s are the actual guarantee. Note the hook stages `index.html` whole —
  if you deliberately staged only part of it, commit the image change separately.
- Accent swaps retint the `<source>` srcsets, not just `img.src` — changing
  `src` alone does nothing inside a `<picture>`.
- `script.js` builds mascot URLs at runtime (`mascot_${theme.mascot}-900.avif`),
  so the six mascots the markup never names still need the hero slot's widths.
  `SIBLINGS` in `image_slots.py` gives them the named mascot's ladder, and
  `bake_markup --check` expands those `${...}` references across the whole family
  — narrow the hero ladder and it fails loudly instead of 404ing for anyone who
  picks a non-default accent.
