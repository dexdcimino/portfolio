# Decisions

**Append-only. Newest first. Never edited, never reordered, never deleted.**

This file exists because *"we rejected that"* and *"nobody thought of it"* look identical
from the code six months later, and neither one is visible in a diff. A commit message is
the wrong home for a call like that: it is filed against the change, not against the
question, and it does not surface at the moment someone is about to revisit the decision.
This file does. Read it before reopening any architectural call (`DOCTRINE.md` rule 18).

Each entry carries four things and nothing else: **what was decided**, **what it replaced**,
**why**, and **what would make it worth reversing**. If an entry cannot name what it
replaced, it was not a decision — it was just the first idea, and it does not belong here.

**The fourth field is a local extension of doctrine rule 18, which asks for three.** It is
adopted here and proposed upstream in `docs/doctrine-amendment-01-reverse-it-if.md`;
`DOCTRINE.md` itself is NOT edited, because it copies verbatim between projects and a local
edit is a fork. The reversal condition is what keeps this file readable as it grows: without
it every entry argues for itself forever, and a reader cannot tell a decision that is still
load-bearing from one whose reason expired. It names a condition, not a date — "nothing
foreseeable; this follows from X and falls only if X does" is a complete answer.

A call that changes how someone builds gets its entry **in the same scoped commit as the
change**, so the reasoning cannot drift away from the diff it explains.

---

## 2026-09-02 — cover-crops are aimed by measurement, vertically only

**Decided.** `tools/focal_point.py` measures the variance within each row of a
240px thumbnail, takes the first row reaching 22% of the strongest as the top of
the subject, and returns an `object-position` that puts the crop window just
above it. `bake_work.py` writes one per piece per box (card and filmstrip thumb)
into `work.json`, cached against the master's content stamp and the module's own
VERSION. `work-index.json`'s `pos` overrides it by stem.

**Replaced.** A plain centred crop, which showed Brigadier Bluebeard's belt
buckle and beheaded Nyxara, Nimp, Osseous, Mecha-Bot and Sandstone Guardian. Two
other candidates were built and measured before this one:

- **Difference from the border-ring median.** Found the figures on flat dark
  plates and missed three of the reported cases outright, because a graded plate
  is a different colour on every row while staying flat across each one. Row
  variance does not care what colour the plate is.
- **FIND_EDGES plus a one-pixel resize**, taken up because it runs entirely in
  Pillow's C code and therefore looked obviously faster. Measured: 52s against
  35s over the set — the filter cost more than the arithmetic it saved — and it
  left kittens-3 at y=.36 and roblox-pets-1 at y=.42, which still cuts both
  their faces.

**Why vertical only.** A version that also re-centred horizontally was measured
against all 40 card frames: not one landscape frame had a framing problem to
fix, and the rule produced gobbler-fish-2 at 92% and bluebeards-blaster-2 pinned
to 100%, both worse than the centre they replaced. The geometry says the same
thing — these boxes are landscape and this art is portrait, so the vertical axis
is where everything is lost.

**Why no "is there a plate" gate.** The first cut had one and refused to move
anything that failed it, which was eleven of the fifteen vertically-cropped card
frames — a gold border, a wide subject and a painted backdrop each put energy at
the edges. Measuring all fifteen instead: aiming at the subject's top is right
on fourteen. The one it costs is knights-of-edengale-3, an interior where the
top of the picture is ceiling, and that is a one-line `pos` override. A gate
that silently declines to fix three-quarters of a reported problem is worse than
a rule with one written-down exception.

**Reverse it if** the gallery grows a lot of work whose subject is at the BOTTOM
of the frame — a skyline, a cutaway, a floor plan. The y clamp keeps that merely
unhelpful rather than broken today (it can only raise a crop, never lower one),
but at that point the rule is guessing more often than it is right.

---

## 2026-09-02 — the gallery arrows move outside the picture, and wrap

**Decided.** `.work-frame` is a three-column flex row — arrow, picture, arrow —
with `.work-hero-area` as the new container-query element the 3:2 hero measures
itself against. `showWorkItem` takes its index modulo the item count, so both
ends wrap, and neither button is ever `disabled`.

**Replaced.** Both arrows absolutely positioned inside `#workHero` at
`left:14px` / `right:14px`, over the artwork, each disabled at its end of the
list.

**Why.** The hero is a FIXED box that letterboxes every shape into itself, so
the edge of the picture moves on every press while an arrow pinned to the box
does not — the arrow kept landing on a different part of a different image and
became hard to track (Dex, 2026-09-02). Giving them their own columns reserves
the space at every width instead of only at the wide ones where the matte
happened to leave a gutter, and it puts them at a stable position that no image
can move.

The wrap is the same problem from the other side: with the arrows outside the
picture there is nothing left to explain why one of them stopped working, and a
93-piece category with a dead end asks the visitor to go find the other arrow.
The counter still reads `01 / 93`, so position stays legible without the ends
having to be walls.

**Reverse it if** a category ever gets small enough that wrapping is
disorienting rather than convenient — three or four pieces, where returning to
the start is indistinguishable from not having moved.
---

## 2026-09-01 — the work gallery is a manifest, not markup, and its masters are WebP

**Decided.** `assets/work/<category>/*.webp` holds 350 web masters capped at
1600px; `tools/bake_work.py` reads them plus the hand-written
`assets/work/work-index.json` and writes `assets/work/work.json`, which
`script.js` renders. Only the eight featured cards' first frames are
`<!-- img -->` directives in `index.html`. The manifest carries FINISHED srcset
strings, generated by the same `derivative()`/`stamp()` that writes every
`<picture>` block on the page.

**Replaced.** Two candidates. (a) 350 `<!-- img -->` directives — a 30,000-line
`index.html`, and forty image fetches on first paint for the eight cards alone.
(b) `script.js` composing derivative URLs from a small {stem, stamp} table,
which is the shortest code and is exactly what CLAUDE.md forbids.

**Why.** The rule against building derivative URLs in JS exists because a
hand-built URL is a second cache entry for identical bytes and a hand-picked
width goes stale against `sizes` — both of which have already cost this repo a
double-fetched LCP image and an always-missing mascot rung. Neither failure is
possible when the browser is handed a string it did not assemble. The manifest
keeps the rule's reason intact while serving a gallery the markup cannot name,
and it is the shape the mockup block always said it would become.

The masters are WebP because 213 of the 350 carry real alpha, which rules out
JPEG, and PNG at 1600px measures 349 MB against WebP q92's 57 MB. `.webp` is
now a master extension in `bake_images.py` — two files in the drop had arrived
as `.webp` already and were being walked past in silence.

**Reverse it if** the gallery ever shrinks to something a person would happily
maintain by hand — call it under thirty pieces. Below that the manifest is
machinery for nothing and the directives are simply clearer.

---

## 2026-09-01 — the featured cards rotate, and frame 0 stays in the markup

**Decided.** Eight featured cards, each cross-fading five pieces from its own
category on one round-robin interval (`TURN_MS / n`, so a card holds a frame for
6 s and something is always moving). Frame 0 is an `<!-- img -->` directive;
frames 1-4 are built from `work.json` when the grid first nears the viewport.
The card's thumbnail is a REFERENCE to frame 0, never a cropped copy.

**Replaced.** Four static cards pointing at generated SVG filler. Also
considered and rejected: a second row of static cards (eight thumbnails is
eight pieces of a 343-piece body of work), eight independent timers, and a
`assets/work/thumbs/` folder of pre-cropped 3:2 thumbnails.

**Why.** Pre-cropping is the interesting one. The card is a fixed
`clamp(200px,24vh,258px)` box with `object-fit:cover`, so it already crops live
at every breakpoint and DPR; a baked 3:2 thumbnail would be cover-cropped a
second time on top of its own crop. Cropping one frame of five would also make
the rotation jump, since the other four are uncropped. The escape hatch for a
badly-framed piece is one `pos` string in `work-index.json`
(`object-position`), which costs no file and no bake.

Independent timers drift into step and eventually flip the whole grid at once,
which reads as a glitch rather than as motion. One interval advancing the next
card cannot drift and cannot leak eight ways.

**Reverse it if** the cards stop being categories and become individual pieces.
A carousel says "there is more behind this"; on a single piece it would just be
a slideshow of one thing's process shots, which is what the overlay is for.
---

## 2026-08-25 — a social link with no handle reads "No tag" instead of collapsing the row

**Decided.** `show()` in `initSocialLinks` always opens the handle row. A link
with no `data-tag` puts the placeholder "No tag" in it, italic and dimmed, with
the copy glyph hidden, `aria-disabled="true"` and an empty `btn.dataset.tag` —
which is the same emptiness the click handler already checks, so there is no
second flag that could disagree with the label.

**Replaced.** `if (!tag) { clear(); return; }` — the row collapsed to zero
height, and the panel above it slid back down.

**Why.** The original reasoning was only half right. Leaving the PREVIOUS handle
up is genuinely wrong: it would name the wrong service. But collapsing is not
the other option, it is a third one, and it reads as something failing to load
rather than as an answer — plus the rail visibly reflows as the pointer crosses
that one icon. "No tag" is the honest answer to the question the row exists to
answer, and it is a real state to design for: a service with no @mention to
give. LinkedIn is exactly that, and it comes out of the row today but may come
back (Dex, 2026-08-25).

**Reverse it if** the row ever holds something other than a handle, where "No
tag" would stop describing what is missing.

## 2026-08-25 (later) — the origin chain shows SOURCES at native aspect, and the clip is opt-in

**Decided.** Two changes to the block described in the entry below, both from
looking at it on the page. (1) The clip is no longer automatically the last
link: `data-origin-clip` on the figure opts in, and only Amphibious and Clayweld
take it. (2) The row is justified instead of gridded — each step's `flex-grow`
is its image's aspect ratio, so every image is the same height at its own shape.
`data-bare` on a step drops the frame for a cutout on transparency.

**Replaced.** The clip appended to every chain unconditionally, and each step
drawn into a fixed 4:3 box with `object-fit: contain`.

**Why.** The clip is already on screen two inches to the right; repeating it in
the chain took a third of the width and said nothing the player was not already
saying. Two links instead of three also makes the sources substantially bigger,
which is the whole point of the block. And the fixed box was worse than useless:
these sources come from five places at five shapes — a 16:9 key art, a portrait
sculpt, a 16:10 wallpaper, a logo on transparency — so `contain` padded the
sculpt with black down both sides and the stills with black above and below. A
justified row gives every image the same height with no crop and no padding,
which is the only arrangement that is both tidy and honest about the art.

**Reverse it if** a chain ever needs four or more links, where a single row at a
common height gets too short to read and the block wants to wrap or scroll.

## 2026-08-25 (later) — a thumbnail click carries the play state, like every other transport control

**Decided.** `#clThumbs` buttons call `select(i, isPlaying())`, the same as the
chevrons and the skip buttons.

**Replaced.** An unconditional `select(i, true)`, and the reasoning written
beside it: that picking a clip out of the strip by name is a statement about
that clip, where a chevron is a statement about direction.

**Why.** That reasoning does not survive use. Someone who deliberately paused
the player and then browsed the strip got sound and motion they did not ask for,
once per thumbnail, and the only way to stop it was to pause again. The strip is
a transport control like the others, and the rule that reads correctly for all
of them is: paused stays paused, playing stays playing, whichever control moved.

**Reverse it if** the strip ever stops being part of the player — a contact
sheet that opens clips somewhere else would be a statement about a clip again.

## 2026-08-25 — a clip's origin is a CHAIN beside the player, not a caption under it

**Decided.** Each `.cl-item` figure carries `data-origin` (the copy) and, nested
inside it, a `<figure class="cl-step">` per source image. `paintOrigin()` renders
them left to right in the statement column with thick waved arrows between,
appends the clip's own poster as the final link, and puts the copy underneath.
Source images that already live in the repo are referenced where they are; only
ones with no other home go in `assets/ai/clips/origins/`.

**Replaced.** Writing the provenance as a paragraph under the player, and
keeping a second copy of each source image under `clips/`.

**Why.** Every clip in the tab was generated FROM something, and the interesting
part is the walk — a still, sometimes a revamped still, then the video. That is a
sequence, and a sequence read as a sentence loses the one thing it has going for
it. The statement column is empty on this tab (the same argument that put the
wallpaper thumbnails there), so the chain costs the player no width. Ending the
chain with the poster rather than a hand-picked frame means it cannot go stale
against the clip. And the `clip-origin` slot's widths are UNIONED with whatever
else claims a master, so pointing at `assets/thumbnails/surveyor-art.png` in
place adds no file at all — a copy would have added six.

**Reverse it if** a clip needs more than three or four links, at which point a
row across a ~480px column stops being legible and the block wants its own
layout rather than a wider chain.

## 2026-08-25 — Concepts is the wallpapers' component instantiated twice, in a 4:3 CONTAIN frame

**Decided.** `initWallpapers` became `initGallery({id, root, panel})`: element
ids are a prefix (`wp` / `cn`) and the arrows are looked up inside the instance's
own root and its own dialog. Concepts is a second call over its own figures and
its own lightbox. The only difference between the tabs is the frame — 4:3, with
the piece fitted inside it rather than cropped to it — and that is three CSS
rules.

**Replaced.** Copying the ~250-line carousel for the second tab; and giving
Concepts the wallpapers' 16:10 `cover` frame.

**Why.** Two carousels that look the same should BE the same, and the two things
that made a copy tempting are exactly the two that break silently: every
`getElementById` was a literal `wp*` id, and both arrow bindings were
`document.querySelectorAll('.wp-prev')`, which would have wired the concepts
arrows to the wallpapers' index as well as their own. On the frame: the
wallpapers are all 2560x1600 masters and fill 16:10 exactly, but a concept is
whatever shape it came out of the model. Cropping throws away part of the piece,
and a frame that tracks each piece's aspect makes the plate, the download and the
strip jump on every arrow press — the mistake the clips frame and the Work
overlay's hero are both already warned about. A fixed box that fits the piece
inside it is the only option that costs nothing and lies about nothing.

**Reverse it if** the real concepts turn out to be a single consistent aspect
ratio, in which case that frame plus `cover` shows more of each piece than a
letterboxed 4:3 does.

## 2026-08-23 — framed, Surveyor does not compile its engine until Begin is pressed

**Decided.** `games/surveyor/js/boot.js` checks `window.top !== window`. Framed by
`/surveyor`, it paints the card with a live Begin button, prefetches `vendor/babylon.js`
into the HTTP cache, and only loads and compiles the engine on the Begin click (or Enter /
Space); `main.js` then calls `begin()` itself off `__surveyorAutoBegin`, so the one press
still starts the session. Top-level the boot is eager, as it has been since the painted-frame
trick.

**Replaced.** Booting the moment the card painted, framed or not.

**Why.** A same-origin iframe shares the wrapper's main thread, and the wrapper's exit chip
is a link on that thread. Babylon's compile is ~1s on a fast machine and several on a slow
one (boot.js's own note), and it ran whether or not the visitor wanted to play — so a
visitor who took one look and reached for the X found it dead. Measured on the dev box:
676ms blocked, one 404ms task attributed to the frame, worst input acknowledgement 386ms;
Stickland, 0 long tasks. The trade is that a visitor who does want to play now waits the
compile AFTER the click, with the button reading Loading, rather than during the seconds
they spend reading the card. Dex's call: leaving immediately takes priority.

Top-level stays eager for two reasons. Nothing shares that thread, so there is no X to
protect; and every dev harness waits for `window.SURVEYOR` before it presses Begin, which a
click-gated boot would turn into a 40-second hang. Splitting on "framed" keeps the harnesses
honest without a flag they would have to remember to pass.

**Reverse it if** the games move to their own origin (a subdomain with
`Origin-Agent-Cluster`, say), at which point the frame gets its own process and the wrapper's
chip is live whatever the game is doing — the eager boot would then be strictly better.

---

## 2026-08-23 — the Surveyor exit chip is top-right, like the other three

**Decided.** `/surveyor`'s exit button sits at `top:14px; right:14px` — the same rule
block as the Stickland, Chomp and Arena wrappers, phones included.

**Replaced.** The mid-left edge (`top:50%; left:14px`, and below 760px a 38×56 tab flush
to the screen edge), chosen in 269c651 2026-08-17 because the top-right corner was Surveyor's own SOUND
button and the wrapper, not the game, was the side that should move.

**Why.** The reason expired. Surveyor's sound toggle no longer exists —
`games/surveyor/css/hud.css` says so at `#survey` ("The sound toggle used to own this
corner ... It does not exist any more") — and what has the corner now is the survey
overlay, HELD rather than toggled, invisible until a key is down. One place for the X is
the convention every returning visitor has already learned across four games; being the
one wrapper whose X is somewhere else costs more than a chip briefly over a held overlay.
The old comment's mobile survey (every corner occupied at 390×844) counted that same
sound button and the DEBUG-only warp column, so it no longer holds either.

**Reverse it if** a PERMANENT Surveyor control moves into the top-right corner — and even
then the first question is whether the game moves, since the game is the side that can be
told it lives in a frame.

---

## 2026-08-22 — the plan parser reads the table, not the file

**Decided.** `tools/context_pack.py` skips fenced code blocks when parsing
`docs/plan/README.md`, and prints what the parse found (`plan: 0 phase row(s) parsed, PHASE
none`) on every non-quiet run.

**Replaced.** A line-by-line regex over the whole file, with no notion of fences.

**Why.** `docs/plan/README.md` documents the table format with a worked example in a fenced
block. The parser matched the three example rows and generated `PHASE: 2/3 — Sync`, plus a
full tracker with Hosting struck through, for a repo whose phase table is deliberately
empty. Every session pasting the pack would have been told it was mid-way through a plan
that does not exist — an invented status, in the one section of `START-HERE.md` that exists
*because* hand-written status lies.

The bug is worth an entry rather than just a fix, because of its shape. It is the house
failure (`ARCHITECTURE.md`, "Writing a checker"): the parser found **a** subject, produced a
confident and plausible answer, and nobody had asserted it was **the** subject. Zero rows
and three rows both rendered without complaint. It was caught by reading the generated
`START-HERE.md` rather than by trusting that the generator had worked, which is the only way
this shape is ever caught — hence the printed count, so an empty table and a mis-parsed one
stop looking identical from outside.

**Reverse it if** the plan table ever moves out of a markdown file, at which point the fence
handling is dead weight and the count is not.

---

## 2026-08-22 — a stale context pack fails the build

**Decided.** `tools/check_pack.py` runs from `pre-commit`, before anything about what was
staged, and refuses the commit when `.context-pack.stamp` names a HEAD that is not the
current one. **Absent is allowed** — a fresh clone has not run the hook and simply has no
pack. **Present-and-wrong is not.** `post-commit` and `post-rewrite` keep the stamp true;
`verdict()` is a pure function of (stamp, HEAD, does the zip exist) that the hook and
`--cases` both call, over seven states of which three must refuse.

**Replaced.** Nothing — the alternative on the table was to build the pack and trust it,
with no check at all.

**Why.** A pack that is present but stale is worse than no pack. A session pastes it, reads
a build stamp naming a HEAD and a clean tree, and works confidently from fiction with
nothing anywhere to warn it — where an absent pack produces a session that knows it is
uninformed. The gate has to be a build failure rather than a warning for the same reason:
a warning on a commit is a warning nobody reads.

`--cases` is not optional decoration. This repo has shipped four checkers that reported
clean while examining nothing, and a freshness check that cannot fail is exactly that shape
— it would sit in the hook forever, printing nothing, proving nothing. Proven once by hand
as well: forging `deadbeef` into the stamp made a real `git commit` exit 1 with HEAD
unmoved.

**Reverse it if** the pack stops being how sessions are started. The gate is only worth its
weight while `docs/ONBOARDING.md` says "paste the zip and nothing else."

---

## 2026-08-22 — game source is held back from the context pack by default

**Decided.** `tools/context_pack.py` ships the site shell, all tools, all docs, every
`games/**/*.md` and all of `games/_shared/`, but **not** the four game source trees. They
are added with `--game <name>` or `--all`, and `START-HERE.md` names the exact flag beside a
per-game table of what was held back.

**Replaced.** The origin script's rule, which is "every tracked text file, no exceptions" —
correct for the project it was written in, which is a couple of hundred KB of text.

**Why.** `git ls-files` minus binaries here is **37 MB**: three separate 8.2 MB copies of
`vendor/babylon.js`, a 5 MB git bundle, and 4 MB of game source. Filtering the vendored and
generated text gets it to 6.2 MB; holding back game source gets it to **2.2 MB**, which is
the difference between an artifact a session can actually read and one it cannot. The
doctrine asks for *the smallest* artifact that makes a session current (rule 26), and a pack
nobody can ingest makes nobody current.

The safety property is untouched and must stay that way: selection is still `git ls-files`
and nothing else. These filters are about **noise, not secrecy**, and every one of them
reports its count and KB, because a pack with a silent hole is the same failure as a checker
that examines nothing.

**Reverse it if** the games leave this repo, or if context windows grow enough that 6 MB is
readable — at which point `--all` becomes the default and the flag inverts.

---

## 2026-08-22 — the context pack is Python, not Node

**Decided.** `tools/context_pack.py` and `tools/check_pack.py` are Python, installed and
fired by the existing hook chain.

**Replaced.** The porting brief's own suggestion — "a Node script is better than a
PowerShell one nobody else on this machine will run" — and the PowerShell original it was
ported from.

**Why.** Node was the right instinct and the wrong conclusion *for this repo*. The reasoning
behind it was "use what the repo already uses," and what this repo already uses for anything
hook-shaped is Python: `check_scope.py`, `check_sweep.py`, `check_accents.py`,
`check_cursors.py`, `bake_images.py`, `bake_markup.py`, and the `--install-hooks` installer
every one of them is wired through. A Node pack would have meant a second installer or a
Python hook shelling into Node.

The deciding factor was the archive itself. Python ships `zipfile`, which writes
forward-slash entry names by construction. Node has no zip writer in its standard library,
so the alternative was hand-rolling a ZIP central directory — and "a Windows writer emitted
backslashes, so a Linux unzip produced one flat directory of mangled names" is the exact
failure the porting brief warned about. Every web AI sandbox unzips on Linux. Choosing the
language whose standard library cannot make that mistake beats choosing the one where
avoiding it is a code review item forever.

`tools/check_markdown.mjs` and the `dev/` harnesses stay Node; nothing here changes what
node is for, which is anything that needs a browser.

**Reverse it if** the Python toolchain leaves the repo. The pack is ~250 lines and the
contract is in its docstring; a port is an afternoon, not a rewrite.
