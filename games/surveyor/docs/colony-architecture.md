# SURVEYOR — Colony Architecture

**Repo:** portfolio · **Target:** `games/surveyor/`

**Status: parked.** Build after the graphics transplants (T2, T3). Can run
before or after Seamless Space — it does not conflict.

---

## The change

Colonies are faceted hemispheres today, with pressure tubes linking each new
dome to one already standing. It works, and it is the least developed-looking
part of a game whose whole goal is colonisation.

Two things:

1. **Better buildings**, with more than one shape, docking together
2. **Tunnels between nearby sites**, so a cluster reads as one settlement

## Why it matters more than it looks

**Density is the core axis of this game** — it drives hyper fuel output, raider
attention, and turret self-sufficiency. Right now it is a number in a HUD and a
glowing blob in the survey overlay.

**Tunnels make density visible in the world.** Standing on a ridge, a linked
cluster reads as a settlement and a scatter of singles reads as outposts. That
is the same information the overlay gives you, delivered by the thing itself.

---

# PHASES

## Phase 1 — Better buildings

Replace the hemispheres. Keep the growth system exactly as it is — this is
geometry, not mechanics.

**Shapes.** Three or four that dock cleanly:

- a dome, as now
- a low cylinder or drum
- a connector or hub piece with multiple docking faces
- something tall, so a mature colony has a silhouette

**Docking is the hard part and the reason to keep the set small.** Every shape
must connect to every other shape, at arbitrary rotations, on a **curved
surface**. Define a small number of docking points per shape with a fixed
socket size, so any two pieces meet the same way regardless of type.

**Do not start with a large shape library.** Get two shapes docking correctly on
a 207 m sphere before adding a third — surface curvature is what will break
this, and it breaks worst on the smallest world.

**Constraints:** all geometry procedural, no external assets. Clockwise winding,
negated normals, per-side signed-volume assertions on mirrored geometry — two
inside-out mesh bugs have already shipped in this project and both were caught
by exactly that check.

## Phase 2 — Growth by shape

The doubling instinct — two connected makes four easier, four makes eight — is
right, and the game already has that curve. Hyper output is `density^1.3`.
**Express the existing curve geometrically rather than adding a second one.**

- A site with more connections grows faster or grows better pieces
- Growth picks the next piece based on what is already there, so colonies
  develop a shape rather than accreting identical domes
- **Derived from the site seed**, so a colony looks the same every time you
  return — same rule the existing domes follow

**Do not add a new resource or a new progression.** Wall-time growth already
works and is already balanced against raiders.

## Phase 3 — Inter-site tunnels

The payoff.

- When two sites are within a threshold distance, a **tunnel** links them
- Threshold is **per-planet, scaled by radius** — the same falloff the density
  calculation already uses. On Ember at 207 m "nearby" is much closer than on
  Anvil at 2072 m.
- Tunnels follow the terrain, on a sphere, over uneven ground. **This is the
  hard geometry**, more so than the docking.
- A dense cluster becomes a visible network. A scatter of singles stays
  disconnected, and looks it.

**Reuse the existing pressure-tube code** — it already links domes within a
site across uneven ground. This is the same problem at a larger scale.

**Watch the count.** A cluster of eight sites could generate 28 tunnels if every
pair links. Use a minimum spanning tree or a nearest-neighbour rule rather than
all-pairs, or a dense basin becomes spaghetti and a frame-rate problem at once.

## Phase 4 — Reading the network

Make the work visible everywhere it should be.

- **Survey overlay** — tunnels drawn as links between colony volumes, so the
  brightest blob is also visibly the most connected
- **Little workers** travel the tunnels between sites, not just within one
- **At night** (if Day and Night has shipped) a connected network is lit along
  its length, and reads from a long way off

---

## Deliberately not in this plan

**A colonisation percentage cap** was considered and left out.

The game already has a clean, countable win condition: **geysers claimed out of
total**, per world and across the system. A percentage-of-surface cap would
compete with it, is fuzzy to read, and — most importantly — **punishes
clustering**, which is the axis the entire economy is built around. Density is
supposed to be rewarded.

If the goal is "you cannot carpet a planet," the geysers already enforce that;
there are only so many and they are placed. If the goal is a *maintenance*
endgame — hold 50% against escalating raiders — that is a different mode worth
building on its own terms later, not a cap bolted onto the current one.

---

## Risks

**Docking on a curved surface is the whole difficulty.** Two pieces that mate
perfectly on flat ground will gap or intersect on a 207 m sphere. Solve it on
the smallest world first.

**Tunnel count.** All-pairs linking explodes. Decide the rule before building
the geometry.

**Do not disturb the growth balance.** Wall-time growth is tuned against raider
damage and against the offline replay. This phase changes what growth *looks*
like, not how fast it happens.

## Verification

- Every shape docks with every other shape, at arbitrary rotation, on the
  smallest and largest worlds
- Signed-volume assertions pass per mirrored side on all new geometry
- A colony rebuilds identically from its seed after a reload
- Tunnels follow terrain without floating or clipping
- Tunnel count stays bounded in a dense basin — state the rule and the worst
  case
- Frame cost with a mature eight-site cluster fully linked
- Growth rate unchanged from current balance
- Existing assertions still pass

## How to spend each session

Build first, measure last. No findings sections. Reports under 15 lines plus
screenshots. Partial is expected — commit what is green and continue the same
phase. Do not split a phase into sub-phases.

## Constraints

All geometry procedural, no external assets. No build step, no bundler, no npm,
no CDN. No inline `<script>` or `<style>`. Clockwise winding, negated normals,
per-side signed-volume assertions. All tuning in `js/tune.js`. Stage explicit
paths — never `git add -A`.

---

## Notes for whoever picks this up

**`Colonies.consolidate()` now merges a site's meshes.** A site's lander, domes
and tubes are baked into one mesh once it stops growing, which is why phase 1
must keep every piece's geometry independent up to that point — a shape library
that only works after the merge is a shape library that cannot grow.

**The signed-volume convention here is negative.** A correctly wound outward
solid comes out negative in this project, matching Babylon's own generators; the
craft hull and the far-band shell are both asserted that way in `dev/run.mjs`.
Getting it backwards on a closed body is invisible until the light lands on the
wrong side, which is slow to notice.

**Tunnels on a sphere are the same problem `flora.js` solved for placement.** A
clump measures the terrain height and both partial derivatives once at its
centre and places everything in it by a first-order expansion, rather than
sampling the height field per item. A tunnel spanning two sites wants the same
treatment along its length, and the height field is the expensive part.
