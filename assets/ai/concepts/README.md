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

## The nine here now

Real concept sheets, all of them **1536x1024**, which is why the frame is 3:2
and letterboxes nothing. They arrived in one drop and were picked from a larger
set on one stated ground: every one of these is exactly 3:2, so the tab has a
single shape. Four others in that drop were not 3:2 or were weaker as a hero
image and were left out.

## Adding or replacing one

1. Save the master here as `<slug>.png`.
2. In the Concepts panel of `index.html`, either copy a
   `<figure class="wp-item">` or edit a placeholder's: `data-title`,
   `data-file`, and the `src` and `alt` in the one-line `<!-- img ... -->`
   directive. Markup order is page order.
3. Commit. The hook bakes the derivatives and fills in the `<picture>`.

Nothing counts the concepts by hand, so a tenth needs no CSS or JS edit.

## Any shape is fine

The frame is a fixed **3:2** box and the piece is fitted INSIDE it
(`object-fit: contain`). Today's nine are all exactly 3:2, so nothing
letterboxes at all — `contain` is there for the TENTH, at whatever shape it
turns up, which lands whole instead of cropped and without this frame having to
change.

The frame does not change shape per piece, and that is deliberate: a stage that
resized itself would make the plate, the download and the thumbnail strip jump
on every arrow press. It is the same rule the clips frame and the Work
overlay's hero are held to — see CLAUDE.md.

The `concept` slot shares the wallpaper ladder (1920/1280/900/600/400/240), and
the ladder skips any rung wider than the master, so these 1536-wide pieces top
out at 1280.
