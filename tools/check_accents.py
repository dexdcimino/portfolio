#!/usr/bin/env python3
"""Verify the seven-accent palette really is identical everywhere it is copied.

ACCENTS in script.js is the source of truth. Five other places restate it, and
three of them carry a comment asserting they are "byte-identical" to it — an
assertion nothing checked until this script existed. The duplication itself is
deliberate and stays: a game must not reach into the parent document to find out
what colour the visitor picked, and the palette changes rarely. What was missing
was the part that makes a rare change safe.

The copies, and why each one exists:

  games/arena1/js/pausemenu.js      exported SITE_ACCENTS; render/actors.js maps
                                    accent NAMES through it for remote pills, so
                                    a drift here mis-colours other players.
  games/chomp/js/pausemenu.js       same table, local to that game.
  games/stickland/src/pausemenu.js  the SOURCE for the two builds below.
  games/stickland/index.html        build output of src/, palette inlined inside
                                    a module string (escaped \\n, same text).
  games/stickland/v1/index.html     the build the SITE ACTUALLY SERVES. Editing
                                    src/ is not enough: `node build.mjs` writes
                                    index.html beside itself and it has to be
                                    moved to v1/, per games/stickland/CLAUDE.md.
                                    This is the copy most likely to be forgotten,
                                    which is the main reason it is checked.

NOT checked, on purpose:

  games/chomp/js/visuals/proc/chomp.js reuses the same hexes for creature bodies
  and tufts, but those track the MASCOT ARTWORK, not the UI accent. If the UI
  palette is ever lightened for legibility the creatures should not follow, so
  binding them together here would enforce the wrong invariant.

  tools/bake_favicon.py pins lime alone (DEFAULT_ACCENT) for the static .ico
  fallback. It is one colour, not the palette, and is already commented as such.

Usage:

    python tools/check_accents.py           # exit 1 on any drift
    python tools/check_accents.py --list    # print the palette and the copies
    python tools/check_accents.py --cases   # prove the checker can still refuse

Exit code is 0 only when every copy matches the source in colour, name and
order. Nothing is rewritten: two of the copies are build output, where the fix
is to re-run the build rather than to patch the generated file.
"""

import io
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SOURCE = "script.js"
COPIES = [
    "games/arena1/js/pausemenu.js",
    "games/chomp/js/pausemenu.js",
    "games/stickland/src/pausemenu.js",
    "games/stickland/index.html",
    "games/stickland/v1/index.html",
]

# games/stickland/index.html is GITIGNORED — the build writes it beside build.mjs
# and it is then moved to v1/, which is the copy the site serves and the only one
# committed. So it is absent on a fresh clone and present on a machine that has
# built: check it when it is there, say nothing when it is not. Absent is not
# drift, and failing on it would break the hook for anyone who has not built.
OPTIONAL = {"games/stickland/index.html"}

# Generated files, where patching the file is the wrong fix.
BUILT = {
    "games/stickland/index.html": "node build.mjs (from games/stickland/)",
    "games/stickland/v1/index.html": "node build.mjs, then move index.html to v1/",
}

# The array opener, in any of the forms the copies use: `const ACCENTS = [`,
# `const SITE_ACCENTS = [`, `export const SITE_ACCENTS = [`.
DECL_RE = re.compile(r"(?:export\s+)?const\s+(?:SITE_)?ACCENTS\s*=\s*\[")

# One entry. The source spells the colour `color:` and carries a third `mascot:`
# key; the copies spell it `hex:` and stop there. Both are accepted — the games
# have no use for a mascot name, and forcing the shapes to converge would mean
# editing five files to satisfy a checker.
ENTRY_RE = re.compile(
    r"name\s*:\s*'([a-z]+)'\s*,\s*(?:color|hex)\s*:\s*'(#[0-9A-Fa-f]{6})'"
)


def fail(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)


def parse(text: str, rel: str):
    """Pull [(name, HEX), ...] out of one file's TEXT, or None if unreadable.

    Split from extract() so --cases can drive it against synthetic palettes
    without needing five files on disk. Every rejection this checker can make
    lives in here, which is what makes the case table below a real test of the
    checker rather than a test of the filesystem.

    Works on source and on build output alike: inside the bundles the array
    lives in a JS string with the newlines escaped, but the entries themselves
    survive verbatim, so the same pattern matches without un-escaping anything.
    """
    decls = list(DECL_RE.finditer(text))
    if not decls:
        fail(f"{rel}: no ACCENTS/SITE_ACCENTS declaration found")
        return None
    if len(decls) > 1:
        # Two arrays means one of them is shadowing the other and this script
        # can no longer say which one the game reads. Refuse to guess.
        fail(f"{rel}: {len(decls)} ACCENTS declarations, expected 1")
        return None

    start = decls[0].end()
    close = text.find("]", start)
    if close == -1:
        fail(f"{rel}: ACCENTS declaration is never closed")
        return None

    entries = [(n, h.upper()) for n, h in ENTRY_RE.findall(text[start:close])]
    if not entries:
        fail(f"{rel}: ACCENTS is present but no entries parsed — shape changed?")
        return None
    return entries


def extract(rel: str):
    """parse() over a file on disk, with the absent-and-that-is-fine case."""
    path = ROOT / rel
    if not path.exists():
        if rel in OPTIONAL:
            return "absent"
        fail(f"{rel}: missing — a palette copy was moved or deleted")
        return None
    return parse(io.open(path, encoding="utf-8").read(), rel)


def report(rel: str, want, got) -> None:
    """Print exactly which rows differ, rather than just that something did."""
    fail(f"{rel}: palette does not match {SOURCE}")
    for i in range(max(len(want), len(got))):
        w = want[i] if i < len(want) else None
        g = got[i] if i < len(got) else None
        if w == g:
            continue
        fmt = lambda e: f"{e[0]} {e[1]}" if e else "(absent)"
        print(f"    [{i}] expected {fmt(w):<18} found {fmt(g)}", file=sys.stderr)
    if rel in BUILT:
        print(f"    {rel} is GENERATED — fix by re-running: {BUILT[rel]}", file=sys.stderr)


# ---------------------------------------------------------------------------- cases --
# A palette that matches, in the shape the SOURCE uses (color: + mascot:).
GOOD_SOURCE = """
const ACCENTS = [
  { name: 'lime',  color: '#9EE02B', mascot: 'frog'  },
  { name: 'blue',  color: '#2B8CE0', mascot: 'fish'  },
  { name: 'red',   color: '#E02B2B', mascot: 'crab'  },
];
"""

# The same palette in the shape the COPIES use (hex:, no mascot). Both must parse
# to the same three entries — that tolerance is deliberate and worth pinning down,
# because tightening it would mean editing five files to satisfy a checker.
GOOD_COPY = """
export const SITE_ACCENTS = [
  { name: 'lime', hex: '#9EE02B' },
  { name: 'blue', hex: '#2B8CE0' },
  { name: 'red',  hex: '#E02B2B' },
];
"""


def cases() -> int:
    """Prove this checker still refuses. Doctrine rule 12; CLAUDE.md, "Count the subject".

    Four of this repo's checkers have reported clean while examining nothing, and a
    palette checker is a soft target for it: every rejection here is "the regex found
    something unexpected", and a regex that finds NOTHING takes the same branch as a
    regex that finds everything in order. So the table below drives parse() — the
    function every rejection lives in — through each shape, and the exit code is wrong
    unless a known number of them come back refused.
    """
    quiet = io.StringIO()
    real_err, sys.stderr = sys.stderr, quiet          # rejections print; cases are not noise

    want = parse(GOOD_SOURCE, "<good source>")
    table = [
        # (name, text, expected -> "match" | "differs" | "refused")
        ("source shape parses (color: + mascot:)", GOOD_SOURCE, "match"),
        ("copy shape parses the same (hex:)", GOOD_COPY, "match"),
        ("a changed hex is drift",
         GOOD_COPY.replace("#2B8CE0", "#2B8CE1"), "differs"),
        ("a renamed accent is drift",
         GOOD_COPY.replace("'blue'", "'azure'"), "differs"),
        ("REORDERED is drift, not a match",
         GOOD_COPY.replace("{ name: 'lime', hex: '#9EE02B' },\n  ", "")
                  .replace("];", "  { name: 'lime', hex: '#9EE02B' },\n];"), "differs"),
        ("a dropped accent is drift",
         GOOD_COPY.replace("  { name: 'red',  hex: '#E02B2B' },\n", ""), "differs"),
        ("an added accent is drift",
         GOOD_COPY.replace("];", "  { name: 'gold', hex: '#E0C22B' },\n];"), "differs"),
        ("no declaration at all is refused", "const NOT_THE_PALETTE = [];", "refused"),
        ("two declarations are refused, not guessed between",
         GOOD_COPY + GOOD_COPY, "refused"),
        ("an unclosed declaration is refused",
         "const ACCENTS = [ { name: 'lime', hex: '#9EE02B' },", "refused"),
        ("EMPTY is refused, never reported as a match",
         "const ACCENTS = [\n];", "refused"),
        ("a changed entry SHAPE is refused, not silently zero",
         "const ACCENTS = [\n  { title: 'lime', rgb: [1,2,3] },\n];", "refused"),
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
        print(f"  {'ok  ' if ok else 'WRONG'} {name:<52} {actual} (wanted {expect})")

    # Count the subject and assert the count, or a gutted table reads as a clean run —
    # which is the exact failure this whole mode exists to make impossible.
    refuses = sum(1 for r in table if r[2] != "match")
    if len(table) < 12 or refuses < 9 or not want or len(want) != 3:
        print(f"check_accents --cases: table gutted — {len(table)} case(s), {refuses} "
              f"refusing, source parsed {len(want or [])} entries", file=sys.stderr)
        return 1

    # And the REAL source, because a case table full of synthetic strings proves nothing
    # about whether this checker can still find the palette it is pointed at.
    live = extract(SOURCE)
    if not live or len(live) < 3:
        print(f"check_accents --cases: parses the fixtures but not {SOURCE} itself "
              f"— discovery is broken", file=sys.stderr)
        return 1

    print(f"check_accents --cases: {len(table) - bad} of {len(table)} as expected "
          f"({refuses} of them proving it still refuses; {SOURCE} parses "
          f"{len(live)} accents)")
    return 1 if bad else 0


def main(argv) -> int:
    if "--cases" in argv:
        return cases()

    want = extract(SOURCE)
    if want is None:
        fail(f"cannot read the source of truth ({SOURCE}); nothing to check against")
        return 1

    if "--list" in argv:
        print(f"{SOURCE} — source of truth, {len(want)} accents")
        for i, (name, hex_) in enumerate(want):
            print(f"  [{i}] {name:<7} {hex_}")
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
        if got != want:
            report(rel, want, got)
            drift += 1

    if drift:
        print(
            f"\naccent palette: {drift} of {len(COPIES)} copies out of step with {SOURCE}",
            file=sys.stderr,
        )
        return 1

    note = f" ({skipped} not built, skipped)" if skipped else ""
    print(f"accent palette: {len(COPIES) - skipped} copies match {SOURCE} "
          f"({len(want)} accents){note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
