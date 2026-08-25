# Toon covers

Posters for the **Toons** tab in Top Picks. Same contract as
`../show-covers/`, because it is the same kind of pick — a bare 2:3 cover in the
`pick-cover` slot with a Google search behind it and no caption.

```
assets/about/toon-covers/<slug>.jpg        the master (2:3, 780x1170)
assets/derived/about/toon-covers/<slug>-*.avif|webp   generated, never hand-made
```

## Where these came from

**TMDB, at `w780`** — `https://image.tmdb.org/t/p/w780/<poster-path>.jpg`, which
is already the 780x1170 the 2:3 slot wants, so nothing is cropped or resized on
the way in. The poster path is the FIRST `og:image` on a show's public page
(`https://www.themoviedb.org/tv/<id>-<slug>`); the second one is the backdrop,
which is 16:9 and wrong.

That is the same source and the same width the show covers use, and it was the
third source tried when they were added: Apple's search API returns SQUARE art
for TV and Wikipedia's REST summary has no poster for most of them. The reasons
are in the commit that added `../show-covers/`.

For a show with more than one poster worth considering,
`https://www.themoviedb.org/tv/<id>-<slug>/images/posters?image_language=en`
lists them all. Rick and Morty's default poster is the season-7 key art — Rick's
face in a fan of portal guns over a lava pit — which was already used once and
rejected, so this folder carries the series key art instead: the two of them
stepping out of a green portal onto an alien plain.

## Adding one

1. Save the master here as `<slug>.jpg`, lowercase and hyphenated — TMDB
   serves JPEG and the show covers beside this folder are JPEG too.
2. Copy a `<li class="pk-card">` in the Toons panel of `index.html` and change
   the search query and the `src`/`alt` in the one-line `<!-- img ... -->`
   directive. Markup order is page order.
3. Commit. The hook bakes the derivatives and fills in the `<picture>`.

Nothing counts the toons, so a sixth needs no CSS or JS edit — except the
suggestion cycler, which carries a `Toon` category and one dot per category in
`index.html`. That IS a hand-kept pair; see `CATS` and `.pk-cat-dashes`.
