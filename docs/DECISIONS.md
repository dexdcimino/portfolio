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
