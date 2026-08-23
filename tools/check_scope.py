"""Reject a commit that reaches across unrelated parts of the repo.

    python tools/check_scope.py <path-to-commit-message>
    python tools/check_scope.py --cases        # prove it can still refuse

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


def verdict(paths: list[str], message: str) -> tuple[bool, str, list[str]]:
    """(allowed, why, units). The WHOLE decision, so the hook and --cases share one.

    Lifted out of main() on 2026-08-22 when this checker got a --cases mode. It had no way
    to prove it still refuses anything — and for a checker whose entire job is refusing,
    that is the failure shape in CLAUDE.md, "Count the subject". This one guards two
    incidents that already happened, so a silent regression here is a regression to the
    state that cost 544 lines.
    """
    if not paths:
        return True, "nothing staged", []

    units = sorted({unit_of(p) for p in paths})
    if len(units) < 2:
        return True, "one project", units
    if exempt(set(units), paths):
        return True, "the documented add-an-image pairing", units

    spans = [l for l in message.splitlines() if l.strip().lower().startswith("spans:")]
    if not spans:
        return False, "reaches across unrelated projects", units

    missing = [u for u in units if u not in spans[0]]
    if missing:
        return False, f"the Spans: line does not name {', '.join(missing)}", units
    return True, "declared with a Spans: line", units


# A commit message with the Spans line where a real one sits: after a blank line.
def msg(subject: str, spans_line: str = "") -> str:
    return (subject + "\n\n" + spans_line) if spans_line else subject


def cases() -> int:
    """Drive verdict() through every state, with both recorded incidents among them."""
    G = "games/surveyor/js/main.js"
    table = [
        # (name, staged paths, message, allowed?)
        ("one project passes", ["styles.css", "index.html"], msg("tidy"), True),
        ("one game passes", [G, "games/surveyor/README.md"], msg("surveyor fix"), True),
        ("nothing staged passes", [], msg("empty"), True),

        ("INCIDENT 55e52cb: a styles.css commit that also reverted ten surveyor files",
         ["styles.css", G], msg("AI Lab: stop the thumbnail hover being clipped"), False),
        ("INCIDENT 2026-08-16: one session sweeping another session's game",
         ["games/chomp/js/main.js", G], msg("chomp work"), False),

        ("two top-level dirs is refused", ["tools/x.py", "docs/y.md"], msg("both"), False),
        ("a game plus the root is refused", [G, "script.js"], msg("fix"), False),

        ("Spans naming every unit passes",
         ["tools/x.py", "docs/y.md"], msg("both", "Spans: docs, tools"), True),
        ("Spans naming only SOME of them is refused",
         ["tools/x.py", "docs/y.md"], msg("both", "Spans: tools"), False),
        ("the Spans key is case-insensitive",
         ["tools/x.py", "docs/y.md"], msg("both", "spans: docs, tools"), True),
        ("Spans must name the root unit explicitly",
         [G, "script.js"], msg("fix", "Spans: games/surveyor"), False),
        ("Spans naming the root unit passes",
         [G, "script.js"], msg("fix", "Spans: <root>, games/surveyor"), True),

        ("the add-an-image exemption passes",
         ["assets/a.png", "assets/derived/a-900.avif", "index.html"], msg("new image"), True),
        ("the exemption is NARROW: a second root file breaks it",
         ["assets/a.png", "index.html", "script.js"], msg("new image"), False),
        ("the exemption does not stretch to another directory",
         ["assets/a.png", "index.html", "tools/x.py"], msg("new image"), False),
    ]

    bad = 0
    for name, paths, message, expect in table:
        allowed, why, units = verdict(paths, message)
        ok = allowed is expect
        bad += 0 if ok else 1
        print(f"  {'ok  ' if ok else 'WRONG'} {name[:72]:<72} "
              f"{'pass' if allowed else 'REFUSE'} (wanted {'pass' if expect else 'REFUSE'})")
        if not ok:
            print(f"         -> {why}; units={units}")

    # unit_of is the whole reason this catches what "one top-level directory" would not,
    # so it is pinned directly rather than only through the table above.
    mapping = [
        ("styles.css", ROOT_UNIT),
        ("index.html", ROOT_UNIT),
        ("games/surveyor/js/main.js", "games/surveyor"),
        ("games/README.md", "games"),          # not deep enough to be one game
        ("tools/check_scope.py", "tools"),
        ("assets/derived/x-900.avif", "assets"),
    ]
    for path, want in mapping:
        got = unit_of(path)
        if got != want:
            print(f"  WRONG unit_of({path}) = {got}, wanted {want}")
            bad += 1

    total = len(table) + len(mapping)
    refuses = sum(1 for r in table if not r[3])
    if len(table) < 15 or refuses < 7:
        print(f"check_scope --cases: table gutted — {len(table)} case(s), "
              f"{refuses} refusing", file=sys.stderr)
        return 1

    print(f"check_scope --cases: {total - bad} of {total} as expected ({refuses} of them "
          f"proving it still refuses, including both recorded incidents)")
    return 1 if bad else 0


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--cases":
        return cases()

    if len(sys.argv) < 2:
        print("check_scope: no message file given", file=sys.stderr)
        return 1

    # A merge resolves other people's work by definition; it is not someone
    # sweeping files by accident.
    if (ROOT / ".git" / "MERGE_HEAD").exists():
        return 0

    paths = staged_paths()
    allowed, why, named = verdict(paths, message_text(Path(sys.argv[1])))
    if allowed:
        return 0

    if why.startswith("the Spans:"):
        print(f"commit-msg: {why}", file=sys.stderr)
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
