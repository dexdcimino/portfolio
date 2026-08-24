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
