# SURVEYOR — Seamless Space

**Repo:** portfolio · **Target:** `games/surveyor/`

**Status: SHIPPED.** All five phases are done and seamless space is in the
game. Phase 5's three bullets are all measured and closed; two findings are
parked and shipped around, both written up under PARKED near the bottom of
this file — the FX crescendo landing before the arrival, and the residual
handoff step on Tarn and Vault. Neither is a bug and neither blocked ship.
This file stays as the record; it no longer has a row in the Idea Vault,
because the vault holds unbuilt plans.

This was a systems change to a game that already worked, and the instruction it
opened with — do not start until the graphics transplants T2 and T3 are done —
was honoured: it landed on top of finished lighting rather than underneath it.

---

## The change

Today, travelling between worlds tears down the current planet and builds the
destination. The other five worlds are **billboards** — flat quads with a shader
that fakes a sphere. They sit at honest angles but there is nothing actually out
there.

The original design was that you **fly to them**. They are genuinely far away,
your speed climbs insanely as you leave a gravity well, and the world resolves
from a dot into a place as you approach. No load, no swap, no cut.

That is what this builds.

---

## Why it is not just "make the far plane bigger"

Two hard limits, and both have the same solution.

**Depth buffer range.** A near plane at 0.1 m and a far plane at 400 km is a
ratio of four million to one. No conventional depth buffer holds that — you get
z-fighting everywhere.

**Float32 on the GPU.** Positions in JavaScript are doubles and handle 400 km
fine. Vertices reach the GPU as float32, where a body 400 km out renders with
visible jitter.

## The solution — two passes, two scales

**Do not move the planets. Render distant ones compressed, in their own pass.**

- **Far pass** — everything beyond ~20 km, rendered **scaled down**. A planet
  400 km away with a 2 km radius is drawn as a planet 4 km away with a 20 m
  radius. Identical angular size on screen; now comfortably inside float32 and a
  normal depth range.
- **Near pass** — everything within ~20 km, at true scale, composited on top.

Both cameras share FOV and orientation, so the seam is invisible.

**This kills both problems at once.** Nothing beyond ~20 km ever reaches the GPU
at true coordinates, so there is no precision jitter and no depth range problem.
No logarithmic depth buffer. No camera-relative rewrite.

**The physics stays honest.** Positions, travel, the speed law, approach spheres
and the analytic sweep all stay in doubles and are unchanged. Only rendering
compresses. The speed readout is not a lie — you really are covering 400 km at
a million metres per second; the renderer is drawing it small.

This is what Elite Dangerous, Kerbal Space Program and No Man's Sky do. Seamless
surface-to-space is not solved with bigger numbers; it is solved by rendering
distance bands separately at their own scales.

---

## What already exists and gets reused

More than it looks. Do not rebuild any of this.

- **Honest positions** — `SYSTEM.at` coordinates are real, in metres
- **The speed law** — altitude-based, unchanged. It was `HYPER.doubleEvery =
  1500` when this was written; phase 5 bullet 2 replaced that with seconds
  solved back to the metres, first as `tripFirst`/`tripRepeat` and then, a day
  later, as one `HYPER.trip`
- **Approach spheres and boundaries** — from Phase 3b
- **The analytic sweep** — stops you tunnelling through a 414 m planet at a
  million m/s — that is Ember measured across, radius 207 m. Still needed,
  still correct.
- **Bounded per-planet quadtree** — a distant planet is already cheap
- **The disc shader** — becomes the lowest LOD rather than being replaced
- **The swap machinery** — becomes LOD promotion instead of teardown
- **Per-planet lighting from T2** — each world already carries its own sun

---

# PHASES

## Phase 1 — The two-pass renderer

The foundation. Nothing else works without it, and it is testable on its own.

- Second camera and render pass for the far band, sharing FOV and orientation
  with the main camera
- Distance-based scale factor: a body at true distance `D` with true radius `R`
  renders at `D · k` and `R · k`, `k` chosen to land it inside a safe range
- **Angular size must be preserved exactly** across the transform — that is the
  whole trick and the thing to assert
- Composite far pass under near pass
- Far pass takes no fog, no shadows, no depth interaction with near geometry

**Verify:** the existing billboards, moved into the far pass, are
indistinguishable from where they are today. Screenshot before and after — they
should match.

## Phase 2 — The LOD chain

Replace the billboards with real geometry that resolves.

```
beyond 20 km    far pass — billboard, then low-poly sphere as it grows
20 → 2 km       near pass, true scale, coarse quadtree
under 2 km      quadtree subdivides as it does today
```

- **The handoff must not pop.** Angular size is continuous across each boundary,
  so appearance should be too. Crossfade if a hard swap shows.
- Only the destination promotes. Bodies you are not approaching stay at their
  cheapest representation.
- **Two planets rendered at once is the new cost ceiling** — the one you left
  and the one you are approaching. Budget for it.

**Verify:** fly toward a world and record the transitions. No pop, no hitch, no
frame spike at either boundary.

## Phase 3 — Multi-body gravity

Currently gravity is "the planet below you," because there is only one.

- Gravity resolves to the **nearest significant body**
- Handover happens at the midpoint between wells, and must not jerk the craft
- Below the approach boundary, behaviour is exactly as today — this changes
  nothing about driving, boating or flying on a surface
- **The craft's local tangent frame follows the new body** on handover

This is the subtlest phase. The failure mode is a craft that flips orientation
mid-flight, and it will only show up in the transition band.

**Verify:** cross between two wells at several angles and speeds. No flip, no
jerk, no loss of control.

## Phase 4 — Remove the swap

The payoff.

- Delete the teardown-and-rebuild path
- Travel becomes continuous: leave a surface, watch the destination grow,
  arrive, land
- **The dev warp keeps working** — route it through an instant position change
  rather than a rebuild
- **Hyper travel is unchanged.** It was always altitude-based and it still is;
  the difference is that now there is something to look at while it happens

**Verify:** surface to surface with no load, no cut, no black frame. All five
other worlds visible the whole way. Round-trip times still ~29–35 s.

**The handoff's brightness step, explained and mostly closed.** It was not
ambient and not albedo and not the per-world LUT — all three measured and
rejected. `bandLight`'s floor is 0.47, so the cel-shaded ground has no night
side at all, while the far body drew a real terminator falling to 0.09; and
every arrival from Home lands on the destination's night side (all five,
measured). Deriving the far body's night from the same ladder the ground is lit
by took the mean step from 261% to 69%. The residual ~120% on Tarn and Vault is
open — limb darkening over a whole sphere against a ground that is all centre is
the leading suspect and is arithmetic, not a measurement.

## Phase 5 — Polish

> **WHEN THIS PHASE IS DONE, DROP THE VAULT ROW.** Dex, 2026-08-20: the Idea
> Vault holds unbuilt things only, so a shipped feature has no row there.
> Delete the `data-title="Seamless Space"` article from the backlog list in
> `index.html` (it sits with the other two Surveyor plans, around line 2402) and
> leave this file in the repo as the record. The row is the only thing that
> goes; `docs/seamless-space.md` stays.


**DONE, and it was a renderer bug rather than a look.** "Grows visibly" is not
the same claim as "grows". Phase 4 closed the first bullet by measuring angular size — 4.21 degrees
climbing out to 13.1 on approach — and the filmstrip shows no world in any
transit frame. `dev/crosscheck.mjs` now measures VISIBILITY rather than size: it
lifts the destination's far body for one frame and differences the frame against
itself, so the pixels that change are the body exactly. Three things had to be
fixed in the measurement before it said anything:

- **A control.** Two grabs with nothing toggled differ by more than two levels
  across **61% of the frame** — the sky's dither and the post grain are
  per-frame. The first version reported 61% of the frame responding at a stage
  where the body was not promoted. Averaging twelve renders per grab takes the
  control to ~6%.
- **Mean absolute difference**, not the difference of means, which cancels to
  zero for a body half brighter and half darker than its sky.
- **One instant.** The stage line comes from an earlier round trip and the craft
  moves kilometres between evaluations, so the target's live distance and
  drawAngle are now read in the same synchronous pass as the pixels.

With all three: **the destination's contribution is below the frame's own noise
at every stage**, at cuts of 2, 8 and 20 levels. That is consistent with the
filmstrip and it is not yet a diagnosis — the body's footprint at these stages
is around 0.1% of frame against a 6% floor, so the test lacks the sensitivity to
separate "flat" from "tiny".

**Found and fixed.** The body's own `drawAngle` said 13.67 degrees across while
its transform subtended 2.12. `promote()`'s identity — `scale = K*1.02 *
tan(drawAngle)` — held exactly, so the scaling was right and the POSITION was
placed against the previous frame's camera: `world.discs.update()` ran before
`cam.update()`. Invisible on the ground, where K is hundreds of metres and the
camera moves centimetres; fatal in transit, where K collapses to 15m and the
camera covers hundreds of metres a frame, leaving the destination behind the
eye. `World.updateCamera` now carries everything pinned to the camera and runs
after it. Every stage's subtended angle matches its drawAngle to the digit, the
pixel test has 7x signal over its control, and the filmstrip shows a dot
climbing out that grows into a world. crosscheck asserts it and fails all four
stages if the ordering is put back.

The phase's three bullets as written, and where each one stands:

- Distant worlds should **grow visibly** during hyper travel — the speed FX
  already exist and now have something to play against
- Consider a **skip or fast-forward** for repeat trips. Thirty seconds is fine
  the first time and tedious the fiftieth.
- Re-check the speed FX against real approaching geometry. They were tuned
  against an empty sky.

## Bullet 2 — DONE, and neither of the two things it offered

**Neither a skip nor a fast-forward** (Dex, 2026-08-21). Both are a SECOND WAY
TO TRAVEL — another arrival path, another FX state, another thing that has to
keep working — to solve what is really just a duration. The trip itself gets
shorter instead.

**AND THEN THE SPLIT WENT TOO, one day later.** It shipped as 20 seconds the
first crossing a save ever makes and 10 every crossing after, counted per
player. That is one crossing length now — **`HYPER.trip`, 7 seconds, every
time**. The split had bought a cheaper fiftieth trip with two of everything:
two laws for the suite to fly, a `--repeat` flag on crosscheck, a save field
that changed the physics, and a trip nobody could state in one number.
`economy.crossings` is still counted and still saved; it decides nothing.

**DOOR TO DOOR IS 15.6s, AND THE ESCAPE BURN IS WHY.** The ask was 7 seconds
door to door — button press to driving — around a 3s burn and a 4s crossing.
**3s of burn is not reachable, and the measurement says so twice over.**
`JET.escapeThin` is a fraction of thrust ABOVE the jet's ceiling, and the first
four seconds of a climb happen below it where the fraction does not apply, so
the burn saturates:

| `escapeThin` | burn to the 900m boundary | six-second boosted pull-up |
|---|---|---|
| 0.5 (shipped) | 8.63s | 799m — stays |
| 0.6 | 7.62s | 842m — stays |
| 0.7 | 6.98s | 886m — stays |
| 0.8 | 6.60s | **crosses — departure stops being deliberate** |
| 1.0 | 6.50s | **crosses** |

Six and a half seconds is the floor at infinite thrust, and the guard breaks
before the burn gets anywhere near three. So the burn is untouched and the
crossing took the stated fallback: **7s of crossing, 15.6s door to door.** The
sweep above is an assertion in `run.mjs` now rather than a paragraph, because a
number in a comment is a number that rots. The lever, if this is revisited, is
the jet's climb itself and not `escapeThin`.

**THE ARRIVAL DWELL WAS THE OTHER HALF, and it was `JET.assistTime`.** Nine
seconds of autopilot after a seven-second crossing — the world in frame and the
controls not yours. Found by measurement rather than assumed: the autopilot
ended at exactly 9.00s on all six worlds, which is what a governor that is a
number of seconds looks like. Not `HYPER.approachAlt`, which decides where
hyper ENDS, and not `ARRIVE.alt`, which is already in radii and produces the
same ~20° arrival dive on all six. It is `ARRIVE.assist` now, 2.0s, split off
for the same reason `ARRIVE.alt` was split off `approachAlt`: a launch and an
arrival only ever shared a value. 2.0 is derived from `JET.assistFade` (1.4s) —
`auto` is `assist/assistFade` clamped, so anything shorter never reaches full
authority. Measured hands-off on all six at 9 / 4 / 3 / 2.5 / 2 / 1.5s: the
lowest ground clearance in the 25s after arrival is **17m at every value** — it
is the GPWS that keeps the craft off the ground, never the assist — and nothing
crashes at any of them. Touching the stick still hands over in `assistFade`, so
only the hands-off case moved, which is the case an arrival is.

**The trip is now authored in SECONDS.** `H` — metres of altitude per doubling
— is the only knob that changes trip time, and `t(H) = 2H·2^(-a0/H)/(v0·ln2)`
is not a relation anyone can set by hand: 1500m was 18.1 seconds and nothing
about the number said so. `tune.js` states the seconds and `doublingFor()`
solves back for the metres. That also settles the absolute-length question this
project has got wrong five times: the metres are absolute and allowed to be,
because `legSeconds` has no radius in it, and all five destinations land within
0.5s of the asked time under both laws. Where a number has a scale-free unit,
author it in that unit.

**A shorter trip crosses the far boundary faster — and does not arrive
faster.** Deceleration is the same curve run backwards, so the boundary speed
rises as the leg shortens: 233 m/s at 20s, 292 at 10, 338 at 7, 440 at 4. The
suite pinned that number against twice the jet's boost and a 7s leg fails it.
**It never reaches the player.** `landOn` clamps `speedScalar` to
`JET.maxSpeed` unconditionally, so the craft is handed back at **92.0 m/s under
every one of those legs** — measured, all four. The check's name and its
measurement were pointing at different things; it asserts the clamp now, over
the whole plausible range of legs, because the clamp is what makes any trip
length safe.

**What nearly got tuned instead of measured.** Phase 3's bank rate was sized as
"a half turn takes 3.5s against the 9s a trip has left", and a 10-second leg
leaves about 5. The 30-pair sweep, run under both laws, duly reported an
arrival 35 degrees off. It was the CHECK. `finalBank` is named for arrival and
measured at the last frame the bank is defined — the last stretch of a crossing
is a dive down the destination's radial where there is no bank to be right
about, and those frames are gated out. On a 25s crossing the gate shuts at 87%
and the bank settled at 73%, so the name was never tested; on a 13s crossing it
shuts at 82% with 35 degrees still standing. The craft is fine: 0.68s of roll
with 2.4s to spend, and `landOn` zeroes roll regardless. The check now measures
the SHORTFALL — seconds of bank standing minus seconds left to unwind it —
which is scale-free and says the same thing about a 37-second crossing and an
11-second one. `GRAV.turn` was not touched. The general lesson is in
`../ARCHITECTURE.md`.

**Verified at 7 seconds.** 248 checks in `run.mjs`, 0 failures; the 30-pair
gravity sweep flies 30 crossings under the one law and every pair is upright by
81% of the trip at the latest; `arrivecheck` clean on all six; `crosscheck`
reports the crossing continuous with the far band where it says it is at four
stages. `--repeat` is gone with the second law and so is its sheet.

**`GRAV.turn` WAS THE THING THAT BROKE, and it is decided.** See bullet 3.

## Bullet 3 — AUDITED AND MEASURED, and the answer is a decision, not a value

### The term audit, which came first

Every FX term the crossing drives, and which kind it is:

**EXTENDED TO 7s AND 4s (2026-08-21), which is what the trip change asked
for.** The two right-hand columns are new and they are the ones that decide
anything; 20s and 10s are kept because a term that is 6% at one scale and 25%
at another is the whole point of the table.

| term | kind | of 20s | of 10s | of **7s** | of 4s |
|---|---|---|---|---|---|
| `hyperAberration` 34, `hyperAberrationRadial` 22 | fraction of t² | — | — | — | — |
| `hyperGrain` 2.6, `hyperVignette` 1.2 | fraction of t² | — | — | — | — |
| `streakFrom` 0.16, `streakLen` .55, alpha/width ramps | fraction of t | — | — | — | — |
| `CAM.hyperFov` 0.62 rad, `hyperDist` 1.9 | fraction of t | — | — | — | — |
| streak scroll `0.35 + k*5.5` | a RATE, per second — correct in kind | — | — | — | — |
| `streakBox` 260m | spatial, not temporal | — | — | — | — |
| `CAM.posLerp` 7.5/s (boom) | seconds, τ = 0.133s | 0.7% | 1.3% | 1.9% | 3.3% |
| sfx layer glides | seconds, ≤ 0.10s | ≤0.5% | ≤1.0% | ≤1.4% | ≤2.5% |
| camera tilt damp 6/s | seconds, τ = 0.167s | 0.8% | 1.7% | 2.4% | 4.2% |
| `CAM.hyperLerp` 1.6/s (FOV) | seconds, τ = 0.625s | 3.1% | 6.3% | 8.9% | 15.6% |
| music intensity 1.6/s | seconds, τ = 0.625s | 3.1% | 6.3% | 8.9% | 15.6% |
| music lead 1.1/s | seconds, τ = 0.909s | 4.5% | 9.1% | 13.0% | 22.7% |
| `GRAV.turn` 0.9 rad/s (the bank) | seconds, π/0.9 = 3.49s | 17.5% | 34.9% | **49.9%** | **87.3%** |

**Re-derived rather than assumed, and everything except the bank still holds.**
The one measured claim in the old table was the lagged FOV, and it was
re-measured by flying real legs through `hyper.js` and running the camera's own
first-order lag over the `hyperT` they produce: the FOV reaches **73.8% of its
push at 20s, 72.0% at 10s, 71.1% at 7s and 69.8% at 4s** — the 20s and 10s
figures reproduce the original two exactly, which is what makes the other two
worth quoting. A third of the trip length costs the FOV push 2.7 percentage
points. The worst term in seconds is the music lead at 13.0% of a 7s leg,
against the 9.1% that was already accepted at 10s. The ATMO block's claim —
everything rides one number, nothing needs its own ramp — still holds at 7s.

**`GRAV.turn` DOES NOT, AND THIS IS THE DECISION IT WAS DEFERRED TWICE FOR.**
At 7s the half turn is half the leg, and three unrelated checks failed in one
run: the 30-pair sweep settled at **99% of the trip** against a 95% bar, the
flown 12-crossing check arrived **88° off**, and the arrival attitude stopped
agreeing between 15fps and 120fps by **4.2°** — which is what a bank still
slewing when the trip ends looks like from three directions at once.

**It is 2.6 rad/s, and the value is derived rather than picked:** whatever
holds the half turn at the same SHARE of the leg that 0.9 held at 20 seconds.
17.45% of 7s is 1.222s, so π/1.222 = 2.57 and 2.6 is the round number above it
— a half turn in 1.21s, 17.3% of the trip. Swept over the 30 pairs at 7s:

| `GRAV.turn` | bank upright by | flown 12-crossing | 15fps vs 120fps |
|---|---|---|---|
| 0.9 | 99% of the trip | 88.0° off | 4.21° |
| 1.1 | 91% | 23.3° | 5.07° |
| 1.3 | 87% | 53.5° | 5.93° |
| 1.5 | 84% | 41.2° | 3.03° |
| 1.8 | 82% | 15.7° | 2.91° |
| 2.0 | 82% | 3.5° | 0.01° |
| **2.1** | 82% | **0.000°** | 0.01° |
| 2.6 (shipped) | 75% | 0.000° | 0.00° |
| 3.0 | 73% | 0.000° | 0.00° |

The flown checks turn green between 2.0 and 2.1, so 2.6 clears the threshold by
half a radian a second rather than sitting on it — a bar has to clear what the
design produces, and so does a design. It is still a roll and not a snap: the
raw field reverses at 776 to 10523 degrees a second and this is 149.
**Re-derive it the same way if the trip length moves again.**

### The term that IS wrong in kind is `hyperT`

`hyperT` is `log(speed)/log(cap)`, and the log of `v0·2^(a/H)` is **exactly
`a/aCap`** — so the single number every effect follows is linear in ALTITUDE.
The picture is a function of DISTANCE TO THE DESTINATION. Altitude climbs and
falls symmetrically; distance only ever decreases. Measured at 60Hz, home to
Anvil, both laws:

- the destination holds the far band's floor near **5.7° for the entire climb**
  — 533.7km out at departure, 529.4km at halfway, because a climb is not an
  approach
- it crosses 8° to 20° in **0.4s** on the long leg and **0.15s** on the short one
- the FX peak at 48-49% of the trip; the fastest growth is at 55-60%. An offset
  of about **1.2 seconds** — 6% of a long leg, 12% of a short one

The filmstrips say it in one frame. `FX at full, still a dot` is a full streak
blast at 1,000,000 m/s with the destination a four-degree grey billboard; two
frames later the world is real and textured and the streaks are gone. **The
effects were tuned against an empty sky, and the reason they still look tuned
against an empty sky is that at the moment they play, the sky IS empty.**

That is not fixable by tuning an intensity. Closing it means driving the FX by
something other than speed alone, which contradicts the design's central claim
(`js/main.js`: "everything is a plain function of hyperT, so there is no state
to leave switched on") and the symmetry `run.mjs` asserts. **It is a decision.**

### What shipped instead

Two assertions in `run.mjs` that pin both halves of the finding, so it cannot
be re-lost, and a fix to the harness that was hiding it: `crosscheck`'s
filmstrip gated its four stages on `hyperT`, which peaks at the midpoint, so
all four landed within about a second of each other — 289.9km to 7.2km of
separation across a 20.5s crossing. It reported that the world grew, and the
world does grow, over that second. The stages gate on the destination's drawn
angle now, and captions are read either side of the shutter and print a range
when they disagree; the first cut of that captioned a frame `4.45°` whose own
pixel probe measured 12.85°.

### The 1.7s upright, which was asked about

**It is invisible, and that is a property of the camera rather than of the
bank.** `ChaseCam` takes its up from `craft.transit.up`, so the craft is always
level in frame and the handover shows only as the destination ROTATING — and a
sphere with no readable surface detail does not show rotation. Detail arrives
about a second before the swap; the bank has settled by 89% of a short trip,
which is 1.2s before arrival. So the short trip's later settle costs nothing
that can be seen, and `GRAV.turn` was not touched. The margin is about one
second, and that is the thing to watch if a leg ever goes below ten.

---

# PARKED, AND SHIPPED AROUND — the two findings phase 5 leaves open

Seamless space ships with both of these open. **Neither is a bug**: the game
plays, travel is continuous, and nothing here is a regression against what the
plan promised. They are measured findings, written as mechanism so that whoever
picks one up does not have to derive it again.

## 1. The crescendo does not land on the arrival

`hyperT` is `log(speed)/log(cap)`, and with `v = v0·2^(a/H)` that reduces
**exactly** to `a/aCap`. Every speed effect is therefore driven by ALTITUDE.
Apparent size is driven by DISTANCE TO THE DESTINATION, and during the climb
the two are unrelated: 533.7km out at departure, 529.4km at halfway. Measured
at 60Hz, home to Anvil:

- the destination holds 5.7° for the whole climb
- it crosses 8° to 20° in **0.4s** on a twenty-second leg, **0.15s** on a ten
  and **0.15s** on the seven that ships
- the FX peak **1.2s before** the fastest growth

**AND SHORTENING THE TRIP CANNOT CLOSE IT — measured, 2026-08-21.** The offset
is a fixed number of SECONDS, not a fraction. Over home→anvil, home→ember and
anvil→ember at 20 / 10 / 7 / 4 seconds it is **1.07s to 1.33s in all twelve**,
dead flat, while the fraction runs 6%, 13%, 18%, 30%. It is a property of the
geometry — the cap is reached at the midpoint because of the speed law, and the
distance collapses later than that whatever the clock says — so a shorter trip
leaves the gap exactly where it is and makes it a bigger share of a smaller
journey. `run.mjs` asserted the FRACTION under 15% until this was measured,
which held at 20s and at 10s and failed the moment the leg went to 7; it
asserts the SECONDS now, flown at two lengths in one run so the invariance is
measured rather than claimed.

The filmstrip frame captioned `FX at full, still a dot` is the whole of it:
full streaks at 1,000,000 m/s against a four-degree grey billboard. **No
intensity closes this.** It is an envelope problem, not a tuning one, and two
assertions in `run.mjs` pin both halves so it cannot be quietly re-lost.

### The intended direction, so it is not re-litigated

**`hyperT` is correct for what it describes and is not to be rewired.** The
speed layer stays exactly as it is. What is missing is a SECOND envelope, for
arrival, driven by the picture rather than by speed.

**Raw drawn angle is too spiky to drive it** — 0.15s across the 8-to-20 degree
band on a short crossing.

**The log of drawn angle was the candidate, and it does not survive
measurement.** The reasoning was that angle goes as 1/d against a geometric
collapse in d, so its log would be near-linear across the descent. The collapse
is not geometric. Deceleration is the climb run backwards, so `2^(-a/H)` is
linear in time and `a = -H·log2(c - kt)` — distance is ALREADY logarithmic in
time, and taking a log of it again over-flattens. Measured over the descent
half only (peak altitude to arrival), as the worst deviation from a straight
line in time as a fraction of the total change:

Measured under the 20s and 10s laws, which is what existed at the time; the
trip is a single 7s leg now and the ordering below is what matters, not the
absolute figures.

| pair | leg | log(drawn) | raw drawn |
|---|---|---|---|
| home→anvil | 20s / 10s | 49% / 57% | 22% / 32% |
| home→ember | 20s / 10s | 47% / 53% | 28% / 34% |
| anvil→ember | 20s / 10s | 47% / 53% | 28% / 34% |

The log is the WORSE of the two on every pair tried. So the next session does
not start there. Note also what the same table says about the objection to raw
angle: the spikiness is in the CROSSING, not in the descent — across the
descent proper the raw angle is the better behaved of the two, at 22-34%. A
candidate that separates the crossing from the descent is worth more than one
that tries to cover both with a single curve.

Whatever is chosen has to carry no radius, because the worlds run 207m to
2072m in radius and this project has now written that lesson down six times.

## 2. The residual handoff step

Tarn and Vault still step **~120%** at the far-body to quadtree handoff. The
leading hypothesis is that the comparison has a floor built in — the body's
mean spans a whole sphere including its limb while the ground is all centre,
which is roughly 19% of arithmetic against a 120% gap.

**The limb hypothesis is still unmeasured, and measuring it comes first.** This
is a standing instruction (Dex): **do not touch a shader.** Two earlier rounds
were lost tuning terms into an unproven mechanism, and it is the specific
failure this project keeps repeating.

---

## Risks

**This can destabilise a working game.** Ship each phase separately and confirm
the game still plays before the next.

**Frame budget.** Two planets at once is a real increase. Measure at every
phase, not at the end.

**Phase 3 is the one to be careful with.** Gravity handover bugs are subtle,
intermittent, and only appear in a narrow band of the flight.

**If a phase turns out to be much harder than this describes, stop and report.**
The current swap-based travel works and ships. This is an improvement, not a
rescue.

---

## How to spend each session

- Build first, measure last. No findings sections.
- Reports under 15 lines, plus screenshots.
- Partial is expected — commit what is green, next session continues the same
  phase. Do not split a phase into sub-phases.
- **Every number from lookdev and from the transplants was derived against
  different scales.** Anything with a length or a luminance needs re-deriving
  here too — this phase changes distances by three orders of magnitude.

## Constraints

No build step, no bundler, no npm, no CDN. No inline `<script>` or `<style>`.
All tuning in `js/tune.js`. Stage explicit paths — never `git add -A`.

---

# Phase log — what actually shipped, and where the plan was wrong

Kept here rather than in the prose above so the plan stays readable as a plan.
Full write-ups are in `../README.md`.

## Phase 1 — shipped `ca7cc6b`

`js/world/space.js`. Landed as described, with two deliberate departures.

**One camera, not two.** A uniform scale about the camera is a *similarity
transform*, so it preserves every angle in the frame — the body's size, its
position, and the depth order and parallax between bodies. There is nothing left
for a second camera to buy, and the seam it exists to avoid is avoided more
completely by sharing FOV and orientation automatically. No matrices to keep in
step, no multi-camera surgery on a post stack attached to one camera. The far
band draws in rendering group 0 and Babylon clears depth before group 1, which
*is* "no depth interaction with near geometry".

**`k` is per world.** The plan implies one scale factor. The far plane is per
world — 828 m on Ember against 8288 m on Anvil — so a single `k` sits inside
Anvil's frustum and a kilometre outside Ember's. It is derived from the world
you are standing on and the true extent of the system: 1/1901 on Ember to 1/190
on Anvil, the whole 944 km system landing at `SPACE.fill` of each far plane.

Verified: angular size preserved to **1.6e-16** relative over thirty world
pairs, and `dev/disccheck.mjs` before and after shows every direction, angle and
on-screen measurement identical.

## Phase 2 — shipped `1a4fb60`

`js/world/farbody.js`, plus promotion in `discs.js`.

**The 20 km / 2 km bands do not survive contact with the worlds.** The disc
compression already *is* an LOD ramp and it is scale-free — every world reaches
the same apparent size at the same multiple of its own radius. Promotion runs
17 km on Ember to 170 km on Anvil, and the threshold is stated as a **drawn**
half-angle, because a threshold in true angle would promote Anvil and Ember at
completely different apparent sizes.

**The handoff had to be measured twice.** `dev/lodcheck.mjs` first measured
angular size alone, found it continuous to 1.1%, and would have shipped the LOD
as "no pop". Adding mean luminance to the same run showed the sphere arriving at
0.42 of the billboard's brightness — a 55% cliff. See the continuity invariant
in `../ARCHITECTURE.md`; it is the general lesson.

The cause is not a bug in either LOD: the billboard fakes a sphere with a
screen-aligned parametrisation and the body has a real terminator across real
geometry, so the night side covers a different share of the visible disc.
Matching them exactly would mean making the billboard wrong on purpose. It is
crossfaded instead, via a per-vertex `fade` in `svDisc` that multiplies the
body and never the halo.

**Nothing in normal play promotes anything yet.** Travel is still an instant
swap, so the closest a neighbour ever gets is 338 km and every world on the
contact sheets is pinned at the `drawFloor`. This phase is invisible until
phase 4, which is the correct outcome for a foundation.

## Phase 3 — shipped

`js/world/gravity.js`, plus a transit basis in `craft.js` and one line in
`camera.js`.

**The field is summed rather than switched, so there is no handover to blend.**
The plan asks for a handover at the midpoint that does not jerk the craft. Sum
the six contributions and the midpoint is where the sum stops leaning one way —
a consequence of the arithmetic instead of a rule, and a consequence cannot be
got wrong at a boundary case. With equal surface gravity, `mu = g0 · R²`, so two
wells balance at `Ra / (Ra + Rb)`: the plan's "midpoint" for equal worlds, and
proportional for unequal ones, which is what it meant. Ember and Anvil are 423km
apart and balance 38km out from Ember.

Surface play is untouched by construction and by measurement: the field reads
26.9992 to 27.0002 against `HOP.gravity` of 27 at the six surfaces.

**"Gravity resolves to the nearest significant body" is a different selector
from the one already in the file.** `hyper.js` ranks by altitude because its
speed law is defined on altitude; gravity ranks by `R/d`. On the Ember-Anvil
line they disagree from 10% to 50% of the way across. Both are right for what
they are for, and there is an assertion pinning the disagreement so a later
phase cannot collapse them into one call.

**The plan's stated failure mode was already shipped, in both directions.**
"A craft that flips orientation mid-flight" — transit orientation was built from
world +Y, so the roll snapped at the boundary by 8.6 degrees leaving from the +Y
pole, 146 from the equator and 171 from the far side, and snapped back on
arrival, where `yaw` was never set at all and carried the departure world's
bearing across. Nothing threw and nothing showed in a still frame.

**The bank has to be rate limited, and that is the whole phase.** The summed
field is smooth and following it still snaps the craft over: a trajectory passes
within a few hundred metres of the balance point, where the field direction
reverses inside one frame — 776 to 10531 degrees a second, on every pair.
Continuity is not the same problem as smoothness. Bounded at 0.9 rad/s the half
turn takes 3.5s of the nine a trip has left, and all thirty ordered pairs are
upright again by 83% of the trip at the latest. (0.9 was right for the 20s leg
it was sized against and wrong for the 7s one that replaced it; it is 2.6 now —
see bullet 3, which carries the sweep.)

**What phase 3 does not do is move anything.** Hyper's speed law stays a
function of altitude; the field decides orientation, not trajectory. The plan
does not ask for more, and phase 4's "hyper travel is unchanged" forbids it.

**The check measured nothing, twice, before it measured this.** Bank at arrival
came back as exactly 0.000 degrees on every crossing — first because the raw
angle between the craft's up and the local radial is 90 degrees for any craft
diving into a world, upright or not, and then because gating on "the local up is
at least 5% across the nose" threw away every frame of the handover and reported
a perfect zero off a sample of nought. See the continuity invariant in
`../ARCHITECTURE.md`; this is its second instance.

**Left deliberately.** `landOn` stands the craft up out of the dive in one frame
— 84 degrees, measured, and asserted to be a pitch about the craft's own wings
and nothing else. It is the swap, not the gravity handover, and phase 4 deletes
it. Changing it in isolation changes the feel of every arrival in the game.

## Phase 4 — in progress: the arrival stops being a cut

Not the teardown yet. The first half is everything the rebuild was doing in the
frame you land, which turned out to be almost all of the cost and none of it in
`swapTo`.

**Measured first.** A real crossing, every animation frame sampled: 5.3ms
median, **324ms on the arrival frame**. `swapTo` itself is 16.6ms of that. The
rest is the first `world.update` of a world that has just been built — 81ms of
it, against 4ms for the same call one frame later — plus the shader compiles
that Babylon defers until something is actually drawn.

**Four things move off that frame**, all of them onto a flight that lasts
eighteen to thirty seconds and knows its destination from the moment it starts:
the terrain streams a field-update a frame; the shaders are force-compiled
mid-flight; the geyser vents are built a vent a frame; and the far body for the
world you are LEAVING is built before you get there, because arriving at B is
what makes A the nearest thing in B's sky.

**Two rounds were lost to guessing which subsystem.** `colonies.stream` at 60ms
reads as colony sites; building sites ahead made it 106ms, because the arrival
prediction has not converged early in a flight. Gating on phase 3's `dominant()`
brought it to 90 — still worse than nothing. Counting builds on the arrival
frame said "0 sites, 0 built": none of it was ever sites, it was `streamGeysers`
called from the same function. The general lesson is in `../ARCHITECTURE.md`.

**Result: 324ms to ~45ms**, with zero shaders compiled on the arrival frame and
the worst frame of a crossing now at the DEPARTURE rather than the arrival.

**And then the destination turned out not to grow at all.** `neighbours()` fixes
every disc's direction and distance from the owning world's centre at
construction, and nothing rewrote it — so across a Home-to-Tarn crossing Tarn
was drawn at a constant 4.16 degrees "as if 302.8km away" while the craft closed
from 291km to 8.9km, where its true angle was 5.45 and the drawn one had turned
from an exaggeration into an understatement. `Discs.observe(at)` re-derives both
per frame from wherever the observer is; the destination now runs 4.21 to 11.99
degrees over a trip and promotes to real geometry on the way in. Same family as
the caching invariant, one level down: not a stale planet, a stale position.

**What this rests on** is that a World can now be built and held invisible: its
terrain, colonies and vents hang off `World.ground` and `showMeshes` switches
it. Before, the only thing keeping an inactive world's ground off the screen was
that its field had been disposed — which is exactly why arriving meant building
one from nothing. Two assertions hold it, because it is the six-sky-domes shape.

### What is left in phase 4

- **The ~56ms `World` build**, which this MOVES rather than removes: it now
  happens on the frame you depart. DECIDED (Dex, 2026-08-20): leave it there.
  Building all six at boot is a permanent memory cost to smooth the one moment
  nobody is looking at — you are pointing at empty sky and accelerating away
  from everything visible — and it fights phases 1-3, which exist so that only
  the current world is real. If departure ever reads badly in play, the cheaper
  fix is starting the build a beat earlier in the escape burn; 8.7 seconds of
  held boost is a lot of runway.
- **The swap itself.** Travel is still an instant substitution at the approach
  sphere. The destination grows and promotes now, but the last step — a far
  body giving way to the world's own quadtree — is still one frame.
- **The 84-degree stand-up** that `landOn` performs, left deliberately by phase
  3 and deleted by this phase when the swap goes.
- ~~**The LOD substitution**: a 642-direction far body replaced by a quadtree
  sampling every 5m, in one frame.~~ MEASURED, and the scoping was wrong about
  it. `dev/handoff.mjs` puts the camera at the approach sphere and isolates
  each side: size and silhouette are continuous to within 3% on every pair
  tried, because at 900m over a world whose relief is a few percent of its
  radius the limb is a smooth circle either way and the detail the two LODs
  disagree about is below a pixel at the only distance the swap happens.
  **The luminance step is +928%, −59% and +1132%** on Home-Tarn, Anvil-Ember
  and Home-Anvil — an order of magnitude worse than the cliff phase 2 found,
  and without a consistent sign, because the far body is lit by a terminator
  with no atmosphere while the world is lit through its own fog.
  So the coarse quadtree in the far band is NOT the next piece of work. It was
  designed to fix a geometry pop that is not there. What is left is a lighting
  match at the boundary: `svFarBody` and `svTerrain`-plus-atmosphere agreeing
  on brightness at the handoff distance, which is a shading problem in two
  files rather than a second terrain pipeline.

### The scoping this started from

Not begun because two of its three files were held by another session when the
scoping was done, and because the answer to "what does the swap actually cost"
turned out to change the shape of the work. Measured rather than assumed:

**The swap is a wholesale substitution, not a teardown that can simply be
deleted.** At the approach sphere a promoted far body — 1280 triangles, 642
directions, so the height field sampled every 29m on Ember and every 290m on
Anvil — is replaced in one frame by the quadtree, which samples every 5m. That
is a 6x to 46x jump in terrain resolution, arriving alongside the water shell,
the rocks, the colonies, the survey markers and a different material set. Add
the 84-degree stand-up phase 3 measured and left in place.

**Two worlds cannot both be at true scale, and the reason is the far plane, not
precision.** Everyone reaches for float32 here; it is not the constraint. The
closest pair of worlds is 338km apart, where the float32 spacing is 3.1cm, and
the widest pair is 869km at 6.3cm — invisible on a body subtending a fraction of
a degree. The constraint is that the far plane runs 1359m to 8288m, so a second
world at its true position is **35 to 700 times beyond the frustum**. That is
what the far band exists for and it does not stop being true in phase 4.

**Every world's geometry is built about the scene origin.** `dir * (surfaceR +
h)` in `chunks.js`, `placeOnSphere` in `colony.js` and `geysers.js`, the sky
dome, the water shell. Six concentric worlds is exactly the geometry of the
six-sky-domes bug, and it is why only one can be active today.

### The shape that falls out

The plan's chain is billboard, low-poly sphere, coarse quadtree, fine quadtree.
The first two rungs already ship. The third is the one that carries phase 4, and
the measurements say it should live **in the far band, not the near one**:

- a uniform scale about the camera is a similarity transform, so a quadtree
  drawn compressed is still a quadtree with every angle intact — the same fact
  phase 1 was built on, applied to terrain instead of to a disc
- that puts the destination's geometry in its own local coordinates about its
  own centre, so the origin problem never arises and no rebase is needed
- the handover to true scale then happens when the destination is within the far
  plane — a few kilometres — where the two representations can be made to agree
  because they are the same height field at two resolutions

Mechanically that is a root `TransformNode` per World carrying the far-band
scale and offset, with the current world's left at identity, rather than a
coordinate rewrite of eight files. `farbody.js` already does exactly this for
one mesh.

### What has to be decided before it starts

`HYPER.approachAlt` is 900 metres absolute on worlds whose radii run 207m to
2072m. It is the boundary the whole travel model is built on — departure,
arrival, the tunnelling sweep and the trip check all reference it — and it is
already the cause of one shipped bug (see "Arriving at Ember drew no world at
all" in `../README.md`, patched at the far plane rather than at the cause). A
continuous approach wants it per-world; making it per-world touches every one of
those. That is a decision, not a detail.

### Collisions to check first

`js/main.js` owns `swapTo` and is the file phase 4 deletes half of. `js/tune.js`
carries `HYPER` and `SPACE`. `js/player/craft.js` carries `enterHyper`,
`landOn` and the fourth craft form. All three are high-traffic. Check what is
uncommitted before starting, every time.

