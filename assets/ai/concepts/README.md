# AI concepts

Masters for the **Concepts** tab in the AI Lab section. Same component as the
Wallpapers tab — the carousel, the plate, the download, the thumbnail grid in
the statement column and the lightbox are all one `initGallery()` in
`script.js`, instantiated a second time — so everything the wallpapers README
says about the strip, the hover preview and the preload is true here too.

```
assets/ai/concepts/<slug>.png                the master
assets/derived/ai/concepts/<slug>-*.avif|webp   generated, never hand-made
```

## THE NINE FILES HERE NOW ARE PLACEHOLDERS

`concept-01.png` .. `concept-09.png` are generated cards that say
**PLACEHOLDER — NOT REAL ART** on their own face. They exist so the tab has its
shape before the art does. The count, the titles and the 4:3 are not decisions
about the real set — do not build on any of them.

## Adding or replacing one

1. Save the master here as `<slug>.png`.
2. In the Concepts panel of `index.html`, either copy a
   `<figure class="wp-item">` or edit a placeholder's: `data-title`,
   `data-file`, and the `src` and `alt` in the one-line `<!-- img ... -->`
   directive. Markup order is page order.
3. Commit. The hook bakes the derivatives and fills in the `<picture>`.

Nothing counts the concepts by hand, so a tenth needs no CSS or JS edit.

## Any shape is fine

Unlike the wallpapers, these are **not** all one size. The frame is a fixed
**4:3** box and the piece is fitted INSIDE it (`object-fit: contain`), so a
square, a portrait or a 16:9 concept all land whole.

The frame does not change shape per piece, and that is deliberate: a stage that
resized itself would make the plate, the download and the thumbnail strip jump
on every arrow press. It is the same rule the clips frame and the Work
overlay's hero are held to — see CLAUDE.md.

The `concept` slot shares the wallpaper ladder (1920/1280/900/600/400/240), and
the ladder skips any rung wider than the master, so a 1600-wide piece simply
tops out at 1280.
