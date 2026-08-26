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

Nine sheets, in the order Dex numbered them: Frostbane, Cinderborn, Gulper,
Mossback, Spineling, Dread Knight, Meltdown, Recess, Quiverkin.

**Seven are 1536x1024** and fill the 3:2 frame edge to edge. **Two are not** —
Cinderborn is 1403x1121 (taller) and Mossback is 1659x948 (wider) — and both are
fitted inside the frame whole. That is the fixed-frame-plus-`contain` pair
earning its keep rather than a compromise: the frame cannot change shape per
piece without making the plate, the download and the strip jump on every arrow
press, and nothing here is worth cropping to avoid two thin bars.

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
(`object-fit: contain`). 3:2 because that is what most of the art is; `contain`
because some of it is not, and an odd shape has to land whole rather than
cropped or forcing the frame to move.

The frame does not change shape per piece, and that is deliberate: a stage that
resized itself would make the plate, the download and the thumbnail strip jump
on every arrow press. It is the same rule the clips frame and the Work
overlay's hero are held to — see CLAUDE.md.

The `concept` slot shares the wallpaper ladder (1920/1280/900/600/400/240), and
the ladder skips any rung wider than the master, so these top out at 1280.
