# Dex music remote

Next / previous / play-pause for the site's music from anywhere on the machine —
another tab, another app, the desktop.

## Install (once, ~1 minute)

1. Chrome → `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → pick this `remote/` folder

That is the whole install. The site's tab has to be open and have a track
loaded; everything else is the extension's job.

## What the keys are

| key | what it does |
|---|---|
| the keyboard's media next / previous / play-pause | next, previous, play/pause |
| `Ctrl+Alt+Right` / `Ctrl+Alt+Left` | the same, via the PowerToys remap onto the media keys |

`Ctrl+Alt+<key>` is **not** bound here and cannot be: Chrome refuses that
combination on Windows because `Ctrl+Alt` is AltGr. It stays a PowerToys
Keyboard Manager remap onto `Media Next` / `Media Previous`, which is where it
was already pointed — the extension is what makes those media keys mean this
site.

## The price, so it is not a surprise

While this is enabled **the media keys belong to it**, so they stop reaching
Spotify and anything else. That is what "override everything" asked for. Turning
it off in `chrome://extensions` gives them back immediately.

## When the site moves to its own domain

Two files, same list, and they must match:

- `manifest.json` — `host_permissions` and `content_scripts[0].matches`
- `background.js` — `SITE`

## Why an extension rather than the page doing it

Two simpler routes were built and measured on the real machine first:

1. **`navigator.mediaSession` in the page.** The site registers next/previous
   handlers. Play/pause worked from the desktop; next and previous did nothing
   anywhere. The OS controls attach to whoever is really making the sound, and
   for the music overlay that is YouTube's cross-origin `<iframe>` — their
   player answers play/pause, and a single video has no next or previous.
2. **Holding the session** with a near-silent track of our own in the top
   document, so Chrome would build the session around an element that is ours.
   It did not take the keys off the embed either.

An extension does not compete for the session at all: `global` commands are
registered with the OS by Chrome itself, ahead of any page. The full reasoning
is in `background.js` and in `docs/DECISIONS.md`.
