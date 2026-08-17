# Shot List

> PLACEHOLDER — replace with the real prompt.

Turn a rough idea for a scene into a shot list I can actually shoot or block out
in 3D, without inventing story I did not give you.

## Input

- **Scene:** one or two lines on what happens.
- **Mood:** the feeling, not the lighting setup.
- **Constraints:** location, cast, time of day, anything fixed.

## What to return

A numbered list of shots. Each one gets exactly these fields:

| Field | Meaning |
| --- | --- |
| Framing | wide / medium / close, and on what |
| Move | static, push, track, handheld — and why |
| Beat | the one thing this shot has to land |
| Length | rough seconds |

## Rules

- Every shot must earn its place. If two shots land the same beat, cut one and
  say which.
- Coverage before flourish: the scene must read from the list alone.
- Name the one shot you would keep if there were time for only one.

```text
Scene:
Mood:
Constraints:
```
