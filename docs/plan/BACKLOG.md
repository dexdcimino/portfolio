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
3. ~~`docs/STATUS.md` has drifted~~ — **done 2026-08-22, by deleting it.** It claimed 50
   markup blocks and 332 derivatives against a real 71 and 522. Every fact in it was either
   measurable (now generated into `START-HERE.md` at pack time) or already an item on this
   list, so there was nothing left to keep. Doctrine rule 17: a hand-maintained status
   section that has drifted twice will drift again.
4. **The `site-work` branch is fully merged and its worktree directory is gone**, and
   `arena1` is merged too. Both are prunable; `site-work` has no remote left.
   Verified: `git branch -a`.
5. ~~Give the remaining checkers a `--cases` mode~~ — **done 2026-08-22.** All eight gates
   have one now. It paid for itself immediately: `bake_markup --check` had no empty-parse
   guard, so a page whose directives stopped matching would have printed "0 image block(s)
   current ... all present" and exited 0, and `check_markdown`'s interpolation scan could
   match nothing and pass vacuously. Both were found by writing the case that should fail.
   Verified: every `--cases` command in the `CLAUDE.md` table.
   Verified: `grep -l -- --cases tools/*.py` → `check_sweep.py` only.

## Notes app — held off on purpose (2026-09-07)

The notes overlay was rebuilt as `notes/`; these were in the old DexNote app and are NOT
carried over yet, each by a decision rather than an oversight. Verified: `ls notes/`
and `grep -c "autolist\|split" notes/*.js` → 0.

9. **Column split (2/3 columns per category) and the autolist (checkbox/letter/number
   rows).** Dex said hold them; one body per category is how the notes are written.
   Both would be a per-category field plus a render branch — the schema is ready for
   neither and should not grow them speculatively.
10. **Image resize by handle.** Images take four widths (25/50/75/100%) from a bar
    that appears on click. A drag handle is a nicety on top of a mechanism that
    already persists correctly (`data-w`); do it when a width in between is missed.
11. **Drag-reorder on the canvas.** The sidebar reorders by grip drag and the header
    menu moves up/down/top/bottom; the canvas has the menu only.
12. **Dictation is Chrome-only, and the button hides itself elsewhere.** The Web
    Speech API is `webkitSpeechRecognition` in Chrome and Edge and absent in Firefox
    and Safari. A server-side transcription route is the only other shape, and it
    costs money per minute for a feature used on one machine.
    Verified: `grep -n "SpeechRecognition" notes/dictate.js`.
13. **A session per blob.** One JSON document holds every session; `state.merge`
    already merges per session and per category, so the client end would not change.
    Worth it only if the document nears the 4 MB ceiling — `notes_store_check`
    names the number.

## Blocked on Dex

6. **The Work overlay is still a mockup** — filler SVG data URIs from the
   `TEMPORARY MOCKUP DATA` block in `script.js`, no `work.json`, no real art. The renderer
   is already data-shape-agnostic, so the build is "replace one block with `work.json` plus
   baked derivatives". It needs actual work to show.
   Verified: no `work.json` in the tree.
7. **Every clip poster is Bunny's auto-generated midpoint frame**, not the frame picked in
   the dashboard. The zone caches them for 30 days and no client-side bust reaches them, so
   this is a re-set plus a purge on Bunny's side — a console job, not a repo job.
8. **Open decisions with no default**, inherited from the deleted `docs/STATUS.md`: two masters break the
   lowercase-hyphen slug rule (rename or relax?); re-render clips at 1080p or accept 1280?;
   King Kong stays pillarboxed 9:16 or gets a 16:9 re-export?; keep the V-number scheme in
   `CHANGELOG.md` or log by date?

9. **Nodes: the pieces not yet built.** The mark, the fold, the hover toolbar
   and the one drag that creates, moves and copies are in (`notes/nodes.js`).
   What was asked for and is not here yet:
   - **A multi-image node.** One node holding several pictures, with an
     overlay to add and reorder them and the existing 25/50/75/100 zoom row
     applying inside it. That is a new node KIND with its own stored shape
     (a list of asset keys rather than one `<img>`), not a change to the
     image handling that exists.
   - **Dropping a node into a category TITLE.** A title is a plain string in
     the model (`cat.title`) and `wireTitle` flattens any element typed into
     it on the next input. Supporting a chip there means the title becomes
     rich text, which is a data-shape change and a merge-conflict question,
     not a drag-target question.
   - **A real favicon.** Blocked by `img-src 'self' data:` and, more to the
     point, by not wanting a private page to tell a third party its link
     graph. `docs/DECISIONS.md` has the reasoning and the shape of the
     server-side answer if it is ever wanted.
   Verified: `grep -c 'chip-image' notes/*.js` → 0.

## Written but unbuilt

Not here. Those live in the **Idea Vault** — the five `.iv-row` entries in `index.html`,
each naming a committed `.md` file. Verified: `grep -c 'class="iv-row"' index.html` → 5.
A vault plan graduates by getting a backlog entry or a phase row; it is never copied into
this file.
