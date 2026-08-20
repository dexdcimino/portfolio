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

**Wallpapers.** Three real pieces landed in `562b644`. Two more masters are
sitting in `assets/ai/wallpapers/` unbaked and unreferenced. Five of the eight
live figures are still stamped placeholders.

## Uncommitted

Only these two — untracked, yours by hand, deliberately not in this commit:

```
?? assets/ai/wallpapers/BASE-Jump.png
?? assets/ai/wallpapers/Edge-Wave.png
```

No `<figure class="wp-item">` for either yet, so the baker falls back to the
standard ladder instead of the 2560-wide `wallpaper` one. Wiring the figures per
`assets/ai/wallpapers/README.md` fixes that; the hook does the rest.

## Next

1. Wire and bake the two new wallpapers; check the top rung against the 150 KB
   budget now the art is photographic rather than gradient.
2. Retire the five placeholder wallpapers as real art replaces them.
3. Clips: all five `data-src` values point at the unresolvable
   `vz-REPLACE-ME.b-cdn.net` host on purpose. Needs a real stream host.
4. Work overlay is still the mockup — filler SVGs, no `work.json`.
5. `CHANGELOG.md` and `README.md` last moved 2026-08-11, ~25 commits back;
   README still says V31 against a V33 changelog.
6. `arena1` and `site-work` are fully merged into `main` and can go. The
   `site-work` worktree at `Desktop/dexcimino-site` is prunable — directory gone.

## Decisions needed

- The two new masters break the lowercase-hyphen slug rule. Rename, or relax it?
- Video host for Clips.
- Delete the five placeholder wallpapers now, or hold them until replaced?
- YouTube and Instagram links in the sidebar are still `href="#"`.
- Keep the V-number scheme in `CHANGELOG.md`, or log by date?
