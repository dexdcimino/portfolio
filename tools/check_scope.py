"""Reject a commit that reaches across unrelated parts of the repo.

    python tools/check_scope.py <path-to-commit-message>

Run from .git/hooks/commit-msg. It reads the staged tree and the message, and
it exits non-zero if one commit touches more than one PROJECT without saying so.

WHY THIS IS MECHANICAL NOW. CLAUDE.md has carried a staging rule for months —
never `git add -A`, run `git status` first, stage the paths you changed by name.
It has been broken twice, both times by a session committing a snapshot of files
it had never edited:

  2026-08-16  a half-finished Chomp tree swept into an unrelated commit
  2026-08-18  55e52cb, subject "AI Lab: stop the thumbnail hover being clipped",
              reverted ten files under games/surveyor/ — 544 deletions, the
              whole pause menu among them — in a commit that meant to change
              styles.css

A convention that fails twice is not a convention any more, so this is the rule
with teeth.

WHAT COUNTS AS A PROJECT. Not "top-level directory", which is the obvious rule
and would NOT have caught either incident: 55e52cb touched `games/` and one root
file, which is one top-level directory plus loose files. The unit that matters
here is the thing a session owns end to end:

    games/<name>        each game is its own project — this is the refinement
                        that catches both incidents, because both were one
                        session sweeping another's game
    <top-level dir>     assets, tools, docs, ai, ...
    <root>             files sitting at the repo root

ONE NARROW EXEMPTION, and it is a generator's own pairing. Adding an image is
documented in CLAUDE.md as: drop the file under assets/, write one directive
line in index.html, commit. tools/hooks/pre-commit then bakes the derivatives
and stages assets/derived/ AND index.html for you. That is two units by the rule
above, on the most routine flow in the repo, and a hook that taxes the documented
path is a hook people learn to bypass. So {assets, <root>} is allowed when the
only root file staged is index.html.

THE ESCAPE HATCH is a `Spans:` line in the message naming every unit. It has to
name them — a bare marker would become something people paste without reading,
and the point is to make the reach deliberate rather than possible.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROOT_UNIT = "<root>"


def staged_paths() -> list[str]:
    """Paths in the commit being made, added/copied/modified/renamed/deleted."""
    out = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMRD"],
        cwd=ROOT, capture_output=True, text=True)
    if out.returncode != 0:
        return []
    return [p for p in out.stdout.splitlines() if p.strip()]


def unit_of(path: str) -> str:
    parts = path.split("/")
    if len(parts) == 1:
        return ROOT_UNIT
    if parts[0] == "games" and len(parts) > 2:
        return f"games/{parts[1]}"
    return parts[0]


def exempt(units: set[str], paths: list[str]) -> bool:
    """The image pipeline's own pairing — see the module docstring."""
    if units != {"assets", ROOT_UNIT}:
        return False
    root_files = {p for p in paths if "/" not in p}
    return root_files <= {"index.html"}


def message_text(path: Path) -> str:
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    # Git's own comment lines are not the author speaking.
    return "\n".join(l for l in raw.splitlines() if not l.lstrip().startswith("#"))


def main() -> int:
    if len(sys.argv) < 2:
        print("check_scope: no message file given", file=sys.stderr)
        return 1

    # A merge resolves other people's work by definition; it is not someone
    # sweeping files by accident.
    if (ROOT / ".git" / "MERGE_HEAD").exists():
        return 0

    paths = staged_paths()
    if not paths:
        return 0

    units = {unit_of(p) for p in paths}
    if len(units) < 2 or exempt(units, paths):
        return 0

    named = sorted(units)
    text = message_text(Path(sys.argv[1]))
    spans = [l for l in text.splitlines() if l.strip().lower().startswith("spans:")]
    if spans:
        line = spans[0]
        missing = [u for u in named if u not in line]
        if not missing:
            return 0
        print(f"commit-msg: the Spans: line does not name {', '.join(missing)}",
              file=sys.stderr)
    else:
        print("commit-msg: this commit reaches across unrelated projects.",
              file=sys.stderr)

    print("", file=sys.stderr)
    print(f"  {len(paths)} staged path(s) across {len(named)} projects:", file=sys.stderr)
    for u in named:
        hits = [p for p in paths if unit_of(p) == u]
        shown = ", ".join(hits[:3]) + (f", +{len(hits) - 3} more" if len(hits) > 3 else "")
        print(f"    {u:<22} {shown}", file=sys.stderr)
    print("", file=sys.stderr)
    print("  If that is wrong (the usual cause), unstage what you did not edit:", file=sys.stderr)
    print("    git status", file=sys.stderr)
    print("    git reset -- <path>", file=sys.stderr)
    print("", file=sys.stderr)
    print("  If it is deliberate, say so in the message:", file=sys.stderr)
    print(f"    Spans: {', '.join(named)}  - <why>", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
