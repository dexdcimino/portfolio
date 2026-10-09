# MindSplit — project brief

Swipe-to-vote app. Reels-style vertical feed, one poll per screen, tap an option,
results reveal instantly as proportional bands. Votes are real and shared:
everyone sees everyone's split. Anonymous by default; asking needs an account.

Codename only — the real name isn't locked. It lives in `APP_NAME` at the top of
the app file. One string. Don't scatter it.

**Stack:** Vite + React + Tailwind v4. Deploys as a static bundle to
`dexcimino.com/mindsplit/` as an installable PWA. Backend is Firestore in
`dexnote-d7047` through `public/cloud.js`, on the same site account as Inko and
DexNote (`/account/site-auth.js`). Rules: `docs/mindsplit.rules` at the repo root,
pasted into the Firebase console by hand. Check: `node tools/mindsplit_check.mjs`.

---

## Invariants — do not "improve" these

These were deliberate. Changing them silently is the main failure mode.

### 1. Thumb rule — nothing interactive above the vertical midpoint

Every button, band, input, and tab lives in the bottom half of the frame. Thumbs
don't reach past the middle of a modern phone.

Enforced structurally, not by eyeballing: `Card` is a CSS grid whose top row is
`topRow` px, measured at runtime as `frameHeight / 2 - headerHeight` via
`ResizeObserver`. The header is text only. Sheets are pinned `height: 50%`, with
one exception: Ask (`Compose`) is `tall` (72%), because a question and four answers
do not fit in half a phone with the keyboard up. Its inputs still start below the
midpoint; only its title sits higher.

If you add a control, it goes in the dock, in a sheet, or in the bottom row of a
page. Never in the header, never in the question card.

### 2. Color model — mix from hex, never render a hue dark

The ROOM paints the app: `tokens(theme, accent)` in `lib/themes.js` derives every
surface by `mix()`ing the room's hexes toward `INK` or `PAPER`. After a vote the
leading answer takes the accent and the rest take `T.runner` steps of the room.
Each category still owns one hex (`CAT_HEX`), used only for its chip's dot. Do **not** reintroduce `hsl(hue, sat, lowLightness)` — that's
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

`canChange` is `i === idx && !changed[p.id] && changesLeft > 0`, with
`CHANGES_PER_DAY = 3` across all polls. Free re-voting lets people drift toward the
majority once they see it, which corrupts every number in the app. Don't loosen
this. A change is `unvote` then `vote`, so the server count stays honest.

Votes are always anonymous: `msVotes` is readable only by its own voter. The anon/handle toggle in the composer affects
question attribution only — never votes. Not a setting, not configurable.

### 5. Reduced motion

`reduce` is checked once and threaded through. Scenes set
`animationPlayState: paused`; transitions become `none`. Keep new animation behind
it.

---

## Done

Tasks 0 to 3 are done: live at `/mindsplit/`, split into `src/`, persisted, and on
Firestore. 2026-10-09 revamp: 390 questions in 13 categories, larger type, the
account sheet (Google, Discord, GitHub, email), handles, ask/delete/report, the
profile, and the PWA (manifest, `sw.js`, `?install=1`, the AI Lab download button).
Same day: the handle became the account's one site-wide @name, held by Inko's
server (see "One @name per account" in `docs/DECISIONS.md`), and people got
profiles: an asker's face in the card's bottom row opens their page with Inko's
followers, Follow, and the questions they asked under their name.

## Task 4 — share card

Currently share copies plain text. Render the result as an image (canvas or
`satori`) — the poll question and the split bars. This is the growth loop; text
doesn't travel.

---

## Known gaps

- The Firestore rules are not exercised by anything in the repo. There is no
  emulator here; `mindsplit_check` runs against a fake `cloud.js`. Try two real
  phones after changing `docs/mindsplit.rules` or `cloud.js`.
- Email and password sign-in needs the Email/Password provider switched on in the
  Firebase console. Until it is, the sheet says so in words.
- Reports hide a question at three, but nobody reviews `msReports` yet.
- No comments, deliberately. If social pressure is wanted later, reactions on the
  *result* — not free text. Comments turn a 2-second interaction into a 2-minute
  one and hand you a moderation job on day one.
- The App Store needs a native wrapper (Capacitor or a TWA for Play); the PWA is
  what installs today.
