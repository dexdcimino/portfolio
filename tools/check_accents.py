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


def extract(rel: str):
    """Return [(name, HEX), ...] in declaration order, or None if unreadable.

    Works on source and on build output alike: inside the bundles the array
    lives in a JS string with the newlines escaped, but the entries themselves
    survive verbatim, so the same pattern matches without un-escaping anything.
    """
    path = ROOT / rel
    if not path.exists():
        fail(f"{rel}: missing — a palette copy was moved or deleted")
        return None

    text = io.open(path, encoding="utf-8").read()
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


def main(argv) -> int:
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
            tag = "  (generated)" if rel in BUILT else ""
            print(f"  {rel}{tag}")
        return 0

    drift = 0
    for rel in COPIES:
        got = extract(rel)
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

    print(f"accent palette: {len(COPIES)} copies match {SOURCE} ({len(want)} accents)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
