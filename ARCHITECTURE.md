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
- **The arrow keys are Previous and Next** (Dex, 2026-09-07), and
  `MediaBus.transport()` is that decision the way `claimant()` is the space
  bar's. It differs in three places, each earned: only a player that declares
  `next`/`prev` is in the running, so the clips player's carousel keeps its own
  arrows; an open overlay does NOT disqualify the player that OWNS it, because
  the music list is where someone is most likely to press an arrow at the music,
  though a foreign overlay still takes them; and the brick breaker takes them
  outright while it runs, declared as `ownsArrows` on its registration rather
  than named in the bus. The toy's own listener does call `preventDefault`, but
  it is attached when the game starts and the transport's at load, so the flag
  is the transport asking first rather than finding out too late. The
  focus test lives in `transport()` too — `KEY_FIELD` and `KEY_CONTROL`, shared
  with the space bar — so the whole rule is one function that can be ASKED, which
  is what `music_check.mjs` 8f does instead of opening six overlays. The range
  sliders are covered by `KEY_FIELD` as plain `input`, which is what keeps arrows
  seeking the scrubber and moving the volume.
- **Opening the music list focuses the DIALOG, not the rail button.** A focused
  button owns its own arrow keys, so the list used to open with left and right
  doing nothing until you clicked away from it — which is the feature above not
  working on the one press a reader actually makes first.
- **`MediaBus.nowPlaying()` and `playbackState()` are the OS media controls.**
  `navigator.mediaSession` puts the page on the keyboard's media keys, in
  Windows' media flyout and behind Chrome's media button, all of which keep
  working while the tab is in the background and the browser is not focused —
  which is the point: a remote for the music from anywhere on the machine, with
  nothing installed. Handlers are installed once and route to whatever is
  playing (or, for `play`, whatever was last announced), so a fourth player gets
  them by registering; metadata is per track. Each handler is set in its own
  `try`, because an action name a browser does not know THROWS and would take
  every handler after it down. Only the last-announced player may repaint the
  state, or the songs bar painting itself paused tells Windows the music stopped
  while it is still going. **KNOWN LIMIT:** the music overlay plays through a
  cross-origin YouTube `<iframe>` and the session belongs to the document that
  is really playing, so the keys may reach YouTube's handlers instead of ours.
  The Top Picks songs are an `<audio>` in this document and are not in doubt.
  There is no API that answers "do I own the session" — it is measured by
  pressing the key, and it WAS measured: with the overlay playing, the play/pause
  key worked from the desktop and next/previous did nothing anywhere, which is
  YouTube's session answering the one action it has.
- **So the page holds the session with a sound of its own.**
  `MediaBus.holdSession()` loops a near-silent 10-second WAV, built at runtime
  into a Blob URL, in THIS document alongside the embed — which gives Chrome an
  audio element here to build the session around, and that session carries our
  handlers. Every number is load-bearing: ten seconds because Chrome gives very
  short media no session at all; not muted and full volume because a muted
  element is not a candidate, with the inaudibility coming from the SAMPLES (one
  LSB of 16-bit, about -90 dBFS); built rather than shipped because 160KB of
  base64 would be a real download describing silence; and paused with the music
  so the flyout never claims something is playing that is not. Only the iframe
  player needs it — the songs bar is an `<audio>` here and owns the session
  already. `holdState()` exists to be checked: a wrong byte in that header
  leaves `duration` NaN and nothing on the page looks different, which is this
  repo's favourite shape of bug. `music_check.mjs` 8f asserts the decode.
- **AND IT DID NOT WORK, so the keys are caught in an extension instead.**
  Measured twice on the real machine: with the overlay playing, the play/pause
  key worked from the desktop and next and previous did nothing anywhere, and
  the silent hold did not take the session off the embed either. `remote/` is a
  three-file Chrome extension whose `global` commands are registered with the OS
  by Chrome itself, ahead of any page, so it never competes for the session at
  all; its content script relays them to the page as DOM events, which
  `initRemoteEvents()` turns into `MediaBus.remote()`. `Ctrl+Alt+<key>` is NOT
  bound there and cannot be — Chrome refuses that combination on Windows
  because it is AltGr — so it stays a PowerToys remap onto the media keys. The
  price, written down in `remote/README.md`: while it is enabled the media keys
  belong to it and stop reaching Spotify. **The hold is kept for now and is on
  probation**: it can only be shown to be pointless by a measurement nobody has
  made (whether the flyout carries our metadata), and it costs one silent audio
  element. `music_check.mjs` 8f drives the relay end to end and 8g asserts the
  extension's two copies of the site list agree — a drift there is silent, the
  key fires and the tab query matches nothing.
- **The media-key handlers call `toggle()`, never the bus's `pause()`.** On the
  bus, `pause` means "yield the room", which for the music player is a full stop
  that tears the embed down; the OS pause key means pause. Which way toggle goes
  is decided by the state the players report to `playbackState()`, because the
  iframe player's `el.paused` answers "is a track loaded" and stays false
  throughout a pause.
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

**THE ` KEYPAD REACHES OVER AN OVERLAY.** It used to stand down whenever any
dialog was open, which made "reachable from anywhere" untrue in exactly the
place it was most useful: from the music list you had to close the music before
you could ask for anything else. The only exception left is a field with the
caret in it — a backtick you meant as a character is a character — which is
also what keeps it out of the way inside the notes, where the caret almost
always is.

It opens STACKED when something is already up (`openModal`'s fifth argument),
and that is the half that makes cancelling safe: Escape closes the keypad and
leaves the overlay underneath exactly as it was, rather than having closed it
on the way in for a code that was never typed. Whatever the code then opens is
opened un-stacked, so it replaces what was there — which is what "go somewhere
else from here" means.

**The panel wears the key that opens it.** `.code-tilde` is the site's own
`tilde` icon at the top left, mirroring the close button's inset on the right;
in the middle it would push the five boxes off the centre of the panel, which
is the one thing that layout is. The BOX and the INK are sized separately, and
that is the whole trick: `.icon` paints `center / contain`, so sizing the
element alone scales the art to fill it — a 32px box put a 32x14 tilde in the
corner beside a 17px X. The box matches the close button's 32x32 at the same
12px inset, and `mask-size` draws the mark at 18x8 inside it, so the two share
a centre line and carry about the same weight.

**The Idea Vault's keypad wears it too** — same lock, same codes, same mark.
There are no corners to mirror down there, so it sits at the head of the row of
boxes: `aspect-ratio` is the art's own 86.5x38 and the width is 0.36 of
the pins' own clamp, so it stays scaled to them at every window size rather
than being a number that was right once. The RATIO is the point — at 1:1 a
solid accent mark was exactly as wide as an empty outlined box, and a filled
shape at the same span as an outline reads far heavier than it, so it arrived
as a sixth cell rather than as a mark on the row. Half was still too much of
one, 0.4 was another 10% too much, and 0.36 is where it settled. It is inside `.vault-pins` so the row's own
`align-items:center` keeps it level with the boxes, and it is decorative —
`script.js` reads `.vault-pin`, so nothing counts it as a sixth cell. The status line under the boxes is BLANK at
rest — the eyebrow above them already says ENTER CODE, and the same three words
twice on a panel with five boxes on it is one of them too many — but it keeps
its height, so filling it in with a refusal does not move the boxes someone is
typing into.

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

A private, password-gated notes app. No control anywhere on the page opens it
-- the address, the tilde keypad and the Idea Vault are the only ways in. It
was rebuilt on 2026-09-07 from a single-document editor into a notes app
with sessions, categories, a sidebar and its own undo; the door is the same.

```
index.html      #notesModal: the keypad pane, then an EMPTY #notesEditor
script.js       the DOOR: createKeypad() . the token . open/close . import('/notes/app.js')
styles.css      .notes-* for the shell only; nothing inside the app
notes/          the app, ES modules, fetched only after the password passes
  app.js          mount()/unmount(); layout, the shared ctx, the save loop, sync
  state.js        the document shape, normalize(), merge(), migrateHtml()
  schema.js       what a body may contain: clean() in, serialize() out, scrub() between
  history.js      the undo stack: text transactions and structural ones
  editor.js       typing: lists, Enter, Backspace, Tab, triggers, paste, copy
  dictate.js      the microphone: the caret as insertion point, the commit diff
  color.js        the picker, and tints(): one hex -> the three text tiers
  render.js       sidebar, rail, canvas, sessions, archive, drag-reorder, scroll spy
  chips.js        link chips, markdown nodes, images (upload, size, menus)
  table.js        tables: make one, Tab/Enter/Backspace in a cell, the handles
  spell.js        Highlight API marks, the right-click menu, autocorrect
  spell-worker.js the Hunspell dictionary, off the main thread
  emoji.js        the ":" picker (3x3) and the full picker
  color.js        the HSB picker with sixteen document-level slots
  search.js       Highlight API matches, Enter/arrows, sidebar dimming
  slash.js        the "/" menu
  md.js           the markdown renderer for nodes (escaping first, hrefs allow-listed)
  transfer.js     a session in and out as markdown: the Upload and Download
                  buttons in the sessions sheet
  ui.js           toast, confirm, panels, menus, tooltips, the icon set
  nodes.js        what a chip looks like and what you can do to one: the mark,
                  the hover toolbar, and the ONE drag that creates, moves and
                  copies them
  dom.js          selection as data, block helpers
  notes.css       every rule, scoped under .nt-app; the five self-hosted faces
  emoji.json      1907 emoji as [unicode, label, tags, group]
  vendor/         typo.js and en_US.aff/.dic
  fonts/          Outfit, Raleway, Inter, JetBrains Mono, Space Mono (latin, woff2)
api/notes/unlock.js   POST {password|token} -> {content, format, rev, savedAt, token}
api/notes/save.js     POST {token, doc, baseRev} -> 200 {rev, savedAt, token} | 409 {doc, rev}
api/notes/asset.js    POST {token, type, data} -> {key};  GET ?key&t -> the image
lib/notes-store.js    blob I/O, scrypt, HMAC tokens, the rev check, backup tiers, assets
lib/notes-seed.js     the pre-rebuild document, read once if nothing was ever saved
```

**The password is checked on the server, and that is the whole point.** The Idea
Vault higher up the page ships ciphertext and decrypts it in the browser, which
is right for something sealed once; these notes are edited daily and cannot be
re-sealed on every keystroke. So nothing about them -- not the text, not its
length, not whether anything has ever been saved -- reaches the browser before
`/api/notes/unlock` returns 200, **and neither does the app's own code**: script.js
holds only the keypad and a dynamic `import('/notes/app.js')` that runs after
the 200. `tools/notes_check.mjs` asserts both by scanning every response the
page received after a wrong password. Closing the overlay unmounts the app and
empties `#notesEditor`, for the same reason the old document was removed: a
document left in the DOM is one devtools panel away for the rest of the visit.

**Storage is Vercel Blob, `access: 'private'`.** `notes/current.json` is the
document as `{ rev, savedAt, doc, tiers }`, where `tiers` is the backup ledger
below and is dropped by `readNotes()` — the browser never sees it.
`notes/current.html` is the document the
overlay wrote BEFORE the rebuild: read once when there is no JSON yet, handed to
the browser as `format: 'html'`, migrated there (`state.migrateHtml`: each
`.nv-sec` becomes a category, its accent becomes the colour, its icon becomes an
emoji), and never written again -- it is the permanent safety net under the
migration, and `notes_check` asserts it stays byte-identical. The server never
converts; it has no DOM and the browser that wrote the HTML is the only thing
that can parse it the same way.

**The rev is what stops two devices wiping each other.** Every save carries the
rev it was built on. A save on a stale rev is answered 409 with the current
document attached and NOTHING is written; the client merges category by
category (`state.merge`: each category from whichever side stamped it last, a
category only one side has is kept) and retries on the new rev. Before this the
later save silently won the whole document. A tab coming back from the
background asks `/api/notes/unlock` with its token and adopts the store's copy
if the rev moved and nothing local is dirty. Asserted in `notes_check` with two
incognito contexts editing two categories: B's save answers 409 then 200, and
both edits are in the store.

**Backups are tiered, not one per keystroke.** `notes/backups/<iso>.json`, one
per ten-minute window, newest 20; `notes/daily/<date>.json`, one per day,
newest 14. Before this every save wrote a copy, so twenty copies covered the
last thirty seconds of typing. The spacing rule is `backupPlan()`, a pure
function of the names already there and the clock, driven through
`notes_store_check` on a synthetic clock. The pre-rebuild `.html` backups are
never counted and never pruned.

**A STEADY SAVE COSTS ONE ADVANCED BLOB OPERATION, and that is a number the
checker asserts.** It used to cost three: `writeNotes` listed *both* backup
folders on every save purely to work out whether a copy was due, and a list is
metered as an advanced operation. At a 1.2 s autosave debounce that is roughly
one hour of typing per month on the Hobby plan, and on 2026-09-08 the store hit
the wall and locked out. The two facts those lists were read for now ride in
the wrapper every save already reads — `tiers: { backupAt, backups, dailyDate,
dailies }` — and the ledger is a **gate, not the decision**: a save it says
nothing is due for lists nothing at all, and a save it says something *is* due
for lists the folder and hands the real names to `backupPlan()`, which decides.
So counting-then-deciding still runs, on the one save in many that writes a
copy. A missing or garbage ledger reads as "due", so the first save after this
change — and every wrapper in the live store predates it — rebuilds the ledger
from a real listing and neither duplicates nor skips a copy. The worst drift a
half-finished save can leave is one extra list and one window's delay. Costs:
1 advanced op for a steady save, 3 when a ten-minute copy is due, 5 on the
first save of a day, 0 for a save refused on a stale rev. `notes_store_check`
tallies the stub's calls and asserts each of those against a number, plus that
100 saves in one window cost exactly 100.

**The client half of the same bill.** `SAVE_DEBOUNCE` is 5 s and `SAVE_MIN_GAP`
is 15 s in `notes/app.js`: a save is never *scheduled* sooner than fifteen
seconds after the last one went out, so unbroken typing costs ~240 saves an
hour instead of ~3000. The floor is on the automatic path only — Ctrl+S, the
`pagehide`/`visibilitychange` `sendBeacon` flush and the post-conflict retry all
save immediately. A failed save now backs off 4 s → 60 s rather than retrying
every four seconds forever, which is the one situation where a fixed retry
makes the problem it is reacting to worse.

**Images are assets, not data URIs.** A pasted or dropped image is scaled to
1600px WebP in the browser (a small PNG stays PNG, a GIF keeps its frames),
posted as base64 to `/api/notes/asset`, and stored under its sha256:
`notes/assets/<sha>.<ext>`, private. The body holds `<img data-key data-w>`;
the `src` is built at render time from the session token and stripped again by
`serialize()`, so a token never reaches the store. While the upload is in
flight the image shows its data: preview and has no key, so a save in that
window simply leaves it out and the next one has it.

**Tokens are stateless**: an expiry, plus an HMAC of it keyed by
`NOTES_PASSWORD`. Every save returns a fresh one, so a tab open across a
working day never hits the wall mid-sentence. The token lives in
sessionStorage: per tab, dies with the tab.

**Setup.** `NOTES_PASSWORD` and `BLOB_READ_WRITE_TOKEN` in the Vercel project.
Without either, every route answers 503 and the keypad says NOT SET UP.

### The document

```
doc      { v: 2, active, sessions: [session], ui, spell: {ignore, custom}, emojiFreq }
session  { id, title, emoji, color, created, updated, cats: [cat], archived: [cat] }
cat      { id, title, emoji, color, collapsed, body, updated, archivedAt? }
ui       { theme, font, fs, sidebar, node, spell, autocorrect,
           archSplit, archOpen, slots[16] }
```

One body per category, no subcategories -- the notes were never written any
other way, and flat is what keeps every operation simple. `updated` on a
category is what the merge compares; every mutation goes through `touch()`.
`normalize()` runs on every document that arrives from anywhere, so an older
shape or a hand-edited blob cannot crash the app.

### What a body may contain

`schema.js` is the contract: root blocks `p h3 ul ol pre blockquote hr table`;
items hold inline content then at most one nested list at the end; inline is
`b i u s code a br img` plus `span.chip`. Alignment is a class (`al-c`, `al-r`),
todo state is `data-checked` on the item, images are `data-key`/`data-w`.

**A TABLE IS RECTANGULAR AND FLAT**, and both halves are enforced by `clean()`
rather than trusted: exactly one `tbody`, every row the same width, the FIRST
row's cells are `th` and the rest are `td`, and a cell holds inline content
only -- no blocks, no lists, no nested tables, no `colspan` or `rowspan`. With
spans, "the cell to the right" and "the column under this one" stop being the
same question and every add, remove and Tab has to answer both; flat cells are
a shape `editor.js`'s caret rules already know. `thead` and `tfoot` fold into
the one `tbody` -- a header row is the first row, not a second container to
keep in step. **A table over the cap is not a table**: `MAX_COLS` x `MAX_ROWS`
is what the editor can build, and anything larger arriving from a paste or an
older document becomes one paragraph per row with cells joined by ` · `, which
is what every pasted table became before tables existed. Nothing is lost and
the invariant holds. **A table is never the first or last block in a body** --
`normalizeRoot` fences it with an empty paragraph, so there is always a line to
put the caret on above and below one.

**The cap is 8 columns x 50 rows, and both numbers were measured.** Eight
columns is what the app's widest writing area holds at a readable width: a
category body is 948px at 1440px and above, so 8 columns is 118px each, and
"Progressive" -- the widest word in the bills table this was built for -- is
88px at the default 17px. A ninth puts every cell under 105px and ordinary
words start wrapping. The narrowest body the layout produces is 368px (at a
780px window, the last width before the sidebar stops being docked), where the
table scrolls sideways inside its own box rather than squeezing: `--nt-col-min`
is 92px and the `overflow-x` is on the table itself. Fifty rows is an
EDITORIAL cap and the measurement is what says so -- every keystroke in a
category clones the whole body twice, `capture()` for the history and
`serialize()` for the save comparison, and an 8x50 table costs 1.4ms of that
against 0.05ms for an empty one; 8x400 is still 7.2ms, well inside a frame,
and an 8x50 filled table is 8.4 KB, 0.2% of the 4 MB document ceiling. So the
row cap has roughly eight times its own headroom measured underneath it, which
is the number to look at before moving it.
**No style attribute anywhere**: the site's CSP has no `'unsafe-inline'` for
styles, so an inline style is not untidy, it is silently ignored on reload.
`clean()` runs on every string on its way in (server, paste, undo) -- in a
DOMParser document with `style=` renamed first, because even an inert
document reports a CSP violation per style attribute -- unknown tags are
UNWRAPPED rather than dropped, and `scrub()` after every native input pulls
what Chrome added (styles when merging lines, `<div>`s, `<span>`s) back into
the schema before it can compound. `serialize()` on the way out strips the
transient: image srcs, selection classes. A save and a reload are
byte-identical, which is what lets the save loop compare strings.

### Editing

**THE BROWSER'S OWN ESCAPE HATCHES ARE NOT OURS TO TAKE.** `Ctrl+Shift+R` was
align-right, lifted from Google Docs along with `Ctrl+Shift+L` and `E`. It is
also Chrome's hard reload, a page can `preventDefault` it, and this one did --
so reaching for a force-refresh inside a text box silently right-aligned a
paragraph, and the way out of a wedged page stopped existing in the one place
someone types for an hour. It is unbound, and deliberately not rebound to a
third chord: align-right is the least used of the three, it has a button in
the header, and a replacement nobody asked for is a keystroke nobody will
remember. Before adding a chord, check it is not the browser's.

**CLEARING A BOX DOES NOT LOSE IT.** The case is a long brain dump: you scroll
into the middle of a 2000px box, `Ctrl+A`, and cut it to paste elsewhere.
Nothing above the box changed, so the canvas keeps its `scrollTop` -- but the
box is 30px tall now, its bottom has come up two thousand pixels, and you are
left looking at whatever used to be far below it, with the box you were
working in off the top of the screen and too small to find by eye.

`keepBoxInView()` in `editor.js` answers it: `onBeforeInput` records the body's
height, `onInput` compares, and if real height was lost AND the section is no
longer fully in view it scrolls the SECTION back -- not the caret, which is now
sitting in an empty box, while the thing that tells you where you are is the
category's title strip above it. Both guards are load-bearing: without the
shrink test it fires on an ordinary backspace, without the visibility test it
yanks a perfectly readable box up to the top edge.

The height is only measured when the edit could actually shrink the box -- a
deletion, or typing over a selection that is not collapsed. `offsetHeight`
forces a layout, and paying that on every keystroke of a long document buys
nothing: a typed character cannot shrink a box. The scroll is `instant`, not
the canvas's usual smooth: this is a correction to a jump you did not ask for,
and watching the page glide is the same disorientation with a longer runtime.

### Sessions in and out

**`notes/transfer.js` is how a session arrives and leaves, and it is markdown
because markdown already has a word for both halves of a session.** `#` is a
session, `##` is a category, everything under a `##` is that category's body,
and `###` and deeper are headings inside it. Several `#` in one file are
several sessions, so a whole backup restores in one press. A file with no `#`
is one session named after the file.

**The Upload and Download buttons live in the sessions sheet's foot**, either
side of New: out on the left, in on the right. All three answer the same
question -- where a session comes from -- and the two square ones are one
gesture in opposite directions.

**AN IMPORT IS AN ORDINARY EDIT.** It builds sessions, pushes them onto the
document and calls `docChanged()`, which is the same path a keystroke takes.
There is no token, no endpoint and no privileged mode: whatever may write a
note may write a session. `tools/notes_import.mjs` does the same job from a
terminal and needs the blob token in a shell, a dev server to borrow a DOM
from, and a person who knows what those are -- it is still the right tool for
a scripted or bulk restore, and the wrong one for a person with a file.

**The body is right by CONSTRUCTION, not by a checker.** What gets stored is
`clean(renderMarkdown(md))` -- `renderMarkdown` decides what the markdown
means, `clean()` decides what a body may contain, and running them in that
order leaves nothing for a body check to disagree with. That is the whole
reason the terminal importer needed a browser: `clean()` needs a DOM, and in
the app it is already loaded.

**A title's leading emoji is the title's emoji.** `\p{Extended_Pictographic}`
alone is not enough to find one: U+275D, the quote ornament already on the
Quotes category, is not in that property and neither is a star, so an export
and a re-import welded the mark onto the front of the title. The class is
widened with the Dingbats and Miscellaneous Symbols ranges. Arrows are
deliberately excluded -- "-> Next steps" is a title, all of it.

**What does not survive a round trip is images**, and it is said in the module
header rather than discovered: they are stored by content hash against the
account, not inside the note, so markdown can only carry a reference. Export
writes `![image](key)`. Everything else -- both list kinds, todo boxes with
their ticks, quotes, fences, rules, tables, links and the inline marks -- goes
out and comes back the same.

**Inside a table, `table.js` answers the keys first.** Tab and Shift+Tab move
between cells and Tab in the LAST cell adds a row and lands in it, which is how
a table gets filled in without reaching for the mouse; at the row cap it does
nothing and says why. Enter inserts a line break and stays in the cell -- a
cell holds inline content, so there is no second block to split into, and
moving down instead would leave no way at all to write two lines in a cell when
Tab and the arrows already move. Backspace at the start of a cell never merges
cells; at the start of the FIRST cell it deletes the table if every cell is
empty and otherwise hands the caret to the line above, which is the only way
out of a table to the left. The row and column handles are appended to the app
root and positioned over the table, the way `nodes.js`'s chip toolbar is: a
control rendered inside the body would be serialized, snapshotted by undo,
reachable by the caret and deletable by Backspace. They hide on a delay rather
than on the canvas's `pointerleave`, because reaching for one leaves the canvas
-- hiding immediately took the button away in the same event the pointer
arrived on it, and the press landed on the category box underneath. Every
structural change goes through `editor.transact`, so adding a row is one undo
step.

The browser types, deletes and applies bold; `editor.js` does lists and blocks,
because a contenteditable's own ideas about lists are the source of nearly
every scar in the two editors this replaces. One set of listeners on the
canvas, delegated to whichever body the event came from.

- **Tab / Shift+Tab** indent and outdent, one item or a whole selection, and
  the selection survives (`keepSelection`: structural moves never recreate
  text nodes, so the nodes it sits on are still the right ones). An item
  cannot go deeper than the item above it, so a selection never becomes a
  staircase. Tab in a paragraph makes it a bullet.
- **Enter** splits an item (its children travel with the tail), steps an empty
  nested item out, turns an empty top-level item into a paragraph, and leaves
  a heading, quote or code block on an empty last line. Ctrl+Enter toggles a
  todo. Quotes are one block per line (consecutive ones draw as one); code
  takes newline characters, never `<br>` -- Chrome treats a trailing `<br>`
  as a placeholder it may remove or move, which is what trapped the caret in a
  quote on the first build.
- **Backspace at the start** unwinds before it merges: nested out, top-level to
  a paragraph, a paragraph into the last item of the list above. Backspace
  right after a chip removes the chip.
- **Markdown triggers** `- * + 1. [] [x] # > ---` and three backticks. Decided
  at beforeinput, applied at input after the space has landed, so the native
  keystroke is its own history step and Ctrl+Z after `- ` gives back `- `.
- **Chips are atoms with a real character after them**, a no-break space when
  they end a line. The old editor bracketed every chip in zero-width spaces
  and then needed arrow hops, delete guards and a hydration pass to keep them
  paired; none of that exists here.
- **Paste** goes through `clean()`; plain text with `- `/`1. `/`[ ]` lines
  becomes real lists (a change of kind at the same depth starts a new list); a
  bare URL becomes a link chip; an image becomes an asset.

### Nodes

A node is an inline atom in a body: a link chip, a markdown chip, an image.
`chips.js` owns what each one IS -- how it is made, edited and stored --
and `nodes.js` owns everything around that.

**Every chip carries a MARK at its head**, and the mark is a control: pressing
it folds the chip down to just that mark (`data-min="1"`, so a note you folded
comes back folded) and pressing it again unfolds it. For a link the mark is
the site's own initial on one of twelve colours derived from the hostname, so
the same site is the same circle in every note -- unless the site is one the
`BRANDS` table knows, in which case it wears its own.

**THE BRANDS ARE BUNDLED, NOT FETCHED.** `BRANDS` in `nodes.js` maps a
hostname to a brand: the rows worth drawing carry a real glyph (Google's
four-arc ring, YouTube's play button, a handful more), and the rest carry the
brand's OWN colours behind the site's initial -- Netflix red, Spotify green,
Amazon orange. `brandOf()` resolves `docs.google.com` and `google.co.uk` to
the same row as `google.com` without a row for each. Anything the table has
never heard of keeps the hashed mark, so an unknown link is never blank.

A glyph is only drawn where it can be drawn honestly. A logo rendered from
memory at eighteen pixels is worse than no logo -- it reads as the WRONG mark
rather than as a generic one -- so a site gets a glyph or it gets its colours,
and there is no third state that half-guesses.

**Still no remote favicons.** The app ships under `img-src 'self' data:`, so
one fetched from Google's icon service would be blocked outright -- and
widening that header would mean every render of a private page telling a third
party which domains are in it. Nothing here reaches the network. A favicon for
a site not in the table would need a same-origin proxy, and that is a decision
about what the server fetches on your behalf, not a CSS change.

**The mark is never stored and never counted as text.** `serialize()` strips
it, `clean()` removes one that arrives through a paste, and `scrub()` -- which
unwraps stray spans in a live body after every native input -- has it in its
exclusion list, because unwrapping it dropped its letter loose into the label
and a link came out reading "Ggoogle.com". Its letter is drawn from an
attribute by CSS rather than being a text node, so the spell checker, the
search, `toText()` and "copy as text" all see the label alone. Reading or
writing a chip's words goes through `chipLabel()` / `setChipLabel()`, never
`textContent`.

**The colour on the mark is a CLASS, not a style.** `scrub()` strips every
style attribute in a body after each input -- that is its whole job -- so a
computed colour would survive exactly until the next keystroke. Twelve
buckets, twelve rules -- and one rule per brand, for the same reason. A brand
GLYPH is safe as real SVG inside the mark, because a multi-colour `fill` is a
plain attribute and it is `style=` that gets stripped.

**Folded, a chip is drawn at the size of the pill it replaced** -- 27px
against the ~26px an open chip occupies at the default text size, with the
chip's own border and padding dropped so the mark is the whole control. The
first version folded to 19px INSIDE that border, which made a folded node a
speck in the line rather than a node you had folded.

**Resting on a chip raises a toolbar over it**: open, edit, copy, fold,
delete. It is NOT a `panel()` -- there is one of those at a time and it closes
on any outside press, so hovering a chip would shut the colour picker and
opening the colour picker would shut this. Delete ARMS on the first press and
acts on the second: a chip is one press from gone, and a confirm dialog for
something Ctrl+Z brings straight back is heavier than what it protects.

**One drag, three jobs** (`beginDrag`): out of the header's node button to
make one where you let go, from a chip to move it, and Shift to leave a copy
behind. **Pointer events, not HTML5 drag-and-drop** -- a contenteditable is
already a drop target with its own opinions about ranges and markup, and
there is no event you can cancel on every path. Nothing is written until the
pointer comes up; the ghost and the drop caret are absolutely positioned over
the app and are never inserted into a body, because a marker put into a live
contenteditable splits its text nodes and invalidates the very range the drop
is aiming at. The drop point is then pinned with an empty text node BEFORE
the chip is taken out, or removing it shifts every offset after it. Moving
between two bodies is two history entries, one per body, because that is what
a text entry is.

**The header's node control is a split button.** The left half inserts the
kind used last (`ui.node`) and is the drag handle; the chevron opens the list.
The mark on it is that kind's own mark in that kind's own colour.

### Undo

`history.js` is one stack for everything. A **text** entry is one body's HTML
before and after plus the serialized selection either side (child-index paths
from the body root), applied by setting innerHTML and putting the caret back.
A **structure** entry is the session as JSON before and after, applied by
swapping the session and re-rendering -- so a deleted category comes back with
its body. Native typing is captured from beforeinput/input and coalesced by
word: a space after letters seals the group, a space that opens one stays open
so `" fox"` undoes as one. The browser's own stack is switched off (Ctrl+Z/Y,
Ctrl+Shift+Z, and the `historyUndo` input type the context menu produces),
because two stacks that both think they own the document was the failure mode
this replaces.

**A snapshot carries no `style` attribute.** `capture()` strips them from a
clone before reading the HTML, because putting a snapshot back is putting it
back through `innerHTML` -- and this app ships under `style-src 'self'` with
no `unsafe-inline`, where an inline style attribute applied that way is
blocked. An image in a body has `style="width: 50%"` on it, set through CSSOM
where the policy does not reach, and the moment that width rode into a
snapshot every undo in a category holding a picture logged a blocked
operation. Nothing is lost: `data-w` is the stored form of the width and
`chips.hydrate()` reapplies it through CSSOM after the HTML lands.

### Spelling, marks and autocorrect

Misspellings are drawn with the **CSS Custom Highlight API** -- a set of ranges
the stylesheet paints with a wavy underline -- so the document is never
rewritten to show them; the caret, the history and the saved HTML never see a
mark. The dictionary (Hunspell en_US via typo.js) is parsed in a Worker.
Right-click on a marked word: suggestions, Ignore, Add to dictionary; both
lists live in the document and follow Dex between devices. **The menu opens on
the click, not on the dictionary.** It used to `await` the worker for
suggestions and only then build anything, so a right-click did nothing visible
for as long as that took and the natural response -- clicking again -- closed
the menu that had just appeared and started another wait. It read as a button
that worked one time in three. The two actions that need no dictionary are
there in the first frame, a placeholder row is replaced in place when the
suggestions land, and `pointerdown` starts the lookup before `contextmenu`
even fires. Measured at 18ms in the harness, against a target of 120. **Autocorrect**
runs when a word is finished: a contraction table, a table of the usual
transpositions, and otherwise the dictionary's suggestions filtered to
Damerau-Levenshtein distance 1 that keep the first letter. A correction is its
own undo step; Backspace straight after it restores the original and stops
that word being corrected again this session. Search uses the same API for
its matches, with the current one brighter.

### Rendering

`render.js` rebuilds only what changed: a canvas render keeps any section whose
body stamp is unchanged, so an autosave, a rename or a sidebar change never
moves the caret. The sidebar row, the rail letter and the canvas header all
carry the category's colour as `--c` on the element. The scroll spy marks the
category that fills most of the view and paints the scrollbar with its colour.

**A colour is the category's title strip and its text. The note box itself
stays neutral.** `tints()` in `color.js` derives five values from one hex.
`--c-head` is the title strip, a FAINT wash of the colour -- enough to say
which category the bar belongs to, not enough to compete with the name
printed on it -- and `--c-head-hi` is that strip under the pointer, which is
the only thing that lights when a category is hovered. A tinted note box was
tried and taken back out; see `docs/DECISIONS.md`.

The text is three tiers and **the hierarchy is carried by SATURATION**:
`--c-title` is THE COLOUR ITSELF, byte for byte, because the whole point of
choosing one is to see it on the name -- the session's title, its badge
letter, every category name and every sidebar row wear the value you picked.
`--c-bold` is duller and a step further from the box; `--c-body`, the lines
being read, duller and further again. A paragraph in a fully saturated colour
is tiring and competes with the name above it, so the reading text ends up
nearly neutral and still unmistakably this category's, and all of the colour
lands where the eye is meant to.

Every tier is then floored until it is readable on every surface it appears
on -- the title against three of them, because it appears on three. That is
the only thing that moves it, and on the dark theme it moves almost nothing:
a near-black pick is one drag away in a free-form HSB field and would
otherwise paint its own category invisible. On the light theme a pastel has
to darken to be read on a pale ground, so the title is exact there only when
the pick is already dark. Each lower tier also keeps a saturation FLOOR,
capped at the picked saturation: without it a pick at full brightness spent
the whole difference on saturation and the reading text came out plain white
with no trace of the category in it -- and a deliberately grey pick must
still give grey text.

### The shell

The sidebar is a column of the WINDOW, not of the area under a bar: it runs
from the top of the screen to the bottom, and the header spans only the
column beside it. That is what puts the session's emoji, its name and its
colour at the very top-left, and it is why the type pickers sit in the
header's middle group -- there is no left group left for them. The middle
group is centred in its column; the search on the right shrinks before any
button does, so nothing there can be squeezed to nothing.

**There is no sidebar toggle in the header.** The chevron tab is on the
sidebar's own edge, welded to the archive, which is where a control that
folds the sidebar belongs -- and the header's middle group is supposed to be
the formatting controls for the text under it. `Ctrl+\` still does it, and so
does pressing the session badge (below).

**The session badge is two controls on one target, split by gesture.**
Resting on it opens the sessions popup; pressing it folds the outliner. That
pairing is what lets it be the only thing in the corner: the sessions are
what you want to SEE from there and folding is what you want to DO. A press
disarms the hover until a real `pointermove` arrives -- folding the sidebar
moves a different badge under a stationary pointer, and Chrome re-evaluates
hover on a layout change, so the leave/enter pair the fold produces is
exactly the one that must be ignored.

**Renaming happens where the name is read.** Double-click a category row or
the session's name in the sidebar and it becomes a field with everything
selected; Enter or clicking away keeps it, Escape puts back what was there.
`wireInlineTitle()` is the whole of it, and `renameCat()` writes BOTH the
sidebar and the canvas -- skipping whichever one is being typed in, because
rewriting the element under the caret collapses the selection and eats the
next keystroke.

**The list and the archive are welded.** One grab edge between them decides
how the leftover height is shared (`--list-flex` / `--arch-flex`, saved as
`ui.archSplit`), and the archive header carries two arms that lie flat while
it is open and fold into a chevron when it is shut -- one mark doing both
jobs, so the header never grows a second control.

**Both halves of that state are saved, and for a while only one was.** The
height was restored on every load (`applySplit()` from `ui.archSplit`) while
the fold was not, so an archive left open came back shut every single time and
the height was faithfully restored for something nobody could see. `ui.archOpen`
is the other half: written by the header's click, applied in `applyUi()`
alongside the split, and followed by `syncTab()` because the tab is welded to
an edge that is in a different place depending on it. Checked in
`notes_check.mjs` (3b) across a real reload, with the flag asserted in the
store on disk first -- a fold restored from a variable that never reached the
server lasts until the tab closes.

The tab that folds the
sidebar away rides the same divider: `syncTab()` keeps it level with the
archive's top edge through the split drag, the fold and a resize. It lives
outside the sidebar because the sidebar clips its own overflow.

`syncTab()` watches **the archive**, not the sidebar. A `ResizeObserver` on
the sidebar cannot see the fold at all -- the sidebar is exactly the same
size with the archive open or shut -- so the one action that moves that
divider furthest was the one that left the tab behind. The observer is
attached lazily, because the archive does not exist yet when `initRender()`
runs, and the archive's own handler calls `syncTab()` on both branches.

**The two foot buttons are one panel.** New Category and My Sessions each
centre their label and pin their mark to the right edge, so the words line up
with each other down the column and the marks line up with each other down
the right. Placed absolutely rather than with `space-between`, because with
`space-between` the label's centre moves with the mark's width and the plus
and the logo are not the same width. The rail's foot is the same pair in
miniature and in the same order: folding the outliner takes a label away, not
a door.

**The sessions sheet has two docks and one element.** It is MOVED into
whichever dock is on screen -- above the foot button while the outliner is
open, out to the side of the rail while it is folded. Two copies would be two
things to keep rendered and the invisible one would be the one that went
stale. **The rail's dock lives outside the sidebar** and is told where to sit,
the same arrangement and for the same reason as the collapse tab: the sidebar
clips its own overflow, so a sheet opening to the right of a 50px rail would
never be seen. `show-sessions` is therefore a class on the ROOT, not on the
sidebar.

**The sessions are three surfaces onto one list.** The popup on the badge
(cards, `openSessions()`), the list under the foot button
(`renderSessionList()`) and the rail's badge all read `doc.sessions`.
The popup's row is the word and a close, and the word is placed ABSOLUTELY at
the popup's centre -- centring it over the cards puts it in the corner
whenever there is only one session. There is **no options menu** on it:
everything such a menu would hold is already reachable from inside the
session it would act on (the name renames on a double-click in two places,
the emoji and the colour are the controls beside it, a card's own X deletes),
so it was a fifth control duplicating four you are looking at. The foot list
is a sheet pinned to the top edge of its own button (`.nt-sess-dock`), not a
block in the column: as a block it pushed the archive down on open and pulled
it back on close, so asking what the sessions were rearranged the sidebar
twice.

**Nothing in the sessions answers a right-click.** The cards reorder on a
drag, and a press-and-hold that begins a drag and a press that opens a
context menu are the same gesture -- the menu won, and closed the popup it
was opened from on the way. `wireSessionDrag()` does NOT `preventDefault()`
its `pointerdown`: cancelling that cancels the compatibility mouse events
after it, `click` included, and the card stops switching sessions.

**The formatting group is centred absolutely, not by a grid track.** The
header spans the same column as the canvas, so the middle of one is the
middle of the text below -- and a grid only centres its middle track while
the two sides weigh the same, which they never do. The search is the reason
they never do, so it rests as a 34px circle at the far left and opens to a
field that changes nothing else's position.

**A sidebar row at rest is its mark, its name and its colour**, with the dot
against the right edge; the archive X opens out of zero width on hover or
while the row is part of a pick, and the dot scoots left to let it through.
Animating the X's WIDTH is what moves the dot -- an X that was merely
invisible still held its 24px -- and its left margin cancels the row's own
flex gap while it is closed, or the gap alone held the dot 6px off the edge.

**Reordering has two handles, and one of them is the whole row.** A sidebar
row drags from anywhere on it (`wireDrag(row, row, id, {anywhere: true})`,
which lets go of the buttons and of a title being renamed), and the letter
itself is the handle on the rail. `wireDrag()` takes the container and item
selectors, so both draw the same line between the two categories a drop would
land between. The grip stays as the thing that SAYS the row is draggable, and
as the touch handle -- it is the one part of the row with
`touch-action: none`, so a finger can drag from there while the rest of the
row still scrolls the list.

**`wireDrag` must never `preventDefault()` its `pointerdown`, and must not
capture the pointer until a drag has actually begun.** Cancelling pointerdown
cancels the compatibility mouse events after it, `click` included, so the row
stops jumping and the rail letters become dead buttons to a real pointer --
unnoticed for a while because the harness clicked the rail programmatically,
which is not subject to it. **Capturing** a pointer retargets those same
events, `dblclick` among them, so a row that grabbed the pointer the moment
it was touched swallowed the double-click that renames its own title. The
capture is taken in the move handler once the threshold is crossed, and the
move/up listeners live on the `window` so the pointer can leave the row
before then. `dataset.dragged` suppresses the click, and only when a drag
actually happened. Nothing needs suppressing anyway: the app is
`user-select: none`.

**A category is a framed box with its title row inside it.** `.nt-cat-box`
carries the box's fill and 3px of padding, `.nt-cat-head` sits inside that a
step more prominent, and the body sits under the head with no background of
its own -- so the "outline the colour of the text box" is the box showing
through around the head. As a real border it would have to be restated on
every hover and focus rule the fill has and would drift out of step the first
time one was missed; this cannot drift, because it is the same paint.

**The chevron and the emoji are OUT OF FLOW to the left** (`.nt-cat-aside`,
`position: absolute; right: 100%`), and the room they sit in is the canvas
column's own left padding (`--gutter`). In flow they pushed the box in by
their own 70px and the text boxes stopped sharing a left edge with the New
Category button under them, which is the one thing that says the canvas is
one column. Under 980px there is no room for a gutter, so the aside goes back
into the flow and the box gives up the width -- squeezed is worse than off
the left edge, but only just, and off the edge is unreachable.

**Hovering a category lights the STRIP, and typing in its title rings the
strip too** -- corner to corner, behind the controls at its right end. Not the
text field, which is not what you are pointing at when you point at a
category; and not the title alone, which was a rectangle inside a rectangle
fighting the name it framed.

**Clicking a title opens what it names**, and only ever opens: clicking into
a title to edit it must not shut the box you were about to look at. The
chevron was the only way in, and aiming at a 26px arrow to read something
whose name is already under the pointer is a step that need not exist.

**Three controls on the strip keep a tooltip, and it opens ABOVE them** --
More, Category colour, Archive. The strip is a 36px bar with the category's
own text directly under it, so a tip below lands on the words. They were
culled with the rest of the header's tips and asked for back by name; which
controls are tipped is a decision either way, and it is recorded in the code
beside them.

**Picking more than one.** `picked` is one Set of ids and `pickIn` says which
list it belongs to -- the live categories or the archive -- because a pick
spanning both would mean "archive these and un-archive those", which is not an
action. **Every click on a row is a selection, a plain one included**: the row
you clicked first IS the first one selected, so the Ctrl+click after it gives
you two and the Shift+click after it gives you the run from there, with no
separate "start a selection" gesture to perform. A plain click replaces the
pick with itself and still jumps; Ctrl toggles one; Shift replaces the run
from the anchor and leaves the anchor where it is, so the far end of a range
can be dragged rather than restarted. A pick of ONE is not drawn -- that row
already shows as the one being read -- but `data-picks` on the root carries
the count, because "one picked" and "none picked" are different states and
nothing else can tell them apart from the outside. **Clicking anywhere that
is not a row drops the pick**, with three exemptions: a row (which handles
its own click), a floating panel (the colour picker is opened FROM a picked
row and clicking in it must not clear what it is painting) and a modal (the
archive confirmation, which is asking about the pick).
`targets(id, list)` is what every row action asks: it returns the whole pick
when the row is in one and two or more are picked, and `[id]` otherwise, so
clicking the X on an UNpicked row is never a request to archive four others.
Archiving, recolouring and dragging a pick are each one undo step and one
dialog. `paintPicks()` prunes ids that no longer exist before it paints:
a stale id would keep counting toward `picked.size` and make a single row act
as if it had company.

**`addCat('auto')` puts a new category where you are looking** -- past
halfway down the canvas it goes to the end, above halfway to the top. The two
buttons that are themselves positional (the plus in the session header, the
New category at the very end of the canvas) stay `'top'` and `'bottom'` and
mean it.

**Switching sessions slides.** `beginSlide()` clones `.nt-canvas-inner`,
freezes the outgoing session's colour tiers onto the copy as literal values
(`--c` and everything derived from it is about to be repainted on the root),
and pushes it off in the direction of the session picked while the real one
comes in from the other side. **The copy is mounted in a layer over
`.nt-canvas`, never inside it**: every category and body lookup in the app
goes through the canvas, and a second set of them in there for the length of
an animation is a scroll spy counting sections twice and a flush walking
bodies that belong to a session nobody is in. `prefers-reduced-motion` skips
it and the function returns a no-op.

**One place holds every keystroke: the information panel** behind the ⓘ in
the header, opened by resting on it and grouped by where you would be
standing when you wanted one (Widgets / Everywhere / Outliner / Canvas /
Editor). A row is `[label, keystroke]`, or `[label, keystroke, () => node]`
which makes it a WIDGET -- the real control goes in at the right end. Undo
and redo are the two widgets, moved out of the header entirely: `Ctrl+Z` is
the whole of how they are used, so two permanent slots above the text were
paying for a gesture that never happens. They are the real buttons, not
copies, so `syncUndoButtons()` still has one of each to find. That
is what let the tooltips stop carrying keybinds -- a shortcut that lives only
in a tooltip can be found only by hovering the button you were about to press
anyway, and thirty of them is thirty places for the same fact to go stale.
Which controls keep a tooltip is a decision, not an oversight: bold, italic,
underline, the alignments, undo, redo, the chevron, the emoji and colour
buttons, the archive X, the theme, the close and the search carry none;
strikethrough, the auto list, the spell check and the nodes menu do, because
none of those four is obvious from its mark alone.

**The caret and the selection are the category's colour too.** `tints()`
returns a fourth value, `--c-sel`, which is the hue taken deep on the dark
theme and pale on the light one, then pushed until the body text clears 3:1
against it -- what is being read must not change legibility because some of
it is selected. `::selection` reads the custom properties of the element it
is over, so one rule gives every body, title and row its own.

**Escape is a ladder, not a trapdoor.** Every handler that consumes it stops
it propagating: the search closes, a rename cancels, a panel shuts, a body
blurs. Only an Escape nothing claimed reaches the `<dialog>` and closes the
notes. And the app's shortcuts are bound to the DOCUMENT, not to its own
root: a keydown bubbles from whatever has focus, focus is regularly on the
dialog or on `<body>`, and the app's root is not an ancestor of those -- so
bound to the root, every shortcut stopped working the moment a field
blurred.

**The sessions have two faces.** The badge at the top-left opens the grid;
the button under New category lists them by name with their category counts,
and only while the sidebar is wide enough to read one.

The **DexNote mark** is the session's colour swatch, in the sidebar head and
at the end of the canvas title. Clicking either opens the picker. Its lower
stroke is the same colour mixed toward black, which is how the mark is drawn.

**A rebuild keeps the scroll.** `replaceChildren` detaches every section,
which resets the canvas to the top -- so archiving a category threw the view
back to wherever it had been. `renderCanvas` restores `scrollTop` directly
(the canvas scrolls smoothly by default and an animated restore is a visible
lurch); an explicit scroll runs after and still wins.

### Colour: the session accents the page, a category colours its text

Two colours, two jobs, and they were tangled.

**The session's colour is the page's accent** -- buttons, focus rings, the
search field, the session title, the scrollbar -- and it is the colour a NEW
category is born with. Nothing else.

**A category's colour is that category's TEXT.** `tints()` in `notes/color.js`
turns one hex into three, and they are a hierarchy rather than a palette:

| tier | where | how it is made |
|---|---|---|
| `--c-body` | everything in the note box | the colour as picked |
| `--c-bold` | bold text and `<h3>` | a step further from the background, saturation x 0.88 |
| `--c-title` | the category header, its sidebar row, its rail letter | one more step, at the bold tier's saturation |

"A step further from the background" is lighter on the dark theme and darker
on the light one. Lighter is what was asked for, but on a light ground lighter
is *less* prominent, and the point of the tiers is that the title reads as the
most prominent thing -- so the direction flips with the theme and the ranking
never does. `repaintColors()` re-derives everything on a theme flip for exactly
that reason; it is cheaper than a re-render and, unlike one, it cannot move the
caret out of a focused box.

Each tier is then walked away from its own background until it clears a WCAG
contrast target -- 4.6:1 for the body against the note box, 5.6:1 for bold,
6:1 for the title against the canvas. Brightness moves first; once that is
spent, saturation, because "lighter" past full brightness means toward white.
**Without this a category picked dark navy paints its own notes invisible**,
and the picker is a free-form HSB field, so that is one drag away rather than
a hypothetical. A near-black pick comes back as a readable mid-blue.

**Why JS and not CSS.** `--c-title: var(--c)` written on `.nt-app` is
substituted **once, there**, against the session's colour. Every category then
inherits that finished value, and overriding `--c` on a section cannot reach
it -- a var() chain does not re-resolve per element. A category recoloured
green kept a blue title for exactly that reason, and it read as the colour not
having saved. `paintColor()` sets all four as literal colours on the element
that owns them, so there is no chain to resolve.

**Two specificity traps, both paid for.** `.nt-app button { color: inherit }`
is one class plus a type and outranks a plain `.nt-cat-emoji`, so every
deliberate accent on a button lost to the reset -- the category badge's letter
was neutral grey whatever the category's colour. The reset is wrapped in
`:where()` now, which has no specificity, because a reset must never beat a
rule written on purpose. And code blocks and quotes stay neutral on purpose: a
snippet should not change colour because the category around it did.

**The badge with no emoji** is a dark square ringed 2px in the note box's own
line, with the letter in the category's colour -- so an uncoloured category
and a green one are told apart from the badge alone.

### Dictation

A microphone in the bottom-right of every text box (`notes/dictate.js`). Press
it and talk; the words land at the caret and keep landing until it is pressed
again. Ten minutes with nothing said ends it, and any result at all puts the
full ten minutes back, so a brain dump lasts as long as there is talking to
do. Ctrl+Shift+M is the same switch from the keyboard.

**The caret is the insertion point, always.** Click elsewhere mid-sentence and
the next words go there; type a word and dictation continues after it; click
into another category and the session follows. There is no second cursor kept
in step with the real one -- the machinery DexNote spent six numbered fixes on
and still lost across a re-render. The only fallback is for when the caret is
genuinely gone (focus left the app): the last place it was, and failing that
the end of the last line. It is never the body's own root, because a bare text
node between two blocks is not in the schema and would come back as a
paragraph on the next load -- what was saved and what was on screen would
differ.

**Provisional words are visible but not in the document.** What the engine has
not committed to shows as grey italic text in `<span class="nt-interim">`,
`contenteditable=false` so the browser will not type into it and the caret
sits in front of it. `clearInterim()` is called at the top of `transact()` and
of `beforeinput`, and `serialize()` strips the span, so provisional text can
never be undone into, saved, or spell-checked. Nothing pulls it out from under
the engine mid-utterance either: the save path clones the body rather than
editing it, which is the half DexNote got wrong.

**Committing is a diff, not a sweep.** Chrome returns a growing list in which
an interim can turn final later, and engines disagree about what a final is:
desktop Chrome sends the NEW words, Android re-sends the WHOLE utterance.
`reduceFinals()` takes the last slot when each starts with the one before it
and the concatenation otherwise; `unwritten()` returns only the part beyond
what is already on the page. Both are exported and both shapes are driven
through them in the harness.

**A click cuts the utterance off.** Move the caret with words still
provisional and they are committed where they were said, then the recognizer
is `abort()`ed and respawned with its handlers detached. Without that, the
engine's own final for those words arrives a moment later and lands again at
the new caret -- the same sentence, twice. `stop()` would flush that final;
`abort()` discards it.

**The pill.** Scroll the box out of sight and a pill appears at the top-left
of the canvas, just clear of the sidebar: what is being dictated into, how
long for, a click back to it, and a stop. A session running three screens up
is otherwise invisible and still writing. Its border is 3px of the dictation
red (`#d6423f`) -- at the original 1.5px hairline it read as a tooltip rather
than as something live.

**It is on the left at every width, and only one offset is ever set.** It used
to flip to `right: 12px` under 980px and to `left: 12px; right: 12px` under
720 -- and setting both offsets on an absolutely positioned box stretches it,
so a window dragged to half a screen showed the chip hard right, and half a
screen at 175% display scaling (under 720 CSS px) showed it as a banner across
the whole canvas. A status chip that changes corner and then changes shape is
three different objects. The 720 rule had a real reason and is replaced rather
than deleted: below that width the sidebar is a full-width drawer (`--sb:
82vw`) and the base `left: calc(var(--sb) + 14px)` would put the pill off the
right edge -- but the answer is a smaller LEFT, since the drawer is an overlay
there and the canvas starts at 0. A `max-width` does the job a right offset was
doing, so the box stays shrink-to-fit and a long category name ellipsises
inside `.nt-pill-main` (which needs `min-width: 0` to be allowed to shrink).
`notes_dictate_check` drives all three bands.

**And the live box wears a ring of the same red**, on `.nt-cat-box` and on the
emoji badge beside it. The microphone is a 30px circle in one corner of one
box on a canvas of them, and "which box are my words going into" is a question
asked from anywhere on that canvas -- so the answer is drawn at the size of the
box. `paintButtons()` toggles `.nt-cat.is-dictating` from the same `live` the
mic reads, in the same pass, because the button and the box are one state and
two places computing it is two places for it to disagree.

It is a **box-shadow ring, not a border**: `.nt-cat-box`'s 3px of padding IS
the frame around the head strip, so a real border would shove every word in the
category sideways the moment recording started. `notes_dictate_check` asserts
the padding is still 3px for exactly that reason, that precisely ONE category
carries the ring and that it is the one whose mic is lit, and that the ring is
gone after the silence cap fires -- a ring that appears is half the feature.

Widths are written as whole pixels because Chrome snaps a border width to
layout pixels: `3.5px` is drawn as `3px`, and a stylesheet naming a width the
browser will not use is a stylesheet that lies.

Restarts are expected, not exceptional: `continuous` does not mean forever, so
`onend` spawns a fresh recognizer unless the stop was deliberate. A monotonic
session id makes a late `onend` from a dead recognizer inert, and six empty
restarts inside eight seconds is a wedged engine rather than a quiet room, so
it gives up and says so. `not-allowed`, `audio-capture` and a wedged engine
each get their own message -- DexNote showed nothing at all, so a denied
permission looked exactly like a dead button.

**The microphone has to be allowed by the page.** `vercel.json` sent
`Permissions-Policy: microphone=()`, which forbids it to every origin
including this one; SpeechRecognition is gated on that policy and fails with
`not-allowed` before any prompt appears. It is `microphone=(self)` now.

**TWO EARCONS: one sound with a direction.** A rising perfect fifth (D5 → A5)
opens a session and the same two notes falling close it, so "it started" and
"it stopped" are not two things to learn. About 250ms end to end and peaking
under a tenth of full scale, because the start sound plays in the moment
before someone begins talking — anything with a tail is something the
microphone then hears.

They are SYNTHESISED, and that is a CSP fact rather than a preference. The
site ships `media-src 'self' https://vz-...`, so an `<audio>` pointed at a
`data:` or `blob:` URI is refused outright — MediaBus's silent hold logs
exactly that on the dev server. A file under `assets/` would pass `'self'`,
but then two sine waves cost bytes on the wire, a licence to track and an
asset the image pipeline knows nothing about. A WebAudio graph never goes
through `media-src` at all.

The ON sound fires in `start()`, ONCE PER SESSION — never in `spawn()`. A
session outlives its recognizer (`onend` spawns a fresh one every minute or
so), so a sound hung on the recognizer starting would chirp at someone
mid-sentence about machinery that is none of their business. The OFF sound
fires in `stop()` for every reason except `'switch'`: moving between boxes
stops one session and starts the next in the same breath, and two blips back
to back would report the machinery rather than the move.

`earconGraph(ctx, kind, t0)` is exported so the sound can be RENDERED rather
than only watched. A spy that records what the app scheduled cannot tell
whether the nodes were connected to anything — a missing `connect()` schedules
every note correctly and makes silence — so `notes_dictate_check` renders the
real graph through an `OfflineAudioContext` and reads the samples: two bursts
of energy, in order, quiet again afterwards. The note-by-note assertions come
from a fake `AudioContext` in the stub, which also catches the case where a
suspended context is resumed after `currentTime` is read and the pair lands as
a chord.

**YOU CAN LEAVE THE NOTES WITH THE MICROPHONE STILL ON.** Closing the overlay
normally throws the document out of the DOM — `teardown()` in script.js empties
the container on purpose, so the notes are not one devtools panel away for the
rest of the visit. Dictation is the one exception, and it cannot work any other
way: dictated words land at a caret in a body, and a body that has been thrown
away has no caret. Buffering them in a variable instead would mean nothing
reaches the store until the notes are reopened, so a tab closed after five
minutes of talking loses five minutes of talking — worse than the thing being
protected against.

So `relock()` splits. With a session live it calls `park()`: the app stays
mounted inside the closed `<dialog>`, and `#notesRec` — a chip at the top-left
of the page, body level because a child of a closed dialog is `display:none` —
names the box, counts the session's own clock, opens the notes again with no
password (nothing was locked; the document never left), and stops the
recording. The way back in is a button with the `fullscreen` mark on it as well
as the label: a name that happens to be clickable is not an affordance.

**It sits beside the nav rail and travels with it.** `--rail-w` is written from
a `ResizeObserver` on the sidebar, only while the chip is up. The rail expands
on hover AND on real keyboard focus, guarded by `.no-focus-expand`; a CSS copy
of that condition beside the chip would be a second copy of a rule to keep in
step, and it would be the copy nobody remembers. The observer reports the width
the sidebar actually has, on every frame of its transition. The chip therefore
has NO transition of its own — a second easing on top made it chase the rail
instead of travelling with it, and for the length of that chase it sat on top
of the nav, which is the one thing it must never do. `notes_dictate_check`
samples the whole retraction rather than its endpoint, because that overlap
only exists while the rail is moving. The moment dictation ends by ANY route — the chip's stop,
the ten-minute cap, a refused microphone, another tab claiming it — `finish()`
runs `teardown()`. That is what `dictate.onEnd()` is for, and `park()`
subscribes before doing anything else so no exit path can skip it.

The exception is therefore open for exactly as long as a microphone is running,
which is a window the reader opened deliberately, can see the whole time, and
can close with one press. The AI Lab sandbox does not park (`demoMode`): a
"recording" chip over the portfolio for a demo someone clicked an eyeball on is
a chip nobody asked for. See docs/DECISIONS.md.

**The session ends by itself after ten minutes with nothing heard**
(`SILENCE_MS`), checked once a second by the same interval that paints the
pill. Any result at all resets it — including an interim the engine later
discards — so the clock measures silence, not sentences. Separately, six empty
restarts inside eight seconds (`DEAD_RESTARTS` / `DEAD_WINDOW_MS`) is a wedged
engine rather than a quiet room, and ends it with a different message.

### The AI Lab sandbox

The eyeball on the DexNote card opens this same app with `format: 'demo'` and
**no token** (`openDemo()` in script.js, `demoDoc()` in `notes/state.js`). It
is the one preview in the AI Lab that points at no iframe: the app is already
on the page, so the preview IS the editor rather than a screenshot or a second
copy.

Nothing is switched off in it -- typing, dictation, undo, images, sessions all
work -- and the save loop is the only thing absent. **The absence of a token
is what makes it safe, not a flag it checks:** with no token there is no
request to `/api/notes/*` that would be answered, so a visitor cannot read,
write or flood the real notes, and cannot reach the keypad from here. The
document is built in memory, closing the overlay unmounts the app and empties
the container, and images live in `ctx.demoAssets` as object URLs that are
revoked on unmount. `notes_dictate_check.mjs` counts every request the page
makes while the sandbox is open and asserts the real document on disk is
byte-identical afterwards.

### The dev loop

`tools/notes_dev_server.mjs` serves the repo with the shipped CSP header and
routes `/api/notes/*` to the real handlers with `NOTES_DEV_DIR` on disk.
`notes_check.mjs` resets that store to the pre-rebuild state at the start of
every run and walks the migration. `notes_editor_check.mjs` drives real keys
through a scratch category it deletes at the end. `notes_dictate_check.mjs`
installs a fake SpeechRecognition and a fake clock before any page script runs,
so the whole dictation pipeline is exercised for real -- the restart loop and
both engines' result shapes included -- and the ten-minute cap is tested in a
second. `notes_store_check.mjs` needs no server, and its stub tallies every
`get`/`list`/`put`/`del` so the cost of a save is asserted as a count rather
than as "fewer than before"; a last block asserts each of the four kinds was
really seen, so an "expected 0" cannot pass on a counter nobody wired up.

**`tools/notes_rescue.mjs` is for the LIVE store, and is not part of that
set.** It requires `BLOB_READ_WRITE_TOKEN` and refuses to run with
`NOTES_DEV_DIR` set, because a tool for looking at production that quietly
looks at a scratch directory instead is worse than no tool. It reads
`notes/current.json` through `lib/notes-store.js`'s own code path, says which
way it is broken if it is -- the blob call threw, the bytes are not JSON, the
shape is wrong -- checks every backup rather than merely listing them, and
`--restore` puts one back. It writes only on `--restore`, and keeps the
current bytes first whatever state they are in: a restore that throws away
the only copy of a damaged document throws away the evidence.

It exists because **SERVER ERROR on the notes gate is never a wrong
password.** `unlock.js` checks the password first and only fills in `detail`
once it has passed, so that message means the password was accepted and
`readNotes()` then threw. Before this there was no way to see which of the
three causes it was without deploying a change, which is the worst possible
moment to be deploying changes.

**`tools/notes_import.mjs` is the other tool that writes to the live store**,
and it carries the same guards: no `NOTES_DEV_DIR` unless `--dev` says so, no
run without `BLOB_READ_WRITE_TOKEN`, dry run unless `--write`. It appends
whole sessions from a JSON seed and touches nothing that is already there --
it refuses outright if a session title already exists, so a second run cannot
duplicate an import. The write goes through `writeNotes(doc, rev)` with the
rev it read, so a save from a notes tab left open comes back as a conflict and
nothing is written; that is the tool's own guard and it has been raced.

**Its body check is the part worth keeping.** A category `body` is schema HTML
(`notes/schema.js`), and a body that `clean()` rewrites looks different after
the first reload than it did going in -- which reads as the import being
broken rather than as the body being wrong. `clean()` needs a DOM, so the tool
loads the shipped module in a real browser against `notes_dev_server.mjs` and
asserts `clean(body) === body` **and** that a `clean()` → `serialize()` round
trip comes back byte-identical, because a body that survives one and not the
other still drifts on the first edit. No dev server, no `--write`; the count
checked is printed and asserted against the number of bodies there are.

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
remote/                  the media-key extension. THE SITE IS SERVED AT
                         https://dexcimino.com -- written here because it was
                         recorded nowhere in this repo at all, and remote/
                         needs it in two files
tools/music_check.mjs    352 checks in a real browser, serves the repo itself,
                         reaches NO network — the embed is intercepted
tools/music_flag_check.mjs  21 checks that DO reach YouTube: a real embed
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

**THE CODE STARTS THE MUSIC.** Typing MUSIC into the keypad opens the list
with a track already playing: that was a request to HEAR the songs, not to look
at a list of them, and making the reader find a second control after getting a
password right was a step doing no work (Dex, 2026-09-07). `open()` calls the
same `startFresh()` the play button used to, so shuffle on means a track that is
not the one `music-last` names and shuffle off means the top of the list.
Nothing auto-starts over something already going — coming back from the docked
bar leaves `index` set and lands on `idle()` instead. Autoplay is not a gamble
here: the code was typed, so the page has sticky user activation, and the frame
carries `allow="autoplay"`; a browser that refuses anyway leaves the track
sitting in the bar with a play button, which is where a refused click landed
before, and the stall watchdog is not armed outside a dead run so nothing is
flagged for it.

**AND A CLICK THAT LANDS BEFORE THE EMBED HAS SPOKEN NAVIGATES THE FRAME
AGAIN.** `loadVideoById` posted into a player that has not answered yet is
simply gone, so the click did nothing and the auto-started song carried on — a
race that was theoretical while the first track of a session was always a
click, and the normal case once the code starts one. `ready` is set by the
first message the embed sends BACK, not by the iframe's `load` event: measured
against a real embed, the frame fires load, we post `listening`, and a command
sent in that same turn is still dropped. Until then `load()` re-points `src`,
which is the path the first track always took and is made under the reader's
own click.

**PAST THE FIRST FEW SECONDS, PREVIOUS RESTARTS THE TRACK.** `RESTART_AFTER` is
5 seconds against `position`, the embed's own clock kept beside the painted one
(`paintTime()` is a cache that skips its work mid-drag, and Previous has to know
the position even then). Long enough to reach deliberately, short enough that
two quick presses still get you to the previous song. Zero — the value before
the embed has said anything — falls through to the history, because a track that
has not started cannot be restarted. Only `music_flag_check.mjs` can test this:
there is no `getCurrentTime` across an origin, the player volunteers the number
in its `infoDelivery` messages, so a harness that intercepts YouTube has a clock
that never moves and a rule that can never fire.

**PREVIOUS NEVER SHUFFLES.** Shuffle decides what comes NEXT; back is always the
song you just heard, which is the only reason anyone presses it. So the player
keeps `history`, a capped list of the video ids it has actually played, and
Previous pops that rather than reading `index - 1` — which with shuffle on is
the row ALPHABETICALLY above a random pick, a second shuffle wearing the back
button's clothes (reported by Dex, 2026-09-07). Ids and not indices, for the same
reason `render()` re-finds the playing track by id: a search or a re-sort
renumbers the queue under a live player, and an id no longer in the visible list
is skipped rather than followed. `load()` records the outgoing track except on a
rewind — recording there would ping-pong between the last two songs instead of
walking back — `stop()` clears the list with the player, and a track the embed
REFUSED is popped back off, because going back to a dead link only skips forward
again and lands somewhere new. At the bottom of the history with shuffle on the
current track restarts, which is what every other player does at the top of a
queue; with shuffle off the list order is the play order, so the row above stays
the fallback. One transport serves both the overlay and the docked corner bar, so
this is one fix in both places. `music_check.mjs` 7e drives it three presses deep
and refuses the old code.

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

### No sound without a control

**THE RULE IS HARD (Dex, 2026-09-10): if something on this page is making
noise, there is a control for it on screen.** Not "usually", and not "unless a
bug". A song was found playing three times with nothing to stop it — once
traced, twice not, and "twice not" is exactly why the rule needs a backstop and
not only a fix.

**The traced cause was `bindModal`'s hand-off branch.** Its close handler took
an early return whenever another overlay was already open, and that return
skipped `onClose` as well as the focus restoration. The music player's
`onClose` is what re-shows its bar in the corner — so opening any overlay OVER
a playing music LIST closed the list, skipped the redock, and left the embed
`armed` with its `src`, playing, with `modal.open` false. Audio from nowhere.
The notes' `onClose` had the same hole in a different shape: replaced by
another overlay, the document stayed mounted and unlocked. Only the FOCUS is
skipped on a hand-off now. Every `onClose` in the file is about ENDING
something — relock, redock, reset a keypad — and none of them is about the
overlay that replaced it.

**The backstop is `MediaBus.guard()`.** For each registered player: is it
audible, and is a control for it reachable? If not, ask it to put one up —
then **ask again**, because a reveal that did not work is the failure this
exists for — and only then pause it. Silence is the worst outcome except for
the one it replaces.

- `audible` is `p.live` for a player that reports to `playbackState()`, and
  `!el.paused` for one that does not. The distinction is load-bearing: the
  music embed's `el.paused` answers "is a track loaded" and stays false all the
  way through a pause.
- `reachable` is the player's own `control()`, falling back to `onScreen()`.
  They are not the same question. The space bar wants "is the reader looking at
  this"; the guard wants "could they reach the pause button" — so the clips
  player's `control` is its panel being the open tab, without `onScreen`'s
  viewport test, because scrolling past a playing clip does not take its
  controls away.
- `reveal()` is optional and is the player's OWN path back on screen: the music
  player's is `redock()`, the songs bar's is the same `reveal()` a track start
  uses. The clips player has none on purpose — changing someone's open tab to
  explain a noise is worse than stopping the noise.

**IT IS A POLL, AND IT IS NOT RUN FROM `playbackState`.** Running it there for
one afternoon looked tidier and was wrong: a player reporting that it has
started is the exact moment another one is being silenced by `solo()`, and the
two are not ordered. The guard fired mid-hand-off, found the outgoing player
still audible with its overlay already gone, and REVEALED it — putting a music
bar back up around a track that was two lines from being stopped, and handing
it the arrow keys the new player had just claimed. `music_check` caught it as
"ArrowRight on the songs bar went to card 0". **A backstop is for states that
PERSIST**; three seconds is far below "how long can a mystery noise play", and
the body costs four property reads when nothing is playing. `visibilitychange`
and `pageshow` cover coming back to the tab and the back/forward cache.

`MediaBus.audit()` reports what the guard can see, for the same reason
`holdState()` exists: a rule nobody can inspect is a rule nobody can prove
still works. `music_check` block 8c-3 reproduces the traced cause, then forces
the state again with `removeAttribute('open')` — no event at all, which is the
shape of every arrival nobody has been able to trace — and asserts the guard
comes back out of it.

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

**AND THEY ARE ONE DESIGN, MEASURED AGAINST EACH OTHER.** Two players over two
listings, one transport: a reader who has learned one has learned the other
(Dex, 2026-09-07). The docked bar was built to `.player`'s measurements and the
two had since drifted — 44px play against 46, 20px icons against 22, a 100px
bar against 105 — so `.player` now takes the docked bar's numbers, including
the 59px artwork that makes both bars the same height. The ONE deliberate
difference is that box's width: 104px and 16:9 for a video thumbnail, square
for album art, because `object-fit:cover` into 16:9 takes the top and bottom off
every cover. `music_check.mjs` 8e puts both bars on screen at once and compares
the boxes — not the stylesheets, which both declared the right numbers while the
docked play button was a rounded square.

**The songs bar's Previous is the music bar's Previous**: the same history of
what was actually played, the same five-second restart, the same refusal to
shuffle backwards. It was worse here before — Previous was handed straight to
the shuffle picker, so back while shuffled served a random song. Indices and not
video ids, because `cards` is built once from the grid and never re-sorted,
where the music queue is re-filtered under a live player. Shuffle and repeat are
remembered too (`dex-song-shuffle`, `dex-song-loop`); the DEFAULTS stay off,
against the music list's shuffle-on and repeat-all, because five cards you can
see on the page are not 311 you cannot.

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

### The remote pill — the transport inside another overlay

Docking has one gap, and it is a direct consequence of what makes docking work.
`show()` is the non-modal form, which is the whole point — nothing inert, the
page live around the bar — and a non-modal dialog is **not in the top layer**.
So the moment anything opens with `showModal()`, the docked bar is painted under
that dialog's backdrop: playing, holding the OS media session, unreachable.

`#musicRemote` is the answer: the same transport as a vertical pill, drawn
inside the overlay that is covering the bar. `initMusicRemote()` in `script.js`,
`.music-remote*` in `styles.css`, markup at the end of `<body>`.

**It is ONE element, and it MOVES.** Being a descendant of the open modal is the
only way to share its top layer. The reason the PLAYER can never move — an
iframe reloads when it is reparented — does not apply to a row of buttons, so
this is appended into the host and taken back out to `<body>` when there is no
host. Two copies would mean the hidden one is the one that goes stale.

**It owns no state.** Every button calls `.click()` on the real control in the
bar; every value it draws is read back off that bar. That is the rule `MediaBus`
already follows (`next: () => btnNext.click()`, so a Previous that restarts a
track you are into stays one implementation). A `MutationObserver` watches eight
specific nodes — the two toggle buttons' subtrees, shuffle, repeat, the volume
input's `style` attribute, the thumbnail's `src`, and the two now-playing text
nodes. Deliberately **not** the whole `.music-bar`: the embed volunteers a time
several times a second, so the scrub and the clock change constantly and neither
is drawn here.

**Two signals, both facts rather than callbacks.** `<html>` carries `music-live`
whenever `armed` is true, toggled in `paint()` — `armed` means the embed is
holding a track, playing or paused, which is exactly "there is music to
control". And a host declares itself with `data-music-remote` on its `<dialog>`
(the notes overlay is the only one today) and says where its own header ends in
CSS: `.notes-modal .music-remote{top:66px}`, clearing the app's 52px header.
Nothing in the pill names a host, and nothing in a host reaches into the pill.

**Order, outward from the corner:** artwork, shuffle, next, PLAY, previous,
repeat, a vertical volume slider, mute. Symmetric around the one circular
button, the same rule the wide bar's transport follows. The slider is
`.player-range` rotated -90deg — the painted `--fill` track, the white thumb
that reads against both halves and the 22px hit area are decisions already made
once. Zero ends up at the bottom, which is the only direction in which up can
mean louder. The title and artist are a two-line tooltip out to the left of the
artwork: a 54px column cannot carry a song title.

**THE ARTWORK IS ALSO THE FOLD.** Pressing it collapses the column to the cover
alone — one circle, same 3px edge — and pressing it again brings the transport
back. It is the right control for the job because it is the one part of the pill
that is not a transport button: nothing is lost by giving it a second meaning,
and a fold arrow of its own would be a tenth thing in a column that is already
tall. It is a `<button>` rather than the `role="img"` div it started as, so the
keyboard, the focus ring and `aria-expanded` come for free. Folding is
`display:none` on everything but the cover and the corner tab, not a width
collapse — a 0px flex column still pays for its children's layout, and getting
out of the way is the whole point.

**AND IT CHANGES CORNERS.** A tab on the end away from the anchor moves it
between the top-right and the bottom-right, with the chevron pointing at where
it will go. At the bottom the column REVERSES (`flex-direction:
column-reverse`), so the cover stays the end nearest the corner and the volume
stays beside it: the pill reads outward from whichever corner it is anchored
to. Anchoring without reversing would be the same list upside down rather than
the same object moved. The tab is absolutely positioned on the pill rather than
being a flex child, so `column-reverse` cannot carry it into the stack, and it
shows folded as well as expanded — a circle in the wrong corner is exactly when
you want to move it. It is the MARK ALONE, in the accent: it was drawn in the
pill's own background and border, which made it read as a tenth control bolted
to the end of nine, and the pill already has one circle — the play button —
whose whole job is being the only one. The target stayed 26px; only the paint
went.

**The corner is remembered and the fold is not.** `music-remote-side` in
localStorage, beside the shuffle, repeat and volume the music player already
keeps: a placement someone chose is not a placement they should choose again
every visit. A fold is the opposite — something you do to get the pill out of
the way for a minute — so `place()` clears it whenever the pill is put away,
and every appearance opens showing the transport. Clearing it on the way OUT
and not on the way in matters: `place()` runs on every state change while the
pill is up, so clearing there would unfold it under the reader's hand the next
time a track changed.

**Where it sits in a host is a VARIABLE, not a `top`.** The bottom corner has to
clear `top` outright, and a host rule setting `top` directly would tie with
`.at-bottom` on specificity and be decided by file order. `.notes-modal
.music-remote` sets `--remote-top: 66px` (clearing the notes app's 52px header)
and the pill reads `top: var(--remote-top, 14px)`.

**No stop and no seek.** Ending the music from inside another overlay is
something you would only do by accident, and a seek bar three centimetres tall
is one nobody can land on. Both are one press of the expand tab away.

`music_check.mjs` block 8c-2 drives it, in its own player: with YouTube
unreachable the embed never handshakes, so every track change re-navigates the
frame — which is exactly what block 8c counts across its whole length. It also
hit-tests the centre of the play button with `elementFromPoint` and presses it
with a real click, because a pill that is present, unhidden and correctly
positioned is still useless if it is painted under the backdrop. The fold and
the corner are pressed with a real pointer too, and every point is re-measured
before every press: the pill moves in that block, and a stale click on a pill
that has gone does not miss quietly — it lands on the host `<dialog>` itself,
whose backdrop handler closes the overlay.

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
