# PORTFOLIO SITE — Architecture

Static HTML/CSS/JS on Vercel, **no build step** (one exception below). One
page (`index.html`), one stylesheet, one plain script — no modules, no
framework. The games live under `games/` with their own ARCHITECTURE.md
each; this file covers the site shell, the image pipeline, and the hooks.

Starting a new AI session? [docs/ONBOARDING.md](docs/ONBOARDING.md).

Per-subsystem docs: [games/surveyor/](games/surveyor/ARCHITECTURE.md) ·
[games/arena1/](games/arena1/ARCHITECTURE.md) ·
[games/chomp/](games/chomp/ARCHITECTURE.md) ·
[games/stickland/](games/stickland/ARCHITECTURE.md). Current state and open
decisions: `docs/STATUS.md`. Rules: `CLAUDE.md`.

## Modules

- `index.html` — single-page shell: sidebar, hero, featured work, games, AI
  Lab (5 tabs), Collab (shared builds — dormant, see below), about/toolkit/picks,
  Idea Vault (AES-GCM blob in `data-vault`; the overlay it opens carries the
  backlog list — see below), contact. Eight native `<dialog>`
  overlays (app embed, wallpaper lightbox, document reader, vault, shared
  game/app gallery, work mockup, resume, contact)
- `script.js` — plain script, feature blocks as IIFEs, executes top-to-bottom
  with `<script>` at the end of body. Major blocks: accent/theme system
  (7 accents; `applyAccent` sets `--accent`, rebuilds the SVG favicon,
  swaps mascots, and regenerates the SITE CURSOR: `cursorValue()` builds
  both the arrow and the pointer-hand as double-stroke data URIs — accent
  stroke over a dark casing, hotspot at the tip/fingertip — into
  `--dex-cursor-arrow`/`--dex-cursor-pointer`; the whole feature rides
  `html.dex-cursor`, default on, persisted as `dex-cursor` — an accent
  I-BEAM (`--dex-cursor-text`) covers selectable copy and the form fields,
  with text elements inside clickables inheriting the hand instead —
  toggled by the
  `cursor-toggle` button, the swatch row's LAST member — the same hexagon
  as the swatches but dark, wearing the live arrow glyph (accent-inked when
  on, muted when off), `aria-pressed` + `aria-label` its only name; docked,
  it sits INSIDE the dropdown at the bottom of the cascade (`--row` one
  past the last swatch, `--rows` = ACCENTS.length) while the collapsed
  state stays a single hexagon; deliberately NOT gated on
  prefers-reduced-motion — the toggle is the escape hatch back to the OS
  accessibility cursors; the styles.css block re-asserts `zoom-in` on the
  shot view and keeps disabled things on the arrow. The game iframes adopt
  the same set via `games/_shared/cursor.js` (`installAccentCursor()`:
  reads the game's own published `--accent` and the shared `dex-cursor`
  key, injects generic rules, follows toggle and accent changes live over
  the `storage` event) — Arena 1 and Chomp load `_shared/cursor-boot.js`
  as their last module; Stickland carries a COPY at `src/cursor.js`
  because its blob build cannot reach `_shared` over file://; Surveyor is
  deliberately untouched — its reticle/target set already covers its whole
  document. The SVG paths exist in three places (script.js, _shared,
  stickland src) and must stay in step. Game states win by construction:
  Arena 1's `cursor:none` crosshair lock, Stickland's inline `grabbing`,
  the breakout field's hide-and-dot. `tools/check_cursors.py` enforces the
  three copies byte-for-byte the way `check_accents.py` guards the palette,
  and the pre-commit hook runs it whenever any copy, the source or the
  checker itself is staged), `probeMascot()` (clones the real `<picture>` so the browser
  negotiates the one true file — **never hand-build derivative URLs**), Work
  overlay (**mockup** — see CLAUDE.md; `TEMPORARY MOCKUP DATA` block, filler
  SVGs; everything after it renders `{title, desc, src, w, h}` and is
  data-shape-agnostic; hero is a fixed 3:2 box on purpose), one `initTabs()`
  behind four tablists, wallpapers carousel/lightbox (self-builds from
  `.wp-item` figures), `initAppInfo()`/`initAppModal()` (the apps are ROWS
  stacked in the statement column under the AI LAB heading (`#aiApps`,
  hidden with the Apps panel the way `#wpThumbs` follows Wallpapers); each
  `.ai-card` row is a non-interactive container with three targets: name +
  mini line on the left are the out-link `<a>` (new tab; both lines
  underline on hover), the eyeball `<button>` — authored only on rows with
  `data-app-modal` — opens the app overlay (which offers NO open-full-page
  or new-tab escape: it is only ever an overlay; `data-link-preview` on a
  card additionally routes its TITLE link into that overlay until the app
  has a public home — MindSplit today), and a click anywhere else SELECTS
  the row and holds (`.is-current`; hover only previews, and the snap back
  to the held row is bound to the LIST — `pointerleave`/`focusout` on
  `#aiApps`, never on a card, because the gaps between rows are inside the
  list and a per-card revert flashed the held app every time the pointer
  crossed one; seeded on the first row; the link
  deliberately does not flex-grow, or the row's empty middle would open the
  tab); a row is one flat fill (`#181d23`, a step above the section rather
  than a match for it) and carries no accent wash — the accent's only job in
  the list is the border on the current row; the mark sits at the row's far
  LEFT and the filled-eye button at
  the far right via flex `order`, so the generated `<picture>` never moves
  in the DOM; the Apps panel across from the list shows the selection: the
  app's NAME large, then an inline carousel of ALL its `.gal-item` shots
  (cloned never borrowed; chevrons hidden on one-shot apps; x/x counter in
  the corner; no filmstrip; no shots collapses the frame — nothing sits in
  that state now, every one of the five apps carries at least one shot.
  NodeBlast's is a 1920x1080 capture of the live site driven over CDP
  through `games/_shared/dev/cdp.mjs`; dexddc.com's
  (`dexddc-portfolio.png`) is a supplied 2482x1478 grab of that site's
  portfolio grid, cropped to 16:9 across the empty sky and floor rather than
  centred, which would have clipped the nav ornament's horns; MindSplit is three captures
  of `/mindsplit/` at a 414x736 handset, in three of its five rooms,
  composited side by side the way `themedock-panel.png` merges four
  marketplace panels — a lone portrait frame in a 1440x690 stage is mostly
  background), then lead,
  description and tags; clicking the shot enlarges it in `#appShotModal` —
  a wallpaper-style lightbox with a centred x/x between arrows that grey
  out on single shots — NOT the games' gallery modal, which apps no longer
  touch; the panel's min-height is measured across all cards (and on
  resize) so hover never changes the section's height; the eyeball hides
  below 768px where the overlay declines),
  `initCollabInfo()` (fills the Collab panel and builds
  each card's brain row + invite link from the card's own `data-people` /
  `data-invite`; adding a project is one card, no JS edit), vault, the vault
  backlog list (see below), clips, ONE markdown loader and ONE reader
  (`loadMd` over a URL-keyed promise cache, `openReader` over `#prModal`)
  serving both document lists — the reader is handed a file, a title and a
  name and knows nothing about prompts or plans, prompts (three live cards;
  excerpt, size, reader, copy and download all read `assets/ai/prompts/*.md`
  at runtime — adding one is a file plus an `<article>`, no JS edit), song
  player, resume overlay, Web3Forms contact (public access key — by design)
- `MediaBus` in `script.js` — the only arbiter between the two things that
  make sound (the clips player and the song bar). Players register a small
  object, never the media element, because every question it asks — is your
  panel the open tab, is your frame on screen — is about the surrounding UI.
  Three invariants live here: **only one player is ever unpaused** (enforced on
  the `play` event, so no new way to start playback can forget it); **nothing
  plays in a hidden tab** (paused on `visibilitychange`, and deliberately NOT
  resumed on return — a page that starts talking when you come back is the
  same ambush reversed); and the space bar goes to a player only when it is on
  screen and playing or already started — never out of a text field, never off
  a button or link, never behind an open `dialog`, and `preventDefault()` is
  reached at exactly one point, after a claimant is found. A third player
  registers, it does not rewrite this.
- The clips player's play control **is the whole video surface**: `#clBig` is
  positioned `inset:0` with the disc drawn inside it, so clicking the picture
  toggles playback and the click target is the same `<button>` the keyboard
  already reaches, already named and already in the tab order. A bare click
  handler on the frame would have been a mouse-only control. `.cl-bar` and
  `.cl-note` sit above it (z-index 4 against 3), which is what leaves the
  scrubber, volume and chips their own clicks; `.wp-plate` is
  `pointer-events:none`.
- `about-breakout.js` — ES module for the About section's Breakout toy.
  Wired into the page as one centred BREAK THE BIO pill (`.bb-ui` in
  `index.html`, absolutely positioned into the dead space under the bio so
  layout never changes; no sound control out here — before the game starts
  there is nothing to mute) and one block at the end of `script.js` that
  owns the gate and the lazy `import()` on first click — the cold path
  costs a rect check and one pill, nothing game-related is fetched before
  then. Gating is split on purpose: pointer + motion live in a CSS media
  query on `.bb-ui`; the geometry half (is there room for the ball, and
  >=150px of clear gutter right of the copy for the in-game control stack
  — one gate, so no width offers the game without somewhere to put the X)
  is a small duplicate in `script.js`, because the module's authoritative
  `canPlay()` cannot run before the module loads. The wall is
  BOTH bio paragraphs; the `h2` is the ceiling and flashes accent on
  contact. Every glyph of the
  wall is measured per character via Range rects (no spans,
  ever — the `<p>` stays one text node), and a transparent canvas overlay
  erases and redraws single letters. The paragraph is NEVER hidden or
  redrawn wholesale: Canvas2D rasterises glyphs measurably brighter than
  Blink rasterises the same font in the DOM (~13% more lit luminance,
  measured 2026-08-19), so intact letters stay real DOM text and the canvas
  only paints opaque background patches over destroyed letters and glyphs
  in motion. Erasing needs an opaque background behind the paragraph —
  the game re-resolves it every ~20 frames and shuts down if it ever stops
  being one colour. `start()` runs the game: paddle (mouse + A/D/arrows),
  contact-point aim, minimum-bounce-angle clamp, ceiling at the h2's
  underside (it flashes accent, throttled), floor at the portrait's bottom
  hard-capped above `.about-sub` — and `canPlay()` gates on a fine pointer,
  motion allowed, and >=56px of dead space under the bio, which the layout
  only has at roughly >=1400px wide. A hit letter detaches with the ball's
  momentum, gravity and spin, and always fades before it lands (no pile-up
  by construction). Two progress levers compound so the back half of a run
  falls apart in the player's favour: at 30% cleared a SECOND ball spawns
  (two maximum, each missed ball respawns on the same delay; one wall,
  stepped sequentially, so a letter broken by one is gone for the other in
  the same frame; aim and angle clamp are per ball) — this deliberately
  reversed the one-ball call of the same day (Dex, 2026-08-20: two balls
  halve the clear time honestly) — and past 60% every ball grows
  continuously from 5px toward 11px radius, sweeping up the end-game hunt
  for scattered survivors. Every 5% cleared a BOMB drop falls from the
  letter just broken (one in flight at a time, missed is gone, no bounce):
  caught with the paddle it arms the next ball the paddle serves, and that
  ball's next hit explodes a 52px radius with a synthesised noise-burst
  boom, letters thrown radially. Letter blips carry a 35ms refractory
  window so two balls read as hits, not a rattle. While the pointer is
  over the field above the paddle line, the OS cursor hides and a faint
  accent dot drawn on the canvas marks it instead (a true repel is
  impossible without Pointer Lock, which is too heavy for a toy); below
  the line and outside, the accent game cursor returns. Control hints
  (`.bb-keys`, the games' pause-menu keycap treatment) sit bottom-left
  under the portrait while the game runs. Muted reads muted: the slider
  hides and the speaker takes a horizontal slash. Audio is the shared Clayweld panel
  (`games/_shared/audio-panel.js`, persisted as `about-breakout-audio`)
  driving synthesized blips through `createBusGraph` — no samples, no
  MediaBus registration for the BLIPS (short fx are not a player and must
  not pause the song bar) — but the MUSIC is a player and registers:
  Juhani Junkala's Title Screen chiptune (CC0 —
  `assets/audio/breakout-loop.mp3`, row in `assets/audio/CREDITS.md`, the
  one audio credits table), fetched on first start and looped as a WebAudio
  buffer with silence-trimmed loop points (the only way a compressed loop
  is seamless, and Safari cannot decode ogg-vorbis). The registered `el` is
  a `.paused` shim — the bus only ever reads that — so starting the toy
  pauses the songs bar, the space bar pauses/resumes the game under the
  bus's existing rules, and the hidden-tab rule quiets it; the module also
  pauses the GAME on visibilitychange. Pause is real: updates freeze, a
  small centred accent-outlined PAUSED panel appears over a slightly dimmed
  playfield (a full dark wash read as a crash), and the whole AudioContext
  suspends; clicking the playfield toggles it, Escape is always a full
  stop. While the ball is live the page cursor becomes an accent arrow in
  the site cursor's own double-stroke construction (dark casing under the
  accent line — same reason the lightbox cursor is built that way),
  cleared on pause and on every exit through stop(), the one funnel all
  error paths drain into. In-game controls are the `.bb-stack` right of
  the playfield, bottom level with the paddle, shown only while running —
  top to bottom: X (stop), pause, then mute + master slider at the very
  bottom, writing the same shared settings, one volume path. Music opens
  at the shared 30% default for a first-time player (no seed override any
  more); a stored preference always wins. Win: when the wall is empty and
  the last fall has faded, every
  letter flies home from scatter below the floor, staggered in reading
  order, and is UNCOVERED the frame it lands — the handoff back to real
  text is per letter and needs no final swap. The win is celebrated the
  reassembly long: a synthesised fanfare (~4s — rising run, chord stabs
  into a held chord, sparkle tail; same voice and bus as the blips, no
  file, no fetch), accent fireworks AND a steady confetti fall, and a
  VICTORY wordmark at half the container width that scales in and then
  flashes outline-to-fill at a chunky arcade rate — all pure canvas paint
  that can leave nothing behind; the canvas outlives the last landing only
  until the final particles die, and `prefers-reduced-motion` gets the
  reassembly and the sound with no particles and no flashing VICTORY. The `<p>` stays in the accessible tree
  at all times (never hidden, never aria-hidden; the canvas is), and every
  exit — any error, Escape, resize, layout shift, a late font swap,
  scrolling the section away — restores the untouched text
- `styles.css` — banner-delimited sections; icon system is baked CSS mask
  data-URIs (`tools/bake_icons.py`); accents are one `--accent` variable,
  never filter chains
- Root wrapper folders `surveyor/ chomp/ arena1/ stickland/` — thin pages
  that iframe `/games/<name>/index.html`, focus the frame (so Escape/WASD
  reach the game), forward the query string, and leave the game on refresh
  (`refresh-home.js`, external file because CSP bans inline). All URLs
  root-absolute: Vercel serves both `/name` and `/name/`
- `mindsplit/` — Vite build **output** served directly (source at
  `ai/apps/mindsplit/`; the one build-step exception). `ai/apps/` contract is in
  its README
- `tools/` — `bake_images.py` (sole writer of `assets/derived/`),
  `bake_markup.py` (owns every `<picture>` block), `image_slots.py` (LADDERS/
  SLOTS/SIBLINGS — the single source of truth), `check_scope.py` (commit-msg
  scope hook), `check_sweep.py` (commit-msg sweep hook), `bake_favicon.py`, `bake_icons.py`, `check_accents.py` (the
  7-accent palette is duplicated in 5 places and must stay byte-identical),
  `check_cursors.py` (the 3-cursor set — arrow/hand/I-beam paths, hotspots,
  fallbacks — is duplicated in script.js, `games/_shared/cursor.js` and
  Stickland's src + build, and must stay in step the same way),
  `check_markdown.mjs` (renderMarkdown() shipped an XSS on 2026-08-19 —
  quotes were not escaped, so a link target closed its own attribute and the
  next thing in it became an event handler; this re-proves the fix against 24
  hostile payloads in a real HTML parser and refuses any new attribute the
  renderer interpolates into),
  `seal_vault.mjs`, `build_docs_pdf.mjs`, `make_gallery_composite.py` (the
  multi-panel gallery masters — Chomp's progress strip and Stickland's four-up;
  it writes MASTERS into `assets/gallery/` and `bake_images.py` treats them
  like any other, so the two tools run one way round and share no state).
  Hooks are versioned in
  `tools/hooks/` and installed once via `bake_images.py --install-hooks`
- `games/_shared/dev/` — the screenshot harness all four games share.
  `cdp.mjs` is the browser (launch, serve, evaluate; every command takes an
  optional deadline, because a CDP call whose page navigates under it never
  answers at all). `capture.mjs` is everything above it that is not about any
  one game: trusted CDP input — which is what reaches pointer lock — a settle
  that watches the canvas stop changing rather than sleeping, and the contact
  sheet builder. Each game then has its own `dev/gallery.mjs` on top: several
  deliberately varied candidates per named shot, the seed and the input stream
  recorded in every caption, and one sheet per game to choose from. The
  candidates are gitignored and regenerable; the sheet is the artefact.
  **Every shot asserts what its caption claims** — the vehicle, the altitude,
  the region — because four frames captioned "Jet" once shipped showing a
  rover, and nothing noticed
- `vercel.json` — CSP in four scopes: root is strict (`script-src 'self'`,
  no inline, connect only to Web3Forms, and `media-src` naming the one
  bunny.net pull zone the AI Lab clips stream from — an exact host, never a
  `*.b-cdn.net` wildcard, which would be every bunny customer's zone);
  `/games/*` adds `'unsafe-inline' blob:` + Photon websockets +
  `frame-ancestors 'self'`; `/mindsplit/*` and `/themedock/*` strict but
  frameable. `assets/derived/` is `immutable` for a year — hence
  the `?v=<8 hex of the master's bytes>` stamp on every generated URL

## Collab (shared builds)

One card per project in `#collab`, same contract as the AI Lab app cards:
everything lives on the card as `data-*` (`data-people` is the single source
for both the brain row and the panel's collaborator list; `data-invite`, when
present, renders a + linking to the repo's collaborators settings page). The
architecture is deliberately NOT in this repo: each collab project is its own
GitHub repo (adding a collaborator there IS the invite — no auth or roles on
the site) with its own Vercel project, rewritten to `/collab/<slug>/` in
`vercel.json` so the existing app overlay and CSP work unchanged. No rewrite
exists yet — the first project card is a stamped placeholder.

DORMANT right now: no nav link (commented out in the nav), no `sections`
entry in the scroll spy, and the panel + grid wear `hidden` behind a CSS-only
UNDER CONSTRUCTION strip (`.collab-soon`) — one line of type between two
full-width hazard bars, not the 340px dashed plate it started as: a section
that is not built yet should cost a rule's height, not a panel. The
machinery is finished and
tested, not deleted — going live is dropping the two `hidden` attributes and
the strip, restoring the nav link and the `sections` entry, and putting real
data on the card.

## Idea Vault — the backlog

The overlay the vault opens onto is the snail, `GOT IT`, and under them a list
of every plan that is written but unbuilt. Same contract as the prompt cards and
for the same reason: a row names a `.md` file and the reading view, the byte size
and the downloaded bytes all come from that file, so **adding a plan is one
`<article class="iv-row">` in `index.html` and no JS edit**. Proven rather than
asserted — a sixth row in a brand-new category renders, previews and downloads
with `script.js` untouched.

The Surveyor rows point straight at the committed plans under
`games/surveyor/docs/`. Nothing is copied into `assets/`: a second copy is a
second thing to update and goes stale the first time a plan is amended. A row
pointing at nothing is worse than no row — if the plan has not been written,
leave the row out.

**The tabs build themselves from the rows' `data-cat`.** That is what keeps
"markup only" true for a plan that is the first of a new category, and what makes
"a category with a single plan gets no tab of its own" automatic instead of
something to remember. Every tab addresses the same one list, so they
deliberately carry no `aria-controls` — `initTabs` reads that attribute to hide
the panel a tab owns, and here they would all own the list. The relationship is
stated the other way round: the list names the selected tab as its label.

This is the one place an overlay opens **over** another instead of in place of
it — the single exception to `openModal`'s "never two overlays at once", taken
by passing `stack`. Closing the reader has to put you back in the list you
opened it from: the vault section relocks the moment its own overlay closes, so
replacing it would leave the keypad on screen still reading OPEN with nothing to
close. `bindModal`'s close handler tells a stacked overlay from a hand-off (a
replacement overlay taking the old one's place) and restores focus only for the
first. Nothing opened from outside another overlay may pass `stack`.

## The image pipeline (full rules in CLAUDE.md — the short version)

Masters under `assets/`, derivatives generated into `assets/derived/`
mirroring the master's subfolder. Adding an image = drop the file + one
`<!-- img src=… slot=… alt=… --><!-- /img -->` directive; the pre-commit
hook bakes and fills in everything (`<picture>`, srcsets, `sizes`,
dimensions). Never edit inside the markers, never type width/height, never
build a derivative URL in JS. Ladders/`sizes` live per-SLOT in
`image_slots.py`. AVIF q58 / WebP q76. Budget: ≤150 KB per image on the
wire, hero LCP < 1.2 s on cold 4G. The two blocking checks:

    python tools/bake_images.py --check
    python tools/bake_markup.py --check

## Call flow at page load

Reload → scroll-to-top + hash strip (except `#resume`). Accent picker builds
and applies the stored accent before first paint matters; reveal/scroll-spy/
parallax bind; remaining IIFEs run inline. On `load`: re-measure, hand the
URL to the scroll spy, then idle-warm the other six mascots one accent at a
time via `probeMascot`.

## Commit hooks

`pre-commit` (only fires when rasters/markup/palette/script.js are staged):
`check_accents.py` → `check_cursors.py` → `check_markdown.mjs` → bake images
→ bake markup → `bake_markup --check`. The markdown check needs node, and its
browser half needs Chrome; both degrade to a printed notice rather than a
block, since a hook is convenience and the check is the guarantee.
Stages `index.html` **whole**, but derivatives only for the masters in the
commit — `bake_images.py --derived-for` maps one to the other. It used to
stage `assets/derived/` whole, and because the bake is repo-wide that pulled
in whatever another session had left unbaked; two commits on 2026-08-20
carried a third party's derivatives that way, master not included.
`commit-msg` → `check_scope.py`: a commit may not span "projects" (each
`games/<name>`, each other top-level dir, the repo root as one unit) unless
the message carries a `Spans:` line naming every one. One exemption:
`assets` + root-`index.html` only (the documented add-an-image flow).

Then `check_sweep.py`, which catches the opposite accident: a commit that stays
inside one project and carries a SECOND session's work out with it, because a
file both were editing got staged whole. Two rules. Markup pointing at an
`assets/derived/` file the commit does not contain is refused outright — that
is `b6ba02f`, which published a `<picture>` whose 1920 rung was in no tree at
all. A region of a root file or an `ARCHITECTURE.md` whose identifiers appear
nowhere in the message is refused with a `Carries:` escape hatch; usually the
right answer is a sentence in the message instead. It flags about one commit in
ten, which is the agreed price (revisit past one in five).

**IT CANNOT SEE A SWEPT HUNK THAT SITS NEXT TO A REAL EDIT.** Hunks less than
60 lines apart are one region, so a region containing both your work and
someone else's is explained by your half of it and passes. That is not
theoretical: `d3c2f6a` carried a `games/surveyor/ARCHITECTURE.md` invariant out
under an unrelated Ember fix, and the finished hook does not catch it. Widening
the region gap does not fix it either — at 150 lines the kong-fu sweep merged
into the edit beside it and the check went silent instead. The hook is a
backstop for the far-apart case; the near case is still on whoever stages.
One session owns `index.html` and `styles.css` at a time (Dex, 2026-08-19) —
that convention, not this hook, is what covers the adjacent case.

## Numbers

7 accents (lime default) · 11 ladders / 16 slots in `image_slots.py` ·
70 generated markup blocks in index.html · fallback ladder
1600/1200/900/600/400/200 · cache stamp = 8 hex of sha256(master) ·
`styles.css?v=` / `script.js?v=` bumped by hand.

## Known-outstanding

The Work overlay is a mockup (no `work.json`, filler SVGs — do not build on
its taxonomy). The Clips tab carries five clips. Every poster is baked at its
clip's own resolution and never upscaled, so a 720p master simply skips the
rungs above it — and every poster so far is Bunny's auto-generated midpoint
frame, not the frame picked in the dashboard (its edge cache holds them for
30 days; clearing it is a Bunny-side job). King Kong is 9:16 in a 16:9 frame:
the frame never changes shape, so that clip carries `data-fit="contain"` and
the `clip-poster-portrait` slot instead of being cropped to a third of itself.
The Collab section is dormant — off the nav, content hidden behind
an UNDER CONSTRUCTION strip — until the first collab repo exists. The vault
backlog carries six plans, three Surveyor and three Site. The Breakout toy
in the bio has no row and never will: the vault holds parked or unstarted
plans, and that one is built. Its unstarted sibling `docs/bio-invaders.md`
is exactly what does get a row. See
`docs/STATUS.md` for the live list and open decisions.
