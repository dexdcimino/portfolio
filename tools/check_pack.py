#!/usr/bin/env python3
"""Refuse a commit when the context pack in the root describes a repo that no longer exists.

    python tools/check_pack.py           # the gate; silent on pass
    python tools/check_pack.py --cases   # prove the gate can still fail

A PACK THAT IS PRESENT BUT STALE IS WORSE THAN NO PACK AT ALL. A session pastes it, reads a
build stamp claiming a HEAD and a clean tree, and works confidently from fiction with
nothing anywhere to warn it. Absent is honest — a fresh clone has not run the hook and the
session simply has no pack. Present-and-wrong is the failure this exists to stop.

The stamp is `.context-pack.stamp`, gitignored, written by `tools/context_pack.py` at the
end of every build: line 1 is the HEAD it packed, line 2 is when. `post-commit` rebuilds the
pack after every commit, so in the normal case the stamp already names HEAD and this check
is a no-op nobody notices.

It goes stale in the cases post-commit does not cover, and those are exactly the cases where
a wrong pack is most believable: a rebase or a merge (git does not fire post-commit for
either), a commit made on a machine where the hook was never installed, a `git reset` that
moves HEAD backwards, or a pack build that died half way.

WHY --cases EXISTS. This repo has shipped four checkers that reported clean while examining
nothing, and a freshness check that cannot fail is precisely that shape — it would sit in
the hook forever, printing nothing, proving nothing. `verdict()` below is a pure function of
(stamp text, HEAD, does the zip exist), the hook and the cases call the same one, and
`--cases` drives it through every state including the two that must fail. Run it after
touching this file.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAMP = ROOT / ".context-pack.stamp"
PACK = ROOT / "context-pack.zip"

REBUILD = "python tools/context_pack.py"


def verdict(stamp_text: str | None, head: str, pack_exists: bool) -> tuple[bool, str]:
    """(ok, message). The whole decision, so the hook and --cases cannot diverge."""
    if stamp_text is None:
        return True, "no pack stamp — nothing claims to be current, which is honest"

    packed = (stamp_text.splitlines() or [""])[0].strip()

    if not packed:
        return False, f"the stamp is empty. A half-written build. Rebuild: {REBUILD}"

    if not pack_exists:
        return False, (f"the stamp names {packed[:8]} but context-pack.zip is gone. "
                       f"Delete .context-pack.stamp, or rebuild: {REBUILD}")

    if not head:
        # No HEAD at all: an unborn branch. Nothing to be stale against.
        return True, "no HEAD yet — nothing to compare the stamp to"

    if packed != head:
        return False, (f"context-pack.zip was built at {packed[:8]} and HEAD is now "
                       f"{head[:8]}. It describes a repo that no longer exists, and a "
                       f"session pasting it would work from fiction. Rebuild: {REBUILD}")

    return True, f"pack is current at {head[:8]}"


def head_sha() -> str:
    try:
        p = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT,
                           capture_output=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return p.stdout.decode().strip() if p.returncode == 0 else ""


def cases() -> int:
    """Drive verdict() through every state. Two of these MUST come back false."""
    HEAD = "a" * 40
    OLD = "b" * 40
    table = [
        # (name, stamp, head, zip present, expected ok)
        ("no stamp at all (fresh clone)",        None,             HEAD, True,  True),
        ("stamp matches HEAD",                   f"{HEAD}\nnow",   HEAD, True,  True),
        ("stamp matches, trailing whitespace",   f"  {HEAD}  \n",  HEAD, True,  True),
        ("no HEAD yet (unborn branch)",          f"{HEAD}\nnow",   "",   True,  True),
        ("STALE: stamp names an older HEAD",     f"{OLD}\nnow",    HEAD, True,  False),
        ("STALE: stamp with no zip beside it",   f"{HEAD}\nnow",   HEAD, False, False),
        ("BROKEN: empty stamp",                  "\n",             HEAD, True,  False),
    ]
    bad = 0
    for name, stamp, head, zip_there, expect in table:
        ok, msg = verdict(stamp, head, zip_there)
        agreed = ok is expect
        bad += 0 if agreed else 1
        print(f"  {'ok  ' if agreed else 'WRONG'} {name:<38} "
              f"{'pass' if ok else 'FAIL'} (wanted {'pass' if expect else 'FAIL'})")
        if not ok:
            print(f"         -> {msg}")

    # Count the subject and assert the count, or a table that stopped being driven looks
    # exactly like a table that passed. Both halves matter: an all-passing table would mean
    # the check can no longer refuse anything.
    must_fail = sum(1 for row in table if not row[4])
    if len(table) < 7 or must_fail < 2:
        print(f"check_pack --cases: only {len(table)} case(s), {must_fail} of them "
              f"failing — the table has been gutted", file=sys.stderr)
        return 1

    print(f"check_pack --cases: {len(table) - bad} of {len(table)} as expected "
          f"({must_fail} of them proving it still refuses)")
    return 1 if bad else 0


def main(argv: list[str]) -> int:
    if argv and argv[0] == "--cases":
        return cases()

    stamp = STAMP.read_text(encoding="utf-8") if STAMP.exists() else None
    ok, msg = verdict(stamp, head_sha(), PACK.exists())

    if ok:
        # Silent on pass. The pre-commit hook is a no-op for most commits in this repo and
        # has to stay one — a line printed on every commit is a line nobody reads.
        if "-v" in argv:
            print(f"check_pack: {msg}")
        return 0

    print(f"check_pack: {msg}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
