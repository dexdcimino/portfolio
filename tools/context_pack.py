#!/usr/bin/env python3
"""Build a context pack — the smallest artifact that makes an outside AI current on this repo.

    python tools/context_pack.py                  # -> context-pack.zip in the repo root
    python tools/context_pack.py --all            # + every game's source tree
    python tools/context_pack.py --game surveyor  # + one game's source tree
    python tools/context_pack.py --skip-probe     # git facts only, no checkers run
    python tools/context_pack.py --quiet          # for the post-commit hook

SELECTION IS GIT-TRACKED-FILES, NOT A WALK OF THE DISK. That is the safety property and it
is not negotiable: anything machine-local or secret in this repo is gitignored by policy
(`_resources/`, `*.log`, `.vscode/`, generated builds), so tracking is the authority on what
is allowed to leave the machine. A disk walk with an exclude list ships a secret eventually
— the origin of this script shipped a live publish token that way, inside the artifact whose
entire purpose is being uploaded to a third party.

The filters below run ON TOP of that boundary and are about NOISE, not secrecy. Every one of
them reports what it dropped, with counts and KB, because a pack with a silent hole in it is
the same failure as a checker that examines nothing: it looks exactly like a complete one.

WHY THIS REPO NEEDS MORE FILTERS THAN THE ORIGINAL. The script this is ported from packs a
whole project because that project is a couple of hundred KB of text. Here, `git ls-files`
minus binaries is **37 MB** — three separate 8.2 MB copies of `vendor/babylon.js`, a 5 MB
git bundle, and four game source trees. So:

  - Vendored and generated text is dropped by path (`vendor/`, `_reference/`, `dist/`,
    `games/<name>/v<n>/`) on top of the extension list.
  - **Game SOURCE is held back by default and reported per game with the flag that adds it.**
    Docs — every `games/**/*.md` — always ship, as does `games/_shared/`. A session asked to
    work on a game is told, in START-HERE.md itself, the one command that includes it.

That takes 37 MB to about 2.2 MB, which is the difference between an artifact a session can
read and one it cannot.

Everything in START-HERE.md's state section is MEASURED by running this repo's own checkers,
never typed. `docs/STATUS.md` is the cautionary example: it is hand-written, dated
2026-08-17, and claims 50 markup blocks and 332 derivatives against today's real 71 and 522.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
import zipfile
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAMP = ROOT / ".context-pack.stamp"

# Binary, or generated and useless to a reader. `.bundle` is a git bundle (5 MB of packed
# objects); `.svg` is text but it is icon geometry nobody reads and there are dozens.
EXCLUDE_EXT = {
    ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".ico", ".bmp", ".svg",
    ".mp3", ".ogg", ".wav", ".mp4", ".webm",
    ".ttf", ".otf", ".woff", ".woff2",
    ".zip", ".7z", ".tar", ".gz", ".rar", ".pdf", ".psd", ".ai",
    ".bundle", ".pyc",
}

# Vendored or generated TEXT. Each is code a reader gains nothing from and which drowns
# everything that matters.
EXCLUDE_PATH = [
    (re.compile(r"(^|/)vendor/"), "vendored engine code"),
    (re.compile(r"(^|/)_reference/"), "vendored reference code"),
    (re.compile(r"(^|/)dist/"), "build output"),
    (re.compile(r"(^|/)node_modules/"), "node_modules"),
    (re.compile(r"^games/[^/]+/v\d+/"), "shipped game build"),
]

MAX_FILE_BYTES = 512 * 1024

# Anything that looks like a credential in a file that IS tracked. Tracking is the real
# defence; this is the last resort for the case where a secret got committed.
SECRET_RE = [
    re.compile(r"^[0-9a-f]{40,}\s*$", re.I | re.M),
    re.compile(r"(?i)(api[_-]?key|client[_-]?secret|access[_-]?token|bearer)"
               r"\s*[=:]\s*[\"']?[A-Za-z0-9_\-]{24,}"),
    re.compile(r"(?i)\b(sk-[A-Za-z0-9]{24,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b"),
]


def git(*args: str) -> str:
    """Run git in the repo and return stdout, or '' if it failed."""
    try:
        out = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    if out.returncode != 0:
        return ""
    return out.stdout.decode("utf-8", "replace").rstrip("\n")


def run(cmd: list[str], timeout: int = 120) -> tuple[int, str]:
    """Run a checker and return (exit code, combined output)."""
    try:
        p = subprocess.run(cmd, cwd=ROOT, capture_output=True, timeout=timeout)
    except FileNotFoundError:
        return 127, "not installed"
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout}s"
    text = (p.stdout + p.stderr).decode("utf-8", "replace").strip()
    return p.returncode, text


def last_line(text: str, match: str = "") -> str:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if match:
        hit = [ln for ln in lines if match in ln]
        if hit:
            return hit[-1]
    return lines[-1] if lines else ""


# --------------------------------------------------------------------------- selection --
def select(include_games: set[str], all_games: bool):
    """Split tracked files into what ships and what was held back, and say which.

    Returns (kept, dropped) where kept is [(relpath, size)] and dropped is a dict of
    reason -> [(relpath, size)]. NOTHING is discarded without landing in `dropped`.
    """
    raw = git("ls-files", "-z")
    if not raw:
        sys.exit("ERROR: git ls-files produced nothing. This script packs only TRACKED "
                 "files; without git it cannot guarantee no secret is included.")

    kept: list[tuple[str, int]] = []
    dropped: dict[str, list[tuple[str, int]]] = {}

    def drop(reason: str, path: str, size: int) -> None:
        dropped.setdefault(reason, []).append((path, size))

    for rel in raw.split("\0"):
        if not rel:
            continue
        full = ROOT / rel
        try:
            size = full.stat().st_size
        except OSError:
            continue  # tracked but not on disk (a deletion mid-stage)

        if full.suffix.lower() in EXCLUDE_EXT:
            drop("binary or generated", rel, size)
            continue

        hit = next((why for rx, why in EXCLUDE_PATH if rx.search(rel)), None)
        if hit:
            drop(hit, rel, size)
            continue

        # Game source. Docs always ship; so does games/_shared/, which the site's own dev
        # harnesses live in and every game imports.
        m = re.match(r"^games/([^/]+)/", rel)
        if (m and m.group(1) != "_shared" and not rel.endswith(".md")
                and not all_games and m.group(1) not in include_games):
            drop(f"game source: {m.group(1)}", rel, size)
            continue

        if size > MAX_FILE_BYTES:
            drop(f"over {MAX_FILE_BYTES // 1024} KB", rel, size)
            continue

        kept.append((rel, size))

    # This repo's own rule, applied to this repo's own tool: count the subject, assert the
    # count. An empty or near-empty selection means discovery broke, and a pack that packs
    # nothing must not look like a pack that packed everything.
    if len(kept) < 50:
        sys.exit(f"ERROR: only {len(kept)} files selected — discovery is broken, not the "
                 f"repo. Expected on the order of 100. Check the filters above.")

    return kept, dropped


# ------------------------------------------------------------------------------ probes --
def probe(skip: bool) -> dict:
    """Measure the repo by running it. Nothing in here is typed."""
    py = sys.executable or "python"
    out: dict[str, str] = {}

    if skip:
        for k in ("accents", "cursors", "markup", "images"):
            out[k] = "not probed (--skip-probe)"
    else:
        code, text = run([py, "tools/check_accents.py"])
        out["accents"] = last_line(text) if code == 0 else f"FAILING — {last_line(text)}"

        code, text = run([py, "tools/check_cursors.py"])
        out["cursors"] = last_line(text) if code == 0 else f"FAILING — {last_line(text)}"

        code, text = run([py, "tools/bake_markup.py", "--check"])
        out["markup"] = (last_line(text, "bake_markup") if code == 0
                         else f"FAILING — {last_line(text)}")

        code, text = run([py, "tools/bake_images.py", "--check"], timeout=300)
        out["images"] = (last_line(text, "bake_images") if code == 0
                         else f"FAILING — {last_line(text)}")

    # Deliberately NOT run here, and said so rather than omitted: the markdown XSS check
    # launches a real browser, and this script runs from a post-commit hook on every single
    # commit. A silent omission would read as "nothing to report".
    out["markdown"] = ("not run by the pack — it launches Chrome and this builds on every "
                       "commit. Run `node tools/check_markdown.mjs` yourself.")

    # Cheap counts straight off the tree.
    index = (ROOT / "index.html").read_text(encoding="utf-8", errors="replace")
    out["vault"] = f"{index.count('class=\"iv-row\"')} plan(s) in the Idea Vault"
    games = sorted(p.name for p in (ROOT / "games").iterdir()
                   if p.is_dir() and not p.name.startswith("_"))
    out["games"] = f"{len(games)} game(s): {', '.join(games)}"
    return out


def read_plan() -> tuple[str, list[dict], dict | None]:
    """Parse docs/plan/README.md. The tracker and PHASE line come from here, never typed."""
    path = ROOT / "docs" / "plan" / "README.md"
    current, rows, focus = "", [], None
    if not path.exists():
        return current, rows, focus

    row_re = re.compile(r"^\|\s*\[(?P<name>[^\]]+)\]\((?P<spec>[^)]+)\)\s*\|"
                        r"(?P<one>[^|]*)\|[^|]*\|(?P<status>[^|]*)\|")
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\*\*Current:\*\*\s*(.+?)\s*$", line)
        if m:
            current = m.group(1)
            continue
        m = row_re.match(line)
        if not m:
            continue
        status = m.group("status").strip().replace("**", "")
        row = {
            "name": m.group("name").strip(),
            "one": m.group("one").strip(),
            "spec": "docs/plan/" + m.group("spec").strip(),
            "status": status,
            "done": status.lower().startswith("done"),
        }
        if not row["done"] and focus is None:
            focus = row
        rows.append(row)
    return current, rows, focus


# ------------------------------------------------------------------------- START-HERE --
def start_here(kept, dropped, probes, current, rows, focus, held_back) -> str:
    head = git("log", "-1", "--format=%h  %s")
    head_date = git("log", "-1", "--format=%ci")
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    commits = git("rev-list", "--count", "HEAD")
    recent = git("log", "-20", "--format=  %h  %ad  %s", "--date=short")
    porcelain = [ln for ln in git("status", "--porcelain").splitlines() if ln.strip()]
    packed_at = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z")

    if porcelain:
        tree_line = (f"**DIRTY** — cut mid-work; the tree differs from HEAD in "
                     f"{len(porcelain)} file(s):")
        dirty = ("```\n" + "\n".join(porcelain) + "\n```\n"
                 "Modified tracked files are packed AS THEY ARE ON DISK, not as committed. "
                 "Untracked (`??`) files are not in the pack at all. Treat the modified set "
                 "as the in-flight work.")
        current_suffix = f" (pack cut mid-work: {len(porcelain)} modified file(s))"
    else:
        tree_line = "**clean** — the tree matches HEAD; this is a settled state."
        dirty = ""
        current_suffix = ""

    # Tracker, generated from the table above. Never hand-written (doctrine rule 5).
    if rows:
        total = len(rows)
        cur = focus or rows[-1]
        idx = next(i for i, r in enumerate(rows) if r["name"] == cur["name"]) + 1
        short = re.sub(r"^\d+\s*\S\s*", "", cur["name"]).strip()
        header = f"PHASE {idx}/{total} — {short}"
        lines = []
        for i, r in enumerate(rows, 1):
            label = (f"{i}/{total} " + re.sub(r"^\d+\s*\S\s*", "", r["name"]).strip()
                     + " — " + r["one"])
            lines.append(f"- ~~{label}~~" if r["done"] else f"- {label}")
        tracker = (f"<details><summary>{header}</summary>\n\n"
                   + "\n".join(lines) + "\n\n</details>")
        phase_short = header.replace("PHASE ", "") if focus else "none"
        wip = f"{short}: {cur['status']}" if focus else "every phase done"
    else:
        header = "PHASE none"
        tracker = ("<details><summary>PHASE none</summary>\n\n"
                   "(no phased plan — see `docs/plan/README.md`, which says so on purpose)"
                   "\n\n</details>")
        phase_short = "none"
        wip = "nothing phased; the backlog is the queue"

    if not current:
        current = "set the Current line in docs/plan/README.md"

    if focus:
        blocked = re.search(r"Dex|needs|blocked|waiting", focus["status"], re.I)
        focus_block = (
            f"**Phase {focus['name']}** — {focus['one']}.\n"
            f"Spec: `{focus['spec']}`. Read it before touching anything in it.\n"
            f"Status, from the plan table: **{focus['status']}**.\n")
        if blocked:
            focus_block += (
                "\n**Blocked on the human.** Your first `DEV'S STEPS` is where that "
                "procedure left off — at most three steps, from the spec's own section. "
                "Do not paste the whole procedure and do not ask Dex where they are; if "
                "you cannot tell, step 1 is the one question that tells you.\n")
        else:
            focus_block += (
                "\nNot blocked. Your first `DEV'S STEPS` is `none` or the one thing Dex "
                "must look at.\n")
    else:
        focus_block = (
            "**There is no active phase, and that is a real answer rather than a gap.**\n"
            "`docs/plan/README.md` carries an empty table on purpose — an invented phase is "
            "a hand-written status, which is the kind that lies.\n\n"
            "The active focus is **the top of `docs/plan/BACKLOG.md`**, in the order written "
            "there — unless this pack was cut dirty (see the build stamp), in which case the "
            "modified files are the focus. Every backlog item names the command that "
            "verified it; re-check before starting, several are one commit from untrue.\n")

    held = "\n".join(
        f"| `{name}` | {count} files | {kb} KB | `python tools/context_pack.py --game {name}` |"
        for name, count, kb in held_back) or "| — | — | — | none held back |"

    # Game source has its own table above with the flag that includes it; listing it twice
    # reads as two different holes.
    drop_rows = "\n".join(
        f"| {reason} | {len(items)} | {round(sum(s for _, s in items) / 1024):,} |"
        for reason, items in sorted(dropped.items(),
                                    key=lambda kv: -sum(s for _, s in kv[1]))
        if not reason.startswith("game source: "))

    total_kb = round(sum(s for _, s in kept) / 1024, 1)

    return f"""# START HERE

**Read this file to the end, then act. Do not ask orientation questions.** Everything a
session needs to work correctly on **dexcimino.com** — the portfolio site — in the required
format, from the exact current state, is in this zip. If you find yourself about to ask
"which one?" or "what would you like me to do?", the answer is below. Find it.

## Build stamp

| | |
|---|---|
| packed | {packed_at} |
| branch | `{branch}` |
| HEAD | `{head}` |
| committed | {head_date} |
| commits | {commits} |
| working tree | {tree_line} |

{dirty}

## Your role — detected by capability, never by asking

This repo has **no build and no test runner**. `npm test` is a stub that exits 1 and has
never run anything. The gate is the checkers, and they are seconds each:

```
python tools/check_accents.py        # "accent palette: 5 copies match script.js (7 accents)"
python tools/check_cursors.py        # "cursor set: 4 copies match script.js (3 cursors)"
python tools/bake_markup.py --check  # "N image block(s) current, M derivative(s) referenced"
python tools/bake_images.py --check  # "N master(s), M derivative(s), all present and current"
python tools/check_sweep.py --cases  # "8 of 8 as expected" — the only checker that self-tests
node   tools/check_markdown.mjs      # XSS payloads through a real parser; needs Chrome
```

- **They run → you are an EXECUTOR.** Start on the active focus below. Run the checks that
  match what you touched, and run them again before you report. Commit per scope, explicit
  paths, never `git add -A`.
- **They cannot run — no Python, no node, no shell, sandboxed → you are a MANAGER /
  REVIEWER.** You write markdown and paste-ready prompts, review diffs, and keep the docs
  honest. You never claim a verification you did not perform; "I could not run X" is the
  sentence to use.
- **Only some run** (Python but no Chrome, say) → executor for everything except the
  markdown XSS check and the browser harnesses. Say so.

**Your first response from this zip is EXACTLY this, nothing more.** No role line, no
"ready", no narration of which checks ran, no corrections, no tracker, no code fence — plain
markdown, it is read, not copied. The first two lines are pre-filled; write only the steps:

CURRENT: {current}{current_suffix}
PHASE: {phase_short}
DEV'S STEPS
1. <an action and where to do it>

- In flight right now: {wip}.
- CURRENT is a fixed project line — the same text in every pack, every phase, every reply.
  Phase status lives in PHASE, the tracker and the build stamp, never here.
- **Each step is an action and where to do it** — one line, about ten words. The `→` path
  carries the location. One to three steps. If there is no active phase, the step is the
  question that picks one. A step never asks Dex to show where they are and never narrates
  what you will do next.
- A correction you want to make becomes a step, or waits until asked. Never prose.
- The tracker and the full report come only when Dex says `expand` or sends a report.

## The formatting contract

`DOCTRINE.md` is the portable original and `CLAUDE.md` is this repo underneath it. The
shape, so you do not have to go and find it:

- **Terseness ceiling.** The default response is the steps unit alone. Prose above it only
  when a decision needs Dex or something breaks without context — three sentences max. Show
  the diff or the error, not a description of it. Never end with a question when a decision
  would do.
- **Work, progress and handoff reports, and `expand`, end with the full unit in this exact
  order: phase header, progress tracker, `DEV'S STEPS`.** Tiny answers do not carry it.
  Never a bare header without the tracker, never inside a code fence. The current tracker,
  generated from `docs/plan/README.md` at pack time — reproduce it verbatim:

{tracker}

  DEV'S STEPS
  1. ...

- **`DEV'S STEPS`** is numbered and holds only what a human must physically do — sign in,
  type a credential, click, look at a screen. "none" is a valid block. Scriptable things get
  scripted instead. One workstream per steps list.
- **Session-end report, in this order:** What shipped (commits, one line each) → Verified vs.
  inferred (separated, naming the command; "it compiles" is not "it works") → Debatable calls
  → Docs touched (always present, "none" counts) → Decision log → Loose ends → **the unit**,
  last.
- **A tool that reports success while doing nothing is the failure shape to fear.** This repo
  has had four. Assume a fifth.

## Active focus

{focus_block}

## Read in this order

1. `DOCTRINE.md` — how we work. Portable, short, numbered, citable by number.
2. `CLAUDE.md` — this repo underneath it: the hard rules with what breaking each has already
   cost, the feedback loops, the report format.
3. `ARCHITECTURE.md` — the site shell, module by module, and the traps already paid for.
4. `docs/plan/README.md` and `docs/plan/BACKLOG.md` — what is next and why.

On demand: `games/<name>/ARCHITECTURE.md` per game; `docs/STATUS.md` for open decisions
(**its measured numbers are stale — this file's state section supersedes them**);
`CHANGELOG.md` for the version history.

## What this is

A static portfolio site — hand-written HTML/CSS/JS, **no build step**, deployed on Vercel —
that also hosts four playable browser games and an AI Lab. One `--accent` variable drives
the whole palette across the site and every game. The CSP is strict (`script-src 'self'`),
so there is no inline script or style anywhere.

The one thing that governs the most decisions: **generated content has exactly one writer,
and it is never a person.** Every `<picture>` in `index.html` is written by
`tools/bake_markup.py` from masters baked by `tools/bake_images.py`. Hand-editing generated
markup is the failure this repo keeps paying for.

## Current state, measured at pack time

Everything here was produced by running the repo, not by someone remembering to update it.
Where it disagrees with a hand-written section elsewhere, this is right.

| check | result |
|---|---|
| accent palette | {probes['accents']} |
| cursor set | {probes['cursors']} |
| image markup | {probes['markup']} |
| image derivatives | {probes['images']} |
| markdown XSS | {probes['markdown']} |
| games | {probes['games']} |
| idea vault | {probes['vault']} |

## What is in this pack, and what is not

**{len(kept)} tracked text files, {total_kb} KB uncompressed.** Selection is `git ls-files`
and nothing else — a disk walk with an exclude list ships a secret eventually.

Held back, and how to get it:

| game | | | include with |
|---|---|---|---|
{held}

Also dropped, all of it tracked but useless or enormous:

| reason | files | KB |
|---|---|---|
{drop_rows}

## Traps that have already cost time

- **A checker that discovers nothing exits 0 and looks identical to a clean run.** Four
  incidents. Count what you examined, print the number, assert it against an expectation.
- **Never edit between `<!-- img -->` and `<!-- /img -->`.** Generated; the next bake
  overwrites it and `bake_markup --check` fails on hand edits.
- **Never `git add -A`.** The commit-msg hook refuses cross-project commits, and the sweep
  hook refuses a commit carrying another session's staged work — both were written after it
  happened, twice.
- **Line endings in this repo are per file and some are MIXED.** `index.html`, `styles.css`
  and `games/arena1/js/main.js` all mix CRLF and LF. Patch them at byte level; normalising
  one rewrites thousands of lines and buries the real diff.
- `npm test` does nothing. There is no test runner.

## Recent history

Commit messages here carry the reasoning and `.git` is not in the pack, so here is the tail.

```
{recent}
```
"""


# ------------------------------------------------------------------------------- build --
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=str(ROOT / "context-pack.zip"))
    ap.add_argument("--game", action="append", default=[],
                    help="include this game's source tree (repeatable)")
    ap.add_argument("--all", action="store_true", help="include every game's source")
    ap.add_argument("--skip-probe", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    started = time.time()
    kept, dropped = select(set(args.game), args.all)

    held_back = []
    for reason, items in dropped.items():
        if reason.startswith("game source: "):
            held_back.append((reason.split(": ", 1)[1], len(items),
                              round(sum(s for _, s in items) / 1024)))
    held_back.sort(key=lambda t: -t[2])

    # Last-resort secret scan, over what is about to be zipped.
    suspects = []
    for rel, _ in kept:
        try:
            text = (ROOT / rel).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if any(rx.search(text) for rx in SECRET_RE):
            suspects.append(rel)

    if not args.quiet and not args.skip_probe:
        print("probing repo state (accents, cursors, markup, derivatives)...")
    probes = probe(args.skip_probe)
    current, rows, focus = read_plan()
    doc = start_here(kept, dropped, probes, current, rows, focus, held_back)

    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".zip.tmp")

    # zipfile writes forward-slash entry names by construction, which is the whole reason
    # this is Python and not a hand-rolled archive: a Windows ZIP writer that emits
    # backslashes turns into one flat directory of mangled names under a Linux unzip, and a
    # Linux unzip is every web AI sandbox. Written to a temp name and moved, so an
    # interrupted post-commit hook cannot leave a half-written pack looking complete.
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr("START-HERE.md", doc)
        for rel, _ in kept:
            z.write(ROOT / rel, rel)
    tmp.replace(out)

    # The freshness stamp. `tools/check_pack.py` reads it and refuses a commit when it names
    # a HEAD that is not the current one. Absent is allowed; present-and-wrong is not.
    STAMP.write_text(f"{git('rev-parse', 'HEAD')}\n{datetime.now().isoformat(timespec='seconds')}\n",
                     encoding="utf-8")

    zip_kb = round(out.stat().st_size / 1024, 1)
    total_kb = round(sum(s for _, s in kept) / 1024, 1)

    if not args.quiet:
        per = Counter()
        for rel, size in kept:
            per[rel.split("/")[0] if "/" in rel else "<root>"] += size
        print("\ncontext-pack contents")
        for name, size in per.most_common():
            n = sum(1 for r, _ in kept if (r.split("/")[0] if "/" in r else "<root>") == name)
            print(f"  {name:<22}{n:>4} files {round(size / 1024, 1):>9} KB")
        print(f"  {'START-HERE.md (generated)':<22}{1:>4} files")
        print()
        for reason, items in sorted(dropped.items(), key=lambda kv: -sum(s for _, s in kv[1])):
            kb = round(sum(s for _, s in items) / 1024)
            print(f"  held back: {reason:<26}{len(items):>4} files {kb:>7} KB")

    # Never silent about a hole. A file dropped for size is one the reader cannot know about.
    for reason, items in dropped.items():
        if reason.startswith("over "):
            print(f"\nWARNING: {len(items)} file(s) dropped for size — the pack is incomplete:",
                  file=sys.stderr)
            for rel, size in items:
                print(f"    {rel}  {round(size / 1024)} KB", file=sys.stderr)

    if suspects:
        print("\nWARNING: possible secret in a TRACKED file — inspect before sending "
              "this anywhere:", file=sys.stderr)
        for rel in suspects:
            print(f"    {rel}", file=sys.stderr)

    print(f"\n{out.name}  {len(kept) + 1} files  {zip_kb} KB  "
          f"({total_kb} KB of text, {time.time() - started:.1f}s)")
    print(f"  -> wrote {out}")

    if zip_kb > 2048:
        print("WARNING: over 2 MB — something generated is probably tracked that should "
              "not be.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
