# CLAUDE.md

**Read `BUILD.md` first. It is the full brief for this project.**

Standalone extraction of a stick-figure open-world game that used to live inside
a note-taking app. `src/` holds verbatim copies of the original modules — they
still contain notes-app coupling that needs cutting.

Non-negotiables:
- Lose zero game features. Weapons, cosmetics, hoverboard, tank, creatures, world, chat, keybinds.
- No Firebase, no auth, no notes, no sessions, no community hub.
- Multiplayer stays wired but gated behind `MULTIPLAYER = false` in `src/config.js`.
- Accent color comes from the host site's `--accent` CSS var via `src/accent.js`.
- Do not retune physics constants. `character.js` owns the render loop.
- **`index.html` is generated — never edit it by hand.** Edit `src/` and run
  `node build.mjs`. Every MD/work session must end with a build plus opening
  `index.html` over `file://` (double-click) before committing. The console
  logs the build timestamp at boot; check it to avoid debugging a stale build.

Work on `main`. Commit after each phase in BUILD.md.

---

## Migrated into the portfolio repo

This folder was `dexnote-game/` on its own. It now lives at `games/stickland/`
inside the portfolio repo and is the only copy — build from here.

Two paths changed and nothing else did:

- `node build.mjs` still writes `index.html` beside itself, but the shipped
  build lives at `games/stickland/v1/index.html`. Move it after building, or
  the site keeps serving the previous version.
- The site serves that file at `/games/stickland/v1/index.html`, framed by the
  wrapper at `/stickland` (`stickland/index.html` in the repo root). Headers for
  `/games/(.*)` are scoped in `vercel.json` — the build's blob-URL module loader
  and inline script/style need them.

`tools/` did not come across: it referenced paths specific to the old repo.

The rule above still stands and matters more here, not less: `index.html` is
generated. Edit `src/`, run the build.
