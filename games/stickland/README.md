# Stick Figure — Open World

A standalone stick-figure open-world game. Fully procedural: **zero images, zero
sprites, zero audio**. The world is Canvas 2D; the character and every weapon are
inline SVG. No framework, no backend, no npm dependencies.

## Running it

**Double-click `index.html`.** That's it — the file is fully self-contained and
runs straight from disk (`file://`), from a web server, or from anywhere you
copy that single file to. It also works served over `http://`
(`npm run serve`), which is how the portfolio site embeds it.

`index.html` is **generated output** — the sources live in `src/`. After editing
anything in `src/`, regenerate it:

```
node build.mjs            # or: npm run build
node build.mjs --watch    # rebuild on every change under src/
```

Never edit `index.html` by hand; the next build overwrites it. The console logs
the build timestamp at boot (`[build] dexnote-game single-file build …`) so you
can always tell whether you're looking at a stale build.

### How a single file loads ES modules from disk

Browsers refuse to load ES module *files* over `file://` (CORS, origin
`'null'`), which is why a plain `<script type="module" src="src/main.js">`
gives a blank page from disk. The build instead embeds every module's source
verbatim in `index.html`; a small bootstrap turns them into `blob:` URLs — which
*are* same-origin to the page — in dependency order and `import()`s the entry.
Real ES module semantics, no transpiling, no bundler; devtools still shows each
module under its own filename via `sourceURL`, with working breakpoints.

## Embedding in the host site

The game reads its accent color from the host page's `--accent` CSS custom property
on `:root`, so it inherits your site's theme automatically:

```css
:root { --accent: #68d121; }
```

Change it at runtime and the HUD, bars, chips and chrome repaint live. The
character's own body color is separate — that's chosen in-game through the
cosmetics customizer.

## Controls

| Key | Action |
|---|---|
| `WASD` / arrows | Move |
| `Space` | Jump — tap for a hop, hold to charge; tap again mid-air for one air jump |
| `Shift` | Sprint |
| `C` | Crouch |
| `H` | Holster / unholster |
| `E` | Interact — enter/exit tank, buildings |
| `1`–`4` | Equip hotbar slot |
| `5` / `B` / `I` | Inventory |
| `G` | Cosmetics customizer |
| `T` / `Enter` | Chat — `/` for commands, `:` for emoji |
| `Y` | Camera lock (rebindable) |
| `ESC` | Close panels / pause menu (keybinds, audio, theme, exit) |

The hoverboard isn't a keybind — it's an inventory item. Equip it to a hotbar slot
and mount it from there.

Keybinds persist to localStorage under `dexnote-keybinds`.

## Multiplayer

Multiplayer is fully wired but **off by default**. Flip it in [`src/config.js`](src/config.js):

```js
export const MULTIPLAYER = false;   // true to enable Photon
```

With the flag off the game makes zero network requests — the Photon SDK isn't even
fetched.

## Layout

```
index.html          GENERATED — the whole game in one self-contained file
build.mjs           Generates index.html from src/ (Node stdlib only)
src/
  index.template.html  Page shell: game DOM + host tokens + inject points
  main.js           Entry point — boots straight into the world
  config.js         MULTIPLAYER flag, room id
  character.js      Physics, character + weapon rendering, inventory, cosmetics.
                    Owns the render loop; playmode has no RAF of its own.
  playmode.js       World, camera, buildings, tank, creature AI, chat
  accent.js         Reads --accent from the host page, repaints on change
  storage.js        Guarded persistence (world, cosmetics, safeStorage accessor)
  chat-picker.js    Chat "/" command + ":" emoji pickers
  emoji-data.js     Emoji dataset for the ":" picker
  photon-client.js  Multiplayer transport (vendor-ish; do not modify)
  game.css          All game styling, inlined into the build
public/             Photon SDK, loaded on demand only when MULTIPLAYER is true
```

Physics is tuned against a 240 Hz reference (`REFERENCE_FPS`) with delta-time
scaling, so it feels identical at any refresh rate.
