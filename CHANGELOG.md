# CHANGELOG

## V34
**Quote cards: the 1/2 pager becomes two dots, and hover no longer touches the text.**
- The second-version control is a pill of two dots instead of the numerals `1 2`. The active dot takes `var(--accent)`, the other the same `#39424b` the suggestion cycler's dashes use — and it literally shares that rule rather than restating the size and grey, so the two cannot drift apart.
- **Hover preview is gone.** `pointerenter` / `pointerleave` / `focus` / `blur` previewing the second version have all been deleted; a click or tap is now the only thing that changes a quote. Hover still lights the pill, which is CSS on the control and cannot reach the text.
- The pill carries ~28px of height around 8px dots so the tap target is honest, with a negative vertical margin so buying that target does not make the card's foot taller.
- The height lock stays. It was written to stop a flicker that only hover could cause, and that loop is now impossible — but a card that resizes under a click is still worse than one that does not, so it keeps its place on its own merit.
- Accessibility unchanged in kind: still a real `<button>` carrying `aria-pressed`, now labelled "Show the second version of this quote", with the dots `aria-hidden` as the indicators they are.

**New PREFS tab — ten takes, two votes each.**
- Last tab in TOP PICKS, ten landscape cards laid out 5 across and 2 down. Each is one line of type (`Dog > Cat`) over its two vote controls, both centred in the card rather than split header-and-footer - the card is a small composition, not a layout. No images anywhere in the panel; the carousel's decode gate already resolves instantly on an empty image set, so nothing waits on a decode that cannot happen.
- Votes are **fire** and **poop** icons registered through the existing mask system (`assets/icons/fire.svg`, `poop.svg` — solid single-colour silhouettes), so grey → accent is the same `currentColor` swap every other icon on the site uses. Emoji would have been full-colour and different on every OS.
- Each vote is a bordered rectangle button rather than an icon with a number beside it, so it reads as something to press: its own outline, fill and radius, all three taking the accent together when chosen. Poop sits left and fire right, ordered in the DOM rather than with CSS `order`, so the keyboard walks them the way they look.
- **One browser, one opinion, and that is the ceiling.** There is no server behind this page, so one-vote-per-person is not on the table — that needs something server-side to see who is asking. `localStorage` under `dex.prefs.votes` remembers *your* pick for all ten cards; the number shown is the card's `data-fire` / `data-poop` seed plus your own vote. Nothing is shared between visitors, a private window is a new voter, and the counts are a mood rather than a poll. Every storage call is wrapped — `localStorage` throws outright in some privacy modes and a panel of ten cards must not vanish because a getter raised.
- One vote per card: picking the other side moves it, pressing the active one takes it back. Real `<button>`s, so Enter and Space work and focus is visible.
- Seeds live in the markup as attributes so they can be retuned without opening `script.js`. The tenth card reads `S&V > All Seasoning`; its storage key stays `sv-seasoning`, because renaming a key orphans a vote somebody already cast.
- **The suggestion popover was deliberately left at six categories** — PREFS does not join the cycler, because a preference is not something a stranger suggests. That is the "leave it alone" branch of the brief's decision point (3), so there is no `DECISIONS.md` entry to write.

**Shows tab reshuffled.**
- Devs added at #2, Severance now #3, Rick and Morty dropped. Poster came from TMDB's public pages at w780 like the rest of the tab; the retired master and its six derivatives are pruned, and one `git checkout` away if it comes back.

## V33
**Diagonals rebuilt to match the reference exactly.**
- Scrapped the V32 gradient-shaded bands. New flat composition: navy base, top-left light→medium gray triangle, a fuller semi-light gray band, a barely-lighter gray below it, and a lighter bottom-right corner shape — all theme-constant.
- The accent is now **pure `var(--accent)`** (no color-mix), so the wedge exactly matches every other accent element. Two pieces: the big back wedge with a hard top edge anchored to the top-right corner, opacity falling 100%→0% away from the edge; and a front band crossing the mascot's waist with a crisp edge and a lower falloff to 0%. Both fades are masks, so the color still crossfades cleanly on theme change.
- Back wedge and front band share the same top-right anchor and angle, so they stay parallel/colinear at any viewport width — the foreground diagonal is locked to the background.
- The whole background now **scrolls with the page** (`position:absolute`, parallax removed from bands and mascot) so the scene moves as one rigid composition.
- Added a faint mirrored mascot reflection sitting on the front band below the waist edge (swaps with the theme like the other mascots).
- Page base lightened to the reference navy (`#1a1f28`); grain kept subtle.

**Featured Work title:** +3px (now ~18–21px) and weight 800→700 — bigger, less bold.

## V32
**Diagonal background system (per reference).**
- Found + fixed the reason background diagonals never showed: `body` painted its own background, which by CSS paint order covers negative-z-index fixed children — the `.bg` layer had been invisible in every browser since the rebuild. `html` now owns the page fill; `body` paints none.
- Rebuilt `.bg` as a layered diagonal composition: base vertical gradient (lighter at top), three gray bands with their own light→dark→light gradients (theme-constant), and one accent band sweeping from the top-right corner behind the mascot. Each band keeps its color in `background-color` (crossfades on theme change) and its shading in a static gradient overlay, so theme switches stay flash-free.
- Added a second, brighter accent band **in front of** the mascot (z-order between art and copy) crossing the lower body, fading from gray at its lower-left into the accent toward the top — per reference. Recolors with the theme.
- Upgraded the grain to two procedural layers (fine grain + coarse mottle) for a subtle grunge finish.
- All four bands drift on scroll parallax (data-driven speeds instead of three hardcoded lines).

**Featured Work row (per reference).**
- Fixed a specificity bug that made the FEATURED WORK heading render at 32–64px (the big `.section-head h2` rule outranked its intended size). Now ~15–18px like the reference.
- Replaced the 3 wide cards with 4 taller cards: ENVIRONMENT, PROP / DESIGN, CHARACTER, CONCEPT / BRAINSTORM — category + title + corner arrow, like the reference. Card images are placeholders; swap each `<img>`/title for the real piece (the concept card is a styled brand-mark placeholder until there's art).
- VIEW ALL WORK bumped 12→14px with a new rounded play-triangle icon (`assets/icons/play.svg`, baked).

**Misc.**
- Accent picker label: "ACCENT COLOR" → "ACCENT".

## V31
**Fixed: all masked icons + CIMINO invisible when opening `index.html` by double-click.**
- Root cause: CSS `mask-image` is fetched with CORS enforced. Pages opened via `file://` have an opaque origin, so browsers silently refuse external mask URLs — every masked graphic vanished while plain `<img>` assets still loaded. Served over `http://` it worked, which is why V30 passed verification.
- Fix: all mask SVGs (16 icons + CIMINO) are now baked into `styles.css` as `data:` URIs, which load on any protocol. Verified via headless Chrome on `file://`: CIMINO region again renders 1,389 px of exact `#9BEF36`; `http://` unchanged.
- The SVG files in `assets/` remain the editable masters. After editing/replacing one of them, run `python tools/bake_icons.py` to regenerate the CSS block (markers in `styles.css` show exactly what's generated). Mascots, photos, and `DEX.svg` are still plain replace-and-refresh.
- Wrapped `history.replaceState` in try/catch for `file://` safety.

## V30
**Exact accent color everywhere + no more color flash.**
- Replaced the entire CSS-filter tint system (`invert/sepia/hue-rotate` chains) with a single mask-based icon system: every tinted SVG is now a CSS `mask` painted with `background-color`. Colors are the *exact* accent hex — no more faded/off-accent CIMINO or sidebar icons.
- Fixed the CIMINO color flash on theme change: `background-color` transitions cleanly, unlike filter chains which interpolate through garbage intermediate colors. The theme switch is now one smooth crossfade on a shared easing curve (`--accent-ease`).
- CIMINO keeps `assets/logos/CIMINO.svg` as the source of truth: an invisible `<img>` sizer preserves the file's aspect ratio, and an overlay paints that same file as an accent-colored mask. Replace the file, refresh, done.
- JS accent themes now set only `--accent` (one variable) — the per-theme filter strings are gone.

**Smarter docked accent picker.**
- Rebuilt the compact (scrolled) picker as a proper vertical disclosure: the active hex docks top-right and the other six cascade out of it with a stagger, on a blurred backing panel.
- Opens on hover (pointer devices), tap-to-toggle on touch, full keyboard support: focus opens it, Arrow keys walk the stack (vertical when docked, horizontal inline), Escape closes and returns focus, outside-tap closes.
- Correct ARIA: `aria-pressed` on swatches, `aria-expanded` on the docked toggle.

**Icons + polish.**
- Restored the missing RESUME download arrow (hero button + sidebar RESUME row).
- New higher-quality games controller icon; new brand-accurate social icons: YouTube, Instagram, LinkedIn, GitHub (ArtStation removed per spec).
- Social icons idle in neutral grey and take the exact accent on hover, matching nav behavior.
- Sidebar now opens on keyboard focus (`:focus-within`), not just hover; added skip-link, `:focus-visible` styles, favicon, `theme-color`, image preloads for both wordmarks, `loading="lazy"` on below-fold imagery.
- Reveal observer now unobserves after firing; `localStorage` wrapped for private-mode safety; removed dead assets (`featured-mark.svg`, `artstation.svg`).
- Verified in headless Chrome: CIMINO region renders 1,389 px of exact `#9BEF36` (only anti-aliasing besides background), theme persistence works, docked picker and scroll-spy confirmed.

## V29
- Restored sidebar icons as direct external SVG images so they render reliably.
- Restored CIMINO as direct `assets/logos/CIMINO.svg`, so replacing the source file updates on refresh.
- CIMINO and active sidebar icons use the shared accent theme filter.
- Reordered sidebar bottom to RESUME → CONTACT → PROFILE.
- Added four placeholder social icons under the profile: LinkedIn, Instagram, GitHub, ArtStation.

## V28
- Fixed CIMINO rendering: external SVG is now used as an exact-color CSS mask.
- Removed OBJECT/SVG tint JS that caused the white rectangle and color flashing.
- Reduced Featured Work heading/cards to match the approved reference scale.
- Nav active/hover icons now use exact `--accent` color via SVG masks instead of approximate filters.
- View All Work arrow now uses the exact accent color.
- Added supplied `assets/icons/tick_mark.svg` before Featured Work and tied it to `--accent`.

# Changelog

## V27
- Added a sticky compact accent picker: after the top row scrolls away, the active hollow hex stays fixed at top-right; hover/focus expands the full palette vertically.
- Compact palette hexes rotate 90° and animate open/closed; choosing a new color makes that hex the collapsed active swatch.
- Moved the hero mascot down 15px and nudged the top accent controls down another 5px.
- Added a short rounded accent divider with a 100% → 0% opacity fade between the role line and intro copy.
- Increased the visual gap between DEX and CIMINO.
- Reworked CIMINO tinting to use the external `assets/logos/CIMINO.svg` as the source of truth, tinting its loaded SVG shapes directly and hiding it until tint is applied to eliminate the wrong-color flash.
- No service worker or image embedding: replacing same-path assets still updates the site on refresh.

## V26
- Replaced CIMINO with the newest external `assets/logos/CIMINO.svg`.
- DEX and CIMINO are both file-backed assets so replacing the files updates the site on refresh.
- CIMINO tint follows the selected accent using a CSS filter; the SVG itself remains external/editable.
- Consolidated the project into one clean root structure; removed per-version notes and image-placement documents.
- Moved general imagery to `assets/images/`.
- Centralized reusable UI artwork in `assets/icons/`.
- Increased ACCENT label, hero descriptor/body copy, and VIEW ALL WORK sizes.
- Added external arrow/download icons to hero buttons.
- Added accent-colored FEATURED WORK mark and cleaner VIEW ALL WORK arrow.
- Nudged the accent picker down and left.
- Strengthened the large accent diagonal behind the page content.

## V25
- Added external mascot theme variants.
- Added sidebar profile/contact controls.
- Added inline CIMINO workaround (removed in V26 in favor of external source-of-truth assets).

## V24
- Improved sidebar scroll-state behavior and hero positioning.

## V23
- Moved composition closer to the approved homepage reference.
