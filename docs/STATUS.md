# STATUS — 2026-08-17

Read off the tree and git history, not memory. `CLAUDE.md` holds the rules.

## Built and shipped

- **Site**: static HTML/CSS/JS on Vercel, no build step. Accent system is one
  `--accent` variable over CSS masks baked into `styles.css`.
- **Image pipeline**: `tools/bake_images.py` + `tools/bake_markup.py` own every
  `<picture>`; a pre-commit hook bakes and stages. The two `--check`s are the
  guarantee — `bake_markup --check` passes (50 blocks, 332 derivatives).
- **Games** at `/stickland`, `/chomp`, `/surveyor`, `/arena1`, each wrapped.
- **Arena 1**: rebuilt from the prototype into a headless deterministic sim with
  a render layer over it — Phases 0–7 of `ARENA1_STEPS.md` plus the MD series
  through 18 (rockets, lobbies, player-grapple, serpent). Photon transport sits
  behind the same interface as loopback.
- **AI Lab**: five tabs (Apps, Wallpapers, Clips, Prompts, MadLabs). MindSplit
  embeds at `/mindsplit`. The wallpapers carousel, strip and lightbox all build
  themselves from the `.wp-item` figures.

## In flight

**Wallpapers — done.** Eight real pieces, all eight wired and baked, no
placeholders left. They landed over four commits: three in `562b644`
(amphibious, slick anarchy, kong fu), three in `f5cebb9` (BASE jump, edge wave,
shale spire crater), kong fu re-baked at full size in `e09e2f0`, and two in
`de387c7` (off the wall, manoray). Every master is a 3.5-6 MB photographic PNG
and every one has a `<figure class="wp-item">`, so the 2560-wide `wallpaper`
ladder applies to all of them rather than the standard fallback.

## Uncommitted

Nothing. `BASE-Jump.png` and `Edge-Wave.png` were listed here as untracked; both
are committed (as `base-jump.png` / `edge-wave.png`), wired and baked.

## Next

1. Clips: five stream from bunny.net. Every poster is Bunny's auto-generated
   MIDPOINT frame, not one picked in the dashboard — the zone caches them for
   30 days and no client-side cache-bust works, so they need re-setting and a
   purge in Bunny. All masters are 720p, so posters top out at 1280 (600 for
   the portrait one); a wider poster needs a fresh render, not an upscale.
2. Work overlay is still the mockup — filler SVGs, no `work.json`.
5. `CHANGELOG.md` and `README.md` last moved 2026-08-11, ~25 commits back;
   README still says V31 against a V33 changelog.
6. `arena1` and `site-work` are fully merged into `main` and can go. The
   `site-work` worktree at `Desktop/dexcimino-site` is prunable — directory gone.

## Decisions needed

- The two new masters break the lowercase-hyphen slug rule. Rename, or relax it?
- Re-render the clips at 1080p for full-width posters, or accept 1280?
- King Kong is 9:16 — pillarboxed in the 16:9 frame. Keep, or re-export 16:9?
- YouTube and Instagram links in the sidebar are still `href="#"`.
- Keep the V-number scheme in `CHANGELOG.md`, or log by date?
