# Proposed doctrine amendment 01 — "reverse it if"

**Status:** proposed here, adopted locally, **not yet upstream.**
**Affects:** `DOCTRINE.md` rule 18. Nothing else moves.
**Raised:** 2026-08-22, dexcimino.com portfolio repo, on the first four `docs/DECISIONS.md`
entries written under the doctrine.

`DOCTRINE.md` is portable and copies verbatim, which means **this repo must not amend its
own copy in place** — a local edit is a fork, and the next project to copy the file gets the
version without it. So the change is written here, adopted in this repo's entries, and
carried upstream to the origin project as a paste. When it lands there, v1.4 replaces this
file's copy of the rule and this file is deleted.

---

## The change

Rule 18 currently asks an entry to carry three things. It should ask for four.

**Current text:**

> 18. **A call that changes how someone builds gets a DECISIONS entry before completion —
>     date, decision, what it replaced, why — landing in the same scoped commit as the
>     change.** So "we rejected that" and "nobody thought of it" stop looking identical from
>     the code, and the reasoning cannot drift away from the diff it explains.

**Proposed text:**

> 18. **A call that changes how someone builds gets a DECISIONS entry before completion —
>     date, decision, what it replaced, why, and what would make it worth reversing —
>     landing in the same scoped commit as the change.** So "we rejected that" and "nobody
>     thought of it" stop looking identical from the code, and the reasoning cannot drift
>     away from the diff it explains. The reversal condition is the half that keeps the file
>     readable as it grows: without it every entry argues for itself forever, and a reader
>     six months out cannot tell a decision that is still load-bearing from one whose reason
>     expired. An entry that cannot name what it replaced was not a decision, it was the
>     first idea; an entry that cannot name what would reverse it is an opinion.

## Why

The four entries in this repo's `docs/DECISIONS.md` were written to the current rule, and
three of the four turned out to have a reversal condition that is **already foreseeable**:

| decision | what would reverse it |
|---|---|
| game source held back from the context pack | the games leave the repo, or context windows grow enough that 6 MB is readable — then `--all` becomes the default and the flag inverts |
| the pack is Python, not Node | the Python toolchain leaves the repo; it is ~250 lines and the contract is in its docstring |
| a stale pack fails the build | the pack stops being how sessions are started; the gate is only worth its weight while onboarding says "paste the zip" |
| the plan parser skips fenced blocks | the plan table moves out of a markdown file, at which point the fence handling is dead weight — **though the printed count is not, and the entry says so** |

Writing those down cost one line each and changed what the entries are *for*. Under the
three-field rule a DECISIONS file is an archive: it explains the past and defends every
choice equally. With the fourth field it is a **trigger list** — a reader scanning it after
some change in circumstance can see which calls that change has just invalidated, without
re-deriving each one's reasoning from scratch.

The fourth entry is the interesting one, because it shows the field doing work rather than
being ceremony. Its reversal condition is *partial*: one half of the decision (skip fenced
blocks) expires if the plan leaves markdown, and the other half (print what the parse found)
never does. A three-field entry has nowhere to record that distinction, so the whole entry
either survives or is thrown away together.

## What it costs

One line per entry, and a little discomfort when there is no honest answer. That discomfort
is the point: a call with no conceivable reversal condition is usually not a call. It is
either a fact about the world — which belongs in `ARCHITECTURE.md`, not here — or it is a
preference that has not been examined.

The rule should **not** be read as demanding a prediction. "Reverse it if" names a
*condition*, not a date, and "nothing foreseeable; this follows from `<constraint>` and
falls only if that does" is a complete and honest answer that also tells a reader exactly
which constraint to check.

## Paste-ready prompt for the origin repo

Everything below the line is the whole handoff. It needs no context from this file.

---

In `DOCTRINE.md`, rule 18 asks a DECISIONS entry for date, decision, what it replaced, and
why. Add a fifth: **what would make it worth reversing.** Replace rule 18 with the
"Proposed text" block above, bump the version line at the top of the file from v1.3 to v1.4,
and update whatever asserts the doctrine's portability so it still passes.

The reasoning, from four entries written under the current rule in another project: three of
the four had a foreseeable reversal condition, and writing it down turned the file from an
archive that defends every past choice equally into a trigger list — a reader whose
circumstances just changed can see which calls that change invalidated without re-deriving
each one. The fourth entry showed the field earning its place: its reversal condition was
*partial*, covering one half of the decision and not the other, and a four-field entry has
nowhere to record that.

Cost is one line per entry. Where there is no honest answer, "nothing foreseeable; this
follows from `<constraint>` and falls only if that does" is a complete one — the rule names
a condition, not a date. The discomfort when no answer comes is diagnostic: a call with no
conceivable reversal condition is usually a fact about the world, which belongs in
ARCHITECTURE, or an unexamined preference.

If any project has DECISIONS entries already written, do **not** backfill them wholesale.
Add the line to an entry the next time someone has reason to read it, so the field is
written by whoever still remembers the reasoning rather than guessed at by whoever found
the file.
