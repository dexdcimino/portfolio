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

## 2026-09-09 — the ` keypad reaches over an overlay, stacked

**Decided.** `` ` `` opens the code prompt from anywhere, including from on top
of another overlay, and it opens STACKED — the overlay underneath stays open
and Escape puts you back in it. The only thing that still stands the shortcut
down is a field with the caret in it.

**It replaced** the original guard, which was "ignored while anything is being
typed into AND while another dialog is up".

**Why.** The second half made "the same lock, reachable from anywhere" untrue
in the place it was most useful. From the music list you had to close the music
before you could ask for anything else, which is the opposite of what a global
shortcut is for — and Dex asked for exactly the missing case: tilde from inside
music, type a different code, go somewhere else.

Stacking rather than replacing is the part worth writing down. `openModal`
closes whatever is open before it shows, so the obvious change — drop the guard
and open normally — would mean pressing `` ` `` by reflex and losing the list
you were reading before you had typed a character. Stacked, cancelling costs
nothing. Anything the code then opens is still opened un-stacked, so it
replaces what was there, which is what going somewhere else means.

This widens `openModal`'s `stack` from one named caller to one SHAPE: something
opened from inside another overlay, where backing out has to put you back. The
Idea Vault was the first instance; this is the second, and the comment on
`openModal` now describes the shape rather than the caller.

**Reverse it if** two stacked overlays ever turn out to confuse the things that
ask "is an overlay up?" — `OVERLAY_OPEN` returns the first in document order,
which is fine while the only stacked thing is a keypad you are typing into, and
would not be if a stacked overlay could own the space bar or the arrow keys.

---

## 2026-09-09 — a live microphone keeps the notes in the DOM, and says so

**Decided.** Closing the notes overlay with a dictation session running does
NOT unmount the app or empty its container. It parks: the document stays in the
DOM, a red chip at the bottom-left of the page names the box being written
into, and the whole thing is torn down the instant dictation ends by any route.

**It replaced** the unconditional teardown — "the document goes with the
overlay; leaving it in the DOM would keep the notes one devtools panel away for
the rest of the visit, which is the thing the server-side check exists to
prevent" — and it replaced the alternative that keeps that rule intact:
buffering the recognizer's output in a variable and flushing it when the notes
are reopened.

**Why.** Dex asked to be able to leave the notes and keep talking, and the
buffering version is worse than it looks: nothing reaches the store until the
overlay is reopened, so a tab closed after five minutes of dictation loses five
minutes of dictation. Silent data loss to protect a document is protecting the
wrong thing.

What the teardown rule actually buys is that the notes are not recoverable from
the page after the overlay closes, **for the rest of the visit**. Parking
narrows that to **for exactly as long as a microphone is running** — a window
the reader opened on purpose, can see the whole time, and closes with one
press. The chip is not decoration, it is the other half of the trade: without a
visible indicator and a stop this would be a hot microphone with the notes
sitting behind it and nothing on screen admitting either.

The subscription is what makes it safe rather than the intent. `park()`
registers `dictate.onEnd()` before it does anything else, and every ending goes
through `stop()` — the chip, the ten-minute cap, a refused microphone, another
tab claiming the microphone, `unmount()` itself. There is no exit path that
leaves the document parked.

The AI Lab sandbox is excluded. It is the same app with nothing behind it, and
a recording chip over the portfolio for a demo someone clicked an eyeball on is
a chip nobody asked for.

**Reverse it if** the notes ever hold something where "recoverable from the
page while a recording runs" is too long a window — a second document class
with a stricter rule, say. Then dictation cannot outlive the overlay for that
class, and the honest answer is to refuse to park rather than to buffer.

---

## 2026-09-09 — the remote's corner is remembered, its fold is not

**Decided.** The music remote pill folds to its cover circle when the cover is
pressed, and moves between the top-right and bottom-right corners from a tab on
its far edge. The corner is saved (`music-remote-side` in localStorage); the
fold is cleared every time the pill is put away.

**It replaced** saving both, which is what the rest of this pill's neighbours
do — shuffle, repeat and volume are all remembered in exactly that storage —
and it replaced giving the fold a control of its own rather than hanging it on
the artwork.

**Why.** The two states are different kinds of thing. A corner is a
PLACEMENT: someone decided the pill was in the way at the top, and making them
decide it again on every visit is the same failure `ui.archSplit` exists to
avoid. A fold is a GESTURE — get this out of my way for a minute — and a
player that comes back as an anonymous circle days later is a player whose
controls have gone missing. Dex asked for exactly this split ("it would
obviously always start as expanded"), and it is worth writing down because the
consistent-looking choice is to save both.

The artwork carries the fold because it is the one part of the column that is
not a transport button: giving it a second meaning takes nothing away, while a
tenth control in a stack that is already 380px tall costs a row and a decision
every time someone reads it. The corner tab could not be folded into anything
the same way — it has to be visible while the pill is a circle, which is
exactly when the pill is most likely to be in the wrong place — so it is the
one control that was added.

**Reverse it if** the fold turns out to be how someone leaves it most of the
time. That is a real signal and it would mean the pill is too big expanded,
which is the thing to fix rather than the thing to remember.

---

## 2026-09-09 — Ctrl+Shift+R goes back to the browser, and is not rebound

**Decided.** The notes editor no longer binds `Ctrl+Shift+R`. Align-right is
the header button only; `Ctrl+Shift+L` and `Ctrl+Shift+E` keep left and centre.

**It replaced** the Google Docs alignment triad, taken whole — and it replaced
the obvious repair, which is moving align-right to a third chord that nothing
else uses.

**Why.** `Ctrl+Shift+R` is Chrome's hard reload. A page can `preventDefault`
it and this one did, so reaching for a force-refresh inside a text box
silently right-aligned a paragraph instead — and the way out of a wedged page
stopped existing in the one place someone sits typing for an hour. That is a
bad trade at any price, and the price here is one keystroke for the least used
of three alignments, with its button two inches away in the header.

Not rebound, because a replacement chord is worse than none: nobody asked for
one, nobody would remember it, and every free `Ctrl+Shift+<letter>` is free
only until a browser wants it. The general rule this instances is in
ARCHITECTURE.md under Editing — the browser's own escape hatches are not ours
to take, and a new chord gets checked against them before it is added.

**Reverse it if** align-right turns out to be reached for often enough to want
a key. Then it takes one that is not a browser shortcut, and the triad becomes
three keys that do not read as a set — which is the cost, and is smaller than
the one being paid here.

---

## 2026-09-08 — the music remote is one element that is MOVED, and owns no state

**Decided.** A vertical transport pill (`#musicRemote`) lives at the end of
`<body>` and is appended into whichever `dialog[data-music-remote]` is open,
whenever `<html>` carries `music-live`. Every button on it calls `.click()` on
the real control in the music bar, and every value it draws is read back off
that bar through a `MutationObserver`. It holds no copy of playing, shuffle,
repeat, volume, the track or the artwork.

**It replaced** two shapes that both look more obvious. A SECOND transport with
its own state, synced from the player — and a pill built and destroyed inside
each host overlay, per host.

**Why.** The problem is narrow and worth stating exactly: closing the music
list with a track playing re-shows the dialog non-modally as a bar in the
corner (`redock()`), and `show()` does not put a dialog in the top layer.
So the moment any overlay opens with `showModal()`, the bar is painted under
its backdrop — still playing, still holding the OS media session, and
completely unreachable. The notes app is the overlay someone sits in for an
hour, which is where that bites.

Being a DESCENDANT of the open modal is the only way to share its top layer,
which forces either one element that moves or one element per host. It moves,
because the reason the PLAYER can never move — an `<iframe>` reloads when it is
reparented, restarting the track — does not apply to a row of buttons, and two
copies would mean the invisible one is the one that goes stale.

Owning no state follows from the same rule the bus already lives by:
`MediaBus` presses Next with `btnNext.click()` rather than calling `step()`,
because the rules about what Previous means live in that handler. A remote that
kept `playing`, `shuffle`, `loop` and `volume` would be four values to keep in
step with a player that writes them from six places, and the copy is always the
half that drifts. Reading them back means there is nothing that can.

**Reverse it if** a host needs the remote somewhere that is not the top layer,
or two hosts need it at once — then it becomes a component with a render
function, and the state question comes back with it. Nothing foreseeable: only
one modal is ever open, which is enforced in `openModal`.

---

## 2026-09-08 — the accent drop-glow under a filled button is commented out, not deleted

**Decided.** `.button.primary`'s `box-shadow: 0 12px 32px …` is commented out
in place, with the declaration kept verbatim beside the rule. VIEW WORK,
GALLERY and VIEW RESUME are flat accent plates now.

**It replaced** deleting the line, which is what "we do not want this any more"
usually means.

**Why.** This is a look Dex asked to SEE, not a decision he has made — the ask
was "I wanna see what it looks like without that glow". A deleted line has to
be re-derived to come back, and the value in it is not obvious: 32px of blur at
22% of the accent was picked against the hero art. Kept as a comment, putting
it back is an uncomment. The hover ring on `.button` is a different thing and
stays: a crisp 2px outline says "this is the target"; a blurred halo under a
resting button does not.

**Reverse it if** the flat version is kept — then the comment goes, in the
commit that says so. Leaving a commented-out declaration in the sheet forever
is the failure mode this is one step away from.

---

## 2026-09-08 — a table is flat, rectangular, and 8 x 50

**Decided.** The notes editor gets a table block whose cells hold inline
content and nothing else: no blocks, no lists, no nested tables, no `colspan`
or `rowspan`, every row the same width, one `tbody`, and the first row is the
header. It is capped at 8 columns and 50 rows, and a table that arrives over
the cap is turned into one line per row rather than truncated.

**It replaced** the two things a table could have been. A full table model with
spans and per-cell blocks, which is what a word processor has. And nothing --
`clean()` already turned every pasted table into ` · ` lines, and Dex's bills
table had been living as a paragraph.

**Why.** Spans are where a table editor's hard bugs live. With them, "the cell
to the right" and "the column under this one" stop being the same question, so
Tab, insert-column, delete-column and the caret rules each have to answer both,
and a ragged table makes every one of those answers conditional. Flat and
rectangular means a cell is one line box of inline content -- a shape the
existing caret machinery in `editor.js` already handles, because it is the same
shape as a paragraph. That is what kept this to one new module rather than a
second editor.

The cap is measured, not chosen. **8 columns** is what the widest writing area
holds at a readable width: the body is 948px at 1440px and above, 8 columns of
that is 118px, and "Progressive" -- the widest word in the table this was built
for -- is 88px at the default 17px. A ninth column puts every cell under 105px
and ordinary words wrap. **50 rows** is editorial rather than technical, and
the measurement is what says so: an 8x50 table costs 1.4ms of the per-keystroke
body clone (`capture()` plus `serialize()`, both on every keystroke) against
0.05ms empty, 8x400 is still 7.2ms, and 8x50 is 0.2% of the 4 MB document
ceiling. So 50 is where a note stops being a note, with about eight times that
much headroom underneath it.

**Over the cap becomes lines, not a truncated table.** Truncating deletes
cells, and a pasted table is exactly the case where nobody would notice which
ones; lines lose the grid and keep every word, which is what `clean()` did with
every table before this.

**Reverse it if** a real table turns up that needs a merged cell -- a header
spanning two columns is the usual one -- and living without it is worse than
the conditional logic. That is a schema change plus a rewrite of every
add/remove/Tab path, so it is worth doing once, deliberately, and not worth
half-doing. Raise the row cap instead of reversing anything if 50 becomes the
constraint: the measurement above says the headroom is there, and it is one
constant in `notes/schema.js`.

---

## 2026-09-08 — a session is imported from inside the app, not from a terminal

**Decided.** The sessions sheet has Download and Upload either side of New.
Upload takes a markdown file or pasted text, shows what it found, and on one
press appends the sessions to the document. Download writes the session you
are in back out as markdown. `notes/transfer.js` owns both.

**It replaced** `tools/notes_import.mjs` being the only way in. That tool is
correct and it stays -- for a scripted restore it is still the right thing --
but as the ONLY route it made a fifteen-minute content job into: install a
CLI, log into it, pull a live read-write credential into a file, export it
into a shell, start a dev server, run a dry run, read the output, run it
again with a flag. Every one of those is a place to stop, and the person who
wanted the notes is not an engineer.

**Why.** The terminal tool needs a token because it writes to the store from
outside the app; it needs a dev server because `clean()` needs a DOM and it
has none. Both problems are artefacts of running outside the app, and both
vanish inside it. An import there is an ordinary edit on the same
authenticated save every keystroke uses, and `clean()` is already loaded --
so `clean(renderMarkdown(md))` is not merely verified, it is what gets
stored. The safety argument runs the same way: the tool needed a rev check,
a duplicate-title refusal and a dry run because it could clobber a document
it could not see. In the app there is no document it cannot see.

Markdown rather than the JSON the seeds used, because the point is that
anything can produce it. "Turn these notes into # session / ## category
markdown" is a sentence you can say to any assistant, and the answer is a
file that imports.

**Reverse it if** a session ever needs to carry something markdown cannot
express and a reference is not good enough -- images are the standing example.
The answer then is a second format beside this one, not the loss of this one:
a person with a file should never need a terminal.

---

## 2026-09-08 — known sites get bundled brand marks; unknown ones keep the hash

**Decided.** `BRANDS` in `notes/nodes.js` is a table of about fifty sites.
The dozen whose marks can be drawn honestly at eighteen pixels carry a real
glyph built into the bundle; the rest carry the brand's own two colours behind
the site's initial. Everything not in the table keeps the hashed mark. Nothing
is fetched.

**It replaced** the entry below this one, which said a link's mark is derived
from the hostname and nothing else. That is still the fallback and still the
default; what changed is that "no remote favicon" was being read as "no brand
mark at all", and those are not the same claim.

**Why.** The privacy argument was never against showing Google's G -- it was
against ASKING Google for it. A glyph compiled into the bundle costs no
request, leaks no link graph, works under `img-src 'self' data:` untouched,
and renders identically offline. The reason the first pass stopped short was
that it treated the CSP as the constraint, when the CSP only forbids the
fetch.

The table has two kinds of row on purpose. A logo reconstructed from memory at
this size reads as a wrong mark rather than as a generic one, which is worse
than the hash it replaced -- so a site gets a true glyph or it gets its
colours, and there is no half-drawn middle. Each brand's colours are a CSS
class, not an inline style, for the same reason the twelve hue buckets are:
`scrub()` strips every style attribute in a body after each keystroke.

**Reverse it if** the table starts needing maintenance faster than it earns
its keep -- a brand refresh nobody notices for months is a worse mark than an
honest initial. The fallback already handles every site, so rows can be
deleted one at a time without anything else changing.

---

## 2026-09-08 — a field that paints its own focus turns the blanket ring off

**Decided.** `.nt-app :focus-visible` still draws a 2px accent outline at 2px
offset for everything, but `.nt-input` opts out of it and keeps only the ring
it draws itself (a 1px border plus a 1px shadow in the same colour).

**It replaced** both rings being drawn at once, which is what shipped: a
field's own 2px edge, a 2px gap showing the panel behind it, and then the
blanket outline 2px further out. Read as a single too-thick stroke with a dark
line down the middle of it.

**Why.** The blanket rule exists so a control nobody styled is still reachable
by keyboard, which is worth keeping. A control that DOES style its focus does
not need a second opinion drawn around it, and two concentric rings separated
by background is not a stronger signal than one -- it is a rendering artefact
that looks like a bug, because it is one. The header's search field already
opted out (`.nt-search-input:focus-visible { outline: none }`) and was the one
field nobody complained about, which is the measurement.

**Reverse it if** a field is ever added that sets `outline: none` and then
forgets to draw anything of its own. The rule to keep is "one ring, and every
field has one", not "no outlines on inputs" -- a field with neither is a
keyboard trap and is worse than the doubled ring this replaced.

---

## 2026-09-08 — old note pages are imported by a tool, not pasted or retyped

**Decided.** The three standalone HTML note pages become sessions through
`tools/notes_import.mjs`: the content is authored as a JSON seed, every
category body is verified against the real `clean()` in a browser, and the
tool appends the sessions to the live document with the rev it read. The seed
itself lives outside the repo and is not committed.

**It replaced** two things. Pasting each page into the editor, which is what
the paste path is for -- and which flattens the whole page into one category,
because a category is a row in the sidebar and not a heading in a body, so
every boundary that made the page readable would have had to be rebuilt by
hand afterwards. And retyping, which is hours and gets the structure wrong in
different places than pasting does.

**Why.** The structure IS the content here. A page of thirteen h3 blocks of
name ideas is worth importing only if it arrives as one category with thirteen
headings; arriving as thirteen categories, or as one wall of text, is worse
than not importing it. A seed file makes that mapping explicit and reviewable
before anything is written, and re-runnable if it is wrong.

The body check is the half that earns the tool. `body` is schema HTML, and
`clean()` runs on every load: a body it rewrites looks different after the
first reload than it did going in, which reads as a broken import rather than
as a wrong body. `clean()` needs a DOM, so the check drives the shipped module
in a real browser and asserts byte identity through `clean()` and through a
`clean()` → `serialize()` round trip. All 17 bodies of sessions 2 and 4 passed
on the first run, which is only meaningful because the check would have said
so if they had not.

**Reverse it if** the editor ever grows a real importer -- a paste path that
understands `<section>`/`<h2>` boundaries and offers to split them into
categories. Then this is a worse version of a feature, and the tool should go
rather than be maintained alongside it. Nothing else makes it worth removing:
it is a few hundred lines that run three times and then sit there, and the
guards on it are the same ones `notes_rescue.mjs` needs anyway.

---

## 2026-09-08 — the backup schedule rides in the wrapper, not in a listing

**Decided.** `notes/current.json` carries a ledger —
`tiers: { backupAt, backups, dailyDate, dailies }` — written by every save and
read by the next one. It decides whether a ten-minute copy or a daily is due.
A save it says nothing is due for makes no `list()` call at all, which takes a
steady save from three metered blob operations to one.

**It replaced** listing both backup folders on every single save and deciding
from the names found there. That was itself a deliberate call, written into
the code as a comment: counting-then-deciding was chosen over a counter
because a counter "drifts the moment a save fails halfway, and drifts
silently: too many backups and too few both look like a working system until
someone needs a restore."

**Why.** The reasoning behind that comment was right and is not being thrown
away — the cost accounting was simply never done. Two lists per save is two
*advanced* blob operations on top of the write, the editor autosaved on a
1.2 s debounce, and Vercel's Hobby plan allows about 10,000 advanced
operations a month. That is roughly one hour of typing per month for one
person, and on 2026-09-08 it ran out and locked the live store.

So the ledger is a **gate, not the decision**. A save it says something *is*
due for still lists the folder and still hands the real names to
`backupPlan()`, which decides exactly as before — the counting simply happens
on the one save in many that writes a copy, instead of on all of them. That is
what keeps the drift the original comment warned about from being possible:
every state the ledger can be wrong in resolves itself. No ledger, or a
garbage one, reads as "due" and rebuilds from a real listing, so the first save
after this change against the live store — where no wrapper has a ledger —
neither duplicates a copy nor skips one. A save that died after writing a
backup never advanced the ledger, so the next one lists, sees the copy, and
refuses. The reverse cannot happen, because the backup is written before
current and a failure there throws first. Worst case is one extra list and one
window's delay, and the next backup-writing save rewrites the ledger from
truth regardless.

The client half went with it: a 5 s debounce with a 15 s floor between
automatic saves, in place of 1.2 s with no floor. The floor is only on the
automatic path — Ctrl+S, the `pagehide` beacon and the post-conflict retry are
untouched — so what it costs is at most fifteen seconds of typing, and only if
the tab dies without telling anyone.

**Reverse it if** the store stops being metered per operation — a paid plan
where a list is free would make the ledger a complication with nothing to buy,
and deleting it would restore the simpler shape the comment argued for. Or if
the ledger is ever found to have drifted in a way the "due" path did not heal,
which would mean the self-healing argument above is wrong rather than merely
inconvenient; that is a correctness failure and the listing goes back on the
hot path the same day.

---

## 2026-09-08 — a link's mark is derived, not fetched

**Decided.** The circle at the head of a link chip is the site's initial on
one of twelve colours hashed from its hostname, computed in the browser from
the URL that is already in the note.

**It replaced** the plan to show the real favicon, the way the app this
borrows from does -- `google.com/s2/favicons?domain=…`.

**Why.** Two reasons, and the second is the one that decides it. The app
ships under `img-src 'self' data:`, so a remote favicon is blocked outright
and the header would have to be widened. And widening it would mean that
every render of a private, password-gated page tells Google which domains are
in it -- one request per distinct site, on every open. A notes app whose whole
premise is that the content is nobody else's business should not leak its
link graph to fetch decorations.

**Reverse it if** the marks stop being distinguishable enough to be useful
and a same-origin favicon proxy is worth building: `/api/notes/favicon` could
fetch and cache them server-side, which keeps `img-src 'self'` and keeps the
request off the reader's machine. That is a server feature with a cache and
an eviction policy, not a CSS change, which is why it is not what shipped
first.

---

## 2026-09-07 — the note box is neutral; only the title strip is tinted

**Decided.** The field the words sit on is the theme's grey (`--bg2`, `--bg3`
while something in it has focus). The category's colour appears on the title
strip as a faint wash, on the strip under the pointer, and in the three text
tiers. `--c-fill` is gone.

**It replaced** a note box painted a faded version of the category's colour,
shipped earlier the same day.

**Why.** It was tried, looked at, and is worse: a wash of colour behind a
whole screen of text is a lot of colour to read on, and eight categories of
it made the app read as a set of coloured cards rather than a set of notes.
The strip alone says which category a box belongs to, and the text tiers
already carry the colour into the box without staining the ground under it.

**Reverse it if** the strip stops being enough to tell two categories apart
at a glance — on a long unbroken page of one colour the strips are far apart,
and if that reads as one undifferentiated column the fill was doing work the
strip cannot.

---

## 2026-09-07 — a colour is the whole category, and the title is the hex itself

**Decided.** `tints()` derives six values from one pick. The box is a faded
version of the colour, the title strip is one step more prominent than that,
and the three text tiers run title / bold / body with **saturation** carrying
the hierarchy: the title is the picked hex byte for byte, and each tier below
it is duller and one step further from the box.

**It replaced** a neutral grey box with three tiers that got LIGHTER on the
way up to the title -- so the title was the most washed-out of the three and
the reading text was the closest to the colour that had been chosen.

**Why.** The ranking was backwards for what a category colour is for: you
choose it to recognise a category by its name, and the name was the one place
the colour had been diluted. Putting the pick on the title and draining
saturation downward also fixes the readability problem the old direction
created — a paragraph in a fully saturated colour is tiring, and now the
lines being read end up nearly neutral while still unmistakably tinted.

**Reverse it if** the readability floors start moving the title often enough
to matter. They exist because a free-form HSB field can produce a colour that
is invisible on its own surfaces, and every time one fires the promise "the
title is what you picked" is broken for that pick. On the dark theme today it
almost never fires; if a palette change made it common, the honest answer
would be to constrain the picker rather than to keep quietly correcting it.

---

## 2026-09-07 — every click on a row is a selection

**Decided.** A plain click on a sidebar row picks that row (and jumps to it).
Ctrl adds, Shift takes the run from it. A pick of one is not drawn.

**It replaced** a plain click that CLEARED the pick, so building a selection
meant Ctrl+clicking the first row as well as the rest — and the row you had
just clicked normally counted for nothing.

**Why.** It is how every list of files behaves, and the alternative made the
common path worse for no gain: click a row to read it, decide you want its
neighbours too, and you had to go back and re-click the one you were already
on. Not drawing a pick of one is what makes it free: that row already shows
as the one being read, so nothing new appears on screen until there is
actually something to say.

**Reverse it if** a pick of one ever needs to be visible — if some action
gains a "does this apply to one or to many" ambiguity, the invisible state
becomes a state you cannot check before acting.

---

## 2026-09-07 — the category's title row moved inside its text box

**Decided.** A category is `.nt-cat-box`: one rounded box carrying the body's
fill and 3px of padding, with the title, the options, the colour and the
archive X on a strip inside it painted the canvas's own ground, and the text
under that. The chevron and the emoji are the only two things left outside,
in an aside to the left.

**It replaced** a title row sitting above the text box, in the canvas's own
space, with the body indented 42px so it lined up past the emoji.

**Why.** The old shape had two separate objects — a bar and a box — that had
to be read as one category, and the only thing tying them together was that
indent. As one framed box the strip reads as part of the thing it names. The
frame being the box's own padding rather than a border is the load-bearing
half: a border would have to be restated on every hover and focus rule the
fill has, and would go out of step the first time one was missed.

**Reverse it if** the 36px strip proves too small for what has to sit on it.
Everything on that row is an icon today; a control with a word in it would
crowd the title, and at that point the row wants to be outside again.

---

## 2026-09-07 — a row is picked with Ctrl and Shift, and every row control follows the pick

**Decided.** The sidebar list and the archive select like lists: Ctrl/Cmd
adds one, Shift takes the run. Everything a row can already do to itself —
archive, recolour, drag, restore, delete — does it to the whole pick instead
when the row is in one. No new toolbar, no checkboxes, no "select mode".

**It replaced** one row at a time, and nothing else: there was no way to
recolour four categories except to open the picker four times.

**Why.** The alternative shape — a selection toolbar that appears when
something is picked — is a second set of controls for actions that already
have controls, and it has to be somewhere, which on a 280px sidebar means on
top of the list you are selecting in. Routing through `targets(id, list)`
means there is exactly one archive path, one colour path and one move path,
and the multi case is a parameter rather than a branch.

**Reverse it if** renaming several at once is ever wanted. That is the one
operation this shape cannot express — there is no per-row control for it to
follow — and it would need the toolbar this decision rejected.

---

## 2026-09-07 — the keystrokes leave the tooltips and live in one panel

**Decided.** Tooltips in the notes app carry a short label or nothing, never a
keybind. Every keystroke lives in one information panel behind the ⓘ in the
header, grouped by where you would be standing when you wanted it. The
controls whose mark is universal — bold, italic, underline, the alignments,
undo, redo, the fold chevron, the emoji and colour buttons, the archive X, the
theme, the close, the search, the session badges — carry no tooltip at all.
Strikethrough, the auto list, the spell check and the nodes menu keep one.

**It replaced** a tooltip on very nearly every control, most of them with the
keystroke appended: `Bold (Ctrl+B)`, `Search (Ctrl+F)`, `Dictate
(Ctrl+Shift+M)`, `New category (Alt+N)` and twenty-odd more.

**Why.** A keybind that exists only inside a tooltip can be found only by
hovering the control you were already about to click — the one moment you do
not need to be told there is a shortcut. And a tip that names what everyone
already knows is not neutral: it trains you to ignore the ones that say
something, which is how `Auto list` and the spell mark ended up invisible
among thirty of them. Thirty tooltips is also thirty copies of the same fact
to keep in step with `editor.js`.

**Reverse it if** the panel stops being the first place anyone looks — if
people are found hunting the header by hover for a shortcut, the panel has
failed to be discoverable and the tips were carrying more than noise.

---

## 2026-09-07 — the session badge is two controls on one target

**Decided.** Resting on the session badge (in the outliner's corner, and on
the rail) opens the sessions popup; pressing it folds the outliner. The header
lost its sidebar toggle entirely; `Ctrl+\` and the chevron tab on the
sidebar's edge are the other two ways.

**It replaced** a badge that opened the popup on a click, plus a separate
sidebar-toggle button sitting inside the header's formatting group.

**Why.** The corner has room for one control and two jobs, and the two jobs
split cleanly by gesture: the sessions are what you want to SEE from there,
folding is what you want to DO. The toggle in the header was in the wrong
group — that group is the formatting controls for the text below it, and it
is centred absolutely on that text, so anything in it that is not about the
text is pressure on the one thing it exists to line up with.

**Reverse it if** hover proves to be the wrong channel on a touch screen. It
already is, strictly: there is no hover on a phone, and the popup is reachable
there only through the foot button's list. If the phone layout ever needs the
popup itself, the badge needs a second target rather than a second gesture.

---

## 2026-09-07 — shortcuts bind to the document, and Escape closes one thing at a time

**Decided.** The notes app's keyboard shortcuts listen on `document` while it
is mounted, and every handler that consumes Escape stops it propagating.

**Replaced.** Listening on the app's own root element, and letting Escape
bubble from wherever it landed.

**Why.** A keydown bubbles from the focused element, and focus is often NOT
inside the app -- the `<dialog>` itself, or `<body>` after a field blurred.
The app's root is not an ancestor of either, so Ctrl+F, Ctrl+S, Alt+N and the
rest silently stopped working after closing anything, and the Escape that
usually followed reached the dialog and shut the notes. Both halves read as
one flaky bug. The harness found it as "the whole app disappeared mid-run".

**Reverse it if.** The notes ever run somewhere that is not a modal dialog
owning the whole viewport, at which point a document-level listener would be
reaching outside its own surface and the root binding is right again.

---

## 2026-09-07 — the sidebar owns the window's left edge, and no menu waits to open

**Decided.** The sidebar runs the full height of the window with the session's
emoji, name and colour at the top of it; the header spans only the column
beside it and holds one centred group. Names are renamed in place in the
sidebar. The archive is welded to the list above it by a draggable edge and
folds under two arms. Any menu opens on the click and fills itself in
afterwards.

**Replaced.** A header across the whole window with a left group of its own,
renaming that sent you to the canvas, a fixed 40%-tall archive under a plain
chevron, and a spelling menu that awaited the dictionary worker before
building a single row.

**Why.** The sidebar is the thing being navigated, so it gets the edge; the
session is the outermost fact about the document, so it goes at the outermost
corner. Renaming somewhere other than where the name is read is a detour.
The archive's size is a preference that differs by how much is in it, so it
is dragged and saved. And nothing is worth waiting on before showing a menu:
the actions that need no async are always available immediately, which turns
a control that felt broken into one that feels instant even when the answer
is slow.

**Reverse it if.** The header ever needs a per-document control that cannot be
centred with the rest (a breadcrumb, a share state), at which point the left
group comes back and the sidebar toggle goes back into it.

---

## 2026-09-07 — a category's colour is its text, and the tiers are computed in JS

**Decided.** One hex per category becomes three colours -- body, bold, title --
derived in `tints()` and written onto the element as literal values by
`paintColor()`. The session's colour is the page's accent and the colour a new
category inherits; it is not the colour of any category's text. Every tier is
pushed until it clears a contrast target against the surface it sits on.

**Replaced.** `--c-text: var(--c)` declared once on the app root, with every
category's text reading `--tx` or that one inherited accent. A category
recoloured green kept a blue title, white body text and a grey badge letter.

**Why.** A var() chain is substituted where it is DECLARED, not where it is
used, so `--c-text` resolved against the session's colour on `.nt-app` and no
per-category `--c` could ever reach it. CSS has no way to derive a value per
element from an inherited one; `color-mix()` can lighten but cannot enforce
readability, and the picker is a free-form HSB field where a dark pick would
otherwise paint a category's own notes invisible. Computing the tiers in JS
buys the derivation, the contrast floor and the theme flip in one place.

**Reverse it if.** CSS gains relative colour syntax with a contrast function
(`color-contrast()` reached CR and was pulled once); at that point the three
tiers are three lines of CSS and `paintColor` sets only `--c`.

---

## 2026-09-07 — dictation writes at the caret, and the preview is the app itself

**Decided.** Two things, both in `notes/`. A microphone per text box
(`dictate.js`) whose insertion point is the live caret rather than a tracked
one, whose provisional words live in a span that no save and no history
capture can see, and which commits by diffing against what it has already
written. And the AI Lab's DexNote eyeball opens the real app with
`format: 'demo'` and no token, rather than an iframe or a screenshot.

**Replaced.** DexNote's speech-to-text, which kept a second cursor
(`_sttInsertionPoint`) in step with the real one through a locked target, a
roving mic, a serialize-and-restore across every re-render, and four
overlapping de-duplication trackers of which three were dead code by the end.
And, for the preview, the pattern every other AI Lab card uses: an iframe
pointed at a deployed URL, which for this app would have meant deploying a
second copy of it.

**Why.** The tracked cursor is the feature's whole bug surface: every one of
its numbered fixes was the tracker disagreeing with the caret after a click, a
type, a restart or a rebuild. The caret cannot disagree with itself, and the
browser maintains it for free through all four. The commit diff stays because
that scar is real and not ours -- desktop Chrome and Android genuinely
disagree about what a final result contains, and both shapes are asserted. For
the preview: the app is already on the page behind the notes overlay, so an
iframe would ship it twice, and a token-less mount is a stronger guarantee
than any check the demo could make about itself -- there is nothing to reach
the real notes WITH.

**Reverse it if.** Chrome ever exposes a real dictation surface (an
`EditContext`-style API that owns the insertion point itself), at which point
the commit diff and the provisional span both belong to the platform. The
sandbox reverses only if the notes app moves off this page.

---

## 2026-09-07 — the notes are an app of their own, mounted behind the same door

**Decided.** The notes overlay is `notes/`, a set of ES modules that script.js
imports only after `/api/notes/unlock` returns 200. Sessions, categories with a
body each, a sidebar and rail, emoji and colour per category, a transactional
undo stack, spell marks through the CSS Highlight API, autocorrect, link chips,
markdown nodes, images as private assets. The store is JSON with a rev; a
save on a stale rev is refused and merged category by category. Backups are
tiered (ten-minute and daily) instead of one per keystroke. The pre-rebuild
HTML document is migrated in the browser on first open and never rewritten.

**Replaced.** The single-document editor in script.js: one contenteditable
over the converted HTML, `execCommand` for every edit, the browser's own undo,
a rail built from the `<h2>`s, and a save that overwrote the whole document on
every keystroke -- and, further back, the DexNote app that this borrows its
layout and pickers from, which kept chips paired with zero-width spaces,
aligned text with inline styles, indented with `margin-left`, and undid by
re-rendering everything from an eighty-deep stack of the whole state.

**Why.** The overlay was asked to become the primary way of taking notes, and
its editing was the thing in the way: Tab/Shift+Tab on more than one line,
smart bullets, undo across structural edits, and anything per category
(colour, emoji, archive) were either absent or built on `execCommand`'s idea
of a list. Doing lists and blocks in code, with the browser left to type
characters, is what makes every one of those correct by construction; doing
undo as transactions with a serialized caret is what makes Ctrl+Z step back a
word rather than a re-render. The rev check exists because two devices with
the overlay open were already wiping each other's edits, silently. The app is
a separate directory and a dynamic import so script.js stays the door and a
visitor who never unlocks never downloads an editor.

**Reverse it if.** The CSS Highlight API is withdrawn from Chrome (marks would
need a wrapping fallback, which is the thing the design avoids), or the notes
outgrow one JSON document -- a session per blob is the next shape, and
`state.merge` already works per session so the client end would not change.

---

## 2026-09-07 — the media keys are caught in an extension, not in the page

**Decided.** `remote/`, a three-file Chrome extension: `global` commands on the three
media keys, a content script that relays them to the site as DOM events, and
`MediaBus.remote()` at the page end. `Ctrl+Alt+Arrow` stays a PowerToys remap onto
those media keys, because Chrome refuses `Ctrl+Alt+<key>` on Windows — that is AltGr.

**Replaced.** Two page-only routes, both built and both measured on the real machine
before this: `navigator.mediaSession` handlers, and then a near-silent track played in
the top document to hold the session against the embed.

**Why.** With the music overlay playing, the play/pause key worked from the desktop
and next and previous did nothing anywhere — not a broken handler, the wrong
document. The OS controls attach to whoever is really making sound, YouTube's iframe
answers play/pause, and a single video has no next or previous. Making our own sound
did not take the session off it. An extension does not compete for the session at
all: Chrome registers global commands with the OS itself, ahead of every page. The
cost is honest and is written on the tin — one unpacked install, and the media keys
stop reaching Spotify while it is on.

**Reverse it if.** Chrome's media session ever routes to the top frame (then the
extension is dead weight and deletes cleanly — the page end stays, since
`MediaBus.remote()` is what a media-session handler calls too), or the remote needs to
reach a phone, at which point the endpoint version is the only shape that works.

---

## 2026-09-07 — the page holds the OS media session with a silent track

**Decided.** While the music overlay is playing, the page loops a near-silent
10-second WAV of its own, built at runtime into a Blob URL, so Chrome builds the OS
media session around an element in THIS document rather than around the YouTube
iframe. The media-key handlers then reach our player. Only the iframe player uses
it; the songs bar is an `<audio>` here and owns the session already.

**Replaced.** Registering handlers and assuming they would be asked.

**Why.** Measured on the real machine, which is the only place this can be measured:
with the overlay playing, the play/pause key worked from the desktop and next and
previous did nothing anywhere. That is not a broken handler, it is the wrong
document — the session belongs to whoever is really making sound, YouTube's embed
answers play/pause, and a single video has no next or previous, so those keys landed
on a session with nothing to do. There is no API that reassigns a session and none
that even reports who owns it; making a sound is the only lever a page has. The
alternative was the resident-script-and-endpoint version, which is more code, more
moving parts, and a thing to keep running.

**Reverse it if.** Chrome starts refusing to build a session around it (the checks
would go on passing — they can only prove the audio decodes and plays, not that the
OS listened), or the media keys turn out to work without it. The tell is the same
one that found it: press the key and see. If it fails, the endpoint version is still
there, and this deletes cleanly — one method on the bus and two call sites.

---

## 2026-09-07 — the arrows skip tracks, and the OS media keys are the remote

**Decided.** Left and right are Previous and Next while the site is open, decided by
`MediaBus.transport()` — focus test included, so the whole rule is one function that
can be asked rather than half a rule in a listener. Opening the music list now
focuses the dialog rather than the rail button. And `navigator.mediaSession` gets
handlers and per-track metadata, which is what puts the page on the keyboard's media
keys and in Windows' media flyout while the tab is in the background.

**Replaced.** Nothing for the arrows — they scrolled. For the remote: the alternatives
were a Chrome extension (`chrome.commands` shortcuts only fire while Chrome is the
focused app, so it cannot cover "on my desktop") and a resident script posting to an
`api/` endpoint the page subscribes to.

**Why.** Dex wanted next/previous from another tab or from the desktop. The media
session is the only route that needs nothing installed in the browser and keeps
working when Chrome is not focused, because Windows routes media keys to whatever
owns the media session. The user-chosen `Ctrl+Alt+Arrow` is then a two-minute remap
in PowerToys or AutoHotkey, outside the browser, where a global hotkey actually
lives: a web page cannot register one, and pretending otherwise is how this would
have turned into an extension nobody maintains. The endpoint version stays the
fallback because it is unambiguous — media keys go to whichever app played last, so
an open Spotify can take them.

**Reverse it if.** The media keys turn out to reach YouTube's embed rather than this
page — which is measurable only by pressing one, and only for the music overlay; the
Top Picks songs are an `<audio>` in this document and are not in doubt. If they do,
the answer is not to fight the session but to fall back to the resident-script
endpoint, which was always the precise option.

---

## 2026-09-07 — the Top Picks bar and the docked music bar are one design

**Decided.** `.player` takes the docked music bar's measurements — 46px play disc,
22px transport icons, 24px play glyph, 34px mute and close, 13.5px title, the bar's
padding and gaps, and a 59px artwork box that makes both bars the same 105px height.
Its Previous becomes the music bar's Previous: a history of what was actually
played, a five-second restart, and no shuffling backwards. Shuffle and repeat are
remembered (`dex-song-shuffle`, `dex-song-loop`) with their existing defaults kept.
`music_check.mjs` 8e puts both bars on screen at once and compares the boxes.

**Replaced.** Two players built to the same sketch and then maintained separately:
44px against 46, 20px icons against 22, a 100px bar against 105, a Previous handed
straight to the shuffle picker, and two modes that forgot themselves on reload.

**Why.** Asked for by Dex, who found the drift by using both: "they should be the
same just accessing different song / music listings". The docked bar's own comment
already said every measurement matched `.player` "because it is standing in the same
place doing the same job" — which was true when it was written and had stopped being
true, in the way a number copied between two files always stops being true. The
songs bar is the one that moved, because the docked bar's numbers are the newer and
more considered set. What is NOT copied is the artwork box's width: 16:9 for a video
thumbnail, square for album art, because cover-fitting a square cover into 16:9
takes the top and bottom off every one. And what is not copied is the defaults —
shuffle on and repeat all are right for 311 tracks you cannot see and wrong for five
cards on the page.

**Reverse it if.** The two players stop doing the same job — if one grows a queue
view, a cast button or anything else the other has no use for, a shared measurement
becomes a constraint rather than a convenience. Until then 8e is what keeps them
honest, and it fails on the drift rather than on the intent.

---

## 2026-09-07 — the code starts the music, and a click that beats the embed navigates again

**Decided.** `open()` auto-starts a track through the same `startFresh()` the play
button used to call, so typing MUSIC into the keypad opens a list with something
already playing. Nothing auto-starts over something already going: coming back from
the docked bar leaves `index` set and lands on `idle()`. And because the reader's
first click now lands a fraction of a second after a fresh navigation, `load()`
re-points `src` rather than posting `loadVideoById` whenever the embed has not
spoken yet — with `ready` set by the first message the embed sends BACK, not by the
iframe's own `load` event.

**Replaced.** An overlay that opened idle, with the bar waiting to be pressed; and a
`load()` that always commanded a player it assumed was listening.

**Why.** Getting a password right is already the request. Asked for by Dex, and the
step it removes was doing no work — nobody types MUSIC to look at a list of song
titles. The second half is not a separate idea, it is the bill for the first: a
command posted into a window that has not answered is silently dropped, so the click
did nothing and the auto-started song carried on. The iframe's `load` event looked
like the right moment to flush it and is not — measured against a real embed, the
frame fires load, we post `listening`, and a command sent in that same turn is still
lost. Re-navigating is not a new risk either: it is the path the first track of a
session always took, and it is made under the reader's own click, which is the
strongest case autoplay has.

**Reverse it if.** A browser starts refusing the auto-start often enough that
readers land on a bar that says a track is playing and is silent. The signal is
reports of "it opens paused", not a measurement anything here can make. The
re-navigation half falls only if the embed gains a way to queue a command before it
is listening.

---

## 2026-09-07 — past five seconds, Previous restarts the track

**Decided.** `back()` restarts the current track when `position >= RESTART_AFTER`
(5 seconds), in both shuffle modes, before it looks at the history at all.

**Replaced.** A Previous that always moved — first to the row above, then, from the
entry above it, to the previously played track.

**Why.** Asked for by Dex, and it is what every media player made does: you notice
you have missed the opening, you press back, you hear the opening. Five seconds
rather than three because it has to be reachable deliberately, and rather than ten
because two quick presses still have to reach the previous song. The threshold reads
`position`, kept beside the painted clock rather than off it, because `paintTime()`
is a cache that skips its work while a scrub handle is held and back has to know
where it is even then. Zero — the value before the embed has volunteered a time —
falls through to the history rather than restarting nothing.

**Reverse it if.** Nothing foreseeable; this is the most conventional behaviour a
transport control has. The NUMBER is worth revisiting if anyone finds five seconds
too short to reach or too long to walk past, and it is one constant.

---

## 2026-09-07 — Previous walks a play history, and never shuffles

**Decided.** The music player keeps `history`, a capped list of the video ids it has
actually played, and the Previous button pops that list in both modes. At the bottom
of it with shuffle on, the current track restarts; with shuffle off, the row above
stays the fallback. A track the embed refused is popped back off the history.

**Replaced.** `index - 1` in every mode — the list position, one row up.

**Why.** Reported by Dex: with shuffle on, pressing back to hear the last song again
served a third song. That is not a bug in the back button so much as a category
error in it — with shuffle on, `index` is a random pick and the row above it is
another arbitrary track, so Previous was a second shuffle wearing the back button's
clothes. Shuffle is a statement about what comes NEXT; there is no reading of it
under which the past is also random, and "the song I just heard" is the only thing
anyone presses that button for. Two smaller calls sit inside it. Ids and not indices,
because a search or a re-sort renumbers the queue under a live player and `render()`
already re-finds the playing track by id for exactly that reason; an id no longer in
the visible list is skipped rather than followed. And history wins over `index - 1`
even with shuffle OFF, where the two normally agree — they diverge only after the
listener clicks rows out of order, and there the history is the more honest answer to
"what did I just hear".

**Reverse it if.** A listener asks for Previous to walk the LIST while shuffle is off
after clicking around by hand — the one case where the two rules disagree. Nothing
else foreseeable: the rest follows from Previous meaning the past, and falls only if
that does.

---

## 2026-09-05 — a dead track is flagged in the browser that hit it, not in the tracklist

**Decided.** When the embed refuses a video, the overlay marks it with a red flag in
a fifth column and remembers that in `music-flags` in localStorage. The mark is
per browser, clearable by clicking it, and `tracklist.txt` learns nothing.

**Replaced.** A fifth field on the tracklist line — an `X` beside the existing `R`
— baked into the manifest, so a known-dead track would arrive already marked for
everyone and the flag would be one fact in one place.

**Why.** The flag is a record of what THIS browser was told, and that is not a
property of the link. A video blocked in Germany plays in Colorado; one that is
age-gated fails for a signed-out visitor and plays for a signed-in one. Baking one
visitor's refusal into the master would take the track away from everybody who
could have played it, and the failure mode is silent — the song simply stops being
offered. The right permanent fix for a genuinely dead link is a NEW LINK, which is
a tracklist edit anyone can make and `tools/music_probe.mjs` can find; the flag is
for the window between the rot and the fix, and for telling the owner which line
to edit.

**Reverse it if** the same video id starts coming back flagged for many different
visitors and there is somewhere to collect that. A per-browser mark cannot see a
pattern; a server that counted refusals could, and then baking a warning into the
manifest would be worth the false positives.

---

## 2026-09-05 — a stall clock, not a re-navigation, catches the second dead track

**Decided.** After a refusal, the overlay watches the track it skips to for 12
seconds; a track that has not reported a PLAYING state by then is treated as
refused too. The clock is armed only between a refusal and the next thing that
actually plays.

**Replaced.** Clearing `armed` in `refused()` so the next track re-navigates the
iframe — which gets a fresh player and therefore a fresh, real `onError`, and needs
no clock and no guesswork.

**Why.** Measured: only the FIRST dead track posts an error. Everything after it
arrives by `loadVideoById` on a player already sitting in an error state, and that
player never speaks again, so two dead tracks in a row stalled on the second one.
Re-navigating fixes that and breaks something worse — the navigation that permits
sound is the one made under the opening click, and a fresh iframe made without a
gesture comes back muted or refuses to start. The site would trade a rare stall
for a common silence. A clock costs nothing when nothing is wrong, and it is armed
narrowly enough that ordinary slow buffering is never flagged: outside a dead run
there is no clock at all.

**Reverse it if** the embed ever reports `onError` for a `loadVideoById` failure.
Then the event is available at the moment it matters and the clock is dead weight —
check by putting two impossible ids next to each other in
`tools/music_flag_check.mjs` and seeing whether the second one flags before the
12 seconds are up.

---

## 2026-09-05 — the availability probe serves its harness over https

**Decided.** `tools/music_probe.mjs` and `tools/music_flag_check.mjs` mint a
throwaway self-signed cert and serve over `https://localhost`, and launch Chrome
with `--disable-blink-features=AutomationControlled`.

**Replaced.** The plain `http://127.0.0.1` server every other harness in `tools/`
uses, which needs no cert, no openssl and no flag.

**Why.** Over http the probe reported EVERY track as blocked — the Rick Astley
video, Queen's own official upload and a garbage id all came back error 150, which
is one verdict for everything and therefore no verdict at all. Serve the identical
harness over https and the three real ones play while the garbage id still fails.
The automation flag is the same shape of problem measured separately: with it
absent, YouTube refuses rights-managed video to a browser that announces itself as
automated, again with 150. Neither is a preference; without both the tool is a
rubber stamp, and a green rubber stamp is worse than no tool.

**Reverse it if** YouTube starts serving rights-managed embeds to insecure origins
again. Check by pointing the probe at a plain-http server and running it against
one known-good and one impossible id: if they come back different, the cert can go.


## 2026-09-05 — the docked bar shows artwork, not a live picture

**Decided.** `.music-modal.is-docked .music-video{display:none}` with YouTube's
thumbnail in its place. The live player renders only while the overlay is open.

**Replaced.** Keeping the video visible in the docked bar at 104px — a position
taken deliberately in this file on 2026-09-04, on the grounds that playing an
embed with the picture hidden is against the terms it ships under.

**Why.** It was the scroll jank, and nothing else was. Compositing a live
cross-origin video surface over a scrolling page costs a frame; the hero's bob
is a composited `transform` animation, which a busy main thread cannot disturb,
and it stuttered too — which points at the compositor rather than at script.
Isolated on the real page with one devtools line: hide that single element, keep
the audio, and both go smooth. `will-change:transform` was tried first and did
nothing, because it addresses raster and this is composite.

The terms position that argued for the visible picture is not abandoned so much
as narrowed: the player is real, it is one click away on the expand tab, and it
is the docked CORNER that shows art. It is worth noting that the docked player
was 104px, already under the ~200x200 the embed guidance expects, so the earlier
position was not being met either.

**Reverse it if** the player stops being a cross-origin iframe, or a browser
gives a way to keep a video surface out of the scroll's way without hiding it.
The picture is preferred wherever it is free.

---

## 2026-09-05 — a second player closes the music feed rather than pausing it

**Decided.** `MediaBus`'s `pause` for the music player is `yieldToOther()`,
which stops it and puts the bar away, and its `el.paused` reports `!armed`
rather than `!playing`.

**Replaced.** `pause()`, which sends `pauseVideo` over postMessage and sets
`playing = false` immediately.

**Why.** Reported as "pausing a Top Picks song starts a music track". It was not
starting; it had never stopped. postMessage to another origin has no
acknowledgement, and the optimistic flag meant that when a message did not land
the bus believed the feed was already paused — and a feed the bus thinks is
paused is one it never pauses again. Two things then decoded audio at once,
which is also what the scroll jank was paying for. `stop()` removes the iframe's
src, which cannot fail. Closing rather than pausing is also what the two players
mean: they are separate things.

**Reverse it if** the player ever gains a reliable state channel — an
acknowledged command, or a same-origin element whose `paused` is a fact. Then
pausing is honest again and holding the playlist's place is worth something.

---

## 2026-09-05 — the docked bar gets its own compositor layer

**Decided.** `will-change:transform` on the docked dialog and on the iframe, and
the embed is asked for the smallest stream.

**Replaced.** Neither, on the grounds that the layout worked.

**Why.** Scrolling caught and the hero's bob stuttered, but ONLY while music
played — and the Top Picks player, which is an `<audio>` element, never did it.
That difference is the whole diagnosis: a live cross-origin video in a
`position:fixed` bar over a scrolling page has to be re-composited with
everything that moves behind it, over a region the shadow makes large. A layer
of its own takes it out of the scroll's way. Worth recording because the first
investigation measured layout, style and script — all cheap — and concluded the
page was healthy, which it is; the cost was in compositing, which those metrics
do not see.

**Reverse it if** the bar stops holding a video. `will-change` pins a layer's
worth of memory for as long as it applies, and it buys nothing for a bar that
is only text and buttons.

---

## 2026-09-05 — the music docks by re-showing the same dialog non-modally

**Decided.** Closing the music overlay with a track playing calls `close()` then
`show()` on the same `<dialog>`, which becomes a bar in the corner. An expand
tab puts the list back. Four shared checks now read
`dialog[open]:not(.is-docked)` instead of `dialog[open]`.

**Replaced.** Closing the overlay stopping playback outright.

**Why.** Two constraints ruled out everything else. The player is a cross-origin
`<iframe>`, and moving an iframe in the DOM reloads it — so a second bar
elsewhere on the page would restart the track every time the list opened or
closed, and no amount of state syncing fixes that. And a modal dialog makes the
page inert, which is precisely what has to stop for the music to play while the
site is read. `close()`+`show()` is the only combination that keeps the iframe in
place and gives the page back. Confirmed with a same-origin frame before it was
built on: the inner `window` keeps a stamped property across the swap and no
load event fires.

**Reverse it if** the player ever stops being an iframe — a self-hosted audio
source would make the bar an ordinary element that can live anywhere, and then a
single bar outside any dialog is simpler than a dialog with two personalities.

---

## 2026-09-05 — the songs bar takes the music bar's control order

**Decided.** `.player-transport` is shuffle, prev, PLAY, next, repeat, with the
two modes moved out of `.player-modes`. Volume and close stay on the right.

**Replaced.** prev/play/next centred, with shuffle and repeat grouped on the
right beside volume and close.

**Why.** The right-hand group carried five controls against the middle's three,
which is what made that end look crowded, and centring an asymmetric transport
leaves the play button itself off centre — the same fault found in the music bar
one commit earlier. Splitting the modes around the transport balances the row
and makes the two bars one control layout instead of two.

**Reverse it if** the bar ever narrows enough that five centred controls stop
fitting; the modes going back to their own group is the right collapse, and the
existing max-width:900px rules are where it would go.

---

## 2026-09-04 — the transport is symmetric about the play button

**Decided.** The five controls run shuffle, prev, PLAY, next, repeat, and
`music_check.mjs` asserts the play button's own centre against the bar as well
as the group's.

**Replaced.** prev, play, next, divider, shuffle, repeat — a group that was
centred while the button was not.

**Why.** Centring the GROUP and centring the PLAY BUTTON are different things
once the group is asymmetric, and the check only asserted the first. The button
sat 65px left of the bar's centre for two rounds with everything green. It
became visible the moment the seek row had to be centred above it, which is the
useful lesson: the weaker assertion held for exactly as long as nothing else
depended on the stronger one.

**Reverse it if** the modes ever leave the transport for their own group, the
way the songs bar up the page has them. Then prev/play/next is symmetric on its
own and the ordering question goes away.

---

## 2026-09-04 — relocking the vault must not take focus

**Decided.** `createKeypad`'s `reset()` takes a `moveFocus` argument, and
`initVault`'s `relock()` passes `pins.includes(document.activeElement)` — clear
and relabel always, take focus only if focus is already in these boxes.

**Replaced.** `relock()` calling `reset()` unconditionally, which was correct
only for the case where the vault's own keypad opened the overlay.

**Why.** It parked focus in the Idea Vault's first box after ANY overlay closed.
The ` shortcut then refused to fire, correctly — it must not eat a character
someone is typing — so the next ` went in as a character instead, and typing
into a focused input below the fold scrolls it into view. That is the second
half of the "tilde jumps me to the Idea Vault" report, and the entry above did
not fix it: `preventScroll` cannot help when the scroll comes from the keystroke
rather than from the focus. It only ever showed on the SECOND press, which is
why the first fix looked complete.

**Reverse it if** nothing. Taking focus the reader did not ask for is the bug in
every version of this; the argument makes the one legitimate case explicit.

---

## 2026-09-04 — play from idle does not resume, it varies

**Decided.** Pressing play with nothing going picks a random track that is not
the one `music-last` names, or the top of the list when shuffle is off.

**Replaced.** Resuming the last played track, decided one round earlier in this
same file.

**Why.** Reported as "it keeps playing the same song". Resuming reads as a
bookmark in a list you work through in order, and this is not one: it is 311
songs with shuffle on by default, where pressing play and getting the same track
every session reads as a button that does not work. `music-last` is still
written on every load, but it is now used to EXCLUDE rather than to resume,
which is what makes "a different one each time" deterministic rather than
merely likely.

**Reverse it if** the overlay ever grows a real position memory — resuming a
track part-way through, rather than restarting it. Resuming from the beginning
was never the useful half of that idea.

---

## 2026-09-04 — the bar's X closes the overlay

**Decided.** `#musicStop` closes the music overlay.

**Replaced.** Stopping playback and hiding the player bar.

**Why.** The bar is permanent now, so half of that button's job no longer
exists, and the other half — stopping — is something closing already does. It
was a control that appeared to do nothing. A second way out of a full-screen
overlay is worth more than a stop button next to a pause button.

**Reverse it if** the bar ever leaves the overlay and plays on across the page.
Then stopping is a real thing to want and closing is not what the X means.

---

## 2026-09-04 — a code clears the instant it is accepted

**Decided.** `createKeypad`'s `attempt()` calls `clearBoxes()` on the success
branch, beside the two refusal branches that already did.

**Replaced.** Leaving it to `bindModal`'s `onClose` teardown, which calls
`keypad.reset()`.

**Why.** That teardown never ran for the case that matters. `bindModal`'s close
handler returns early when another overlay is already open, because that is a
HAND-OFF and pulling focus or resetting state out from under the replacement is
wrong — and a code opening a door is exactly that hand-off. So an accepted code
stayed in the boxes for the rest of the visit, in both the tilde keypad and the
Idea Vault's, readable by anyone who walked past afterwards. Clearing at the
moment of acceptance also puts all three outcomes in one place instead of two.

**Reverse it if** a keypad ever needs to show the code that worked — a
confirmation step, say. Nothing suggests one, and the boxes are five characters
with no label, which is the wrong place to confirm anything.

---

## 2026-09-04 — the door remembers who opened it

**Decided.** `reveal(payload, secret, from)` takes the element to hand focus back
to. The vault's own keypad passes its last box; the tilde keypad passes whatever
had focus when the shortcut fired. Every `focus()` inside `createKeypad` carries
`preventScroll`.

**Replaced.** Every door being handed `pins[pins.length - 1]`, the Idea Vault's
last box, whoever had opened it.

**Why.** Restoring focus to a vault box fires the pins' own `focus` listener,
which moves focus to the first empty box — and that call had no `preventScroll`,
so the browser scrolled the vault into view. Closing an overlay opened with the
tilde shortcut therefore dragged the reader from wherever they were down to a
section they had not asked for. Two independent things had to be wrong for it to
happen, which is why it read as a mystery scroll rather than a focus bug.

**Reverse it if** nothing: an overlay handing focus back to the control that
opened it is the rule everywhere else on this page, and this was the one place
that had it hard-coded to the wrong control.

---

## 2026-09-04 — the music bar is permanent and shuffle starts on

**Decided.** The player bar shows the whole time the music overlay is open, with
an idle state of its own; pressing play with nothing going starts the last
played track, or a random one. Shuffle defaults to on and is remembered.

**Replaced.** A bar that appeared on the first play and was hidden again by
Stop, and shuffle defaulting off.

**Why.** The bar appearing only after a successful click makes the transport
something you discover rather than something you use — there was no way to just
press play. And 311 tracks in alphabetical order is a filing cabinet: shuffle
off means the same song every time the overlay opens, which is not how anyone
listens to a list this long. Both are remembered rather than imposed, so turning
shuffle off sticks.

**Reverse it if** the list ever gets short enough to read top to bottom, where
alphabetical order is a feature and shuffle is noise.

---

## 2026-09-04 — the repeat defaults are a field in tracklist.txt

**Decided.** A track marked `|R` as an optional fourth field in `tracklist.txt`
starts in the repeat playlist. `bake_music.py` refuses any other value in that
position.

**Replaced.** `Repeat_Tracks_Only.md`, a separate list of 56 `Title — Artist`
lines, which is how the set arrived.

**Why.** Two lists of the same songs drift. The reference file already disagreed
with the tracklist on the artist field — it credits every artist where the
tracklist names the primary one — so matching had to be by title, and a title
edited in one file and not the other would go silently unmatched. The only
symptom would be a track that quietly stopped being a default, which is
invisible: nothing errors, the playlist is just one song shorter than someone
remembers. One master, one edit, and a mark that is refused if it is typo'd.

**Reverse it if** the defaults ever need to be more than a flag — several named
playlists rather than one. Then the fourth field is the wrong shape and the
right answer is a manifest beside the tracklist, keyed by video id rather than
by title, so it cannot drift the way the .md would have.

---

## 2026-09-04 — seeding the repeat playlist applies a delta, not a snapshot

**Decided.** The overlay stores the set of defaults it last saw
(`music-repeat-seed`). On open it adds tracks marked since then and removes ones
unmarked since, and leaves everything else the listener has done alone. A
browser with no stored ticks takes the current defaults whole.

**Replaced.** Seeding once, on the first visit, and never again.

**Why.** Seed-once is invisible in exactly the case that matters: a song marked
`|R` after someone's first visit can never reach them, and nothing anywhere says
so. Seeding every time is the opposite failure — it keeps restoring what they
deliberately unticked. The delta is the only version where both editing the
tracklist and unticking a row keep working.

**Reverse it if** the ticks ever move off `localStorage` onto a server. Then
there is one authoritative list per person rather than one per browser, and the
merge belongs there instead of being re-derived on every open.

---

## 2026-09-04 — the music embed is driven by hand, not by YouTube's API script

**Decided.** The music overlay talks to its YouTube embed with raw postMessage —
`{event:'listening'}` on load, `{event:'command',func,args}` out, `infoDelivery`
back — and `vercel.json` gains a `frame-src` for
`https://www.youtube-nocookie.com https://www.youtube.com` and nothing else.
`script-src` stays `'self'`.

**Replaced.** Loading `https://www.youtube.com/iframe_api` and using
`YT.Player`, which is the documented way and about fifteen lines shorter.

**Why.** The API script is a postMessage wrapper around the same embed. Taking
it would mean widening `script-src` — the one directive this page is strictest
about, and the one that makes the notes overlay's XSS allowlist a backstop
rather than the whole plan — to buy fifteen lines. The protocol is stable,
public, and already what the wrapper sends. There was also a real cost to NOT
touching the CSP at all: with no `frame-src`, an iframe falls back to
`default-src 'self'` and the embed is refused with nothing anywhere to say so,
which is the silent false-green this repo has four scars from.

**Reverse it if** YouTube changes the postMessage protocol under the embed, or
adds something the overlay needs that only the API exposes. The failure would be
loud — the transport buttons stop working and `music_check.mjs`'s embed-URL and
state checks are the place it shows up — so this does not need watching, only
answering when it happens.

---

## 2026-09-04 — the music code is a doorway, the notes code is a lock

**Decided.** The music overlay has no gate. Typing `MUSIC` opens straight into
the list.

**Replaced.** Giving it the same keypad-then-content shape as the notes overlay,
which is what it visually copies in every other respect.

**Why.** A lock has to be protecting something. The notes hold a private
document and the password is checked on the server precisely so that nothing
about it reaches the browser first. This holds public YouTube links; the only
thing a gate would protect is the fact that Dex likes these songs, and it would
do that badly, since the manifest is a static file anyone can request. Shipping
a password box in front of nothing teaches that the password boxes on this site
are decoration, which is the opposite of what the notes one needs to mean.

**Reverse it if** the overlay ever holds something that is actually private —
unreleased work, anything with a name in it. Then it needs the notes' shape:
server-checked, content fetched only after, not a gate over a file that is
already public.

---

## 2026-09-04 — the notes keypad is hidden while a code in hand is checked

**Decided.** `#notesGate` starts hidden and `#notesWait` ("UNLOCKING") stands in
its place whenever the overlay opens with a saved token or a passed code. The
keypad appears only once both silent tries have come back empty.

**Replaced.** The gate being on screen from the first frame, always.

**Why.** A saved token or a code handed over by the vault is how the notes are
almost always opened, so for the length of that round trip the overlay asked for
a password that had just been typed. It reads as the code having failed. Nothing
about the lock changed — the content still comes from `/api/notes/unlock` or not
at all, and a wrong code still lands on the keypad.

**Reverse it if** the round trip ever becomes slow enough that UNLOCKING is
itself the thing on screen for seconds. Then the answer is a real progress
state, not going back to showing a keypad nobody has to touch.

---

## 2026-09-03 — the vault case asserts the request, not the lock

**Decided.** `notes_check.mjs` case 6 asserts that the vault's hand-off goes to
`/api/notes/unlock`, that the notes are not in the page before that response,
and that the overlay's state MATCHES whatever the server answered — in both
directions. It reports which configuration it ran under.

**Replaced.** Asserting that the notes keypad is still showing after the vault
opens the overlay.

**Why.** That assertion was really asserting that a fetch had not landed yet.
The vault hands its code to the notes overlay to try as the notes password
(`reveal()` -> `notes:code`), and under this harness the two strings are the
same one — the dev server runs with `NOTES_PASSWORD=notes` and NOTES is also
the vault code — so the attempt succeeds and the keypad goes away. Measured at
two failures in three runs, which is what sent a session chasing a product bug
that was not there. The property worth protecting was never "the notes stay
locked": it is that nothing local decides, and that survives either answer.

**Reverse it if** the harness ever runs the dev server with a notes password
that is not the vault code. Then the strict form is meaningful again and should
come back — but as an assertion that reads the configuration rather than
assuming it, because assuming it is what broke this the first time.

---

## 2026-09-02 — a card's crop can be tightened, in the card only

**Decided.** `zoom` in `work-index.json` — a number, or `{scale, pos}` to
tighten around a point of its own — baked into `work.json` and applied as the
CSS `scale` property with `transform-origin` at the aim point. Two pieces use
it. It applies to the card and to nothing else.

**Replaced.** Aiming alone (`pos` / `focal_point.py`), which can only PAN a
cover-crop, and the alternative of cropping a second master on disk.

**Why.** Some pieces cannot be aimed into a good thumbnail: osseous-2 carries a
painted gold border that a cover-crop leaves as a strip down each side, and
bone-archer-1 is a three-view turnaround where the character is a fifth of the
width. Cropping on disk would answer both and is refused elsewhere in this repo
for good reasons — a second master to keep in sync, and a crop that is wrong at
the next breakpoint. `scale` rather than `transform: scale()` because the card's
hover rule already owns `transform` and the two are separate properties that
compose; written into `transform` the crop would spring back on mouseover. Card
only because the two boxes answer different questions: the card is a poster and
may show the best part of a picture, while a thumb in a strip of 93 has to look
like the piece it opens.

**Reverse it if** the ladder ever serves the card a rung whose pixels the zoom
outruns. This throws pixels away — 1.9x on a 900px rung is a 474px source in a
282px box, still comfortable, but a wider card or a shorter ladder changes that
arithmetic and the answer becomes a tighter master, not a bigger number.

---

## 2026-09-02 — the leaving frame stays opaque instead of fading out

**Decided.** A card or video frame going off screen keeps `opacity: 1` one
layer down (`.is-leaving`) while the incoming one fades in over it, and is
dropped a full cross-fade later, by which time it is completely covered.

**Replaced.** A symmetrical cross-fade — the old frame 1->0 while the new one
0->1 — which is what everyone writes first and what was there.

**Why.** Stacked layers composite as `1-(1-a)(1-b)`, not as a sum. Two matched
ease curves therefore cover only 0.75 of the panel at their midpoint, and that
quarter of dark panel flashing through is the flicker in the middle of every
fade. No duration fixes it: a slower fade only makes the dip last longer. The
sum, which is the number you reach for, is exactly 1.0 for the broken case and
says everything is fine — `work_check.mjs` measures the compositing formula and
carries a control that withholds `is-leaving` and asserts the cover DOES dip,
because a number that never moves proves nothing.

**Reverse it if** the frames stop being opaque rectangles that fully overlap.
The trick is paid for by the outgoing frame being hidden behind the incoming
one; a transparent PNG, a smaller frame, or a transform on either would show
the stale image instead of the panel, which is worse.

---

## 2026-09-02 — the featured sweep is three columns, not five items

**Decided.** The stage turns in three steps 300 ms apart — the video, then the
left pair of thumbnails together, then the right pair — about 600 ms end to end
under `.85s` fades that are still running when the next step starts.

**Replaced.** Five turns in DOM reading order, one every 260 ms.

**Why.** Item by item reads as five separate events; the eye follows a queue
being serviced rather than one movement crossing the stage. Grouping by the
column the eye already sees makes it a wave, and the overlap is what stops it
being three events instead of five. The grouping is the part that can regress
silently — five turns in reading order satisfies any count and any timing
window — so the harness asserts the SHAPE, `1,2,2`, and which items share a
step.

**Reverse it if** the stage stops being three columns. On a narrow layout where
the four thumbnails stack, the columns are no longer what the eye groups, and
the pairing should follow the layout rather than the DOM order.

---

## 2026-09-02 — the notes scroll indicator is drawn, not the browser's

**Decided.** The native scrollbar is hidden on both engines and replaced by
`.notes-thumb`, a div positioned from the scroll ratio, draggable, coloured by
whichever section fills most of the view.

**Replaced.** Styling the real one — first with `scrollbar-width` /
`scrollbar-color`, then with `::-webkit-scrollbar` and its pseudo-elements.

**Why.** Neither works. Setting the standard properties makes Chrome ignore the
webkit ones and fall back to an OVERLAY scrollbar: measured here as
`offsetWidth - clientWidth === 0`, occupying no layout space and fading out a
second after scrolling stops — not the always-visible bar that was asked for.
Using only the webkit pseudo-elements is supposed to opt back into a classic
bar; it did not, in headless, even with `--disable-features=OverlayScrollbar`
and `Emulation.setScrollbarsHidden({hidden:false})`.

That last part is the decisive one. **No headless run paints a scrollbar of
either kind**, so the look could not be captured and looked at — and this repo's
rule is that no visual item is done without a captured frame. A native bar here
would have shipped on the strength of a computed style agreeing with itself. A
div can be measured: its length, its offset, its colour and whether it is
hittable are all in the check, and dragging it is asserted to move the
document.

**Reverse it if** `scrollbar-color` ever becomes styleable without opting into
overlay behaviour AND headless paints it. Both would have to be true: the second
is what makes the first checkable.
---

## 2026-09-02 — the vault hands over the code, it does not hand over the password

**Decided.** When a vault code opens a door that has its own password, the vault
passes ALONG THE CODE THAT WAS TYPED. The notes overlay tries it against
`/api/notes/unlock` before showing its keypad, so entering `notes` in the Idea
Vault opens the document directly. If it does not match, the keypad appears as
before.

**Replaced.** Sealing the notes password into the vault blob as part of the
payload, which is the obvious way to make one code open both.

**Why.** That would put a real credential — the one guarding a document edited
every day, on a server — behind a five-character code that can be ground offline
forever, because the blob ships in a static page. The vault's own comment says
it is the right lock for half-finished ideas and the wrong one for anything that
would hurt to lose, and a notes password is the second thing.

Passing the typed code costs nothing and adds nothing to the page: it works only
because the two happen to BE the same word, the server check is untouched, and
the failure mode is the keypad rather than a leak. If they are ever set to
different words the overlay simply asks, which is correct.

**Reverse it if** the two are deliberately given different secrets and the
double prompt becomes the normal path. At that point the honest fix is a
server-issued token the vault can request, not a password baked into ciphertext.
---

## 2026-09-02 — the notes overlay checks its password on the SERVER

**Decided.** `/#notes` opens a keypad; the password goes to
`/api/notes/unlock`, which checks it with scrypt and a timing-safe compare and
only then returns the document. Storage is Vercel Blob with `access: 'private'`.
Sessions are stateless HMAC tokens keyed by the password itself.

**Replaced.** The Idea Vault's pattern, twenty lines up the same page: ship the
ciphertext, derive a key from the code, let AES-GCM's tag be the check.

**Why.** That pattern is right for something sealed ONCE. Its whole strength is
that the plaintext is genuinely absent from the document, and its whole cost is
that the blob is public and can be ground offline forever. These notes are
edited every day — re-sealing a document on every keystroke is not a thing that
can happen, and a vault you have to re-seal to write to is not a notes app. So
the content lives on the server and the check lives with it. `access: 'private'`
rather than public because a public blob has a URL, the pathname is fixed, and
the store id is not really a secret — that is one guess away from being the leak
the feature exists to prevent.

Keying the token HMAC on `NOTES_PASSWORD` rather than a separate secret is
deliberate: changing the password then invalidates every live session, which is
what changing a password should do.

**Reverse it if** the notes ever stop being edited and become something
published once — at which point the vault's shape is better and this is
machinery for nothing.

---

## 2026-09-02 — the notes content was converted, not the CSP

**Decided.** The pasted document's `<style>` block became rules in `styles.css`,
its `style="color:#hex"` became a `data-accent` token per `<section>`, its
`onclick` sidebar became something `buildRail()` builds at runtime from whatever
sections exist, and its nine SVG icons came through untouched. A converter
asserted all 127 list items identical, word for word, before and after.

**Replaced.** Adding `'unsafe-inline'` to `style-src` — one line in
`vercel.json`, and the pasted HTML would have rendered as-is.

**Why.** The site ships `script-src 'self'` and `style-src 'self'` with no
`'unsafe-inline'`, so pasted verbatim the document renders as an unstyled wall
of text with a dead sidebar. Weakening that site-wide, permanently, for one
private overlay is the wrong direction — this repo has a whole XSS gate
(`check_markdown.mjs`) defending the same posture. The conversion also turned
out to be worth more than the CSP: a runtime-built sidebar cannot go stale when
a section is renamed, and a derived list colour cannot disagree with its
heading, both of which the original carried as duplicated facts.

**Reverse it if** the notes ever need arbitrary pasted formatting to survive
exactly — at which point the honest answer is a sandboxed iframe with its own
CSP, not a weaker one for the whole site.

---

## 2026-09-02 — the notes editor is built on execCommand

**Decided.** Indent, outdent, bold, italic, underline, list creation, the
marker deletion behind the `- ` shortcut and redo all go through
`document.execCommand`.

**Replaced.** Moving nodes by hand, which is what the first cut of the `- `
shortcut did with `Range.deleteContents`.

**Why.** The undo stack. A hand-rolled edit is invisible to it, so Ctrl+Z either
does nothing or reverts to a state that never existed — and the task asked for
standard undo. That was not theoretical: the `deleteContents` version could not
be undone AND left the selection pointing into a text node it had just emptied,
so `insertUnorderedList` silently did nothing and the line ended up blank. Both
faults went away when the same deletion became `execCommand('delete')`.
execCommand is deprecated in the sense that no new features are coming, not in
the sense that it is going away.

The cost is that Chrome re-wraps moved text in a `<span>` carrying its computed
colour, which here is the section accent — so the wrapper freezes the wrong
colour and writes an inline style into the saved document.
`unwrapCommandSpans()` strips them immediately, and the editor check asserts
zero remain.

**Reverse it if** a browser actually drops it, or the editor grows past what
the built-in commands express — tables, real block moves. Then the undo stack
has to be owned deliberately rather than borrowed.
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
