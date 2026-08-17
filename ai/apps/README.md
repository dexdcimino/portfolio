# AI Lab — app builds

Drop point for AI Lab apps, mirroring `games/` for playable builds.

```
ai/apps/<slug>/index.html      the app's own entry point
ai/apps/<slug>/...             everything else it needs, self-contained
```

## The contract

- **Self-contained.** No build step, no bundler, no npm — static stays static.
  An app that needs a build produces its output here; the source lives in its
  own repo.

  **Splitmob is the exception, deliberately.** Its source is a Vite project that
  lives *here* (`uvote/`, with `src/` and `package.json`) and builds to
  `/splitmob/` at the repo root — the same source-beside-build split
  `games/stickland/` uses, because the source was already in this repo and
  moving it somewhere else to satisfy a sentence helps nobody. Two consequences
  worth knowing: `uvote/index.html` is now Vite's dev entry, not a servable
  page, and `/ai/apps/uvote/` therefore redirects to `/splitmob/` in
  `vercel.json`. The card in the Apps panel points at `/splitmob/`.
- **CSP.** The site is `script-src 'self'` / `style-src 'self'` with no CDN and
  no `eval`. No inline `<script>` or `<style>` — inline blocks are blocked live,
  which has already cost a debugging session on `/stickland`'s wrapper.
- **Images go through the bake.** Sources under `assets/`, never a hand-made
  derivative. App icons live in `assets/ai/icons/<slug>-icon.png` and are
  referenced from the card through the `ai-icon` slot.
- **Card ordering** is the order the `.ai-card` elements appear in
  `index.html`'s Apps panel. There is no sort key.

## Adding an app

1. Unpack the build into `ai/apps/<slug>/`.
2. Put a square icon at `assets/ai/icons/<slug>-icon.png`.
3. Add an `.ai-card` to the Apps panel in `index.html` with a one-line
   `<!-- img ... slot="ai-icon" -->` directive — the `<picture>` block is
   generated, never typed.
4. Commit. The pre-commit hook bakes the derivatives and fills the markup in.

`assets/ai/images/` and `assets/ai/thumbnails/` are the equivalent drop points
for the Images tab: full-size source in the first, and if a separate smaller
crop is ever wanted, its source in the second. Both are baked, not hand-cut.
