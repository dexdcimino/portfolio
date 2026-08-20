# Browser Game Spec

Turn the idea below into a browser game that actually ships. No build step, no
bundler, no install — files a browser can open, served as they are.

Everything here has cost real time to learn. None of it is preference.

## First, settle one thing

**Single-player or multiplayer?**

Read the idea. If it says or clearly implies one, take it and say which and why.
"Co-op", "versus", "with friends", "lobby" settle it. So does a design that only
makes sense alone.

**If it is genuinely ambiguous, ask once and wait.** Do not guess and do not
build both — the answer changes the whole architecture:

- **Single-player** — one loop, direct state, keep it simple. Do **not** add a
  network seam "just in case". It is real cost for nothing and it makes a solo
  game worse.
- **Multiplayer** — headless deterministic simulation, fixed timestep, transport
  seam from the first commit.

Ask this too: **is multiplayer wanted later, even if not now?** "Solo now,
multiplayer later" means building the multiplayer architecture today.
Retrofitting it rewrites movement, collision and combat at the same time.

## Non-negotiable, whichever it is

**Vendor every dependency.** No CDN. Under a strict content policy a CDN script
is not blocked loudly — the library is simply `undefined` and the game never
boots, with no useful error. Commit the library, pin the version, record where
it came from.

**One config file, every tunable.** Every number that affects feel or balance
lives in one place. No magic numbers anywhere else, ever. This is what makes the
game tunable later instead of archaeologically excavated.

**Seeded randomness for anything that affects play.** Never the built-in random
in game logic. Solo, this buys reproducible bugs and shareable seeds.
Multiplayer, it is mandatory — without it clients disagree about the world.
Cosmetic jitter in render code is fine.

**A volume API from the first commit** — set, get, mute, unmute — with every
sound routed through a single master gain rather than each connecting to the
output. Retrofitting this means touching every sound in the game. Mute must be
independent of volume: unmuting restores the previous level.

**The game owns Escape**, and its pause menu binds no keys of its own — it asks
the state machine to pause. Otherwise Escape belongs to whatever the game is
embedded in, and pressing it throws the player out mid-session.

## If multiplayer

Three layers, strictly one direction:

```
input → SIM (headless, deterministic, fixed step) → snapshot → RENDER
```

**The simulation must run with no engine, no scene, no canvas.** This is the
whole foundation. A sim that needs a rendering context to know where the world
is can never be authoritative and can never move to a server.

- **The sim never imports the rendering engine.** Not even for vector types. Use
  plain objects and your own maths. The moment the engine appears in a sim file
  the headless property is gone and nobody notices for months.
- **Never raycast against the scene.** The sim owns its collision shapes; meshes
  are built *from* that data, never the reverse.
- **Fixed timestep**, render interpolates between snapshots. Variable timing
  means a 144fps client and a 60fps client compute different physics.
- **No wall clock in the sim.** All timing from tick count.
- **Input as serialisable commands**, not direct mutations.
- **Stable entity IDs from the sim**, never creation order.
- **Combat resolves in the sim** and emits events the renderer plays.
- **Solo play goes through the network path** as a host with zero peers. If solo
  bypasses it, every wrong assumption surfaces at once the day you switch
  networking on.

State the ceiling plainly rather than discovering it late: host-authoritative
gives the host zero latency and the ability to cheat. Fine among friends. A
dedicated server fixes it later — a deployment job, not a rewrite, **if** the
sim is genuinely headless.

## Enforce with a script, not discipline

Write it early and run it after every milestone:

1. No engine imports in the simulation directories.
2. No built-in random, no wall clock, in the simulation.
3. Every simulation file imports cleanly with no browser. **This is the headless
   proof** — run it constantly, not once.

Multiplayer also needs a determinism test: two simulations, same seed, identical
command stream, byte-identical results. Change the seed, results must differ.
**Strip the seed before comparing**, or the different-seed case passes on
metadata and proves nothing.

## Build order

1. Scaffold, vendored engine, config, guards, embed stubs.
2. Loop and state machine. Multiplayer: the sim skeleton and the determinism
   test **before anything renders**.
3. **The core mechanic. Nothing else.**
4. World, entities, content.
5. Audio, HUD, pause menu.
6. Embed and ship.

**Stop and report after step 3.** If the mechanic does not feel good, that is
the finding. Building content on a mechanic that does not work is the most
expensive mistake available, and it is the one part no spec can help with.

## Reporting

After each step: what changed, each acceptance item pass or fail, and anything
you deviated from here with the reason.

**Deviate when this spec is wrong for this game** — but say so. A flagged
deviation is useful. A silent one is a bug nobody finds until it ships.

---
