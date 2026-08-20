# Braindump to Batch

Take everything below the line and turn it into a numbered batch of separate,
self-contained task files — each one small enough to hand to a coding agent on
its own, ordered so the safe work lands before the risky work.

It is unsorted, half-finished, and written in the order it occurred to me. Do
not ask me to organise it first. That is the job.

## Order by risk, not by my order

Sort what you find into four tiers and number them in this sequence:

1. **Cosmetic** — styling, copy, config values. Nothing can break.
2. **Contained** — one file, one function. No new imports.
3. **Connected** — two or three files, new wiring between existing parts.
4. **Structural** — new modules, data shapes, anything other work will sit on.

Risky work lands last on purpose: by the time it runs, everything cheap is
already shipped and working, so a failure has a clean floor to fall back to.

If task 7 needs task 5 to have landed, say so at the top of 7 in one line.

## What each task file contains

- **One thing.** If it touches more than about three files, it is two tasks.
- Exact paths, exact function names, exact strings to search for. **Never line
  numbers** — they move the moment anything above them changes.
- Before and after, where a before exists.
- **What not to touch.** The nearby thing that looks related and is not.
- How to tell it worked — one check I can run in under a minute.

Write for someone who has never seen this project and cannot ask me a question.
State what already exists, what must not be rebuilt, and what "done" looks like.
Assume no memory of anything above the line.

## Rules for the agent that runs these

Put these in every file:

- **Stage explicit paths. Never `git add -A`.** It sweeps up whatever else is
  in the tree, including another session's work.
- **Report in under fifteen lines.** Analysis is not the deliverable.
- **Partial is fine.** Commit what works and say what is left, rather than
  holding everything back until the whole task is done.

## Before you write anything

Tell me the total count and the tier split. If it is more than fifteen, tell me
the count and wait — that is usually a sign two projects are tangled together
and want separating before either starts.

Then list, separately: **anything I have to do by hand.** Accounts to create,
keys to generate, dashboards to click. Numbered, in order, at the top. Nothing
is more expensive than a batch that stalls on step three because nobody said an
API key was needed.

---
