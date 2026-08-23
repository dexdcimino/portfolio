# Plan

**Current:** static site is shipped — the open arc is real Work content, then the games' own roadmaps

The line above is the project's arc in a few words. It is **fixed**: the same text in every
context pack, every phase and every reply, so it never carries phase status. Change it when
the direction changes, not when a phase finishes. Doctrine rule 5.

## Phases

**There is no phased plan right now, and that is a real answer rather than a gap.**
`PHASE none` is valid; `tools/context_pack.py` parses this table, finds no rows, and points
the session at the top of `BACKLOG.md` instead. Do not add rows to fill the shape — an
invented phase is a hand-written status, which is the kind that lies (doctrine rule 17).

Add rows when there is genuinely a sequence with an end. One row per phase, in order:

| Phase | What it delivers | Owner | Status |
|---|---|---|---|

The columns are read positionally by the pack, so keep all four:

1. `[<n> — <name>](<spec>.md)` — the link target is the spec, relative to `docs/plan/`.
2. The shortest possible description. It becomes the tracker line, so keep it under about
   forty characters or the pack truncates it.
3. Owner. Free text, not parsed.
4. Status. **`done` at the start of the cell marks a phase finished** and strikes it through
   in the tracker; anything else leaves it open. The first row that is not `done` is the
   ACTIVE FOCUS, and a status containing `Dex`, `needs`, `blocked` or `waiting` tells the
   pack the phase is blocked on a human and changes what `START-HERE.md` asks for.

Worked example, so the format is not guessed at:

```
| [1 — Hosting](1-hosting.md)     | always-on public server    | Dex   | **done** |
| [2 — Sync](2-sync.md)           | edit → everyone sees it    | Dex   | in progress |
| [3 — Installer](3-installer.md) | one exe, sign-in, update   | Dex   | not started |
```

## Where the real backlog lives

Two places, and they are not the same thing:

- **`docs/plan/BACKLOG.md`** — the ordered list of what to pick up next. Unblocked work,
  smallest first where it makes no difference. This is what a session reads when there is
  no active phase.
- **The Idea Vault**, the `.iv-row` list in `index.html` — plans that are *written but
  unbuilt*, each row naming a committed `.md` file. It is a shipped feature of the site, not
  a planning document, and adding a plan there is one `<article>` and no JS edit. A row
  pointing at nothing is worse than no row.

A vault plan graduates by getting a phase table row or a backlog entry. It does not get
copied here: a second copy is a second thing to update, and it goes stale the first time the
plan is amended.
