# Backlog

What to pick up when there is no active phase, in order. A session started from a context
pack with `PHASE none` starts at the top of this list.

**Every item here was checked against the tree on 2026-08-22, not copied from memory.** The
command that confirmed each one is named, because an unverified backlog is a hand-written
status section wearing a different hat (doctrine rule 17). Re-check before starting one —
several of these are one commit away from being untrue.

## Unblocked — a session can start any of these now

1. **`README.md` says `V31`, `CHANGELOG.md` is at `V33`.** Two versions of drift.
   Verified: `grep -o "V[0-9]\+" README.md CHANGELOG.md | head`.
2. **Two `href="#"` placeholders in `index.html`** — the YouTube and Instagram links in the
   sidebar. They need real URLs or removal; a dead link is worse than an absent one.
   Verified: `grep -c 'href="#"' index.html` → 2.
3. **`docs/STATUS.md` is a hand-maintained status section and has already drifted.** It is
   dated 2026-08-17 and claims `bake_markup --check` passes at "50 blocks, 332 derivatives";
   the real numbers today are **71 and 522**. Doctrine rules 16–17 say the measurable half
   should not be typed at all — `START-HERE.md` now measures it at pack time. The fix is to
   cut the measurable claims and leave only the open decisions, which cannot be measured.
   Verified: `python tools/bake_markup.py --check`.
4. **The `site-work` branch is fully merged and its worktree directory is gone**, and
   `arena1` is merged too. Both are prunable; `site-work` has no remote left.
   Verified: `git branch -a`.
5. **Give `check_accents.py`, `check_cursors.py` and the two `--check`s a `--cases` mode.**
   `check_sweep.py` has one and it is the only checker in the repo that can prove it still
   bites. Everything else counts its subject but has no test that fails when the checker
   goes blind — which is precisely the shape that has already cost this repo four incidents.
   See `CLAUDE.md`, "Count the subject".
   Verified: `grep -l -- --cases tools/*.py` → `check_sweep.py` only.

## Blocked on Dex

6. **The Work overlay is still a mockup** — filler SVG data URIs from the
   `TEMPORARY MOCKUP DATA` block in `script.js`, no `work.json`, no real art. The renderer
   is already data-shape-agnostic, so the build is "replace one block with `work.json` plus
   baked derivatives". It needs actual work to show.
   Verified: no `work.json` in the tree.
7. **Every clip poster is Bunny's auto-generated midpoint frame**, not the frame picked in
   the dashboard. The zone caches them for 30 days and no client-side bust reaches them, so
   this is a re-set plus a purge on Bunny's side — a console job, not a repo job.
8. **Open decisions with no default**, carried from `docs/STATUS.md`: two masters break the
   lowercase-hyphen slug rule (rename or relax?); re-render clips at 1080p or accept 1280?;
   King Kong stays pillarboxed 9:16 or gets a 16:9 re-export?; keep the V-number scheme in
   `CHANGELOG.md` or log by date?

## Written but unbuilt

Not here. Those live in the **Idea Vault** — the five `.iv-row` entries in `index.html`,
each naming a committed `.md` file. Verified: `grep -c 'class="iv-row"' index.html` → 5.
A vault plan graduates by getting a backlog entry or a phase row; it is never copied into
this file.
