#!/usr/bin/env python3
"""Verify the cursor set really is identical everywhere it is copied.

CURSOR_PATHS in script.js is the source of truth: three cursors (arrow,
pointing hand, I-beam), each a path, a hotspot and a native fallback, drawn
as accent-over-casing data URIs. Three other places restate the table, and
comments naming the other copies only work until one edit lands in two of
three — after that nothing says which one is right. Same failure the accent
palette had, same fix: check_accents.py established the pattern.

The copies, and why each one exists:

  games/_shared/cursor.js         the module game documents import — an
                                  iframe cannot inherit the parent page's
                                  cursor, so each game installs its own.
  games/stickland/src/cursor.js   Stickland builds from src/ alone; the blob
                                  loader cannot reach _shared over file://.
  games/stickland/index.html      build output of src/ (gitignored; present
                                  only on a machine that has built).
  games/stickland/v1/index.html   the build the SITE ACTUALLY SERVES — the
                                  copy most likely to be forgotten, which is
                                  the main reason it is checked.

Compared per cursor: the SVG path (`d`), the hotspot and the fallback.
The two stroke widths of the double-stroke construction (4.5 casing under 2
accent) are asserted present in every file as well — a copy that redrew the
line weight would read as a different set even with identical geometry.

Usage:

    python tools/check_cursors.py           # exit 1 on any drift
    python tools/check_cursors.py --list    # print the set and the copies
    python tools/check_cursors.py --cases   # prove the checker can still refuse

Nothing is rewritten: two of the copies are build output, where the fix is
to re-run Stickland's build rather than to patch the generated file.
"""

import io
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SOURCE = "script.js"
COPIES = [
    "games/_shared/cursor.js",
    "games/stickland/src/cursor.js",
    "games/stickland/index.html",
    "games/stickland/v1/index.html",
]

# Absent is not drift — see check_accents.py, which set this convention.
OPTIONAL = {"games/stickland/index.html"}

BUILT = {
    "games/stickland/index.html": "node build.mjs (from games/stickland/)",
    "games/stickland/v1/index.html": "node build.mjs, then move index.html to v1/",
}

# One cursor entry, in source or in build output (inside the bundles the
# module source lives in a JSON-quoted string, but single-quoted JS strings
# survive verbatim there, so the same pattern matches unmodified).
ENTRY_RE = re.compile(
    r"\b(arrow|pointer|text)\s*:\s*\{[^{}]*?"
    r"d\s*:\s*'([^']+)'[^{}]*?"
    r"hot\s*:\s*'([^']+)'[^{}]*?"
    r"fallback\s*:\s*'([^']+)'",
    re.DOTALL,
)

KINDS = ("arrow", "pointer", "text")
STROKES = ("stroke-width='4.5'", "stroke-width='2'")


def fail(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)


def parse(text: str, rel: str):
    """Pull {kind: (d, hot, fallback)} plus a strokes flag out of one file's TEXT.

    Split from extract() so --cases can drive it against synthetic cursor sets.
    Every rejection this checker can make lives in here, which is what makes the
    case table a test of the checker rather than of the filesystem.
    """
    entries = {}
    for kind, d, hot, fallback in ENTRY_RE.findall(text):
        if kind in entries and entries[kind] != (d, hot, fallback):
            fail(f"{rel}: two different '{kind}' cursor entries — cannot say which one runs")
            return None
        entries[kind] = (d, hot, fallback)

    missing = [k for k in KINDS if k not in entries]
    if missing:
        fail(f"{rel}: no cursor entry parsed for: {', '.join(missing)} — shape changed?")
        return None

    strokes_ok = all(s in text for s in STROKES)
    return {"entries": entries, "strokes": strokes_ok}


def extract(rel: str):
    """parse() over a file on disk, with the absent-and-that-is-fine case."""
    path = ROOT / rel
    if not path.exists():
        if rel in OPTIONAL:
            return "absent"
        fail(f"{rel}: missing — a cursor copy was moved or deleted")
        return None
    return parse(io.open(path, encoding="utf-8").read(), rel)


def report(rel: str, want, got) -> None:
    fail(f"{rel}: cursor set does not match {SOURCE}")
    for kind in KINDS:
        w = want["entries"][kind]
        g = got["entries"][kind]
        if w == g:
            continue
        for label, wv, gv in zip(("d", "hot", "fallback"), w, g):
            if wv != gv:
                print(f"    {kind}.{label}: expected {wv!r}\n"
                      f"    {kind}.{label}:    found {gv!r}", file=sys.stderr)
    if not got["strokes"]:
        print(f"    double-stroke weights ({' / '.join(STROKES)}) not both present",
              file=sys.stderr)
    if rel in BUILT:
        print(f"    {rel} is GENERATED — fix by re-running: {BUILT[rel]}", file=sys.stderr)


# ---------------------------------------------------------------------------- cases --
# One complete cursor set, in the shape both the source and the bundles carry. The
# strokes are checked as bare substrings by the real checker, so they have to be here
# verbatim or every case would fail on the strokes flag rather than on what it is testing.
GOOD = """
const CURSORS = {
  arrow:   { d: 'M2 2 L2 18 L7 13 L11 20 L14 18 L10 12 L17 12 Z',
             hot: '2 2', fallback: 'default' },
  pointer: { d: 'M9 2 L9 12 L12 9 L15 14 L12 16 L9 11 Z',
             hot: '9 2', fallback: 'pointer' },
  text:    { d: 'M8 3 L14 3 M11 3 L11 17 M8 17 L14 17',
             hot: '11 10', fallback: 'text' },
};
const OUTLINE = "stroke-width='4.5'";
const INK     = "stroke-width='2'";
"""


def cases() -> int:
    """Prove this checker still refuses. Doctrine rule 12; CLAUDE.md, "Count the subject".

    The failure mode this guards against is specific and has happened in this repo three
    times in one afternoon: a regex whose shape assumption quietly stopped matching, so it
    observed ZERO of its subject and took the same branch as a clean run. Every case below
    goes through parse(), which is where all of this checker's rejections live.
    """
    quiet = io.StringIO()
    real_err, sys.stderr = sys.stderr, quiet

    want = parse(GOOD, "<good>")
    table = [
        # (name, text, "match" | "differs" | "refused")
        ("a complete set parses", GOOD, "match"),
        ("a changed path is drift",
         GOOD.replace("L2 18", "L2 19"), "differs"),
        ("a changed hotspot is drift",
         GOOD.replace("hot: '9 2'", "hot: '9 3'"), "differs"),
        ("a changed fallback is drift",
         GOOD.replace("fallback: 'pointer'", "fallback: 'grab'"), "differs"),
        ("A MISSING OUTLINE STROKE is drift, not a pass",
         GOOD.replace("stroke-width='4.5'", "stroke-width='4'"), "differs"),
        ("a missing ink stroke is drift",
         GOOD.replace("stroke-width='2'", "stroke-width='1.5'"), "differs"),
        ("a dropped cursor is refused",
         GOOD.replace("  text:    { d: 'M8 3 L14 3 M11 3 L11 17 M8 17 L14 17',\n"
                      "             hot: '11 10', fallback: 'text' },\n", ""), "refused"),
        ("two DIFFERENT entries for one kind are refused, not guessed between",
         GOOD + GOOD.replace("hot: '2 2'", "hot: '3 3'"), "refused"),
        ("EMPTY is refused, never reported as a match", "", "refused"),
        ("a file with no cursor set at all is refused",
         "const SOMETHING_ELSE = { a: 1 };", "refused"),
        ("a changed entry SHAPE is refused, not silently zero",
         GOOD.replace("d:", "path:"), "refused"),
        ("a renamed kind is refused, because one of the three is now missing",
         GOOD.replace("pointer:", "hand:"), "refused"),
    ]

    bad = 0
    results = []
    for name, text, expect in table:
        got = parse(text, "<case>")
        actual = "refused" if got is None else ("match" if got == want else "differs")
        ok = actual == expect
        bad += 0 if ok else 1
        results.append((ok, name, actual, expect))

    sys.stderr = real_err
    for ok, name, actual, expect in results:
        print(f"  {'ok  ' if ok else 'WRONG'} {name:<62} {actual} (wanted {expect})")

    refuses = sum(1 for r in table if r[2] != "match")
    if len(table) < 12 or refuses < 9 or not want or len(want["entries"]) != len(KINDS):
        print(f"check_cursors --cases: table gutted — {len(table)} case(s), {refuses} "
              f"refusing", file=sys.stderr)
        return 1

    # Duplicate-but-IDENTICAL entries must NOT be refused: script.js and the bundles both
    # legitimately restate the set, and refusing that would break the live gate.
    if parse(GOOD + GOOD, "<dup>") != want:
        print("check_cursors --cases: identical duplicates should parse, not refuse",
              file=sys.stderr)
        return 1

    live = extract(SOURCE)
    if not live or len(live["entries"]) != len(KINDS):
        print(f"check_cursors --cases: parses the fixtures but not {SOURCE} itself "
              f"— discovery is broken", file=sys.stderr)
        return 1

    print(f"check_cursors --cases: {len(table) - bad} of {len(table)} as expected "
          f"({refuses} of them proving it still refuses; {SOURCE} parses "
          f"{len(live['entries'])} cursors)")
    return 1 if bad else 0


def main(argv) -> int:
    if "--cases" in argv:
        return cases()

    want = extract(SOURCE)
    if want in (None, "absent"):
        fail(f"cannot read the source of truth ({SOURCE}); nothing to check against")
        return 1
    if not want["strokes"]:
        fail(f"{SOURCE}: double-stroke weights ({' / '.join(STROKES)}) not both present")
        return 1

    if "--list" in argv:
        print(f"{SOURCE} — source of truth, {len(KINDS)} cursors")
        for kind in KINDS:
            d, hot, fallback = want["entries"][kind]
            print(f"  {kind:<8} hot {hot:<6} fallback {fallback:<8} d {d[:52]}{'…' if len(d) > 52 else ''}")
        print(f"\n{len(COPIES)} copies checked:")
        for rel in COPIES:
            tags = []
            if rel in BUILT:
                tags.append("generated")
            if rel in OPTIONAL:
                tags.append("gitignored, checked only if built")
            print(f"  {rel}" + (f"  ({'; '.join(tags)})" if tags else ""))
        return 0

    drift = 0
    skipped = 0
    for rel in COPIES:
        got = extract(rel)
        if got == "absent":
            skipped += 1
            continue
        if got is None:
            drift += 1
            continue
        if got["entries"] != want["entries"] or not got["strokes"]:
            report(rel, want, got)
            drift += 1

    if drift:
        print(f"\ncursor set: {drift} of {len(COPIES)} copies out of step with {SOURCE}",
              file=sys.stderr)
        return 1

    note = f" ({skipped} not built, skipped)" if skipped else ""
    print(f"cursor set: {len(COPIES) - skipped} copies match {SOURCE} "
          f"({len(KINDS)} cursors){note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
