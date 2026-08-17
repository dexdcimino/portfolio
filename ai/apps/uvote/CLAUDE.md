# Splitmob — project brief

Swipe-to-vote app. Reels-style vertical feed, one poll per screen, tap an option,
results reveal instantly as proportional bands. Anonymous by default.

Codename only — the real name isn't locked. It lives in `APP_NAME` at the top of
the app file. One string. Don't scatter it.

**Stack:** Vite + React + Tailwind v4. Deploys as a static bundle to
`dexcimino.com/splitmob/`. Backend will be Firebase (reuse `dexnote-d7047`).

---

## Invariants — do not "improve" these

These were deliberate. Changing them silently is the main failure mode.

### 1. Thumb rule — nothing interactive above the vertical midpoint

Every button, band, input, and tab lives in the bottom half of the frame. Thumbs
don't reach past the middle of a modern phone.

Enforced structurally, not by eyeballing: `Card` is a CSS grid whose top row is
`topRow` px, measured at runtime as `frameHeight / 2 - headerHeight` via
`ResizeObserver`. The header is text only. All sheets are pinned `height: 50%`.

If you add a control, it goes in the dock, in a sheet, or in the bottom row of a
page. Never in the header, never in the question card.

### 2. Color model — mix from hex, never render a hue dark

Each category owns one hex (`CAT_HEX`). Every surface is `mix()`ed from it toward
`INK` or `PAPER`. Do **not** reintroduce `hsl(hue, sat, lowLightness)` — that's
what turns orange into brown and yellow into olive. That bug already got fixed
once.

Text color is computed, never hardcoded: `inkOn(bg)` runs WCAG relative luminance
and picks near-black or near-white by contrast ratio. Use it everywhere, including
on theme accents and dynamic band colors.

### 3. Scene renders once, at app level

`<Scene>` sits behind everything, outside the feed. Cards are frosted glass over
it. Do **not** move scene rendering into `Card` — that's 60 simultaneous animation
loops and it will melt a phone.

Themes harmonize category colors into their own world via `blend` + `amt`, so
Food's orange goes slate-teal in Downpour and warm-amber in Ember. That's why
nothing clashes. Keep that contract when adding scenes.

### 4. One vote change, then locked

`canChange` is `i === idx && !changed[p.id]`. Free re-voting lets people drift
toward the majority once they see it, which corrupts every number in the app.
Don't loosen this.

Votes are always anonymous. The anon/handle toggle in the composer affects
question attribution only — never votes. Not a setting, not configurable.

### 5. Reduced motion

`reduce` is checked once and threaded through. Scenes set
`animationPlayState: paused`; transitions become `none`. Keep new animation behind
it.

---

## Notes for porting out of the artifact sandbox

- `localStorage` was banned in the artifact preview. **On your own domain it's
  fine.** Use it for theme choice and cast votes until Firebase lands.
- Fonts are a Google Fonts `@import` in a `<style>` block. dexcimino.com runs
  strict CSP (A+ Observatory) — this **will** be blocked. Self-host Bricolage
  Grotesque and DM Mono as woff2 and delete the `@import`. Don't weaken the CSP.
- Set `base: '/splitmob/'` in `vite.config.js`.
- Page head needs
  `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
  or the safe-area padding on the dock does nothing on iPhone.

---

## Task 0 — get it live (do this first)

Priority is a working URL on a real phone. Don't refactor anything yet.

```bash
npm create vite@latest splitmob -- --template react
cd splitmob && npm i && npm i -D tailwindcss @tailwindcss/vite
```

- `vite.config.js`: add `import tailwindcss from '@tailwindcss/vite'`, then
  `plugins: [react(), tailwindcss()]` and `base: '/splitmob/'`
- `src/index.css`: replace contents with `@import "tailwindcss";`
- Drop the prototype in as `src/App.jsx` (default export is `Splitmob`)
- `index.html` head:
  `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
  — without `viewport-fit=cover` the dock's safe-area padding does nothing on iPhone.

**Self-host the fonts.** The app currently pulls Bricolage Grotesque and DM Mono
via a Google Fonts `@import` inside a `<style>` block. dexcimino.com runs strict
CSP (A+ Observatory) and will block it. Download both as woff2 into
`public/fonts/`, declare `@font-face`, delete the `@import`. Do not weaken the CSP
to make the CDN work.

Then: `npm run dev -- --host`, open the printed LAN address on a phone on the same
wifi. That's the iteration loop — no deploy needed while tweaking.

To ship: `npm run build`, copy `dist/` to `/splitmob/` in the portfolio repo,
push. Same iframe/route pattern as the other games.

**Embed on the portfolio — modal on desktop, full page on mobile.**

The app ships as a standalone route at `/splitmob/`. How it's *entered* differs:

- **Desktop (≥768px):** clicking the card in the AI Lab section opens a modal
  overlay — a dimmed backdrop plus a phone-shaped iframe pointing at `/splitmob/`.
  Roughly 92vh tall, 9:19.5 aspect ratio (so ~420px wide at 900px tall), capped so
  it never exceeds viewport. Rounded corners ~28px, subtle shadow. Closes on Esc,
  on backdrop click, and via a close button *outside* the phone frame — never
  inside it, that space belongs to the app. Lock body scroll while open.
- **Mobile (<768px):** do **not** use a modal. Navigate to `/splitmob/` as a
  normal full page. This is deliberate — a phone-shaped modal inside a phone is
  pointless, `env(safe-area-inset-bottom)` doesn't reliably propagate into an
  iframe (the dock would sit under the home indicator), and a real page gives you
  working back-button behavior for free.

iframe gotcha: iOS Safari ignores `border-radius` on an iframe. Wrap it in a div
with `overflow: hidden`, the radius, and `transform: translateZ(0)` to force the
clip.

No changes needed inside the app for this — its `isPhone` check reads
`window.innerWidth`, which inside a ~420px iframe is already true, so it correctly
renders full-bleed with no fake device chrome. The modal supplies the phone shape.

Acceptance: loads on a phone at dexcimino.com/splitmob/, no CSP violations in
console, fonts render (not fallback), dock clears the home indicator, all 5 themes
switch, modal opens/closes cleanly on desktop and is bypassed on mobile.

## Task 1 — scaffold and split the file

The prototype is one ~1000-line file. Break it up, change nothing visual.

```
src/
  App.jsx              # state, dock, page routing
  data/polls.js        # POLLS array (60), CAT_HEX, CAT_LABEL, CAT_ORDER
  lib/color.js         # mix, lum, inkOn, rgba, hex2rgb
  lib/themes.js        # THEMES, chrome()
  scenes/              # Sky, Rain, Deep, Ember, Paper, index
  components/
    Card.jsx  Band.jsx  Profile.jsx  Sheet.jsx
    Settings.jsx  Filter.jsx  Compose.jsx  ShareSheet.jsx  FlagSheet.jsx
  hooks/useCounter.js
```

Acceptance: renders identically, thumb rule still measured at runtime, no visual
diff on any of the 5 themes.

## Task 2 — persistence

`localStorage` for theme, cast votes, changed flags, and user-created polls.
Rehydrate on load. No schema work yet.

## Task 3 — Firebase

Firestore: `polls/{id}` with `counts` array, `votes/{uid}_{pollId}` to enforce one
vote per person, `reports/{id}` so the flag button actually queues something.
Anonymous Auth. Reuse `dexnote-d7047`.

Optimistic local update first, then write — the reveal must never wait on network.

## Task 4 — share card

Currently share copies plain text. Render the result as an image (canvas or
`satori`) — the poll question and the split bars. This is the growth loop; text
doesn't travel.

---

## Known gaps

- Report button is local-only. Nothing is sent, no moderation queue exists.
- No comments, deliberately. If social pressure is wanted later, reactions on the
  *result* — not free text. Comments turn a 2-second interaction into a 2-minute
  one and hand you a moderation job on day one.
- Live vote drift is fake (`setInterval` on the visible card). Delete it when
  Firestore listeners land.
- Preloaded bylines are derived from a hash of the poll id. Placeholder.
