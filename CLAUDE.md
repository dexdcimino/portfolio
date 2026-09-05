# CLAUDE.md — what is true in this repo

`DOCTRINE.md` beside this file is *how we work*. It is portable, numbered and copies
verbatim into any project. **This file is *what is true here*, and it does not repeat the
doctrine** — where a rule below is the local instance of a doctrine rule, it says which
number, so you can see the general shape behind the specific scar.

Everything in here has already cost time. Nothing is a preference. If this file contradicts
the repo, the repo wins — say so and it gets fixed.

`ARCHITECTURE.md` is the third file: how the site is put together, module by module. This
one is the rules; that one is the map.

## The feedback loops

**There is no build and no test runner.** `npm test` is a stub that exits 1 and has never run
anything — do not read its failure as a broken suite, there is no suite. The gate is the
checkers below and the commit hooks that fire them. Doctrine rule 23.

| run this | it answers |
|---|---|
| `python tools/check_accents.py` | the 7-accent palette is byte-identical in all 5 copies |
| `python tools/check_cursors.py` | the 3 cursor paths are identical in all 4 copies |
| `python tools/bake_markup.py --check` | every `<picture>` is current and every reference resolves |
| `python tools/bake_work.py --check` | `work.json` matches the masters, the index and the ladder |
| `python tools/bake_music.py --check` | `assets/music/tracks.json` matches `tracklist.txt` |
| `python tools/bake_images.py --check` | every derivative exists and is newer than its master |
| `python tools/check_sweep.py --cases` | the sweep checker can still refuse — 8 recorded cases |
| `python tools/check_pack.py --cases` | the pack freshness gate can still refuse |
| `python tools/check_accents.py --cases` | the palette checker can still refuse — 12 cases |
| `python tools/check_cursors.py --cases` | the cursor checker can still refuse — 12 cases |
| `python tools/check_scope.py --cases` | the scope checker can still refuse — both incidents |
| `node   tools/check_markdown.mjs --cases` | the XSS detector fires on a renderer with the original bug |
| `python tools/bake_images.py --cases` | `--check` fails on an empty walk |
| `python tools/bake_markup.py --cases` | `--check` fails on an empty parse and a hand edit |
| `python tools/bake_work.py --cases` | the manifest gate can still refuse — 4 recorded states |
| `python tools/bake_music.py --cases` | the track-list gate can still refuse — 10 cases |
| `python tools/focal_point.py` | the crop-aiming rule still keeps heads in frame — 8 cases |
| `node tools/notes_check.mjs` | the notes overlay: no leak, real persistence, 20 backups (needs the dev server) |
| `node tools/notes_editor_check.mjs` | the notes editor: Tab, Backspace, shortcuts, the selection bug — 29 checks |
| `node tools/notes_store_check.mjs` | the notes store against a stubbed Vercel Blob — 30 checks, no server needed |
| `node tools/work_check.mjs` | featured work, the work overlay, the code prompt, the games stack and the AI Lab — 93 checks, serves the repo itself |
| `node tools/music_check.mjs` | the music overlay: the four columns, the seeded repeat list, the three-state repeat, the centred transport, 20 size floors, the embed URL and the notes keypad flash — 85 checks, serves the repo itself |
| `node tools/check_markdown.mjs` | `renderMarkdown` cannot emit an event handler (needs Chrome) |
| `python tools/context_pack.py` | rebuilds the context zip in the root, measured not typed |

Every one of them prints the size of what it examined. That is not decoration — see
**Count the subject** below.

### And the ones that lie

Named next to the honest ones, because a false green is worse than a red (doctrine rule 12):

- **`npm test`** exits 1 while running nothing. It is a stub, not a signal.
- **`python tools/bake_images.py --check` printed "all derivatives present and current"
  over an empty walk.** It is in the table above because it is fixed and now prints its
  counts; it is in this list because it is the reason the rule exists.
- **A browser harness on a throwaway `--user-data-dir` has empty `localStorage`,** so every
  returning-visitor path is dark and a bug that only reproduces for a real visitor will not
  reproduce in it.
- **`element.click()` across an iframe boundary does not move browser focus.** A test that
  drives a click and then asserts on focus or on `:hover` passes while reproducing nothing.
  Drive real input events and assert the state you meant to reach actually arrived.
- **`Page.captureScreenshot` clips in PAGE coordinates; `getBoundingClientRect()` is
  viewport.** Forget to add `scrollX/scrollY` and you get flat background, which compares
  equal to flat background and passes any test that is not looking at bytes.
- **Polling until two reads agree returns mid-transition** for anything off-screen: Chrome
  stalls transitions between compositor ticks, so the same in-flight value appears twice.
  Settle on the site's own reduced-motion path instead of guessing at a sleep.

## Reporting

The shape is `DOCTRINE.md` rule 5 and is not restated here. What is local:

- **The tracker and the `CURRENT:` / `PHASE:` lines are generated from
  `docs/plan/README.md`, never hand-written.** `tools/context_pack.py` parses that table at
  pack time. There is no phased plan right now and `PHASE none` is the correct answer;
  `docs/plan/BACKLOG.md` is the queue instead. Do not add phase rows to fill the shape.
- **`CURRENT:` is fixed.** Same text in every reply, every phase, every pack. It is the
  project's arc, not its status.
- **A session-end report runs in this order:** what shipped (commits, one line each) ->
  verified vs. inferred, separated, naming the command that ran -> debatable calls -> docs
  touched, always present, "none" counts -> decision log -> loose ends -> the phase unit,
  last.
- **"It compiles" is not "it works," and in this repo there is nothing to compile.** The
  honest sentence is the name of the checker you ran and what it printed. "I could not run
  X" is a complete sentence (doctrine rule 14).

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

- **And the other half of that accident is now enforced too.** A commit can
  also carry work it never mentions, by staging a file two sessions are both
  editing. On 2026-08-19 three did: `b6ba02f` published a re-baked kong-fu
  `<picture>` whose derivatives were not staged, so `main` referenced a file
  that was in no tree at all; `feef1f3` ("Splitmob renamed everywhere") carried
  a `.vault-pin` restyle; `d3c2f6a` carried an ARCHITECTURE.md invariant. Wrong
  attribution is the small half — the real risk is a revert taking out
  something nobody knew was in there. `tools/check_sweep.py` refuses three
  things: markup pointing at an `assets/derived/` file the commit does not
  contain, and a `?v=` restamp whose bytes the commit does not carry (both
  exact, no escape hatch), and a region of a root file or an `ARCHITECTURE.md`
  whose identifiers appear nowhere in the message. The last is escapable, and
  has to name the file:

      Carries: styles.css - the vault pin restyle, agreed with the other session

  Usually the right fix is not the escape hatch but a sentence in the message.
  `python tools/check_sweep.py --commit <sha>` runs it against history, and
  `--cases` re-runs every incident named here as an assertion.

  **Two of those three are refused. `d3c2f6a` is not, and is not meant to
  be.** It is the checker's one known limit and it has a name: the ADJACENCY
  limit. Hunks no more than 60 untouched lines apart are treated as ONE
  region, so a swept invariant sitting beside a real edit is explained by the
  real half and passes — d3c2f6a's invariant is inside a 34-line region with
  the Ember fix that earned it, excused by that fix's own `approachAlt` and
  `maxZ`. Do not read the list above as "all three are now caught". Widening
  it is a tuning decision with a measured noise cost, not an oversight; the
  reasoning is in `tools/check_sweep.py`'s docstring and in ARCHITECTURE.md.

  A fresh clone installs both hooks once:
  `python tools/bake_images.py --install-hooks`.

## The work gallery is REAL ART now, but the selection is not settled

The SVG filler is gone. `assets/work/<category>/` holds 350 web masters across
eight categories, and the `TEMPORARY MOCKUP DATA` block in `script.js` has been
replaced by `assets/work/work.json`. What is still provisional is *which* of
them ship, not whether they are real.

- **The masters are WEB masters, not originals.** WebP q92, capped at 1600px
  (the top of the `work` ladder). The untouched originals are 525 MB and live
  outside the repo in `_resources/gallery-originals/`, which is gitignored. Do
  not treat `assets/work/` as the only copy, and do not re-export from it.
- **`.webp` is a master extension now**, not only an output one. Two files in
  the original drop were already `.webp` and `bake_images.py` walked past them
  in silence.
- **The `work` ladder is (900, 600, 400) and that is DELIBERATELY SHORT.** The
  overlay hero wants 1600 and is being served 900 on purpose, because the full
  ladder is 4200 files to encode for a set that is mostly about to be cut. One
  edit in `tools/image_slots.py` widens it once the selection settles.
- **`work-index.json` is the hand-written half and the pruning tool.** Every
  file in a category folder is shown unless its stem is in `omit`, so adding
  art is a drop and removing it is one line. `bake_work.py` prints shown and
  omitted counts per category on every run.
- **The categories, the card frames and the titles are a FIRST PASS.** They
  were chosen by looking at contact sheets of all 377 files, not by a taxonomy
  anyone has agreed to. Do not build on them as if they were settled.
- **Nothing is cropped on disk and nothing should be.** The card and the
  filmstrip thumb are landscape boxes and most of this art is portrait, so a
  centred cover-crop takes the head off every standing figure — which is
  exactly what shipped first. `tools/focal_point.py` measures where the
  subject starts and `bake_work.py` writes an `object-position` per piece per
  box. A baked thumbnail would be cropped twice and would still be wrong at
  the next breakpoint.
- **The measured crop is cached in `work.json` against the master's stamp AND
  `focal_point.VERSION`.** Change a constant in that module and bump the
  version, or `--check` will keep agreeing with positions it computed under
  the old rule. A hand override goes in `work-index.json`'s `pos`, keyed by
  stem; there is exactly one today and it names why.
- **27 groups of exact duplicates were collapsed** when the drop was
  reorganised (The Wild Robot was also Roblox-2..7, Knights of Edengale was
  also Low-Res-Assets, DigiBitties spanned three folders). A piece lives in
  exactly one category. If a piece needs to appear in two, the manifest points
  at it twice — do not copy the file.

The hero is still a **fixed 3:2 box** (the frame itself on phones) and images
letterbox into it with `object-fit:contain`. Do not make the box track each
image's aspect ratio: that is what makes the caption and filmstrip jump on
every arrow press.

## A constant correct for the average world is wrong for the small ones (five times)

`games/surveyor/` has six worlds whose radii run **207m to 2072m**, a factor of
ten. Every number that is a length has to be asked what it means at both ends,
and five times now one has not been:

| the constant | what it was | what it broke |
|---|---|---|
| `HYPER.approachAlt` | 900m, absolute | 0.43 radii up on Anvil, **4.35 on Ember** — the root cause under the three below |
| `farPlane` | `R * 4` | on Ember the arrival sat outside it: all 51 live leaves clipped, no world drawn at all |
| the fog altitude clamp | `2R` | froze the range above it, so Ember over ~400m and Tarn over ~900m went to 100% fog — an arrival into a white-out |
| the far body's air gate | `2R` | switched the term off at exactly the altitude it was written for, on exactly the worlds that needed it |
| the arrival altitude | shared `approachAlt`, 900m | the world you flew to filled **0% of the frame** on Ember and Tarn. A limb enters the chase view at 0.41 radii and 900m is 4.35 of them there |

The fog rule carried a second version of the same mistake in its maths rather
than its constants: `sqrt(2Ra)` for the horizon is the small-angle form and is
only right while `a` is small against `R`. At Tarn's arrival it under-read by
31%.

**So: EMBER AND TARN ARE THE FIRST CHECK ON ANY NEW CONSTANT, NOT THE LAST.**
Before adding a length, divide it by 207 and by 2072 and look at both answers.
If the number is absolute, say why it is allowed to be. If it is a multiple of
the radius, check it against the altitudes the game actually puts a craft at —
the jet's ceiling of ~580m is 0.28 radii on Anvil and **2.80 on Ember**, and
anything keyed to one or two radii is already wrong there.

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
- **Budget: no served AVIF over 150 KB on the wire**; hero LCP < 1.2 s on cold
  4G. The budget is the AVIF and only the AVIF (Dex, 2026-08-20): that is the
  file a modern browser downloads, so it is the number that describes what a
  visitor pays. The WebP beside it is the fallback for browsers too old for
  AVIF, and holding it to the same ceiling would mean either degrading the AVIF
  or dropping a rung for a shrinking minority — so **WebP is informational, not
  a gate**. Worth a glance if it ever runs away; never a reason to fail a
  commit. `bake_images --check` prints the AVIF rungs currently over as a note
  (six today, all the wallpapers' 1920) rather than anyone keeping a list —
  the last hand-written one said "the three busiest pieces" while naming four,
  and the real answer was six.
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
  Derivatives are staged per-master, not by folder: the bake is repo-wide, so
  `git add assets/derived/` swept another session's unbaked art into two commits
  on 2026-08-20. The hook now asks `bake_images.py --derived-for` which files
  belong to the masters being committed, and reports what it left alone.
- Accent swaps retint the `<source>` srcsets, not just `img.src` — changing
  `src` alone does nothing inside a `<picture>`.
- `script.js` builds mascot URLs at runtime (`mascot_${theme.mascot}-900.avif`),
  so the six mascots the markup never names still need the hero slot's widths.
  `SIBLINGS` in `image_slots.py` gives them the named mascot's ladder, and
  `bake_markup --check` expands those `${...}` references across the whole family
  — narrow the hero ladder and it fails loudly instead of 404ing for anyone who
  picks a non-default accent.

## Count the subject, assert the count (four times)

The local instance of doctrine rule 12, and the one this repo has paid for most.
**A checker that discovers nothing does not fail.** It examines nothing, finds no problems,
prints whatever it prints when all is well, and exits 0 — byte-identical to a clean run. A
pattern that silently matches nothing looks exactly like a pattern that matches everything.

Four times, three of them in one afternoon: `glslcheck.mjs` scanned none of the three shader
bodies it exists for; `lodcheck` observed **zero** of the handoffs it measures for its whole
life while printing that they were clean; `bake_images.py --check`, which this file names as
a blocking gate, printed success over an empty walk.

So, for anything new that checks something:

1. **Count what you examined and put the number in the output**, pass or fail.
2. **Assert the count against an expectation, not against zero.** `bodies.length > 10`
   passed on seventeen while three were missing.
3. **Never let a positive claim be reachable with an empty subject.** An empty set is a
   broken discovery, and it is reported as broken, not as clean.
4. **A loop that emits checks emits none when its subject is empty**, so the suite total
   drops silently and everything still passes. Assert the size before the loop.

**Every gate in this repo now has a `--cases` mode, and a new one is not finished without
it.** Each drives the checker's own decision function — not a copy of it — through the
states it must refuse, asserts how many of those there are, and asserts the live subject is
still found. Writing them was worth it twice over: `bake_markup --check` turned out to have
no empty-parse guard at all, so a page whose directives stopped matching would have printed
"0 image block(s) current ... all present" and exited 0; and `check_markdown`'s
interpolation scan could match nothing and pass vacuously. Both were found by writing the
case that should fail, not by reading the code.

The shape to copy, if you add a gate: a pure `verdict()` / `parse()` / `issues()` the hook
and the table both call, a table with the refusals marked, an assertion on the table's own
size, and one control proving the real subject is still discovered. Full history in
`ARCHITECTURE.md`, "Writing a checker".

## Line endings are per file, and some files are MIXED

Not a style question — a correctness one, and it has already buried a real diff.

`index.html` is 2203 CRLF against 3192 LF. `styles.css` is 4295 against 4308.
`games/arena1/js/main.js` has three bare-LF lines in a CRLF file. **Read each file's own
endings before editing it, and patch a mixed file at BYTE level.** A tool that sniffs
`b"\r\n" in raw`, decides "this file is CRLF" and rewrites it whole will convert every line:
that turned a 12-line edit to `games/surveyor/js/world/discs.js` into a 1054-line diff, which
is a diff nobody can review and a `git blame` nobody can use.

Check before you write:

```
python -c "b=open('styles.css','rb').read(); print(b.count(b'\r\n'), b.count(b'\n'))"
```

Equal numbers mean uniform CRLF; a zero first number means uniform LF; anything else is
mixed and gets byte-level replacement only. Never normalise a file as a side effect of
editing it.

## Two display values that have been broken four-plus times

`.infochip-img-wrap` must stay `display: inline-block` and `.img-zws` must stay
`display: inline`. Every switch to `block` or a float looks like a tidy-up and breaks the
same two things: the caret goes full-image-height beside a chip, and a selection that
crosses one loses the zero-width spaces that make it navigable. **The tall cursor and the
highlight near images are accepted trade-offs, not bugs to fix** — that is what makes this
regression so attractive to the next person.

**Where it lives is not obvious, so check before you go looking:** the only code in THIS
repo that depends on it is `games/stickland/_reference/infochips.js`, which queries both
classes throughout (`chip.closest('.infochip-img-wrap')`, the `img-zws` sibling handling
around line 2700). The CSS declaring them is **not in this repo at all** — no `.css`, `.html`
or `.js` file here contains either selector's rule. So a change here cannot break it and a
fix here cannot repair it; the rule is recorded because the consumer is vendored in and the
pairing has to survive the next person who reads that file. If the declarations belong
anywhere, it is the project `_reference/` was taken from.

## Architecture docs stay current

Any change that alters module structure, a data shape, an invariant, or a
number quoted in an `ARCHITECTURE.md` must update that file in the same
commit. A stale architecture doc is worse than none — it is confidently
wrong. The docs: `ARCHITECTURE.md` (site shell) and one per game under
`games/<name>/ARCHITECTURE.md`.

## Where each kind of fact lives, and who is allowed to write it

Doctrine rule 16 has three layers; this repo has four files and they do not overlap.
Putting a fact in the wrong one is how it rots.

| the fact | lives in | written by |
|---|---|---|
| how the site is built | `ARCHITECTURE.md`, `games/*/ARCHITECTURE.md` | a person, same commit as the change |
| the rules and what breaking them cost | `CLAUDE.md` (this file) | a person, once it has cost something twice |
| **why a call was made, and what it replaced** | **`docs/DECISIONS.md`** | **a person, same scoped commit, append-only** |
| what is true right now | `START-HERE.md` in the context pack | `tools/context_pack.py`, measured |
| what to do next | `docs/plan/BACKLOG.md` | a person, each item naming the command that verified it |

**`docs/DECISIONS.md` is append-only and newest-first, and it is read before reopening any
architectural call.** A commit message is not a substitute: it is filed against the change
rather than against the question, and it does not surface at the moment someone is about to
revisit the decision. From the code alone, "we rejected that" and "nobody thought of it"
look identical.

**There is no STATUS.md any more, and there must not be another one.** It was
hand-maintained, and by the time it was deleted on 2026-08-22 it claimed 50 markup blocks
and 332 derivatives against a real 71 and 522 — drift in the one file whose whole job was
being current. Every fact in it was either measurable, and is now generated into the pack at
build time, or an open item, and is now in the backlog. If you find yourself about to type a
number that a command could print, that is the mistake (doctrine rule 17).
