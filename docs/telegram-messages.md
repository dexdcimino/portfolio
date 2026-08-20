# Telegram — message me from the site

Clone my portfolio repo — github.com/dexdcimino/portfolio — and read
`ARCHITECTURE.md` first.

---

## The idea

Replace the dead Instagram link in the sidebar social row with **Telegram**,
carrying the same `@dex_ddc` handle Discord uses. Beside the handle row's copy
glyph, a **message icon** opens a small panel: name, message, and an optional
contact field. Sending relays it to Dex's Telegram.

**The visitor needs no Telegram account and no app.** They type on the site;
it lands on Dex's phone.

## Why it needs a serverless function

The Telegram Bot API is one HTTP call, but **the bot token cannot go in client
JS** — anyone reading the source could then drive the bot.

So: a Vercel function at `api/telegram.js`. Vercel picks up `api/` with no
config, no build step and no npm, so this does not break the site's constraints.
It is **same-origin**, so the existing `connect-src 'self'` already covers it and
**no CSP change is needed**.

```
social row → message icon → panel (name · message · contact?)
      ↓  POST /api/telegram
      ▼
api/telegram.js   validates, then calls api.telegram.org with the token
      ▼
Dex's Telegram
```

---

## Step 1 — the function

`api/telegram.js`, plain Node, no dependencies:

- **POST only.** Reject anything else with 405.
- Read `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` from `process.env`. **Never
  hardcode either, and never send either to the client** — not in an error
  message, not in a debug field.
- Validate before relaying: **message required; name and contact optional**,
  with the `Anon` and `None` fallbacks applied here rather than in the browser.
  Cap lengths hard — name ~80, contact ~200, message ~4000. Reject a message
  that is empty or whitespace-only.
- Compose exactly the three labelled lines above. Nothing else.
- **Escape the payload** for whichever Telegram parse mode you use, or send it
  as plain text. A message containing Markdown characters must not break the
  formatting or, worse, get rejected.
- Return a plain `{ ok: true }` or a generic failure. **Never surface Telegram's
  response body** — it can contain the chat ID.
- Fail closed: if either env var is missing, return a clean error rather than
  attempting the call.

## Step 2 — spam

**A public endpoint that pipes straight into a phone is a magnet, and unlike
email there is no spam folder.** This is the part most worth getting right.

In order of value for effort:

- **Honeypot field** — hidden, and any submission that fills it is dropped
  silently with a `{ ok: true }`. The contact form already uses `.contact-trap`;
  read it and match the approach.
- **Minimum time on form.** Stamp when the panel opens; reject a submission
  under ~3 seconds. Bots submit instantly.
- **Length caps**, as above.
- **Drop anything with a URL in the message.** Nobody legitimately needs to send
  a link in a first contact, and it is what the spam is.

Vercel functions are stateless, so a true rate limit needs a store. **Do not add
one yet** — note it as outstanding, and Vercel KV is the answer if it ever
matters.

## Step 3 — the social row

`index.html`, the `.social-mini` block.

- **Replace the Instagram `<a href="#">`** with Telegram: real `t.me` href,
  `data-tag="@dex_ddc"`, proper `aria-label`, `target="_blank"
  rel="noopener noreferrer"` — matching the Discord and GitHub entries exactly.
- **A `telegram.svg` in `assets/icons/`**, drawn to match the existing set: same
  weight, same box, same line style. Read `discord.svg` and `github.svg` first.
  It goes through `bake_icons.py` like the others.
- The grid is `repeat(5,1fr)` and stays five — this is a swap, not an addition.

## Step 4 — the message button

The handle row is one button whose whole width copies, with a copy glyph pinned
right. **The message icon sits to its right and must not break that.**

- It only appears when the handle showing is Telegram's. On GitHub or Discord
  there is nothing to message.
- **It cannot be nested inside `.social-tag`** — a button inside a button is
  invalid and the click targets fight. Make it a sibling in `.social-tagwrap`,
  positioned beside the row, and make sure the copy row's hit area still reaches
  its full width.
- Same visual family as `.social-tag-copy`: quiet, small, accent on hover.

## Step 5 — the panel

**Reuse the contact modal's machinery rather than writing a second one.** Read
`contactForm` in `script.js` and the `.contact-panel` markup: it already has the
honeypot, the validation pattern, the invalid-state styling, the modal
open/close via `openModal`/`bindModal`, and the success and failure states.

The panel itself is small. **Only the message is required:**

- **Message** — required, a textarea. The one thing that must be there.
- **Name** — optional. Empty arrives as `Anon`.
- **Contact** — optional, one field, labelled so it is obvious why it helps —
  something to the effect of *"email or handle, so I can reply"*. Empty arrives
  as `None`.
- Honeypot, hidden.
- Send, with a clear pending state, a clear success, and a failure that points
  at the contact form instead.

**Both optional fields carry their fallback in the function, not in the
markup** — a browser that never loaded the JS must not be able to send a
literal "Anon" someone typed.

**No inline `<script>` or `<style>`** — the CSP is `script-src 'self';
style-src 'self'`.

## Step 6 — what Dex does by hand

Put these in the report as numbered steps, in order:

1. Message `@BotFather` on Telegram, `/newbot`, keep the token.
2. Message the new bot once, then get the chat ID — `@userinfobot` is the
   simplest route.
3. Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` as environment variables in
   the Vercel project, for Production and Preview.
4. Redeploy.

**Nothing works until step 3.** Say so plainly, and make the function's failure
mode when the vars are missing something Dex can recognise rather than a blank
500.

---

## Decided — do not re-ask

**The email contact form is untouchable.** Web3Forms stays exactly as it is:
`contactForm`, `CONTACT`, `.contact-panel`, its endpoint and its access key. This
is a **second, separate** path, not a replacement and not a refactor of the
first. Reuse its *patterns* by reading them; do not edit its code. If a change
seems to require touching it, stop and report instead.

Email is the formal route. Telegram is the fast one — a direct message Dex can
read the second it arrives.

**The message, as it should arrive in Telegram:**

```
Name: <name, or "Anon" if empty>
Contact: <contact, or "None" if empty>
Message: <the message>
```

Three labelled lines, in that order. Nothing else — no page, no referrer, no
timestamp, no site branding. It is already in Telegram, so it does not need to
announce that it came from Telegram.

**Only the message is required.** Name and contact are both optional and both
have a stated fallback, so someone can send something with no friction at all.
Do not mark either as required in the markup or reject on either in the
function.

---

## Verification

- Sending from the site lands in Telegram as the three labelled lines
- An empty name arrives as `Anon`; an empty contact arrives as `None`
- A message alone, with both other fields blank, sends fine
- An empty message is rejected
- **The email contact form is byte-identical** — `git diff` proves it
- The token and chat ID appear **nowhere** in anything the browser receives
- Honeypot submissions are dropped and still return success
- A sub-3-second submission is rejected
- Over-length fields are rejected cleanly, not truncated silently
- A message full of Markdown characters arrives intact
- Missing env vars fail with a recognisable error, not a blank 500
- The Telegram icon matches the set; the row is still five across
- The handle row still copies across its full width
- The message button only shows on the Telegram handle
- No CSP violations; no inline script or style
- `bake_icons.py` and `bake_markup.py` pass

## Report — under 12 lines

- what shipped
- **the by-hand steps, numbered, in order**
- the spam measures actually implemented, and what was left for later
- anything blocking

## Constraints

No build step, no bundler, no npm, no CDN. A Vercel function in `api/` is fine
and is the point. All secrets in environment variables. Stage explicit paths —
never `git add -A`. Line endings are mixed per file; preserve each file's own.

**If `vercel.json` needs touching, validate it at key level before committing** —
parse it, confirm top-level keys unchanged, confirm every pre-existing block is
byte-identical, and read the whole diff.

**Update the relevant `ARCHITECTURE.md` in the same commit.**
