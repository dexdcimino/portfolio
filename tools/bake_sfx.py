#!/usr/bin/env python3
"""Bake assets/sfx/sfx.txt into assets/sfx/sfx.json.

    python tools/bake_sfx.py            # rebuild the manifest
    python tools/bake_sfx.py --check    # fail if it is out of date or hand-edited
    python tools/bake_sfx.py --cases    # prove the parser can still refuse

WHY A MANIFEST AND NOT MARKUP. The library is a wishlist that grows a line at a
time, and 70+ cards of hand-written HTML is 70 chances to get one wrong. One
line in a text file adds a sound; the overlay fetches the JSON on its first
open and builds itself.

WHY --check IS A BYTE COMPARISON. The output is deterministic, so "is this file
what the source would produce" has an exact answer. A hand edit to sfx.json is
a hand edit that the next bake silently throws away, which is the same shape as
the generated-markup rule in CLAUDE.md.

COUNT THE SUBJECT. Every run prints categories, items, tracks and how many of
those tracks have a file behind them, and the parser REFUSES an empty result --
a manifest that stopped matching would otherwise bake an empty library and
report success, which is the failure this repo has paid for four times.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "sfx" / "sfx.txt"
OUT = ROOT / "assets" / "sfx" / "sfx.json"

# A file is a path under assets/sfx/ or the one-character "not sourced yet".
NONE = "-"
# Anything the browser will play and the CSP allows from 'self'.
EXTS = (".mp3", ".ogg", ".wav", ".m4a", ".webm", ".flac")


def parse(text: str) -> tuple[list[dict], list[str]]:
    """(categories, problems). The WHOLE decision, so the bake, --check and
    --cases all ask the same function rather than three copies of it."""
    cats: list[dict] = []
    by_cat: dict[str, dict] = {}
    problems: list[str] = []
    seen: set[tuple[str, str, str]] = set()

    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue

        parts = line.split("|")
        if len(parts) != 4:
            problems.append(f"line {n}: {len(parts)} field(s), expected "
                            f"Category|Item|Variant|File -> {line[:60]}")
            continue

        cat, item, variant, file = (p.strip() for p in parts)
        for name, value in (("category", cat), ("item", item), ("variant", variant)):
            if not value:
                problems.append(f"line {n}: no {name} -> {line[:60]}")
                break
        else:
            if not file:
                problems.append(f"line {n}: no file field; use {NONE!r} for one "
                                f"not sourced yet -> {line[:60]}")
                continue
            if file != NONE:
                if file.startswith("/") or ".." in file:
                    problems.append(f"line {n}: a file is a path UNDER assets/sfx/ "
                                    f"-> {file}")
                    continue
                if not file.lower().endswith(EXTS):
                    problems.append(f"line {n}: {file!r} is not one of "
                                    f"{', '.join(EXTS)}")
                    continue
                if not (SRC.parent / file).exists():
                    problems.append(f"line {n}: assets/sfx/{file} is not there")
                    continue

            key = (cat.lower(), item.lower(), variant.lower())
            if key in seen:
                problems.append(f"line {n}: {cat} / {item} / {variant} is listed twice")
                continue
            seen.add(key)

            bucket = by_cat.get(cat)
            if bucket is None:
                bucket = {"name": cat, "items": [], "_by_item": {}}
                by_cat[cat] = bucket
                cats.append(bucket)
            card = bucket["_by_item"].get(item)
            if card is None:
                card = {"name": item, "tracks": []}
                bucket["_by_item"][item] = card
                bucket["items"].append(card)
            card["tracks"].append({"name": variant,
                                   **({"file": file} if file != NONE else {})})

    for bucket in cats:
        bucket.pop("_by_item", None)

    # An empty library is a BROKEN parse, never an empty one: this file has
    # never been empty and a run that produces nothing has lost its subject.
    if not cats and not problems:
        problems.append("no categories parsed at all — the manifest is empty or "
                        "every line was refused silently")
    return cats, problems


def counts(cats: list[dict]) -> tuple[int, int, int, int]:
    items = sum(len(c["items"]) for c in cats)
    tracks = sum(len(i["tracks"]) for c in cats for i in c["items"])
    sourced = sum(1 for c in cats for i in c["items"]
                  for t in i["tracks"] if t.get("file"))
    return len(cats), items, tracks, sourced


def render(cats: list[dict]) -> str:
    nc, ni, nt, ns = counts(cats)
    doc = {"count": nt, "items": ni, "sourced": ns, "categories": cats}
    return json.dumps(doc, indent=1, ensure_ascii=False) + "\n"


def main(argv: list[str]) -> int:
    if "--cases" in argv:
        return cases()

    if not SRC.exists():
        print(f"bake_sfx: {SRC} is not there")
        return 1
    cats, problems = parse(SRC.read_text(encoding="utf-8"))
    if problems:
        print(f"bake_sfx: {len(problems)} problem(s) in {SRC.name}")
        for p in problems[:20]:
            print("  " + p)
        return 1

    text = render(cats)
    nc, ni, nt, ns = counts(cats)
    summary = (f"{nc} categor{'y' if nc == 1 else 'ies'}, {ni} item(s), "
               f"{nt} track(s), {ns} with a file, {nt - ns} still to source")

    if "--check" in argv:
        if not OUT.exists():
            print(f"bake_sfx --check: {OUT.name} has never been built")
            return 1
        if OUT.read_text(encoding="utf-8") != text:
            print(f"bake_sfx --check: {OUT.name} is not what {SRC.name} would "
                  f"produce — run python tools/bake_sfx.py")
            return 1
        print(f"bake_sfx --check: {summary}, manifest current")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8", newline="\n")
    print(f"bake_sfx: {summary} -> {OUT.relative_to(ROOT)} "
          f"({len(text) / 1024:.1f} KB)")
    return 0


def cases() -> int:
    """Drive parse() through every state it must refuse, and one it must not.

    The control at the end is not decoration: a parser that had stopped
    matching anything would refuse all of these for the wrong reason and print
    exactly this. See CLAUDE.md, "Count the subject"."""
    ok = "Player|Jump|Short|-"
    table = [
        ("a line with a dash for the file", ok, True),
        ("three fields is not four", "Player|Jump|-", False),
        ("five fields is not four", "Player|Jump|Short|-|extra", False),
        ("no category", "|Jump|Short|-", False),
        ("no item", "Player||Short|-", False),
        ("no variant", "Player|Jump||-", False),
        ("no file field at all", "Player|Jump|Short|", False),
        ("an absolute path", "Player|Jump|Short|/etc/passwd.mp3", False),
        ("a path that climbs out", "Player|Jump|Short|../../secret.mp3", False),
        ("a file that is not audio", "Player|Jump|Short|jump.txt", False),
        ("a file that is not there", "Player|Jump|Short|nope.mp3", False),
        ("the same variant twice", ok + "\n" + ok, False),
        ("comments and blanks are skipped", "# a note\n\n" + ok, True),
        ("nothing but comments is EMPTY, which is broken", "# all of it", False),
        ("an empty file is broken too", "", False),
    ]
    bad = 0
    for name, text, want_ok in table:
        cats, problems = parse(text)
        got_ok = not problems
        mark = "ok  " if got_ok == want_ok else "FAIL"
        if got_ok != want_ok:
            bad += 1
        print(f"  {mark} {name:<44} {len(cats)} categor(ies), "
              f"{len(problems)} problem(s) (wanted {'none' if want_ok else 'some'})")

    refusals = sum(1 for _, _, want in table if not want)
    if refusals != 13:
        print(f"  FAIL the table holds {refusals} refusals, expected 13 — "
              f"a case was dropped")
        bad += 1

    # ...and the LIVE manifest still parses, or every refusal above is a
    # refusal of a parser that no longer reads anything.
    live, live_problems = parse(SRC.read_text(encoding="utf-8")) if SRC.exists() else ([], ["missing"])
    nc, ni, nt, ns = counts(live)
    if live_problems or nt < 20:
        print(f"  FAIL the live manifest parses to {nt} track(s) "
              f"({len(live_problems)} problem(s))")
        bad += 1

    print(f"bake_sfx --cases: {len(table) - bad} of {len(table)} as expected "
          f"({refusals} of them proving it still refuses); live manifest parses "
          f"to {nc} categories, {ni} items, {nt} tracks, {ns} with a file")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
