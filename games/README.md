# games/

Playable builds live here. Nothing in this folder is generated — every file is
shipped by whoever built the game.

## Folder contract

Each game is a **self-contained folder** at:

```
games/<slug>-v<n>/
```

- `index.html` at the folder root.
- **Relative paths only.** Nothing may assume it is served from the domain root.
- **No external network calls.** Fonts, audio, textures, and the engine itself
  all ship inside the folder. No CDNs, no analytics, no remote asset loading.
- **Under 30 MB on first load.**

## Why this exact shape

This is not a house style. The same folder is simultaneously:

1. what an `<iframe>` on this site needs,
2. the **YouTube Playables** submission format, and
3. the **itch.io** HTML5 upload format.

One artifact, three destinations. Deviating from it breaks the Playables path
specifically, and retrofitting a build that assumed absolute paths or a CDN is
expensive — it means rebuilding, not repackaging.

## Versioning

The slug carries the version: `cupcake-gobbler-v3`, not `cupcake-gobbler`. A new
build gets a **new folder**, so URLs already handed out keep working. Never
overwrite a shipped version in place.

## The image baker skips this folder — by design

`tools/bake_images.py` auto-discovers every raster in the repo. Without an
exclusion it would find game textures and re-encode them to AVIF/WebP at six
widths, producing derivatives nothing references and bloating the repo. Game
folders arrive with their own already-optimised assets, so `games` is listed in
`SKIP_DIRS`. Do not remove it.

**Poster frames and thumbnails do not live here.** Those are site imagery: put
them in `assets/` and let them bake normally.
