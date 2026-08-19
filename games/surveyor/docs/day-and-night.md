# SURVEYOR — Day and Night

**Repo:** portfolio · **Target:** `games/surveyor/`

**Status: parked.** Build after the graphics transplants (T2, T3) and after
Seamless Space. Ordering matters — this changes lighting, and it should land on
top of finished lighting rather than underneath it.

---

## The change

Every world has a fixed sun today. This makes it move, and makes night a
different game.

Night is **harder and more dangerous**, and it is also the only time certain
resources are visible. You need light and heat to survive it, and both come from
things you build. That turns "wait out the night" into "prepare for the night,"
which is the loop worth having.

## Why this is cheap and worth a lot

Each world already declares its own `sunDir`, used by both the ground lighting
and the disc shader. **Rotating it is close to free**, and it multiplies systems
that already exist:

- **Ember** — the fissures already glow above 1.0. At night they become the only
  light on the planet, which is what its profile always said they were.
- **Shroud** — already the world you cannot see in. At night it goes from
  difficult to hostile.
- **Vault** — hard low light across ice is a different look entirely at a
  grazing angle.
- **Colonies become lighthouses.** Your own infrastructure lights the dark, so
  **density becomes visible from a ridge at night** — the same information the
  survey overlay gives you, delivered by the world itself.

---

## One thing to protect from earlier phases

**T2's per-world lighting must keep the sun as a runtime parameter, not a baked
constant.** If T2 has already shipped with a hardcoded direction per world,
converting it to a curve is the first task here — do that before anything else,
and confirm all six still match their approved daytime look at the appropriate
point in the cycle.

---

# PHASES

## Phase 1 — The cycle

Rotate the sun. Nothing else.

- **Per-world day length** in `tune.js`, alongside palette, fog and lighting.
  These need not be realistic and should not all match — a short day on Ember
  and a long one on Anvil is free variety.
- The sun's direction, colour and intensity all move together. Dawn and dusk are
  warm and low; midday is the current approved look.
- **Ambient and IBL follow.** A night lit by the same ambient as noon reads as a
  bug. Sky colour, fog colour and fog density move too.
- **The disc shader must agree.** Each world's disc already lights from that
  world's sun — those are now moving. A world lit one way on the ground and
  another in the sky is a subtle, ugly bug.
- **Other worlds' discs should show phases.** They already have a terminator;
  now it means something.
- Time persists in the save, and **advances on wall time** like colony growth
  and raiders already do.

**The current approved look for each world is its daytime look.** Do not
regrade the day to accommodate the night.

**Verify:** six-way sheet at four points in the cycle — dawn, noon, dusk,
midnight. Daytime frames must match the currently approved look.

## Phase 2 — Night is dangerous

Night needs teeth or it is just a filter.

Pick per world from its profile rather than applying one rule everywhere:

- **Cold** — the obvious one. Vault and Shroud especially. Damage over time
  outside a lit zone.
- **Raiders are bolder at night.** They already run on wall time; weight their
  aggression by the local sun angle. Shroud's ambush profile becomes genuinely
  frightening.
- **Visibility collapses.** Fog and darkness together on Shroud should make the
  survey overlay the only way to operate — which its profile always said, and
  which has never quite been true.

**Not every world needs to be hostile at night.** Home should be survivable —
it is where a player learns the cycle. Ember, being lit by its own ground, might
be *easier* at night, and that is a good joke to leave in.

## Phase 3 — Light and heat as buildings

The counter-play, and the reason to build up.

- **Colony lights.** A mature colony lights a radius around itself. Denser
  clusters light more, which is the existing density axis expressed as a third
  thing you can see.
- **A night shield or heat field** as a colony upgrade — a survivable zone
  around a sufficiently developed site.
- **Craft lights**, and a power cost for running them. A reason to get home.
- Reuse the existing wall-time growth system. **Do not build a second
  progression.**

The shape to aim for: early game you avoid night, mid game you survive it near
colonies, late game you own it.

## Phase 4 — Night-only resources

The reason to go out.

- Something only visible or only harvestable in darkness. Given the art
  direction, **emissive** is the obvious answer — it exists in the palette
  system already and it is exactly what cyan is reserved for.
- Placed from the planet seed like geysers, and **visible in the survey
  overlay**, so the overlay's value goes up again.
- Should feed something the day economy cannot get. Not just more hyper fuel —
  a different resource with a different use, or the loop is just "same thing,
  worse conditions."

**This phase is the one that justifies the other three.** Without it, night is
an obstacle. With it, night is a decision.

---

## Risks

**Do not let night become tedium.** The failure mode is a player sitting still
waiting for dawn. Every night should offer something worth going out for, and
the cycle should be short enough that waiting is never the efficient play.

**Do not regress the day.** Six worlds are approved as they look now. That is
noon. Any change that improves night at the cost of day is a net loss.

**Frame cost.** More light sources at night is the obvious risk — colony lights
across a dense cluster especially. Measure, and tier-gate.

## Verification

- Six-way sheet at four cycle points
- Daytime frames match the approved look
- Ground sun and disc sun agree at every point in the cycle
- Time survives a reload and advances offline within the existing cap
- Night is survivable near a mature colony and dangerous away from one
- Home is survivable at night without special equipment
- Frame cost at night with a dense cluster lit
- Existing assertions still pass

## How to spend each session

Build first, measure last. No findings sections. Reports under 15 lines plus
screenshots. Partial is expected — commit what is green and continue the same
phase. Do not split a phase into sub-phases.

## Constraints

No build step, no bundler, no npm, no CDN. No inline `<script>` or `<style>`.
All tuning in `js/tune.js`. Stage explicit paths — never `git add -A`.

---

## Notes from the sky pass, for whoever picks this up

Two things landed since this plan was written that change the first task.

**The sun is already a runtime parameter.** `SKY.sunDir` is per world and
resolved through `skyOf()`, and the sky shader takes it as the `uLight` uniform
rather than baking it — so the "convert T2's constant to a curve" task in the
section above is already done. What is not done is anything that *moves* it.

**`SKY.stars` is new and interacts directly with this.** Thin-air worlds draw a
star field through the daylight, authored past 1.0 so bloom finds it. Those
values are set against a *daylit* sky; at night the same amount will be far too
strong. Stars are the one term here that has to be re-derived per cycle point
rather than left alone, and `SKY.stars.horizon` — the elevation they fade in
above — is the dial to watch, because a low sun and a star field want the same
part of the sky.
