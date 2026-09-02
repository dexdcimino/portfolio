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
  purpose; the eight featured cards cross-fade five frames each on ONE
  round-robin interval, frame 0 from the markup and 1-4 from the manifest),
  one `initTabs()`
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

7 accents (lime default) · 12 ladders / 21 slots in `image_slots.py` ·
106 generated markup blocks in index.html · 343 gallery pieces in
`work.json` · fallback ladder
1600/1200/900/600/400/200 · cache stamp = 8 hex of sha256(master) ·
`styles.css?v=` / `script.js?v=` bumped by hand.

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
