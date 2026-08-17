# AI clips

Posters for the **Clips** tab in the AI Lab section. The video itself is **not
here and never will be** — clips stream from bunny.net. This folder holds the
poster frame for each one, which is the only local asset a clip needs.

```
assets/ai/clips/<slug>.png                     poster  (1920x1080)
assets/derived/ai/clips/<slug>-*.avif|webp     generated, never hand-made
```

## Adding one

1. Export a poster frame at **1920x1080** and save it here as `<slug>.png`.
2. Copy a `<figure class="cl-item">` in the Clips panel of `index.html` and set
   `data-title`, `data-note`, `data-src`, and the `src`/`alt` in the one-line
   `<!-- img ... -->` directive.
3. Commit. The hook bakes the derivatives and fills in the `<picture>`.

`data-src` is the bunny.net playback URL, e.g.

```
https://vz-<pull-zone>.b-cdn.net/<video-id>/play_720p.mp4
```

## ⚠ The CSP has to allow your pull zone

The site ships `media-src 'self'`. **A bunny.net URL will be blocked until that
changes** — the clip will fail with a console CSP error and the player will say
it could not load. Nothing else on the site needs this, so it is not done in
advance:

```jsonc
// vercel.json — the global CSP block
"media-src 'self' https://vz-<pull-zone>.b-cdn.net"
```

Add the exact host, not a wildcard. `https://*.b-cdn.net` would open the policy
to every bunny.net customer's zone, which is most of the internet's CDN traffic.

## The five here are placeholders

Their `data-src` points at `vz-REPLACE-ME.b-cdn.net`, which does not resolve.
That is deliberate and the player detects it: the poster shows, the play button
is disabled, and a line under the frame says the slot is not connected. Nothing
spins, nothing retries, and no console noise pretends to be a bug.

Swap in a real URL and the same slot plays with no other edit — `playable()` in
`script.js` is the only thing that knows the difference.

## Why there is no download here

Wallpapers hand over a file; clips do not. The source is a streaming URL on
someone else's CDN, and offering "download" for something we are only linking to
would be a button that either lies or hotlinks. If clips ever need to be
downloadable they need real files with real licences behind them, which is a
different job.
