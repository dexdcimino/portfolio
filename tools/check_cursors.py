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


def extract(rel: str):
    """Return {kind: (d, hot, fallback)} plus a strokes flag, or None/'absent'."""
    path = ROOT / rel
    if not path.exists():
        if rel in OPTIONAL:
            return "absent"
        fail(f"{rel}: missing — a cursor copy was moved or deleted")
        return None

    text = io.open(path, encoding="utf-8").read()
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


def main(argv) -> int:
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
