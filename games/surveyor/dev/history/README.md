# Imported git history

SURVEYOR was developed in a standalone repo (`~/Downloads/surveyor`, since
deleted). Its 13 commits are preserved here as a git bundle rather than a
nested `.git`.

- `surveyor-history.bundle` — every commit, branch and tag, complete.
- `COMMITS.txt` — the log, for reading without unpacking.

The working tree at that repo's HEAD (`417aa51`) is byte-identical to
`games/surveyor/` as imported, minus `dev/shots/*.png`, which were gitignored
there and are regenerable with `dev/shots.mjs`.

Restore a browsable clone anywhere outside this repo:

    git clone games/surveyor/dev/history/surveyor-history.bundle surveyor-history

Or inspect without cloning:

    git bundle list-heads surveyor-history.bundle
