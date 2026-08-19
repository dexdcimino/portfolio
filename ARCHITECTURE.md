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
  Lab (5 tabs), about/toolkit/picks, Idea Vault (AES-GCM blob in
  `data-vault`), contact. Eight native `<dialog>` overlays (app embed,
  wallpaper lightbox, prompt reader, vault, shared game/app gallery, work
  mockup, resume, contact)
- `script.js` — plain script, feature blocks as IIFEs, executes top-to-bottom
  with `<script>` at the end of body. Major blocks: accent/theme system
  (7 accents; `applyAccent` sets `--accent`, rebuilds the SVG favicon,
  swaps mascots), `probeMascot()` (clones the real `<picture>` so the browser
  negotiates the one true file — **never hand-build derivative URLs**), Work
  overlay (**mockup** — see CLAUDE.md; `TEMPORARY MOCKUP DATA` block, filler
  SVGs; everything after it renders `{title, desc, src, w, h}` and is
  data-shape-agnostic; hero is a fixed 3:2 box on purpose), one `initTabs()`
  behind four tablists, wallpapers carousel/lightbox (self-builds from
  `.wp-item` figures), vault, clips, prompts, song player, resume overlay,
  Web3Forms contact (public access key — by design)
- `styles.css` — banner-delimited sections; icon system is baked CSS mask
  data-URIs (`tools/bake_icons.py`); accents are one `--accent` variable,
  never filter chains
- Root wrapper folders `surveyor/ chomp/ arena1/ stickland/` — thin pages
  that iframe `/games/<name>/index.html`, focus the frame (so Escape/WASD
  reach the game), forward the query string, and leave the game on refresh
  (`refresh-home.js`, external file because CSP bans inline). All URLs
  root-absolute: Vercel serves both `/name` and `/name/`
- `splitmob/` — Vite build **output** served directly (source at
  `ai/apps/uvote/`; the one build-step exception). `ai/apps/` contract is in
  its README
- `tools/` — `bake_images.py` (sole writer of `assets/derived/`),
  `bake_markup.py` (owns every `<picture>` block), `image_slots.py` (LADDERS/
  SLOTS/SIBLINGS — the single source of truth), `check_scope.py` (commit-msg
  scope hook), `bake_favicon.py`, `bake_icons.py`, `check_accents.py` (the
  7-accent palette is duplicated in 5 places and must stay byte-identical),
  `seal_vault.mjs`, `build_docs_pdf.mjs`. Hooks are versioned in
  `tools/hooks/` and installed once via `bake_images.py --install-hooks`
- `vercel.json` — CSP in three scopes: root is strict (`script-src 'self'`,
  no inline, connect only to Web3Forms); `/games/*` adds `'unsafe-inline'
  blob:` + Photon websockets + `frame-ancestors 'self'`; `/splitmob/*`
  strict but frameable. `assets/derived/` is `immutable` for a year — hence
  the `?v=<8 hex of the master's bytes>` stamp on every generated URL

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

`pre-commit` (only fires when rasters/markup/palette files are staged):
`check_accents.py` → bake images → bake markup → `bake_markup --check`.
Stages `index.html` **whole**. `commit-msg` → `check_scope.py`: a commit may
not span "projects" (each `games/<name>`, each other top-level dir, the repo
root as one unit) unless the message carries a `Spans:` line naming every
one. One exemption: `assets` + root-`index.html` only (the documented
add-an-image flow).

## Numbers

7 accents (lime default) · 11 ladders / 14 slots in `image_slots.py` ·
~49 generated markup blocks in index.html · fallback ladder
1600/1200/900/600/400/200 · cache stamp = 8 hex of sha256(master) ·
`styles.css?v=` / `script.js?v=` bumped by hand.

## Known-outstanding

The Work overlay is a mockup (no `work.json`, filler SVGs — do not build on
its taxonomy). Clips point at an unresolvable placeholder video host on
purpose. Some wallpapers are stamped placeholders. See `docs/STATUS.md` for
the live list and open decisions.
