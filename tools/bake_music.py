#!/usr/bin/env python3
"""Turn the hand-written `tracklist.txt` into the manifest the music overlay fetches.

    python tools/bake_music.py           # write assets/music/tracks.json
    python tools/bake_music.py --check   # the gate: refuse if it is stale or malformed
    python tools/bake_music.py --cases   # prove the gate can still refuse

WHY A MANIFEST AND NOT MARKUP. 311 rows of <li> is ~40 KB of index.html that every
visitor downloads to look at the hero, and none of them can see it: the overlay is
behind the same code the Idea Vault uses. The list is fetched once, on the first open,
and the page ships nothing but the shell. Same argument as work.json.

WHY tracklist.txt IS THE MASTER. It is the file Dex actually edits — one line per
track, `Title|Artist|URL`, sorted however the paste happened to be sorted. Adding a
song is a line; removing one is a deletion. Nothing here is a taxonomy anyone has to
maintain, which is exactly what work-index.json is for the gallery.

WHY THE OUTPUT CARRIES NO TIMESTAMP. `--check` is then a byte comparison against a
rebuild, which cannot be fooled by a clock, and re-running the bake on an unchanged
tracklist produces an unchanged file and therefore no diff.

WHY --cases EXISTS. This repo has shipped four checkers that reported clean while
examining nothing, so `parse()` below is a pure function of the file's text, the gate
and the cases call the same one, and `--cases` drives it through every state it must
refuse — including the empty file, which is the shape all four of those bugs had.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "tracklist.txt"
OUT = ROOT / "assets" / "music" / "tracks.json"

REBUILD = "python tools/bake_music.py"

# Every form of YouTube link that names ONE video. A playlist or a channel URL is
# refused rather than guessed at: the overlay plays a video id and nothing else.
VIDEO_ID = re.compile(
    r"""^https?://
        (?: (?:www\.|m\.)?youtube(?:-nocookie)?\.com/(?:watch\?(?:[^#]*&)?v=|embed/|v/|shorts/)
          | youtu\.be/ )
        (?P<id>[A-Za-z0-9_-]{11})
        (?:[?&#].*)?$""",
    re.VERBOSE,
)

# A direct audio file on the site's own media host (2026-11-10). These have no
# video id: the URL itself is the track identity, which is exactly how the
# player's embed parser (lib/music-embeds.js) treats them. An audio file on
# any other host is refused, like every other non-YouTube link.
AUDIO_URL = re.compile(
    r"^https://media\.clayweld\.com/[\w./-]+\.(?:mp3|m4a|ogg|wav)$",
    re.IGNORECASE,
)

SEED_PLAYLISTS = ROOT / "assets" / "music" / "seed-playlists.json"


def parse(text: str) -> tuple[list[dict], list[str]]:
    """(tracks, problems). The whole decision, so the gate and --cases cannot diverge.

    Blank lines are skipped rather than reported — a trailing newline is not a mistake
    and neither is a gap someone left while pasting. Everything else that is not
    `Title|Artist|URL` with a real video id is a problem, named by line number.

    A FOURTH FIELD, `R`, marks a track as one of the repeat playlist's defaults.
    It lives here rather than in a second file because two lists of songs drift:
    a title edited in one and not the other goes silently unmatched, and the only
    symptom is a track that quietly stops being a default. One master, one edit.
    Anything else in that field is a problem rather than a shrug — a typo'd mark
    that did nothing would be invisible.
    """
    tracks: list[dict] = []
    problems: list[str] = []
    seen: dict[str, int] = {}

    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line:
            continue

        parts = line.split("|")
        if len(parts) not in (3, 4):
            problems.append(f"line {n}: {len(parts)} field(s), expected "
                            f"Title|Artist|URL or Title|Artist|URL|R -> {line[:60]}")
            continue

        mark = parts[3].strip().upper() if len(parts) == 4 else ""
        if mark not in ("", "R"):
            problems.append(f"line {n}: the fourth field is {mark!r}, expected R "
                            f"or nothing -> {line[:60]}")
            continue

        title, artist, url = (p.strip() for p in parts[:3])
        if not title:
            problems.append(f"line {n}: no title -> {line[:60]}")
            continue
        if not artist:
            problems.append(f"line {n}: no artist -> {line[:60]}")
            continue

        found = VIDEO_ID.match(url)
        audio = None if found else AUDIO_URL.match(url)
        if not found and not audio:
            problems.append(f"line {n}: not a single-video YouTube link or a "
                            f"direct audio file on media.clayweld.com -> {url[:60]}")
            continue

        vid = found.group("id") if found else url
        if vid in seen:
            problems.append(f"line {n}: video {vid} is already on line {seen[vid]} "
                            f"({title})")
            continue
        seen[vid] = n

        # `u` is kept as well as `v` because the LINK column shows a link someone
        # copies and pastes, and rebuilding it from the id would quietly rewrite a
        # youtu.be short link into the long form nobody typed.
        row = {"t": title, "a": artist, "u": url, "v": vid}
        if audio:
            row["p"] = "Audio"
            row["audio"] = url
        # Written only when true, so an unmarked track costs nothing in the
        # manifest and the flag reads as a mark rather than as a field.
        if mark == "R":
            row["r"] = 1
        tracks.append(row)

    # An empty subject is a BROKEN parse, never a clean one. A tracklist that stopped
    # matching would otherwise write an empty manifest and report success over it,
    # which is the exact shape of the four failures CLAUDE.md records.
    if not tracks and not problems:
        problems.append("no tracks parsed at all — the file is empty, or every line "
                        "stopped matching Title|Artist|URL")

    return tracks, problems


def render(tracks: list[dict], playlists: list[dict] | None = None) -> str:
    """The manifest, byte-for-byte. Deterministic, so --check is an exact comparison.

    `repeat` is the count of defaults, carried so the page can tell "nothing is
    marked" from "the flags stopped being written" without walking the list.

    `playlists`, when the seed playlists file names any, are the repo curated
    playlists (assets/music/seed-playlists.json), carried in the same shape the
    playlist API returns, so a static host serving only this manifest shows
    them too. The live store merges the same file on read (lib/music-store.js).
    """
    doc = {"count": len(tracks),
           "repeat": sum(1 for t in tracks if t.get("r")),
           "tracks": tracks}
    if playlists:
        doc["playlists"] = playlists
        doc["playlistsVersion"] = 1
    return json.dumps(doc, ensure_ascii=False, indent=1) + "\n"


def build() -> tuple[str | None, list[str], int, int]:
    """(manifest text or None, problems, tracks seen, repeat defaults marked)."""
    if not SOURCE.exists():
        return None, [f"{SOURCE.name} is missing — nothing to bake"], 0, 0
    tracks, problems = parse(SOURCE.read_text(encoding="utf-8"))
    marked = sum(1 for t in tracks if t.get("r"))
    if problems:
        return None, problems, len(tracks), marked
    playlists: list[dict] = []
    if SEED_PLAYLISTS.exists():
        try:
            raw = json.loads(SEED_PLAYLISTS.read_text(encoding="utf-8"))
        except Exception as error:
            return None, [f"{SEED_PLAYLISTS.name} does not parse: {error}"], len(tracks), marked
        entries = raw.get("playlists") if isinstance(raw, dict) else None
        if not isinstance(entries, list):
            return None, [f"{SEED_PLAYLISTS.name} has no playlists list"], len(tracks), marked
        known = {t["v"] for t in tracks}
        for entry in entries:
            if (not isinstance(entry, dict) or not isinstance(entry.get("id"), str)
                    or not isinstance(entry.get("name"), str)
                    or not isinstance(entry.get("tracks"), list)
                    or not all(isinstance(v, str) for v in entry["tracks"])):
                return None, [f"{SEED_PLAYLISTS.name} has a malformed playlist entry"], len(tracks), marked
            missing = [v for v in entry["tracks"] if v not in known]
            if missing:
                return None, [f"{SEED_PLAYLISTS.name} playlist {entry['name']!r} names "
                              f"a track that is not in {SOURCE.name}: {missing[0]}"], len(tracks), marked
            playlists.append({"id": entry["id"], "name": entry["name"],
                              "tracks": list(entry["tracks"])})
    return render(tracks, playlists), [], len(tracks), marked


def cases() -> int:
    """Drive parse() through every state. Six of these MUST come back with problems."""
    OK = "Song|Band|https://www.youtube.com/watch?v=Ngng8UyyaGQ"
    TWO = OK + "\nOther|Act|https://youtu.be/IB1MlSvHq58"

    table = [
        # (name, text, expected track count, must it report a problem)
        ("one good line",                 OK,                                 1, False),
        ("two lines, mixed url forms",    TWO,                                2, False),
        ("blank lines are not errors",    f"\n{OK}\n\n",                      1, False),
        ("a repeat mark",                 OK + "|R",                          1, False),
        ("a lower-case repeat mark",      OK + "|r",                          1, False),
        ("a fourth field that is not R",  OK + "|X",                          0, True),
        ("five fields",                   "A|B|C|D|E",                        0, True),
        ("EMPTY FILE",                    "",                                 0, True),
        ("whitespace only",               "\n  \n\t\n",                       0, True),
        ("missing artist",                "Song||https://youtu.be/IB1MlSvHq58", 0, True),
        ("not a video link",              "Song|Band|https://example.com/x",  0, True),
        ("a playlist, not a video",
         "Song|Band|https://www.youtube.com/playlist?list=PL123",             0, True),
        ("the same video twice",          f"{OK}\n{OK}",                      1, True),
        ("a direct audio file",
         "Song|Band|https://media.clayweld.com/assets/music/song.mp3",        1, False),
        ("an mp3 on another host",
         "Song|Band|https://example.com/song.mp3",                             0, True),
    ]

    bad = 0
    for name, text, want_n, want_problem in table:
        tracks, problems = parse(text)
        agreed = (len(tracks) == want_n) and (bool(problems) is want_problem)
        bad += 0 if agreed else 1
        print(f"  {'ok  ' if agreed else 'WRONG'} {name:<32} "
              f"{len(tracks)} track(s), {len(problems)} problem(s) "
              f"(wanted {want_n}, {'some' if want_problem else 'none'})")
        if not agreed and problems:
            print(f"         -> {problems[0]}")

    # The table above only counts tracks and problems, so a mark that parsed without
    # complaining but set nothing would pass every row of it. Read the flag itself.
    marked, _ = parse(OK + "|R")
    plain, _ = parse(OK)
    if marked[0].get("r") != 1:
        print("bake_music --cases: |R parsed cleanly but set no repeat flag",
              file=sys.stderr)
        return 1
    if "r" in plain[0]:
        print("bake_music --cases: an unmarked track came back with a repeat flag",
              file=sys.stderr)
        return 1

    # Same for the audio shape: a direct file that parsed but lost its marker
    # would reach the player as a YouTube id and fail there instead of here.
    audio_rows, _ = parse("Song|Band|https://media.clayweld.com/assets/music/song.mp3")
    if (len(audio_rows) != 1 or audio_rows[0].get("p") != "Audio"
            or audio_rows[0].get("audio") != audio_rows[0].get("v")):
        print("bake_music --cases: a direct audio file parsed without its Audio marker",
              file=sys.stderr)
        return 1

    # Assert the table's own size, or a table that stopped being driven looks exactly
    # like a table that passed.
    must_fail = sum(1 for row in table if row[3])
    if len(table) < 13 or must_fail < 8:
        print(f"bake_music --cases: only {len(table)} case(s), {must_fail} of them "
              f"refusing — the table has been gutted", file=sys.stderr)
        return 1

    # ...and one control on the REAL file, or the whole table could be passing against
    # a parser that no longer sees the subject it exists for. The repeat defaults are
    # counted here too: they are set by a mark that is easy to lose in an edit and
    # whose absence looks exactly like "nobody has ticked anything yet".
    live, live_problems = parse(SOURCE.read_text(encoding="utf-8")) if SOURCE.exists() else ([], ["missing"])
    live_repeat = sum(1 for t in live if t.get("r"))
    if len(live) < 100 or live_problems:
        print(f"bake_music --cases: the live tracklist parsed to {len(live)} track(s) "
              f"with {len(live_problems)} problem(s) — the real subject is not being "
              f"found", file=sys.stderr)
        return 1
    if live_repeat < 1:
        print("bake_music --cases: not one track in the live tracklist carries |R — "
              "the repeat defaults have been lost", file=sys.stderr)
        return 1

    print(f"bake_music --cases: {len(table) - bad} of {len(table)} as expected "
          f"({must_fail} of them proving it still refuses); "
          f"live tracklist parses to {len(live)} tracks, {live_repeat} marked |R")
    return 1 if bad else 0


def main(argv: list[str]) -> int:
    if argv and argv[0] == "--cases":
        return cases()

    want, problems, seen, marked = build()
    if problems:
        print(f"bake_music: {SOURCE.name} has {len(problems)} problem(s) "
              f"({seen} track(s) parsed before them):", file=sys.stderr)
        for p in problems[:20]:
            print(f"  {p}", file=sys.stderr)
        if len(problems) > 20:
            print(f"  ... and {len(problems) - 20} more", file=sys.stderr)
        return 1

    have = OUT.read_text(encoding="utf-8") if OUT.exists() else None

    if argv and argv[0] == "--check":
        if have is None:
            print(f"bake_music: {OUT.relative_to(ROOT)} does not exist. "
                  f"Build it: {REBUILD}", file=sys.stderr)
            return 1
        if have != want:
            print(f"bake_music: {OUT.relative_to(ROOT)} does not match "
                  f"{SOURCE.name} ({seen} track(s) in the source). Rebuild: {REBUILD}",
                  file=sys.stderr)
            return 1
        print(f"bake_music --check: {seen} track(s), {marked} marked |R, "
              f"manifest current")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    if have == want:
        print(f"bake_music: {seen} track(s), {marked} marked |R, "
              f"{OUT.relative_to(ROOT)} already current")
        return 0
    # Newline as written: the manifest is generated, so it is uniform LF and stays
    # that way. Nothing here ever touches a file with mixed endings.
    OUT.write_text(want, encoding="utf-8", newline="\n")
    print(f"bake_music: {seen} track(s), {marked} marked |R -> {OUT.relative_to(ROOT)} "
          f"({len(want.encode('utf-8')) / 1024:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
