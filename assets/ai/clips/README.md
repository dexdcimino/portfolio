# AI clips

Posters for the **Clips** tab in the AI Lab section. The video itself is **not
here and never will be** — clips stream from bunny.net. This folder holds the
poster frame for each one, which is the only local asset a clip needs.

```
assets/ai/clips/<slug>.png                     poster  (16:9, clip's native size)
assets/ai/clips/origins/<name>.png             a source image, if it is not
                                               already somewhere else in the repo
assets/derived/ai/clips/<slug>-*.avif|webp     generated, never hand-made
```

## Adding one

1. Save a poster frame here as `<slug>.png`, at the clip's own resolution.
   `<video-id>/thumbnail.jpg` on the pull zone is stored at the source's
   resolution — convert it to PNG, and do **not** upscale it to reach a wider
   rung. The ladder skips any width above the master, so a 720p clip tops out
   at 1280 and a 720-wide portrait one at 600.
2. Copy a `<figure class="cl-item">` in the Clips panel of `index.html` and set
   `data-title`, `data-note`, `data-src`, and the `src`/`alt` in the one-line
   `<!-- img ... -->` directive.
3. Commit. The hook bakes the derivatives and fills in the `<picture>`.

`data-src` is the bunny.net playback URL, e.g.

```
https://vz-<pull-zone>.b-cdn.net/<video-id>/play_720p.mp4
```

## ⚠ `thumbnail.jpg` is probably NOT the frame you picked

Every poster pulled so far has matched the video at **exactly its midpoint**
(t = duration/2, to within a frame). That is Bunny's auto-generated thumbnail,
not a frame chosen in the dashboard. Setting one there does not necessarily
reach you: the pull zone caches `thumbnail.jpg` for 30 days and ignores query
strings for its cache key, so `?nocache=` will not bust it and neither will
`Cache-Control: no-cache` — every request comes back `CDN-Cache: HIT`.

Before trusting a poster, check which moment it matches. If it is the midpoint,
say so and have the thumbnail re-set **and the zone cache purged** in Bunny
rather than working around it from here. A `Last-Modified` within a minute of
`CDN-CachedAt` is the auto-generator's signature: both are stamped when the
encode finishes.

## A clip that is not 16:9

The frame is a fixed 16:9 box and **stays one**. Resizing it per clip makes the
plate, the controls and the thumbnail strip jump on every arrow press, which is
the same mistake the Work overlay's hero is warned about in CLAUDE.md.

So an odd-shaped clip is fitted into the frame instead of cropped to it. Two
things go on the figure and nothing else changes:

```html
<figure class="cl-item" data-title="King Kong" data-note="0:10" data-fit="contain"
        data-src="...">
  <!-- img src="assets/ai/clips/king-kong.png" slot="clip-poster-portrait" ... -->
```

`data-fit="contain"` is carried onto the shared frame by `select()` and switches
both the poster and the video to `object-fit:contain`. Default is `cover`, which
is right for 16:9 and would show barely a third of a 9:16 clip.
`clip-poster-portrait` exists because a pillarboxed poster renders about a third
of the frame's width — same place in the layout, very different `sizes`.

## ⚠ The CSP has to allow your pull zone

`media-src` in the global CSP block of `vercel.json` lists the zones clips may
stream from. The one in use is already there:

```jsonc
// vercel.json — the global CSP block
"media-src 'self' https://vz-f98421b2-da0.b-cdn.net"
```

**A clip on any other zone is blocked until its host is added too**, and the
failure reads as a broken player rather than a policy error unless the console
is open. Add the exact host, not a wildcard. `https://*.b-cdn.net` would open
the policy to every bunny.net customer's zone, which is most of the internet's
CDN traffic.

## ⚠ The library blocks requests with no referrer

This library refuses a request that arrives without a `Referer` header — 403,
on every path including `thumbnail.jpg`. A browser on the live site sends its
origin and is fine; `curl` with no `-e` is not, so a bare curl 403 is the
library's referrer rule, **not** a missing file and not the CSP. It also means
the site's `Referrer-Policy` is load-bearing: it is
`strict-origin-when-cross-origin`, which sends the origin cross-site. Setting
it to `no-referrer` would break every clip.

## A slot with no clip yet

**Leave `data-src` off the figure entirely.** The player detects that: the
poster shows, the play button is disabled, and a line under the frame says the
slot is not connected. Nothing spins, nothing retries, and no console noise
pretends to be a bug.

Add a real `data-src` and the same slot plays with no other edit — `playable()`
in `script.js` is the only thing that knows the difference. Do not park a
made-up host there instead: an unresolvable URL is a failed request and a
console error, which is exactly what the empty slot exists to avoid.

## Why there is no download here

Wallpapers hand over a file; clips do not. The source is a streaming URL on
someone else's CDN, and offering "download" for something we are only linking to
would be a button that either lies or hotlinks. If clips ever need to be
downloadable they need real files with real licences behind them, which is a
different job.

## Where a clip came from

Every clip here was generated FROM something, and the walk from that something
to the clip is shown beside the player, in the statement column (`#clOrigin`,
built by `paintOrigin()` in `script.js`). It is all attributes on the figure:

```html
<figure class="cl-item" data-title="Spinal Tap"
        data-origin="A creature head I modelled in 3D a while back, ..."
        data-note="0:10" data-src="...">
  <!-- the poster's own <!-- img --> directive, as above -->
  <div class="cl-origin-src">
    <figure class="cl-step" data-label="My original sculpt">
      <!-- img src="assets/ai/clips/origins/spinal-tap-sculpt.png" slot="clip-origin"
           alt="..." class="cl-step-img" -->
      <!-- /img -->
    </figure>
    <figure class="cl-step" data-label="AI revamp">
      ...
    </figure>
  </div>
</figure>
```

- **`data-origin`** is the copy under the chain. **No copy, no block** — the
  whole thing hides rather than showing an empty heading.
- Each **`.cl-step`** is one link, in markup order, and **`data-label`** is the
  word under it. Keep labels to two words: the caption box is two lines at a
  phone width and a third would overflow it.
- **`data-origin-clip` on the FIGURE** appends the clip's own poster as a final
  link, labelled *Clip* and marked as the destination. It is opt-in, and most
  clips do not take it: the clip is already on screen two inches to the right,
  and repeating it steals width from the sources without saying anything new.
  Amphibious and Clayweld use it because the payoff is worth reading in
  sequence. The poster is CLONED, never written here — a chain that ends in a
  picture of the clip cannot fall out of step with the clip.
- **`data-bare` on a `.cl-step`** drops the border and the rounded corner. For a
  cutout on transparency — the Clayweld logo has no edges of its own, so a frame
  draws a box around empty space. It is declared, not sniffed from the alpha
  channel: whether a thing reads as a cutout is a judgement about the art.
- **Steps are optional.** King Kong has none: its source is a photo of a ceiling
  and is not published, so that clip is copy alone. A real state, not a gap.
- A source image that already lives somewhere in the repo is **referenced where
  it is** — the Surveyor step points at `assets/thumbnails/surveyor-art.png` and
  the Amphibious one at the wallpaper master. Only images with no other home go
  in `origins/`. The `clip-origin` slot's widths are unioned with whatever else
  claims the master, so sharing one costs nothing.

### Any shape, no letterbox

The row is **justified**: `paintOrigin()` reads each image's width/height
attributes and sets `flex-grow` to its aspect ratio, so the free width is shared
in proportion and every image comes out the same HEIGHT while keeping its own
shape. Nothing is cropped and nothing is padded — a portrait sculpt and a 16:9
still sit in the same row at their own proportions.

Do not put these in a fixed box with `object-fit: contain`. That was the first
attempt and it padded the sculpt with black down both sides and the still with
black above and below, in a block whose whole job is showing pictures.
