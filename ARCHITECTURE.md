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
decisions: `docs/DECISIONS.md`. What is next: `docs/plan/BACKLOG.md`. Rules: `CLAUDE.md`.

## Modules

- `index.html` — single-page shell: sidebar, hero, featured work, games, AI
  Lab (5 tabs), Collab (shared builds — dormant, see below), about/toolkit/picks,
  Idea Vault (AES-GCM blob in `data-vault`; the overlay it opens carries the
  backlog list — see below), contact. Eight native `<dialog>`
  overlays (app embed, wallpaper lightbox, document reader, vault, shared
  game/app gallery, work gallery, resume, contact)
- `script.js` — plain script, feature blocks as IIFEs, executes top-to-bottom
  with `<script>` at the end of body. Major blocks: accent/theme system
  (7 accents; `applyAccent` sets `--accent`, rebuilds the SVG favicon,
  swaps mascots, and regenerates the SITE CURSOR: `cursorValue()` builds
  both the arrow and the pointer-hand as double-stroke data URIs — accent
  stroke over a dark casing, hotspot at the tip/fingertip — into
  `--dex-cursor-arrow`/`--dex-cursor-pointer`; the whole feature rides
  `html.dex-cursor`, default on, persisted as `dex-cursor`. The arrow has
  been eased upright twice: 20° of lean overshot, 14° still read as a lean,
  and it sits at ~9° now (2026-08-20). **Every rotation is about the TIP**,
  which is why `hot` has read `6 4` unchanged through all three — the `M6 4`
  that opens the path is the pivot and the hotspot at once. Re-verified by
  measurement each time rather than by assumption, because a few degrees is
  exactly the size of change that looks like it cannot have moved anything:
  rasterise the live `--dex-cursor-arrow`, keep only the ACCENT ink (the
  casing is the wider stroke and would read as the extreme), and fit the
  round cap's support function back to its centre — 5.998 4.000 measured
  against a declared 6 4. An accent
  I-BEAM (`--dex-cursor-text`) covers selectable copy and the form fields,
  with text elements inside clickables inheriting the hand instead —
  toggled by the
  `cursor-toggle` button, the swatch row's LAST member — the same hexagon
  as the swatches but dark, wearing the live arrow glyph (accent-inked when
  on, muted when off), `aria-pressed` + `aria-label` its only name; docked,
  it sits INSIDE the dropdown at the bottom of the cascade (`--row` one
  past the last swatch, `--rows` = ACCENTS.length) while the collapsed
  state stays a single hexagon. DOCKED, the active hex is a disclosure and
  never a re-pick, and it opens two ways: hover, which closes again on
  mouse-out, and a deliberate act — click, Enter, Space, or an arrow key —
  which sets `pickerPinned` and HOLDS it open until a second click, an
  outside tap, or Escape. The two are distinguished so that a pointer
  merely passing through cannot latch it; every close funnels through
  `setOpen(false)`, which drops the pin, so a pin can never outlive the
  open state. Until 2026-08-20 a click was gated on `!open`, which on a
  real pointer is never true — pointerenter has already opened it — so the
  click fell through to re-picking the accent already on and then closing:
  the dropdown shut in your face and would not reopen under the cursor.
  Escape is a document listener for the same reason (the hover path leaves
  focus on `<body>`, where a listener bound to the swatches never hears
  it), and the arrow keys open the stack before walking it, because a
  collapsed cascade still has six focusable hexes at `opacity:0`.
  Deliberately NOT gated on
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
  overlay + CARD CAROUSEL (343 pieces in eight categories, loaded once from
  `assets/work/work.json` — written by `tools/bake_work.py`, carrying FINISHED
  srcset strings so the same rule holds here; `paintPicture()`/`warmPicture()`
  fill and pre-negotiate every `<picture>`; hero is a fixed 3:2 box on
  purpose, with the two arrows OUTSIDE it in their own flex columns and
  wrapping at both ends; the eight featured cards cross-fade five frames each
  on ONE round-robin interval, frame 0 from the markup and 1-4 from the
  manifest. The sweep is THREE COLUMNS, not five items: the video, then the
  left pair of thumbnails, then the right pair, `STEP_MS` 300 apart on a
  15 s hold, so the whole wave crosses the stage in about 600 ms while each
  `.85s` cross-fade is still running. And a frame LEAVING keeps opacity 1 one
  layer down (`.is-leaving`) instead of fading out under the new one: two
  matched ease curves composite to `1-(1-a)(1-b)`, which is 0.75 at the
  midpoint, and that quarter of panel showing through was the flicker in the
  middle of every fade. The frames' stacking is why `.card-shade`/`.card-meta`/
  `.card-go` carry `z-index:4`: an element with a z-index paints over a sibling
  without one whatever the source order, and the eight captions went dark the
  day the reel got its layers. A card's crop can also be TIGHTENED, not only
  aimed -- `zoom` in `work-index.json`, a number or `{scale, pos}`, applied as
  the `scale` property so the hover rule's `transform` cannot replace it, and
  ONLY in the card: a filmstrip thumb has to look like the piece it opens.
  Inside a `.fv-item` the fade is put BACK under everything at `z-index:1` --
  there the frames are the items themselves, and 4 landed it on top of the
  caption and the download button), one `initTabs()`
  behind four tablists, `initGallery({id, root, panel})` — ONE carousel +
  lightbox, self-building from `.wp-item` figures, instantiated TWICE:
  Wallpapers (`wp`) and Concepts (`cn`). The ids are a prefix and the arrows
  are looked up inside the instance's own root and dialog; both were
  `document` lookups while there was one of these and both are exactly what a
  second instance cannot share. The only difference between the two is the
  frame — 16:10 cover against 4:3 contain — and that is CSS, not JS,
  `initAppInfo()`/`initAppModal()` (the apps are ROWS
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
  the list is the border on the current row. HOVER AND SELECTED ARE NOT THE
  SAME LANGUAGE: hover (and `:focus-within`, which stays paired with it) is
  ONE STEP OF GREY, `#181d23` → `#1f262e`, with no border, no ring and no
  lift; the accent border is the selected row's alone, and it is FADED to
  55% rather than thickened — a 2px border plus a 1px ring at full accent
  was the loudest thing in the section, and on a near-black page more
  accent pixels read as shouting rather than as weight. The focus
  INDICATOR is unchanged: the accent outline on the link or the eyeball
  itself. The mark sits at the row's far
  LEFT and the filled-eye button at
  the far right via flex `order`, so the generated `<picture>` never moves
  in the DOM; the Apps panel across from the list shows the selection: the
  app's NAME large, then an inline carousel of ALL its `.gal-item` shots
  (cloned never borrowed; chevrons hidden on one-shot apps; x/x counter in
  the corner; no filmstrip; no shots collapses the frame — nothing sits in
  that state now, every one of the five apps carries at least one shot.
  NodeBlast's are TWO 1920x1080 captures of the live site, driven SIGNED OUT
  over CDP through `games/_shared/dev/cdp.mjs`: `nodeblast-alchemists.png`
  (the creator hub, and FIRST, because the card's thumbnail is whatever shot
  leads) and `nodeblast-catalysts.png` (the hex grid). Three things sit in
  front of those frames and every one of them has produced a wrong
  screenshot: the feed is ASYNCHRONOUS, so a frame timed off `load`
  photographs an empty grid; the welcome modal is re-shown on EVERY load,
  because dismissing it does not persist, so it has to be clicked away each
  run; and the logo's hover opens a colour picker column that covers the
  Catalysts toggle and does NOT close on a plain mouseleave — the pointer
  has to be walked THROUGH the panel and out again, which means it is closed
  LAST, after all navigation, since any click near the top-left reopens it.
  All three are asserted at the shutter rather than slept on. There is no
  Account-page shot and there is not going to be one: it would need a
  signed-in session, NodeBlast's sign-in is OAuth-only (Google, GitHub,
  Discord) with no password form, and signed out "My Profile" does
  nothing at all — so it cannot be driven headlessly and was dropped
  rather than staged by hand (Dex, 2026-08-20). Two shots is the set.
  dexddc.com's
  (`dexddc-portfolio.png`) is a supplied 2482x1478 grab of that site's
  portfolio grid, cropped to 16:9 across the empty sky and floor rather than
  centred, which would have clipped the nav ornament's horns, and then GRADED
  — the Windows screen capture came back flat and sat dead beside its
  neighbours in the carousel, measuring sd 43.5 against nodeblast-hub's 50.8
  and topping out at 189 where the others reach 197 and 255. The master now
  carries a five-point tone curve (20,14 · 60,60 · 128,144 · 190,212) and a
  1.26x saturation about luma, applied once and baked in: sd 50.4, p99 209,
  nothing clipped either end that was not already. The ungraded original is in
  git, which is the only copy there needs to be; MindSplit is three captures
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
  backlog list (see below), clips — the player plus `paintOrigin()`, which
  builds the Clips tab's origin chain in the statement column (`#clOrigin`)
  from the `.cl-item` figure itself: `data-origin` is the copy and the nested
  `<figure class="cl-step">` blocks are the source images in order.
  `data-origin-clip` on the figure OPTS IN to the clip's own poster as a final
  link (cloned, never written twice — Amphibious and Clayweld take it, the rest
  do not), labelled by `data-clip-label` where the plain "Clip" is not enough;
  `data-bare` on a step drops its frame, for a cutout on transparency. Steps are
  optional — King Kong is copy alone, and that case carries `.is-copyonly` so
  the CSS can give back the room the chain would have taken. The row is JUSTIFIED — each
  step's `flex-grow` is its image's aspect ratio, read off the baker's
  width/height attributes, so every image is the same height at its own shape
  and nothing is cropped or letterboxed. It follows `#ai-panel-videos`'s
  `hidden` through a MutationObserver for the same reason `#wpThumbs` and
  `.app-info` do —
  ONE markdown loader and ONE reader
  (`loadMd` over a URL-keyed promise cache, `openReader` over `#prModal`)
  serving both document lists — the reader is handed a file, a title and a
  name and knows nothing about prompts or plans, prompts (three live cards;
  excerpt, size, reader, copy and download all read `assets/ai/prompts/*.md`
  at runtime — adding one is a file plus an `<article>`, no JS edit), song
  player, resume overlay, Web3Forms contact (public access key — by design),
  **TOP PICKS is seven tabs** â Games, Movies, Shows, Songs, Quotes, Pods, Prefs â and both the
  tab machinery (`initTabs`) and the carousel (`initPkCarousel`) derive their
  tabs and panels FROM THE DOM, so an eighth is markup only, no JS edit.
  Games, Movies and SHOWS share the 2:3 `pick-cover` slot — a show card is a
  bare cover over a Google search, captionless, exactly like a movie, which is
  why the season range on Rick and Morty rides its alt text and its query
  rather than a line of type that tab does not have; Songs and PODS share the 1:1
  `song-cover` slot, because podcast art is natively square exactly as album
  art is. A pod card is cover + caption, both linking to the show's YouTube
  channel, plus a small WHERE-ELSE-TO-LISTEN row. That row is `.pk-listen` /
  `.pk-listen-link` — named after what it does rather than after either tab,
  because SONGS carry it too (Spotify then YouTube; on a song the cover is a
  play button rather than a link, so the row is that card's only way out to a
  service). It is pinned to the BOTTOM of the card (`margin-top:auto` on a
  column card) so a caption that wraps to two lines cannot leave one tab's rows
  ragged. Three of the five song rows point at a Spotify SEARCH rather than a
  track — those three could not be verified without guessing an id, so they say
  "Find on Spotify" and land on a real search instead of a maybe-right track.
  **NO AUDIO ON THE PODS TAB, and that is a licensing answer, not an oversight.**
  A podcast's RSS audio is publicly fetchable, but fetching is not a licence to
  serve it from this page, and doing so would route around the host's own ad
  insertion and measurement. The legal way to actually play an episode is the
  platforms' OWN embeds (Spotify / Apple / YouTube iframes), which are licensed
  for embedding and keep the creator's ads and numbers â the cost is that this
  site's CSP carries no `frame-src`, so enabling one means letting third-party
  frames into an otherwise self-contained page. Links only until someone wants
  to pay that. Only YouTube and Apple are linked because only those two were
  verifiable (handles resolve 200 with the right channel title; Apple links
  come from Apple's own search API) â Spotify is absent rather than guessed.
  PREFS is the odd one out, deliberately: no art at all (the pick IS the
  sentence), ten landscape cards on the same grid, a fire/poop vote on each.
  **Votes are per browser and cannot be otherwise** - there is no server here,
  so one-vote-per-person is not available. `localStorage` under
  `dex.prefs.votes` holds this visitor's ten picks and the number shown is the
  card's `data-fire` / `data-poop` seed plus their own vote, shared with
  nobody; every storage call is wrapped because it throws outright in some
  privacy modes. It is also the ONE tab the suggestion `?` ignores - a
  preference is not something a stranger suggests - so `TAB_CAT` carries no
  entry for it and the cycler stays at six.
  QUOTE RENDITIONS finally have a user: the Alan Watts card carries both of his
  quotes in `data-original` / `data-rendition` and swaps them in place, so the
  text and its cite can never drift apart. Its toggle is `.pk-quote-pager` â both
  two DOTS in one pill, the active one in the accent, and the dot shares
  `.pk-cat-dashes i`'s rule rather than restating its size and grey.
  **CLICK ONLY**: the hover preview the machinery shipped with is deleted, so
  a pointer crossing a card can never change what it says. Cards without `.has-rendition`
  still show no toggle at all.
  and the Top Picks suggestion POPOVER (the `?` sits in `.pk-tabrow` as a
  SIBLING of the picks tablist, never inside it — role=tab there would join
  the arrow-key cycle and announce as one more category; the panel is
  `.pk-pop` anchored beside the button — NOT a dialog: no backdrop, no
  modal focus trap; focus enters on open and returns to the `?` on close;
  Escape, outside click, and >24px of scroll close it, and TYPED VALUES
  PERSIST across closes — only a successful send resets the form; below
  760px it drops under the row's right edge instead of beside the button.
  The header row is the accent-coloured "Suggestion?" left / the cycler
  right: one button walking Game→Movie→Show→Song→Toon→Quote→Pod wrapping, its
  aria-hidden indicator dots centred UNDER it — deliberately not controls,
  a tab stop each would cost more than the cycle pays. **`CATS` in script.js
  and the `<i>` dots in `.pk-cat-dashes` are a HAND-KEPT PAIR** — one dot per
  category, counted by nobody — so a new picks tab touches both; whatever
  shows is what sends, and it STARTS on whichever picks tab is showing when
  the `?` is pressed (`TAB_CAT`). Below sit the TITLE field (left-aligned,
  `autocomplete=off` so the browser's own history of past titles stays
  down, its placeholder and aria-label painted by the cycler: Game Title /
  Movie Title / Song Title / The Quote; a TEXTAREA - one row for a title,
  two on Quote, fitted to the text up to a five-line max-height; Enter sends
  a title, on a quote Enter is a line break and Ctrl/Cmd+Enter sends) and a
  `From:` word with the Anon
  field out to the same right edge (`.pk-pop-from`), and SEND holds the
  footer's right edge. Spam, the client-side half: three a minute, a dozen
  a day (`dex-picks-sends`, stamps kept 24h), the same category+title
  twice in a day (`dex-picks-seen`), and junk that cannot be a title (no
  letters, one character six times running, a link) are refused before a
  request exists; all localStorage, so it stops the enthusiastic and the
  accidental - the relay (Web3Forms: honeypot, its own scoring, hCaptcha
  available) is the real filter. Same Web3Forms relay with a `[Top Picks]` subject
  and a `category` field; the Anon fallback happens in the
  PAYLOAD with a `name_given` flag so a typed "Anon" stays distinguishable
  from a blank; honeypot pattern shared; three sends a minute under
  `dex-picks-sends`; the contact form's own code untouched)
- `:` emoji picker in `script.js` (`.emoji-pick`) - Stickland's chat autocomplete
  on the two fields people write to me from: the contact MESSAGE and the Top
  Picks TITLE. Same shape as the game's (":" + up to 20 letters, six best
  matches over three most-used, arrows / Enter / Tab / Escape / click). The
  dataset is NOT copied: it is `import()`ed lazily from
  `games/stickland/src/emoji-data.js` on the first `:` - the one place the site
  reads a game's source, recorded in that game's ARCHITECTURE.md; under
  file:// the import is refused and the picker is simply absent. Built INSIDE
  its host (`.contact-panel` / `.pk-pop`), never on `<body>`: the contact form
  is a top-layer `<dialog>` and nothing on body paints over it. Escape closes
  the picker before the surface (preventDefault on the keydown stops the
  dialog's cancel; the popover's capture listener steps aside while a picker
  is open). Frequency under `dex-emoji-freq`, its own key, so a game session's
  most-used never leaks into a message
- `MediaBus` in `script.js` — the only arbiter between the two things that
  make sound (the clips player and the song bar). Players register a small
  object, never the media element, because every question it asks — is your
  panel the open tab, is your frame on screen — is about the surrounding UI.
  Three invariants live here: **only one player is ever unpaused** (enforced on
  the `play` event, so no new way to start playback can forget it); **nothing
  plays in a hidden tab EXCEPT a player that declares `keepPlayingHidden`**
  (paused on `visibilitychange`, and deliberately NOT resumed on return — a page
  that starts talking when you come back is the same ambush reversed). The songs
  bar is the one exemption: a track someone put on deliberately is meant to
  outlast switching windows, and they know where it is coming from because they
  started it. Clips and the toy keep the default, where the sound is a side
  effect of looking at something. And the space bar goes to a player only when it is on
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
  (`.bb-keys`, the games' pause-menu keycap treatment) sit UNDER THE
  PLAYFIELD while the game runs: left edge flush with the bio column,
  centred in the strip between the ball's floor and `.about-sub`. That
  strip is the portrait's overhang and is a steady 54px at every width the
  toy is offered at (1400-2560, measured 2026-08-20), which a 34px row
  clears at both ends, at `opacity:.45` — the row is a reference for whoever
  needs it, not a feature, and at full strength six lit caps competed with
  the one part of the page that is actually moving. They anchored to
  `.about-photo` until 2026-08-20
  and so rendered under the PORTRAIT, one column over from the game they
  label. A / D / Space / Click carry 15px type; the two arrow caps carry a
  solid sideways triangle instead of ← / → — `.bb-key-tri`, an inline SVG
  with `.sr-only` text beside it for the name the character used to say
  out loud. The glyphs are hairlines at every weight the system font has,
  so they read as TEXT sitting in a keycap while the lettered caps read as
  keys; 14px of triangle plus the caps' padding comes to the same 36px
  min-width the letters take from `.bb-key`, so the row stays one set of
  keys. Muted reads muted: the slider
  hides and the speaker takes a 45deg no-sign slash (it was a horizontal bar
  until 2026-08-26, which read as bold rather than as a prohibition).

  **THREE POWERUPS, ONE DROP SLOT.** Only ever one drop is in flight. The
  BOMB is the recurring one, every `DROP_EVERY` (5%) of the wall, and on
  catch it arms EVERY ball immediately — it used to set a `pendingArm` flag
  that the next paddle contact spent on one ball, so the pickup did nothing
  visible until that ball came back down and the second ball never got it at
  all. A charge SURVIVES a miss: `respawn()` deliberately does not clear
  `armed`, because losing a bomb you already caught to a paddle miss is a
  second punishment for the same mistake. The TURRET (`TURRET_AT`, 10%) and
  the two RAPID FIRE pickups (`RAPID_AT`, 50% and 95%) are one-shots at fixed
  marks and take PRIORITY over a bomb when the marks collide — with one slot,
  the rare thing should not be the one that waits. Turrets fire a volley from
  both paddle ends every `TURRET_PERIOD / (1 + rapid)`, so the three rates are
  1x, 2x, 3x; the barrels grow with the rate, which is the only readout it
  has. A rapid pickup with no turret ARMS the turret, since rapid fire with no
  gun is a powerup that silently does nothing. A turret ROUND landing has its
  own sound rather than borrowing the ball's letter blip, which made a turret
  kill and a paddle rally identical. The three drops are told apart
  by SHAPE, not colour — block, one arrow, two — because the field paints in
  the one accent over live text and a dark punch-out would be wrong on a
  transparent canvas. `breakLetter()` is the single place a letter leaves the
  wall; the three callers differ only in the velocity and spin they hand the
  falling glyph. The second ball joins at `SECOND_BALL_AT` 0.15, down from
  0.3. **Every `roundRect` goes
  through `roundedRect()`**: it is Safari 16.4 and Firefox 112, and an engine
  without it does not draw square corners, it THROWS out of the middle of the
  draw — paddle, ball, bomb and veil vanish together and the toy reads as
  broken rather than as unrounded. Audio is the shared Clayweld panel
  (`games/_shared/audio-panel.js`, persisted as `about-breakout-audio`)
  driving synthesized blips through `createBusGraph` — no samples, no
  MediaBus registration for the BLIPS (short fx are not a player and must
  not pause the song bar).

  **A SONG ALREADY PLAYING SURVIVES THE GAME** (2026-08-28). Starting the toy
  used to `MediaBus.solo()`, which stopped whatever the visitor had on — they
  asked to play a game, not to change the music. `MediaBus.busy(who)` is the
  counterpart to `solo`, and when anything else is sounding the toy starts with
  its own chiptune off and leaves the bus alone. The track picker is the way
  back, and `goTo()` turns the music ON for exactly that reason — otherwise the
  picker would change a number and make no sound, with no route to the game's
  own music at all. With nothing playing, the old solo stands.

  **FIVE TRACKS, not one** (2026-08-27): the whole of Juhani Junkala's `5
  Action Chiptunes` pack, picked with a `‹ n / 5 ›` control on the right of the
  keys row under the playfield. The module owns the list, the cache and the
  remembered choice (`about-breakout-track`); `script.js` only paints the
  counter and turns the 0-based index into a 1-based label. **Only the selected
  track is fetched**, and the cache holds the decode PROMISE rather than the
  buffer — caching the result only covers a track that has finished decoding,
  and a 74s MP3 takes long enough that two clicks through one track fetched it
  twice, which is what the picker test caught.

  **The music runs through a fixed `MUSIC_TRIM` of 0.7** under the slider.
  Measured offline, the bed peaked 0.155 against a turret shot's 0.040 — the fx
  were a quarter of the thing they had to cut through. The shared `DEFAULTS` in
  `games/_shared` belong to Arena 1 as well and are not this toy's to retune,
  and moving the slider's default would only move the number the player sees;
  this is a mix decision about this game's own bed, so it sits on this game's
  own node. After it: shot 0.151 and turret impact 0.160 against a music peak
  of 0.109.

  **The bomb is the one fx with a shape worth
  knowing**: one noise buffer split into a highpassed CRACK (0.14s) and a
  lowpassed RUMBLE sweeping 1800→90Hz (0.85s), plus two sine drops for the
  body. Rendered offline it peaks about 4.6x the letter blip with ~3x its
  high-band energy; the first version was a 0.3s lowpassed knock that
  measured x1.68 with LESS high content than the blip it landed on, and was
  inaudible in practice. An armed hit plays the explosion INSTEAD of the
  letter blip, not on top of it — but the MUSIC is a player and registers:
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
  - `.title-mark` / `.title-icon`: **PARKED (Dex, 2026-08-24) - the rules are
    live but match nothing.** COLLAB and IDEA VAULT wore grey marks hung in
    the section's left padding for a day; the two `<h2>`s have since lost
    their `title-mark` class and their `title-icon` span, and re-adding either
    span is the whole of restoring it. Likeliest return is when COLLAB earns
    its nav link. `assets/icons/vault.svg` (a side-view brain facing RIGHT,
    stem left, folds cut out with an SVG-internal `<mask>`) stays with them,
    and `collab.svg` is wanted regardless by the dormant nav link. Same
    park-don't-delete shape as the portrait state in `script.js`
  - `.about-flags` / `.about-flag`: the three marks at the top right of the
    bio — US flag, Colorado flag, and a travel icon (`assets/icons/travel.svg`,
    baked like any other mask). The class still says "flag" because it is a
    size-and-colour rule and the third mark wants exactly the same one;
    accent-tinted through the same `.icon` mask. They sit in the About
    section's own right padding rather than inside the copy column - the
    pocket between the nowrap h2 and that column's right edge is ~55px at 1440
    and the heading runs into it. **The gutter is the ceiling on their size**:
    52px clears it only above 1100 (where `--gutter` is 123-161px); under that
    it drops to `clamp(28px,5vw,60px)` and the flag tracks it as
    `clamp(20px,3.8vw,44px)` rather than taking a second fixed size that would
    be wrong at one end of the range. Under 760px they come
    inside and ride the eyebrow's own row side by side, which is the only line
    in that column with space to its right. Each carries a `data-tip` ("US
    Based", "Born Colorado") with `data-tip-pos="right"` - the shared tooltip's
    one placement option (the DEFAULT is BELOW the target now, flipping above
    only when the window bottom is close — above used to be the default and
    covered the title and the line under it on a picks card, which is the text
    someone is reading when they go hunting for an icon's name): beside the
    mark and centred on it,
    right if it fits and left if it does not, with the default above-placement
    kept only as a last resort. In practice it flips left on most screens:
    measured at 1440 there are 81px between the flags and the window edge
    against a 104px "Born Colorado". The `aria-label` carries the same words,
    so the meaning does not depend on a hover. The travel mark's tip is the
    first MULTI-LINE one (three lines): a newline in `data-tip` (`&#10;` in the
    attribute) is the whole opt-in, and `show()` sets `#tip.is-multi` from the
    text rather than from the element, which is what keeps every other bubble
    `nowrap` — a long single-line label must never fold itself. It shows postcodes
    because the bubble is a 12px label in a margin and five state names would
    outrun the column beside it; the `aria-label` writes them out. They STAY UP while Breakout
    runs (2026-08-26). They used to hide off `.bb-ui.bb-playing ~
    .about-flags` because `.bb-stack` is also `left:100%` — same column,
    different strip: measured at every size the toy is offered (it gates
    itself off below about 1500x900) the flags are y 110-224 and the stack
    y 368-524, and the overlap is zero. Sources are `assets/icons/flags/*.svg`, picked up by
    `bake_icons.py` like any other mask - the flag detail is cut into one
    path, so a single-colour mask keeps the stars, stripes and bands
- Root wrapper folders `surveyor/ chomp/ arena1/ stickland/` — thin pages
  that iframe `/games/<name>/index.html`, focus the frame (so Escape/WASD
  reach the game), forward the query string, and leave the game on refresh
  (`refresh-home.js`, external file because CSP bans inline). All URLs
  root-absolute: Vercel serves both `/name` and `/name/`
- `mindsplit/` — Vite build **output** served directly (source at
  `ai/apps/mindsplit/`; the one build-step exception). `ai/apps/` contract is in
  its README
- `themedock/` — the ThemeDock preview, opened by the AI Lab card's eyeball into
  the app overlay (`data-app-shape="window"`). `panel.css` is the extension's
  own stylesheet vendored in unmodified, `window.css` is the mock VS Code around
  it, `themes.js` is ten themes read out of the real sources, and `demo.js`
  drives both. Every colour is a `--vscode-*` custom property set on `.vsc` at
  runtime, which is the same contract a webview gets, which is what lets the
  vendored stylesheet work unshimmed.

  **ONLY THE PANEL IS LIVE, AND THE REST NOW SAYS SO.** A full fake window
  invites clicks on the tabs and the code, and it was getting them. The dead
  half is marked by a single diagonal hatch — `.vsc-dead`, ONE element over the
  whole window with the panel punched out of it by a `clip-path`, because
  separate elements per region do not line their diagonals up at the seams and
  the mismatch reads as a rendering fault. The punch-out's corners are measured
  off the panel's own `getBoundingClientRect` and kept current by a
  `ResizeObserver`; restating `.vsc-mid`'s grid in the clip-path would be a
  second copy of the geometry to drift, and a few pixels either way is hatch on
  live UI or a bare stripe down the seam. Measured at 0.000px of corner error.

  **The three chrome regions keep their fill and the code area does not.** The
  title bar, activity bar and status bar are the extension's paint targets —
  recolouring them IS the demo — so they get hatch lines and nothing that mutes
  the colour. The tab row and the code demonstrate nothing, so they take a wash
  as well, sized to the editor's box from the same measuring pass.

  **The hatch ink is the chrome's own text ink**, `luminance > 0.42 ?
  '#15181d' : '#ffffff'`, the same expression and the same value rather than a
  parallel one — verified to agree with `--td-title-fg` on all twelve swatches.
  A fixed neutral dies in the middle of the range: the lime sits at 0.4296 and
  the green at 0.367, so the two of them want opposite inks. With no swatch
  worn the same expression runs against the theme's own title bar instead.

  **The wash goes AWAY from the editor, not toward it.** "Dim" reads as
  "darken", and a dark wash over a near-black editor moves no pixels — and then
  the dark ink on top of it could not be seen either, both halves failing in
  the same place for the same reason. Less contrast is what dimming means, and
  that direction is away from whatever is already there: pale over dark code,
  dark over light.

  The hatch is a sign, not a fence, so the fence is separate and real —
  `pointer-events: none`, `aria-hidden="true"` and `inert` on all five dead
  regions, with `tabindex="-1"` under `inert` for anything that predates it.
  Verified by tabbing rather than by eye: 28 stops, every one of them a panel
  control, and `.focus()` called directly on a dead element leaves the
  activeElement on `body`. **No animation** — moving dashes would make the dead
  zone the most active thing in the frame, which is backwards, and
  `prefers-reduced-motion` is moot only for as long as that stays true.

  **The hatching can be switched off** — the switch is labelled *Overlay*,
  because the word people reach for is the thing on top of the window rather
  than the name of the pattern it is drawn with — and it is the ONE live control
  in the dead half — a child of `.vsc-editor`, which is neither `inert` nor
  aria-hidden, so it clicks, tabs and announces normally while everything
  around it does not. demo.js centres it in whatever empty space is left below
  the last line of code, measured off that line's own box: `scrollHeight`
  cannot answer this, being defined as at least clientHeight, so it reports the
  container's height exactly when the content does not fill it, which is every
  case that matters. Under ~70px of clearance it parks above the note instead.
  It turns off the HATCH ONLY — the wash, the note and the `inert` stay, because
  the region is still dead and the switch is labelled Hatching. **Below 760px
  the editor is `display:none` and the switch goes with it**, so the direct page
  on a phone has hatched chrome and no way to unhatch it; the overlay itself
  never opens under 768px, so this is a fallback path rather than a live one.

  **Its fill is the ink's OPPOSITE pole**, which is what makes its outline mean
  anything. The outline is the hatch ink — it is the control for that ink, so it
  wears it — and the first cut filled the pill with the editor background, which
  worked until the two poles met: GitHub Light wearing a dark swatch gives a
  WHITE ink on a near-white editor and the pill came out with no edge at all.
  Filling with the other pole makes the edge contrast by construction rather
  than by luck, out of the same two values the chrome's own text is picked from.
  The switch inside uses `--wc-fill`/`--wc-on-ink`, the panel's own accent,
  because `tuneAccent` already guarantees that clears 2.2:1 while the hatch ink
  would be invisible half the time.

  **The default is Solarized Dark wearing `#074b73`**, in custom slot 0 rather
  than in the twelve-swatch palette — the custom slots are the half of the panel
  nobody discovers by looking, so it opens with one filled and worn.

  **State is remembered for the session and not one second longer.** Reopening
  reloads this page (the site blanks the iframe to `about:blank` on close), so
  the panel used to reset every time; what should survive is the trip out and
  back, and what should NOT is a reload of the site, or a preview never shows
  anyone the default. The slot is a property on the PARENT window, which
  outlives this document and dies with the page around it. **sessionStorage is
  the reflex here and it is wrong** — it survives a refresh, which is the one
  thing that has to clear it; localStorage is wronger still.

  The window is **960x875**, down from 1400 at 16:10. At 1400 the editor column
  was 1052px wide against a 518px widest line: 45% of the frame was empty code
  area, which is both nothing to look at and a lot of surface inviting a click.
  612px of editor leaves the gutter, the widest line and the right padding
  fitting in 580 with nothing wrapping; below about 940 the longest line
  clips. The HEIGHT is deliberately unchanged — the panel's own content is
  714px against a 786px scroll box, so any trim there starts scrolling the one
  live thing on the page. The size lives in `styles.css`'s
  `[data-shape="window"]` rule (the shape ThemeDock is the only user of) and in
  `window.css` for the free-standing page, and the two have to move together.
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
- `games/_shared/audio-panel.js` — the mixer every game and the Breakout toy
  share: master/music/fx, a row per channel, levels persisted per game.
  `createMasterCascade()` wraps the settings object so a mute drives its own
  fader to zero rather than leaving it at 30% over silence, master takes all
  three down with it, and turning anything back on restores what was there —
  including the rule that a channel you switched off YOURSELF stays off through
  a master cycle. It lived as byte-identical private copies in Chomp's and
  Surveyor's pause menus while Arena 1 had none, which is where it was noticed
  missing; three copies of a mixer is the exact failure that module was
  extracted to prevent, and it should not have been three copies of the cascade
  either. **Both copies claimed the stays-off rule in a comment and neither
  implemented it** — `restoreChildren` woke any child sitting at zero, which is
  every child. Writing the sentence down as a test rather than as a comment is
  what found it.
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
  the region, and now what is FILLING THE FRAME — because four frames
  captioned "Jet" once shipped showing a rover, and nothing noticed. The third
  of those is Arena 1's: "Ground level — looking up" shipped with a pink
  crystal across the right half of the picture, which the vehicle and altitude
  guards both passed because neither is about what the shot is OF. A grid of
  336 picking rays measures how much of the viewport is something within 18m,
  and the shot is refused if one object holds more than 12% or everything near
  holds more than 18% (`maxNear` / `maxClutter` in `arena1/dev/gallery.mjs`).
  The predicate is what makes it work at all — Babylon skips `isPickable:false`
  meshes unless one is given, and the crystals are exactly those. The same file
  now also WALKS somewhere first: floor positions are scored by the elevation
  of the tallest thing near them, so the frame starts from open ground instead
  of from wherever the floor fight ended. `--only <text>` runs one named shot
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
that is not built yet should cost a rule's height, not a panel. The whole
strip carries `opacity:.5`, type and tape together rather than a greyer
text colour: the words and the tape are one sign, and at full strength the
line read brighter than the sections that have real content in them. The
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

### The keypad clears when the code lands, and nothing scrolls

Two bugs that looked unrelated and were not: both came from doing keypad
teardown in the wrong place.

**The code used to survive being accepted.** `createKeypad` cleared its boxes on
a wrong code but not on a right one, leaving that to `bindModal`'s `onClose`.
That teardown deliberately does not run when one overlay hands off to another —
see the paragraph above — and opening a door IS that hand-off, so the boxes were
never cleared at all. Walking back to either keypad after closing the overlay
showed the code still sitting in it for the rest of the visit. `attempt()` now
clears on the success branch, next to the two refusal branches that already did.

**And closing an overlay used to scroll to the Idea Vault.** `reveal()` handed
every door `pins[pins.length - 1]` — the vault section's last box — as the
element to restore focus to, whatever had opened it. Restoring focus there fired
the pins' own `focus` listener, which bounces focus to the first empty box, and
that call had no `preventScroll`. So closing an overlay opened from the tilde
keypad walked the page down to the vault from wherever the reader actually was.
`reveal(payload, secret, from)` now takes the opener: the section's keypad
passes its own box, the tilde keypad passes whatever had focus when \` was
pressed. Every focus call inside `createKeypad` carries `preventScroll` as well,
because that listener fires on focus the code did not ask for.

**That fix was half of it.** `relock()` still called `keypad.reset()`
unconditionally, which parks focus in the vault's FIRST box after any overlay
closes. The ` shortcut then correctly refuses to fire — something is being typed
into — so the next ` went in as a character, and typing into a focused input the
reader cannot see scrolls it into view. Same symptom, different cause, and only
ever on the SECOND press, which is why the first fix looked complete.
`reset(moveFocus)` now leaves focus alone unless it is already in these boxes,
which it is exactly when the section's own keypad opened the overlay.

Worth stating plainly because it cost a round trip: `preventScroll` could never
have fixed that one. The scroll came from the keystroke, not from the focus.

`music_check.mjs` parks the page at 900px before typing the code and asserts the
scroll position is unchanged through opening, entering and closing — the bug is
invisible from the top of the document, which is where a harness starts — and
then presses ` a second time and asserts it opens the keypad rather than typing
a character into the vault.

## The image pipeline (full rules in CLAUDE.md — the short version)

Masters under `assets/`, derivatives generated into `assets/derived/`
mirroring the master's subfolder. Adding an image = drop the file + one
`<!-- img src=… slot=… alt=… --><!-- /img -->` directive; the pre-commit
hook bakes and fills in everything (`<picture>`, srcsets, `sizes`,
dimensions). Never edit inside the markers, never type width/height, never
build a derivative URL in JS. Ladders/`sizes` live per-SLOT in
`image_slots.py`. AVIF q58 / WebP q76. Budget: ≤150 KB per **served AVIF** on
the wire, hero LCP < 1.2 s on cold 4G — the AVIF is what a modern browser
downloads, and the WebP fallback is reported by `--check` but never gated on.
The two blocking checks:

    python tools/bake_images.py --check
    python tools/bake_markup.py --check

## Call flow at page load

Reload → scroll-to-top + hash strip (except `#resume`). Accent picker builds
and applies the stored accent before first paint matters; reveal/scroll-spy/
parallax bind; remaining IIFEs run inline. On `load`: re-measure, hand the
URL to the scroll spy, then idle-warm the other six mascots one accent at a
time via `probeMascot`.

## Animating a box: nothing inside it may resolve its own height from it

A panel that opens by animating its own height — a `0fr -> 1fr` grid track, a
clip, a max-height — is animating the number its contents are laid out against.
**Anything inside that works out its own size from the parent's current height
gets its motion for free from the layout engine, on a schedule nobody chose.**

This is the one that does not look like itself. Every symptom says timing, so
every instinct says easing, and the timing is fine: when the sidebar profile was
stepping badly enough to read as unfinished, the whole toggle was already five
transitions, all 240ms, all on `--sidebar-transition-ease`, all starting on the
same frame. There was nothing to stagger and nothing to slow down. The raggedness
was coming out of flex and min-height.

Three shapes, all of them found in that one panel:

- **A flex child shrinks by default.** `.profile-mini` is a flex column, so while
  the wrapper's track was short every child was being squashed and let out again
  as it grew — and flex distributes shrinkage against each child's own
  min-content floor, so they come off their floors at different points in the one
  motion. Measured: `.profile-copy` and `.profile-extra` sat pinned at their
  collapsed floor for the first 144ms of 240 and then did all 45px of travel in
  the remaining 96. `.social-mini` travelled 90px up and then 20px back down —
  a direction reversal, which is the most conspicuous thing a moving element can
  do. Fix: `flex:none` on the children, so the block holds its final layout the
  whole way and the clip is the only thing that changes.
- **A floor that snaps against a track that interpolates.** `min-height:136px`
  flipped to 0 with the class while the track it floors eased from `0fr`, so the
  first 40ms of every expand ran underneath a box that was already 136px tall and
  nothing moved at all; the box did not start travelling until 72ms in, a third
  of the way through. A floor has to be out of the way for the WHOLE transition,
  not just at the end of it.
- **A sibling that is not transitioned at all.** `.profile-compact`, the 52px
  stand-in row, arrived at full opacity on the frame of the press: the footer
  jumped 47px before the collapse had run a millisecond, and for that frame the
  rail carried two portraits and two copies of the name.

So, for anything that opens or closes by animating its own box:

1. **Take the contents out of the calculation.** `flex:none`, an explicit size,
   anything that makes the inside independent of the outside. If the content
   reflows during the motion, the motion is not one motion.
2. **Every property that changes with the class must interpolate.** The frame the
   class flips on is a separate measurement from the transition, and an
   untransitioned property snaps there where no amount of looking at the
   transition will show it. It is also what breaks reversibility: a transition
   restarts from the value it is currently at, so if nothing snaps from a settled
   state, nothing snaps mid-flight either.
3. **Reveal direction is a decision, so make it.** `justify-content:center`
   inside a box that is animating to zero puts half the content outside the clip
   and reveals from the middle outwards. `flex-start` reveals top-down, which is
   the direction this block grows.
4. **Check the resting states before shipping a flex change.** These are layout
   properties being changed for motion reasons, and the MD that asked for the fix
   forbade a layout change. Diff every box in both directions of every state —
   the fix above is zero-difference everywhere visible, and that is a measured
   claim, not a hopeful one.

Measuring it: do NOT sample with `requestAnimationFrame`. Headless Chrome paints
only on demand, so a 240ms transition lands in about four samples. Pause the
`CSSTransition`s from `document.getAnimations()` and step `currentTime` in slices,
reading computed style and shooting a frame at each. That also gets you the
inventory — every element, property, duration, delay and easing the one state
change started — which is the first thing to look at, and which is what said
"timing is not the problem here" in under a minute.

## Writing a checker: count the subject, assert the count

Every check in this repo answers a question about a set of things it had to go
and find — masters under `assets/`, derivative references in the markup, shader
bodies in a source file, worlds in a system. **The failure that matters is not a
wrong answer. It is an empty set.**

A checker that discovers nothing does not fail. It examines nothing, finds no
problems, prints whatever it prints when all is well, and exits 0 — which is
byte-identical to a clean run. **A pattern that silently matches nothing looks
exactly like a pattern that matches everything and passes**, and it is worse
than having no check at all, because it buys confidence nobody earned.

This has now happened four times in this repo, three of them in one afternoon:

- `games/surveyor/dev/glslcheck.mjs` scanned none of `COMMON`, `HAZE` or
  `svFarBodyFragmentShader` — its regex only knew one declaration shape — and
  reported clean while a live break sat in one of them.
- `arrivecheck`, `disccheck` and `lodcheck` each end in `exit(bad ? 1 : 0)` and
  print a positive claim in words. `lodcheck` had been observing **zero** of the
  handoffs it exists to measure, for its whole life, while printing that the
  handoff was clean.
- `tools/bake_images.py --check`, which CLAUDE.md names as a blocking gate,
  printed "all derivatives present and current" over an empty walk.

So, for anything new that checks something:

1. **Count what you examined** and put the number in the output, pass or fail.
   `bake_markup --check` has always done this — "70 image block(s) current, 514
   derivative(s) referenced" — and is the model.
2. **Assert the count against an expectation**, not against zero. `bodies.length
   > 10` passed on seventeen while three were missing; a loose bound is
   decoration. Where there is no fixed expectation, derive the same number a
   second, independent way and require the two to agree.
3. **Never let a positive claim be reachable with an empty subject.** If the set
   is empty, that is the failure — report it as broken discovery, which is what
   it is, and not as a clean result.
4. **A loop that emits checks emits none when its subject is empty**, so the
   suite total silently drops and everything still passes. Assert the size
   before the loop.

## Commit hooks

Three of them, installed together by `python tools/bake_images.py --install-hooks`. One
installer on purpose: CLAUDE.md and docs/ONBOARDING.md both send a fresh clone there, and a
second installer script is a second thing to remember and the one nobody runs.

`post-commit` rebuilds `context-pack.zip` in the repo root — the artifact a new AI session
is started from — and writes `.context-pack.stamp` naming the HEAD it packed. It runs AFTER
the commit because the instant after a commit is the one moment the tree is reliably clean,
and clean-or-dirty is a line in the pack's own build stamp. It cannot fail the commit, so a
failure is loud; `tools/check_pack.py` on the next `pre-commit` is the backstop, refusing a
commit whenever the stamp names a HEAD that is not the current one. Absent is allowed (a
fresh clone has not run the hook); present-and-wrong is not, because a session pastes a
stale pack and works confidently from a state that no longer exists. `check_pack --cases`
drives the same `verdict()` the hook calls through seven states, three of which must refuse
— a freshness check that cannot fail is the exact shape this repo has shipped four times.

`pre-commit` runs that freshness gate first, before anything about what was staged, since
every commit moves HEAD. It is silent on pass. Then (only when
rasters/markup/palette/script.js are staged):
`check_accents.py` → `check_cursors.py` → `check_markdown.mjs` → bake images
→ bake markup → `bake_markup --check`. The markdown check needs node, and its
browser half needs Chrome; both degrade to a printed notice rather than a
block, since a hook is convenience and the check is the guarantee.
Stages `index.html` **whole**, but derivatives only for the masters in the
commit — `bake_images.py --derived-for` maps one to the other. It used to
stage `assets/derived/` whole, and because the bake is repo-wide that pulled
in whatever another session had left unbaked; two commits on 2026-08-20
carried a third party's derivatives that way, master not included. The
markup bake is likewise gated to ITS OWN triggers (index.html/slots staged,
or rasters staged) — it used to run whenever ANY trigger fired, and on
2026-08-20 a palette check on script.js tripped it while another session's
re-exported masters sat unbaked: it restamped their blocks and staged the
page whole into `e8645cd`, publishing new `?v=` stamps over old immutable
bytes.
`commit-msg` → `check_scope.py`: a commit may not span "projects" (each
`games/<name>`, each other top-level dir, the repo root as one unit) unless
the message carries a `Spans:` line naming every one. One exemption:
`assets` + root-`index.html` only (the documented add-an-image flow).

Then `check_sweep.py`, which catches the opposite accident: a commit that stays
inside one project and carries a SECOND session's work out with it, because a
file both were editing got staged whole. Three rules now, all sharing one
shape — the hook does something after you staged. Markup pointing at an
`assets/derived/` file the commit does not contain is refused outright — that
is `b6ba02f`, which published a `<picture>` whose 1920 rung was in no tree at
all. A `?v=` RESTAMP on a derivative whose bytes the commit does not carry is
refused just as outright — that is `e8645cd`, where the file existed in HEAD
so nothing dangled, but the new stamp promised a new bake over year-immutable
old bytes; both incident commits are kept as `--commit` regression cases. A
region of a root file or an `ARCHITECTURE.md` whose identifiers appear
nowhere in the message is refused with a `Carries:` escape hatch; usually the
right answer is a sentence in the message instead.

That last rule went SILENT on the shape it exists for, and the miss is worth
more than the rule: `ba546b6` carried this file's whole NodeBlast gallery
paragraph out under a `.bb-keys` subject, and the check passed it. Not the
adjacency limit below — the region split correctly and was measured and kept.
It died at the last gate, on two coincidences, because ONE shared word was
enough to excuse a region: `sign`, a piece of the region's `sign-in`, against
a message using "sign" about the UNDER CONSTRUCTION sign; and `nodeblast`,
a piece of `nodeblast-alchemists`, against the one sentence in that message
saying it was deliberately NOT committing the NodeBlast work. So a whole
identifier now excuses a region outright, a PIECE of one takes two agreeing
(`FRAGMENTS_NEEDED`), and a disclaiming sentence lends no words at all
(`DISCLAIMER_RE`) — this repo's conventions ask for disclaimers constantly,
which made them a standing source of false excuses. Re-measured over forty
commits: it fires twice, on `ba546b6` and on `dafb908`, whose message says
"icon span" about a `btn-icon` region. One in forty, against an agreed price
of about one in ten (revisit past one in five).

Every incident is now an assertable case rather than a paragraph:
`python tools/check_sweep.py --cases` re-runs all four refusals and four
controls through the same `run_commit()` the hook uses. A checker that buys
confidence has to be checkable — three separate checkers in this repo were
found reporting clean while observing nothing on 2026-08-20 alone.

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

## The yin-yang mark

`assets/icons/yin-yang.svg`, baked into `styles.css` like every other icon and
placed twice: `.about-yin`, enormous and at 5.5% behind the About section with
about a third of it past the right edge, and `.footer-yin`, 46px and centred on
the footer bar. Both are `.icon` spans, so both retint with the accent picker
for free.

**While Breakout runs the mark goes IN FRONT of the playfield** —
`.about.bb-live .about-yin{z-index:1}`, the class set by `script.js` on start and
cleared on stop. The game hides a broken letter by painting the first OPAQUE
background above the paragraph, this section's `#0b0e11`; once the mark sat
behind the bio the real ground under a letter became that colour PLUS a 4.5%
tint, so every patch came out a shade dark and the wall filled with rectangles.
Raising the mark over the canvas makes the patch correct by construction —
`#0b0e11` is exactly right underneath, and the tint then passes over patch and
untouched ground alike. z-index 1 clears the canvas (positioned, auto) and stays
under `.bb-stack` / `.bb-keys` at 2, which are controls and must not be washed.
Fading the mark out for the length of a game was the other option and throws the
art away.

**Two rules keep the big one working and neither is obvious.** It is cropped by
`body{overflow-x:hidden}`, NOT by an overflow on `.about` — the country flags
sit out in that section's right gutter and a clip there would eat them. And it
sits at `z-index:-1` under `.about{isolation:isolate}`: the isolate is what
gives the negative index a stacking context to be negative INSIDE, so the mark
lands above the section's own `#0b0e11` and below every piece of content.
Without it the nearest context is the root and the mark disappears behind the
section background — which looks exactly like the mark not being there at all.
Doing it this way means no content block needs a z-index of its own; the two
things already positioned in there (`.about-flags`, the breakout game's
`.bb-keys`) are both inside `.about-copy` and are untouched.

## Numbers

7 accents (lime default) · 12 ladders / 19 slots in `image_slots.py` ·
106 generated markup blocks in index.html · 343 gallery pieces in
`work.json` · fallback ladder
1600/1200/900/600/400/200 · cache stamp = 8 hex of sha256(master) ·
`styles.css?v=` / `script.js?v=` bumped by hand.

### Aiming a cover-crop (`tools/focal_point.py`)

The featured card and the filmstrip thumb are both `object-fit:cover` in a
LANDSCAPE box (about 1.175:1 and exactly 1.5:1) and most of this art is
PORTRAIT, so the default centre crop takes the head off every standing figure.
The module measures the variance WITHIN each row and column of a 240px
thumbnail, takes the first row that reaches 22% of the strongest as the top of
the subject, and puts the crop window just above it.

Three things it deliberately does not do, each because measuring said so:

- **It does not compare pixels to a background colour.** That version found
  figures on flat dark plates and missed three of the four reported cases,
  because a graded plate is a different colour on every row while staying flat
  across each one.
- **It does not gate on "is there an empty plate".** Of the fifteen
  vertically-cropped card frames, aiming at the subject's top is right on
  fourteen; the gate refused to move eleven of them. The one it costs is an
  interior, and that takes a `pos` override in `work-index.json`.
- **It does not aim horizontally.** No landscape frame had a framing problem,
  and the rule produced two crops worse than the centre they replaced.

`y` is clamped to 0.5, so this can only ever raise a crop toward a head, never
push one below where the browser would have put it. Results are cached in
`work.json` against the master's content stamp AND `focal_point.VERSION` —
without the version, tuning a constant would leave every cached position stale
while `--check` reported the manifest as current.

## Live notes overlay (`/#notes`)

A private, password-gated editor for the WorldHop notes. No control anywhere on
the page opens it -- the address is the only way in.

```
index.html   #notesModal: one dialog, two panes (keypad, then editor)
script.js    createKeypad() . the notes block . editing . caret correction
styles.css   .notes-* for the shell, .nv-* for the document itself
api/notes/unlock.js   POST {password|token} -> {content, token, savedAt}
api/notes/save.js     POST {token, content}  -> {savedAt, backups, token}
lib/notes-store.js    blob I/O, scrypt password check, HMAC session tokens
lib/notes-seed.js     the starting document, server-side only
```

**The password is checked on the server, and that is the whole point.** The Idea
Vault higher up the page ships ciphertext and decrypts it in the browser, which
is right for something sealed once; these notes are edited daily and cannot be
re-sealed on every keystroke. So nothing about them -- not the text, not its
length, not whether anything has ever been saved -- reaches the browser before
`/api/notes/unlock` returns 200. `tools/notes_check.mjs` asserts that by
scanning every response body the page received after a wrong password.

**Storage is Vercel Blob, `access: 'private'`.** A public blob has a URL, and a
fixed pathname plus a store id is one guess away from being the leak the feature
exists to prevent. `notes/current.html` is the document; `notes/backups/<iso>.html`
is one copy per save, newest 20 kept. Pruning counts what is actually there and
deletes the surplus rather than deleting one per save -- a count that drifts
silently is a count nobody can restore from.

**Tokens are stateless**: an expiry, plus an HMAC of it keyed by
`NOTES_PASSWORD`. Nothing to store, which matters when every request may reach a
different instance; and changing the password invalidates every live session,
which a separate signing secret would not do. Every save returns a fresh one, so
a tab open across a working day never hits the wall mid-sentence.

**Setup.** Two environment variables, both set in the Vercel project:
`NOTES_PASSWORD`, and `BLOB_READ_WRITE_TOKEN` (injected automatically when a
Blob store is connected under Storage). Without either, both routes answer 503
and the keypad says NOT SET UP rather than pretending the password was wrong.

### The document is CSP-safe markup, not the pasted HTML

The notes arrived as a standalone file: a `<style>` block, `style="color:#hex"`
on every heading and list, and a sidebar of `onclick="...scrollIntoView..."`
links. The site ships `script-src 'self'` and `style-src 'self'` with **no**
`'unsafe-inline'`, so pasted verbatim that renders as an unstyled wall of text
with a dead sidebar. Loosening the CSP for one private overlay was the wrong
trade, so the content was converted instead: styles became rules, colours became
a `data-accent` token per `<section>`, the sidebar became something `buildRail()`
builds from whatever sections exist, and the nine SVG icons came through
untouched (presentation attributes are not inline styles). 127 list items were
asserted identical, word for word, before and after.

Stored content is re-checked through an allowlist on every render, and pasted
HTML goes through the same one. Unknown tags are UNWRAPPED, never dropped: a
paste from a web page is far more likely than an attack, and deleting the words
inside it would lose real notes.

### Editing

Everything goes through `document.execCommand`, deliberately. Hand-rolled DOM
edits are invisible to the browser's undo stack, so Ctrl+Z either does nothing
or reverts to a state that never existed; rebuilding undo on top of them means
snapshotting the document on every keystroke. It is deprecated in the sense that
no new features are coming, not that it is going away.

- **Tab / Shift+Tab** indent and outdent, one bullet or a whole selection.
  Always consumed while the caret is in the document, even where there is
  nothing to indent -- a Tab that does nothing is a small disappointment, a Tab
  that reaches the browser's own tab cycling loses the caret and the reader's
  place at once.
- **Backspace at the very start of a bullet** unwinds before it merges: nested
  steps out a level, top-level becomes a plain line, and only a plain line
  merges upward.
- **Ctrl+B/I/U**, **Ctrl+Y** (Chrome does not bind redo inside a
  contenteditable), **Ctrl+S** to save now rather than save the web page.
- **`- ` or `* ` on an empty line** makes a bullet. The marker is removed with
  `execCommand('delete')`, not a range operation -- the first cut used
  `deleteContents`, which the undo stack never saw and which left the selection
  pointing into a text node it had just emptied, so `insertUnorderedList`
  silently did nothing.
- **Enter on an empty bullet** steps out a level.
- `indent`/`outdent` re-wrap the moved text in a `<span>` carrying its computed
  colour. Here that colour is the section accent, so the wrapper freezes the
  wrong one and puts an inline style into the saved document;
  `unwrapCommandSpans()` strips them immediately.

### The click-past-the-end bug

Clicking in the empty space right of a bullet should put the caret at the end of
that line. It does -- **unless the bullet also contains a nested list**, and then
Chrome's `caretRangeFromPoint` returns offset 0 of the line's first text node.
Measured on this document: `Coop` (no nested list) gives 4, the end of its text;
`Creatures` and `NPCs` (nested `<ul>`) both give 0. Dragging from there therefore
selects from the beginning of the line, which was the reported symptom on the
reported bullet.

A drag anchor is fixed at mousedown, so correcting afterwards is too late.
`correctedCaret()` recomputes the position, and on the affected shape ONLY --
when Chrome's answer and the corrected one actually differ -- the default is
prevented, the caret placed, and the drag extended by hand from the same
function. Every other click is left entirely to the browser.

## Music overlay (code `MUSIC`)

A playlist of 311 YouTube links behind the same door as the notes: type `MUSIC`
into the tilde keypad or the Idea Vault. Not in the nav, not linked anywhere.

```
tracklist.txt            the master. one line per track: Title|Artist|URL[|R]
tools/bake_music.py      the only writer of the manifest. --check, --cases
assets/music/tracks.json generated. {count, tracks:[{t,a,u,v}]}
index.html               #musicModal: head, rail, list, player bar. NO ROWS
script.js                initMusic() - below MediaBus, see why in its header
styles.css               .music-*
tools/music_check.mjs    241 checks in a real browser, serves the repo itself,
                         reaches NO network — the embed is intercepted
tools/music_flag_check.mjs  15 checks that DO reach YouTube: a real embed
                         refusing a real video, over https, see below
tools/music_probe.mjs    asks YouTube whether every link still plays. --cases
```

**The row is a five-column grid**: a tick, a play button, the title over the
artist, the link with a copy button on the end of it, and a flag. The two thin
columns are fixed 40px squares so they line up down all 311 rows however long a
title runs — `music_check.mjs` asserts that by measuring the column edges on the
longest-titled row against the shortest, which is the only pair where a column
that tracks its content instead of the grid would show up. The flag column is
measured the same way and for a sharper reason: it is EMPTY on almost every row,
so the cell has to be in the grid from the start. A column that appeared the
first time a track failed would re-lay-out all 311 rows under the reader.

**Everything here is sized larger than the site's own chrome, on purpose.** This
is a list read at arm's length and scrubbed through with a pointer, not a
caption: 19px titles, 15px artists and links, 44px transport buttons, a 52px
primary. `music_check.mjs` holds 20 measured size FLOORS for exactly this
reason — every one of those numbers was smaller once, and each is the first
thing a tidy-up reaches for. They are measured in the browser rather than read
off the stylesheet, because a rule that loses to a later one still looks right
in the source.

**The bar is permanent while the overlay is open**, not something that appears
once you have found a track to click. That needs a real idle state: `#musicScreen`
is one box that holds the embed when there is one and a play glyph when there is
not, at the same size either way, so starting a track does not resize the row it
sits in. The now-playing line names the queue instead (`311 in ALL`). Stop
returns to that state rather than putting the bar away.

**Press play with nothing playing and something starts.** With shuffle on that
is a random track that is NOT the one `music-last` names, so two presses running
cannot serve the same song; with shuffle off it is the top of the list, which is
the only answer that is not a surprise to someone who turned shuffle off. An
earlier version resumed the last played track and that was wrong: in a shuffled
list of 311, the same song every session reads as a broken button.

**The playing track has to be findable**, which is three things and not one.
`showRow()` scrolls it into view when it is not already (via `scrollTop`, never
`scrollIntoView`, which would walk up to the page behind the dialog); the row
carries an accent tint and an inset edge loud enough to pick out while scrolling
past; and `#musicMark` is a tick on the scroll track at `(index + 0.5) / length`
of the way down — the only one of the three that can be seen from anywhere in
the list.

### A track that will not play

**An unplayable video posts `{"event":"onError","info":<code>}` and then nothing,
ever.** The handler read `info` as a player state, and 150 is not 0, 1 or 2, so
every branch fell through: no error, no advance, no message. The playlist stopped
on a song that was never going to start, which is indistinguishable from a broken
Next button. Found by listening, not by any gate here (Bohemian Rhapsody,
2026-09-05). `onError` is now read BEFORE the state, because an error and a state
are both a bare number in `info` and cannot be told apart by shape.

**`refused(code)` marks the track, then moves on.** The mark is the point: a
silent skip past a song someone deliberately put in the list is the same bug with
better manners. It steps with `step(1)` and never through the ended path, because
repeat-one on a dead track is the infinite loop the whole function exists to
avoid.

**The mark is a red flag in the last column, and it is per browser.** `music-flags`
in localStorage, `[[v, code, at], …]` — triples rather than objects because 300 of
them would be a lot of repeated key names in a value rewritten on every failure.
It is NOT baked into `tracklist.txt`: a video blocked in one country plays in the
next, and one visitor's answer must not take the track away from everybody. Red
and not the accent — it is the one mark in the overlay that is not decoration, and
an accent would make it another themed tick. The tooltip is the `loud` kind and
carries what happened, why and when, plus how to clear it; clicking the flag
clears it, or a mark could only ever be set and would become a column nobody
trusts.

**A SECOND dead track in a row reports nothing at all**, and that is measured. The
first bad video navigates the iframe and posts `onError`; every track after it
arrives by `loadVideoById` on a player already sitting in an error state, and that
player stays silent — so a list with two dead tracks stalled on the second one,
the same bug one song later. Re-navigating the frame would get a fresh player and
a fresh error and is the WRONG fix: the navigation that permits sound is the one
made under the opening click. The answer is a 12-second stall clock, armed only
between a refusal and the next thing that actually plays. Ordinary playback never
carries it, so a slow connection is never flagged for being slow.

**Only a PLAYING state (1) calls the clock off — not buffering (3).** Buffering was
in there first and it broke the whole watchdog: a dead video loaded by
`loadVideoById` posts buffering, sits there and never speaks again, so counting it
as success cancelled the only thing still watching it. Buffering is a track
trying; playing is a track that did.

**The skip gives up.** `deadRun` counts consecutive refusals and is capped at
`min(queue.length, 10)`; past it the player stops and the bar says how many
refused. Ten in a row is not a run of bad links, it is the network being down, and
a skip that cannot stop is a page pinning a core for as long as it is open.

**`music_check.mjs` cannot test any of this and does not pretend to.** It
intercepts every YouTube request by design, so it seeds a flag into localStorage
and checks the column, the tooltip and the clearing. `music_flag_check.mjs` is the
one that earns a flag: it serves the repo over HTTPS with a throwaway cert and
plays ids that have never named a video. HTTPS is not a nicety — over plain http
on 127.0.0.1 YouTube refuses EVERY rights-managed video with the same 150 it uses
for a dead one, so a good track and a dead track become indistinguishable and the
harness would pass while proving nothing.

**`tools/music_probe.mjs` is the audit**, and it exists because three cheaper
checks all lie: oEmbed answers 200 for a video that exists but will not embed (the
Bohemian Rhapsody link answered 200 with the right title on it); the InnerTube
player endpoint answers ERROR 152 for every id when there is no browser behind it;
and `GET /embed/<id>` no longer inlines a playerResponse to read. Only the player
knows. Same https requirement, same reason.

### The tooltip and the top layer

**A modal `<dialog>` is in the TOP LAYER, which is not part of the z-index
ordering at all**, so `#tip` — a div on `<body>` with `z-index:300` — was painted
behind every overlay it labelled. Not a stacking bug to out-bid with a bigger
number. `show()` now re-homes the bubble into `el.closest('dialog[open]')`;
`position:fixed` still measures from the viewport in there, because no dialog here
carries a transform, a filter or a `contain`, so the placement maths is untouched.

Found by the flag column, and it had been silently true for the Idea Vault's
buttons and the work overlay's copy and download tips as well. The regression is
caught two ways, because neither is sufficient alone: the bubble's parent is
asserted to be the dialog, and a screenshot with it up is compared against one
with it down. `elementFromPoint` was the first attempt and can NEVER work here —
`#tip` is `pointer-events:none` and so is not hit-testable, and the check reported
"covered" whether it was or not. The pixel half alone is not enough either:
`::backdrop` is `rgba(3,5,7,.9)` rather than opaque, so a mis-parented bubble
still tints pixels, unreadably but not to nothing.

**The X in the bar closes the overlay.** It used to stop playback and hide the
bar; with the bar permanent it was left doing nothing anyone could see. Closing
stops playback on the way out, so nothing is lost, and a second way out of a
full-screen overlay is worth having.

**Shuffle starts ON** and is remembered in `music-shuffle`. 311 tracks in
alphabetical order is a filing cabinet, not a playlist. Absent is not the same as
off: only an explicit `0` turns it off, so the default survives a browser that
has never touched the control.

**The bar is two rows.** The seek row spans it; the controls keep three columns
(`1fr auto 1fr`) underneath. Both halves matter: a flex row would put the
transport wherever the now-playing title happened to end and move it every time
the title changed, and the songs bar up the page already learned that five
groups on one line gives the scrub the same width as the volume slider — about
50px for a three-minute track, which is a layout that cannot give a scrubber
room rather than a size to patch.

**The transport is symmetric about the play button**: shuffle, prev, PLAY, next,
repeat. Centring the GROUP is not the same as centring the button — with the
modes hanging off one end the play button sat 65px left of centre while every
check passed, and it only became visible once the scrub had to sit above it.
Volume and the close X are in the third column, out of the centred group.

**Volume and seek reuse `.player-range`**, the site's own slider: the painted
track driven by `--fill`, the 22px hit area behind a 5px bar, and the white thumb
that reads against both halves are decisions already made and already fixed once.
Volume is remembered in `music-volume`, default 0.4 like everywhere else.

### Docking — the music outlives the list

Closing the overlay with a track playing does not stop it. The SAME dialog is
re-shown non-modally as a bar in the bottom-right corner, `.is-docked`, matching
`.player`'s position and measurements because it is standing in the same place
doing the same job.

**Two constraints force that shape, and both obvious alternatives fail.** A
second bar elsewhere cannot work: the player is a cross-origin `<iframe>`, and
moving an iframe in the DOM RELOADS it, so the track would restart on every open
and close. Nothing may reparent it, so whatever shows the player has to BE the
element it already lives in. And `showModal()` cannot stay, because a modal
dialog makes the rest of the page inert — which is the exact thing that has to
stop. `close()` + `show()` is the non-modal form, and it never takes the iframe
out of the document. Verified rather than assumed: a same-origin frame's inner
`window` keeps a property stamped on it across the swap, with no load event
(`.notes-dev/probe.mjs`, and `music_check.mjs` asserts the src and load count on
the real one).

**A docked dialog is open but is not an overlay**, and four places had to learn
the difference or the bar would lock the page scroll, swallow the `` ` ``
shortcut and be closed by the next overlay that opened. They share one selector,
`OVERLAY_OPEN` (`dialog[open]:not(.is-docked)`), and one predicate,
`isDockedBar()` — the accent picker already owns a zero-argument `isDocked()`
that means something else entirely.

**Docking releases focus.** The overlay's X goes `display:none` as the bar docks,
so the browser hands focus to the next focusable thing in it — the scrub or the
volume slider, both `<input>`, which makes the `` ` `` shortcut correctly refuse
to fire. Nothing in a bar whose list just closed should hold the caret.

**WHILE A TRACK IS PLAYING THERE IS ALWAYS A CONTROL BOX ON SCREEN** — the
overlay's, or the docked bar's, never neither. That is the invariant, and it is
asserted across a dock/expand/close/expand/close cycle rather than at one point,
because it broke on the second lap.

**How it broke is the lesson.** Closing was decided by a `closeMode` flag with
three values, and `expand` had to survive the queued `close` event to be read.
`bindModal` SKIPS its `onClose` whenever another dialog is already open — which
is exactly the state expanding leaves behind — so the flag was never cleared,
the NEXT close read a stale `expand` and did nothing at all, and the music
played on with no bar and no way back. A flag set beside `close()` can outlive
the close that set it. Whether the overlay came back is now read off
`modal.open`, which cannot go stale; only `stopping` remains, set and consumed
in the same turn by the bar's X — the one control that ends playback.

**The docked bar is ONE WIDTH**, whatever is playing. It was growing and
shrinking with every track title, and that took two fixes rather than one: a
`<dialog>` is `width:fit-content` in the UA stylesheet, so the auto width
resolved against the content instead of the gap; and `.music-frame` was STILL
being shrink-wrapped inside the now-fixed dialog, because `.music-modal[open]`
carries `place-items:center`. Both are pinned explicitly now. A control surface
that resizes when the thing it controls changes is the one thing it must never
do, and `music_check.mjs` compares the width across a short title and a long
one — asserting the long one actually overflows first, or the comparison proves
nothing. Overflow is left to the column's own ellipsis rather than a character
count, so the cut lands where the column really ends.

**The expand tab** is a triangle in the shell's own border colour, half out of
the top edge and centred above the duration, that puts the list back with no
code asked for. That is not a hole in the lock: the bar only exists because
someone typed the code, and it dies with the tab.

**The tab's target is a box; the triangle is its `::before`.** `clip-path` clips
hit testing as well as paint, so a button that WAS the triangle could only be
hit on the triangle — 22x10 of slanted edges. The mark stays 22x10 and the
target around it is 44x32, and both are asserted so neither drifts into the
other.

**Shuffle and repeat both start ON and are remembered** (`music-shuffle`,
`music-loop`). Repeat's first toggle up from off is the whole playlist, which is
the sensible resting state for a list someone deliberately put on; a stored
repeat value is only honoured if it is one of the three, so a hand-edited key
cannot strand the button somewhere the cycle never reaches.

**ANOTHER PLAYER TAKING THE ROOM CLOSES THIS FEED**, it does not pause it, and
that is one fix for two symptoms. `pause()` is a postMessage to another origin
with no acknowledgement, and it set `playing = false` the moment it was sent —
so when the message did not land, the video played on while the bus believed it
was paused, the bus never reached it again, and pausing a Top Picks song simply
uncovered music that had never stopped. It also meant two things decoding audio
at once, which a scroll frame was paying for.

So the bus's `pause` for this player is `yieldToOther()`, which closes the feed:
`stop()` removes the iframe's `src`, and nothing can play from a src that is not
there. And `el.paused` answers "is this feed live at all" (`!armed`) rather than
"is it rolling" (`!playing`) — reading it off the optimistic flag is exactly
what let the drift hide, because a feed the bus thinks is already paused is a
feed it will never pause again. It is also what the two players mean: starting a
Top Picks song is not a request to hold the playlist's place.

**THE PICTURE IS STOOD DOWN WHILE DOCKED**, and that is the scroll fix.
Compositing a live cross-origin video surface over a scrolling page costs a
frame: the page caught and the hero's bob — a composited `transform` animation,
which a busy main thread cannot touch — stuttered, and only ever while music
played. The Top Picks bar never did it, because an `<audio>` element has no
picture to composite.

`.music-modal.is-docked .music-video{display:none}`, with YouTube's own
thumbnail standing in. `display:none` and not opacity or an offscreen
transform: those still composite, which is the entire cost. The iframe is not
reparented and its src is not cleared, so the audio does not blink and the
player keeps its place — standing the PICTURE down is not stopping the player.
The real one is a click away on the expand tab, where an open overlay means
there is no page scrolling behind it to compete with. `img-src` in
`vercel.json` gains `https://i.ytimg.com` for the artwork.

**`will-change:transform` on the bar and the iframe was tried first and did not
help**, because it addresses raster and the cost here is composite. It is gone;
a layer pinned for nothing is memory for nothing.

HOW IT WAS FOUND, because three measurements missed it: layout, style and
script are all cheap (~1.2ms/frame) and none of them is the problem, and the
harness cannot reach YouTube at all — a run with it unblocked never got the
player past state `-1`. It took one line in devtools on the real page,
`#musicVideo{display:none}` with the audio still going, to isolate it.

KNOWN: the docked bar and the Top Picks songs bar occupy the same corner. Since
starting either now closes the other's feed, they can no longer both be live —
but a paused songs bar can still be on screen under the music bar.

**The clock is read, not polled.** There is no `getCurrentTime` to call across an
origin, but the embed volunteers `currentTime` and `duration` in its
`infoDelivery` messages several times a second — the same feed the official API
caches to answer `getCurrentTime` synchronously. Those are read BEFORE the
handler's playerState early-return, because plenty of those messages carry a
time and no state, and returning on them would freeze the scrubber for the whole
of a track. Seeking goes back as `seekTo`, and volume has to be re-pushed on
every load and on every play, since a player in another origin has no idea what
the last one was set to.

**Two playlists and no way to make a third.** ALL is the file; REPEAT is
whatever is ticked. The rail's selection is also the queue the transport walks,
so Next never leaves the list being looked at. Ticks are a per-browser
preference in `localStorage` (`music-repeat`), not a document — there is no
server behind this overlay and nothing here is worth anything to anyone else.

**The repeat playlist has DEFAULTS, and they are a fourth field.** A track whose
line ends `|R` starts ticked; 56 of the 311 do. The marks live in
`tracklist.txt` rather than in a second list of song titles because two lists
drift — a title edited in one and not the other goes silently unmatched, and the
only symptom is a track that quietly stops being a default.

Seeding is a **delta, not a one-off**. A browser that has never opened the
overlay takes the defaults whole. One that has gets only what CHANGED since it
last looked (`music-repeat-seed` holds the previous set): newly marked tracks
are added, newly unmarked ones removed, and everything ticked or unticked by
hand is left alone. Seeding once would mean a song marked `|R` next month never
reaching anyone who has already visited; seeding every time would keep putting
back what they took off.

**The repeat BUTTON in the bar is a different control from the REPEAT rail**,
and it is a three-state cycle — off, the whole list, this one track — carrying
the same `data-loop` attribute and the same `1` badge as the songs bar further
up the page. `aria-pressed` cannot say three things, which is why it is not
used. Repeat-one governs what happens when a track ENDS; Next and Previous
still move, because a mode that made a button stop working would read as
broken.

**The list is not in the page.** 311 rows of markup is ~40 KB every visitor
downloads to look at the hero and none of them can see. The manifest is fetched
on the first open and cached for the tab. An empty manifest is treated as a
BROKEN one, never as an empty playlist — the same rule the checkers follow.

**Adding a song is one line in `tracklist.txt`**, then `python
tools/bake_music.py`. Never edit `tracks.json`; `--check` fails on a hand edit
because the output is deterministic and the check is a byte comparison against
a rebuild.

### The embed, and why script-src did not move

These are YouTube links, so there is no audio URL to hand an `<audio>` element
that is not a scrape. The embed is the supported way to play one, and it is an
iframe — which the site CSP had no `frame-src` for, so it fell back to
`default-src 'self'` and was refused silently. `vercel.json` now allows exactly
`https://www.youtube-nocookie.com https://www.youtube.com` and nothing else.

**`script-src` is unchanged, and that was the point.** YouTube's IFrame API is a
postMessage wrapper around the same embed; loading it would mean widening the
one directive this page is strictest about, for convenience. So the handshake is
done by hand — `listening` on load, `{event:'command',func,args}` out,
`infoDelivery` back — in about fifteen lines. State 0 is the end of a track and
advances the queue.

The video is **visible and stays visible**. Playing an embed with the picture
hidden is against the terms it ships under, and at 132px it costs one row of the
list.

**The first track navigates the frame; every one after it is `loadVideoById`.**
Re-pointing `src` per track would throw away the user gesture that permits sound
and flash a black box between songs.

`initMusic()` sits with the other players rather than beside the notes overlay
it is a sibling of, because `MediaBus` is a module-level `const` further up the
file and calling `MediaBus.add()` above that line throws on the temporal dead
zone. It registers with a shim `el` whose `paused` getter reads the overlay's
own state, so starting a song here silences the Top Picks bar and the clips
player through the same one rule as everything else.

### The keypad no longer flashes

Opening the notes with a code already in hand — which is how it is almost always
opened — used to show the password keypad for the length of the unlock round
trip, asking for a password that had just been typed. `#notesWait` stands in for
the gate while a saved token or a passed code is being tried, and the keypad
appears only once both silent tries come back empty. Asserted synchronously in
`music_check.mjs` (the state exists for one frame), in both directions: with no
code and no token the keypad is still what shows immediately.

## Known-outstanding

The Work overlay is real art now, but its SELECTION is not settled: 350
masters went in as a first pass and the categories, the card frames and the
titles in `assets/work/work-index.json` are there to be cut down, not built
on. The `work` ladder is deliberately short at (900, 600, 400) until they are
— the overlay hero is being served 900 where it wants 1600. The Concepts tab carries nine real sheets now, all of them
1536x1024, which is why its frame is 3:2 and letterboxes nothing — `contain`
stays for the tenth at whatever shape it arrives. Top Picks gained a **Toons**
tab after Songs (five, TMDB posters at w780 like the shows —
`assets/about/toon-covers/README.md` has the source and why it is that one).
The Clips tab carries five clips, four of which now show where they came
from; King Kong's source is a photo of a ceiling and is not published, so it
is the one with copy and no chain. A clip in the strip now carries the play
state forward the way the chevrons always have — paused stays paused. Every poster is baked at its
clip's own resolution and never upscaled, so a 720p master simply skips the
rungs above it — and every poster so far is Bunny's auto-generated midpoint
frame, not the frame picked in the dashboard (its edge cache holds them for
30 days; clearing it is a Bunny-side job). King Kong is 9:16 in a 16:9 frame:
the frame never changes shape, so that clip carries `data-fit="contain"` and
the `clip-poster-portrait` slot instead of being cropped to a third of itself.
The Collab section is dormant — off the nav, content hidden behind
an UNDER CONSTRUCTION strip — until the first collab repo exists. The vault
backlog carries five plans, two Surveyor and three Site — Seamless Space came
out when it shipped, which is the rule working rather than an edit to it. The Breakout toy
in the bio has no row and never will: the vault holds parked or unstarted
plans, and that one is built. Its unstarted sibling `docs/bio-invaders.md`
is exactly what does get a row. See
`docs/plan/BACKLOG.md` for the live list and the open decisions. There is no STATUS.md
any more: it was hand-maintained, it drifted twice — claiming 50 markup blocks and 332
derivatives against a real 71 and 522 — and every fact in it was either measurable or
already in the backlog. The measurable half is generated into the context pack's
START-HERE.md at pack time now, which is doctrine rule 17 applied rather than quoted.
