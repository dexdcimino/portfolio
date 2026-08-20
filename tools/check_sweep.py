"""Reject a commit that carries work its message does not describe.

    python tools/check_sweep.py <path-to-commit-message>
    python tools/check_sweep.py --commit <sha>     # try it against history

Run from .git/hooks/commit-msg, after check_scope.py.

WHY THIS EXISTS. check_scope.py stops a commit reaching across unrelated
PROJECTS. It cannot see the other half of the same accident, which is one
session's commit carrying another session's hunks inside a file they both
edited. Two of those shipped on 2026-08-19, hours apart, in both directions:

  b6ba02f  "AI Lab: the cards list under the heading" also published a re-baked
           kong-fu <picture> block, whose derivatives were not staged. main then
           referenced assets/derived/ai/wallpapers/kong-fu-1920.avif, a file
           that was not in the repo, until the other session caught up.
  feef1f3  "MindSplit: Splitmob renamed everywhere" also carried a .vault-pin
           restyle. Nothing broke, but nobody reading that subject would ever
           guess the vault's code fields changed in it.

Both came from staging a shared file WHOLE — the pre-commit hook does exactly
that with index.html, and `git add styles.css` does it to anyone. The wrong
attribution is the small half. The real risk is a revert: rolling back a rename
takes out a CSS fix nobody knew was in there.

TWO RULES, because the two incidents are different in kind.

RULE 1 - DANGLING DERIVATIVES, exact, and it has no escape hatch because there
is no version of it that is fine. If the staged markup names a file under
assets/derived/ that will not exist once the commit lands, refuse. That is
b6ba02f precisely: it published a kong-fu <picture> whose 1920 rung was not
staged, so main 404'd for everyone who pulled it. Checked against the index,
which IS the post-commit tree, in one `git ls-files` rather than a cat-file per
reference - index.html alone names about 380 derivatives. Across the last sixty
commits this fires once, on b6ba02f, and never otherwise.

RULE 2 - UNEXPLAINED REGIONS, a judgement call, and therefore escapable:

  1. ROOT FILES ONLY. index.html, styles.css and script.js are what every
     session touches at once and what the pre-commit hook stages WHOLE on its
     own initiative. Same unit check_scope.py calls <root>. Checking every file
     instead flagged 8 of 40 commits; checking root files flags 5 of 60.
     ...plus every ARCHITECTURE.md at any depth, which are shared for a
     different reason: CLAUDE.md requires the session that changes a module to
     update its doc, so every session edits them and they collide constantly.
     A third sweep on 2026-08-19 carried a games/surveyor/ARCHITECTURE.md
     invariant out under an unrelated Ember fix, and root-only would have
     missed it.
  2. REGIONS. Hunks more than SEPARATION untouched lines apart are different
     parts of the file and are judged separately. This number is load-bearing
     in both directions: at 150 the swept kong-fu block merged into the AI Lab
     edit beside it and the check went silent.
  3. SUBSTANTIAL, and not generated. Under MIN_CHANGED changed lines is never
     flagged, and neither is bake_markup.py's output - a re-baked <picture> is
     a generator running, not someone's work riding along.
  4. UNEXPLAINED. Flagged only when none of the region's identifiers appear in
     the commit message or in a staged path. Identifiers, not words: this
     repo's comment blocks are long enough that a naive tokeniser matched
     `deliberately` and `somewhere` across unrelated diffs and excused every
     sweep it was aimed at. See code_shaped().

A root file with one region is never checked. The rule only speaks when one
file changed in two distant places and the message accounts for one of them.
Residual noise is about one commit in twelve, always a large feature commit
whose prose subject did not happen to name a symbol; the fix there is usually
to mention it in the message, which is the cheaper outcome anyway.

THE ESCAPE HATCH is a `Carries:` line naming each file, in the same shape and
for the same reason as check_scope.py's `Spans:` — deliberate reach has to be
stated, so it is a decision rather than a default:

    Carries: styles.css - the vault pin restyle, agreed with the other session

Naming the file is the whole point. A bare marker becomes something people
paste without reading.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Untouched lines between two hunks before they count as different regions.
SEPARATION = 60
# Changed lines a region needs before it is worth talking about. TUNED, not
# chosen: at 6 changed lines and 60 apart this fired on 11 of the last 40
# commits, and a hook that stops a quarter of honest commits is a hook people
# learn to paste the escape hatch into without reading. See the tuning note
# at the bottom of this docstring block.
MIN_CHANGED = 14
# Identifiers shorter than this are noise.
MIN_TOKEN = 4

# Binary and generated things this cannot reason about.
SKIP_GLOB = ("assets/index-", "vendor/", "package-lock.json", ".min.",
             "/dist/", ".map")
SKIP_SUFFIX = {".png", ".jpg", ".jpeg", ".avif", ".webp", ".woff2", ".ico",
               ".mp3", ".wav", ".pdf", ".zip", ".3dl", ".glb", ".ttf", ".otf"}

# Words that appear in every hunk in the repo and therefore distinguish
# nothing. Keeping this list short is deliberate: a token wrongly called common
# makes the check quieter, never louder.
STOP = {
    # languages
    "const", "let", "var", "function", "return", "class", "this", "true",
    "false", "null", "undefined", "import", "export", "from", "async", "await",
    "if", "else", "for", "while", "new", "typeof", "instanceof", "static",
    "get", "set", "then", "catch", "throw", "try", "case", "break", "default",
    "type", "types", "self", "args", "kwargs", "none", "def", "elif", "not",
    "and", "or", "in", "is", "with", "as", "pass", "raise", "lambda",
    # css
    "color", "colour", "background", "border", "width", "height", "margin",
    "padding", "display", "position", "absolute", "relative", "fixed", "flex",
    "grid", "block", "inline", "none", "auto", "hidden", "visible", "solid",
    "transparent", "opacity", "transform", "transition", "size", "left",
    "right", "top", "bottom", "center", "centre", "text", "font", "line",
    "space", "content", "wrap", "align", "justify", "items", "gap", "min",
    "max", "calc", "var", "rgba", "srgb", "mix", "clamp", "radius", "shadow",
    "style", "styles", "hover", "focus", "active", "before", "after", "root",
    # html
    "div", "span", "button", "href", "src", "alt", "aria", "label", "data",
    "html", "head", "body", "link", "meta", "title", "form", "input", "img",
    "picture", "source", "srcset", "sizes", "loading", "decoding", "true",
    # prose that shows up in every comment block here
    "that", "this", "with", "which", "what", "when", "then", "than", "there",
    "here", "they", "them", "their", "have", "has", "had", "does", "not",
    "one", "two", "into", "onto", "over", "under", "from", "same", "other",
    "because", "rather", "would", "could", "should", "every", "each", "only",
    # hyphenated properties, which are code-shaped but say nothing about topic
    "border-radius", "border-color", "border-style", "box-shadow", "font-size",
    "font-family", "font-weight", "line-height", "text-align", "text-transform",
    "background-color", "aspect-ratio", "object-fit", "max-width", "min-width",
    "max-height", "min-height", "grid-template-columns", "flex-direction",
    "align-items", "justify-content", "pointer-events", "letter-spacing",
    "color-mix", "data-icon", "aria-hidden", "aria-label", "rel-noopener",
    "still", "just", "also", "more", "most", "less", "least", "make", "makes",
    "made", "does", "done", "line", "lines", "file", "files", "code", "note",
    "see", "the", "and", "for", "but", "was", "were", "are", "its", "it",
}

def git(*args: str) -> str:
    out = subprocess.run(["git", *args], cwd=ROOT, capture_output=True,
                         text=True, errors="replace")
    return out.stdout if out.returncode == 0 else ""


TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_-]{%d,}" % (MIN_TOKEN - 1))
CAMEL_RE = re.compile(r"[a-z][A-Z]")


def code_shaped(word: str) -> bool:
    """Is this an identifier rather than an English word?

    THE TOKENISER IS THE WHOLE CHECK, and the first cut of it failed on this
    repo specifically. Comment blocks here are long and argumentative, so a
    naive tokeniser reads `deliberately`, `somewhere` and `between` out of a
    diff and finds them again in any other diff, which excused every sweep it
    was pointed at. Prose is not evidence. An identifier is: it carries a
    hyphen or an underscore (`vault-pin`, `kong-fu`, `wp-item`), or it is
    camelCase (`buildBudgetPerFrame`), and English almost never is either.
    """
    return "-" in word or "_" in word or bool(CAMEL_RE.search(word))


def tokens(text: str) -> set[str]:
    """Distinctive identifiers, lowercased. A hyphenated name also yields its
    parts, so `vault-pin` matches a message that only says "vault"."""
    found: set[str] = set()
    for m in TOKEN_RE.finditer(text):
        raw = m.group(0)
        if not code_shaped(raw):
            continue
        w = raw.lower()
        if w not in STOP:
            found.add(w)
        for part in re.split(r"[-_]", w):
            if len(part) >= MIN_TOKEN and part not in STOP:
                found.add(part)
    return found


def staged_files() -> list[str]:
    out = git("diff", "--cached", "--name-only", "--diff-filter=ACMR")
    return [p for p in out.splitlines()
            if p.strip() and keepable(p) and shared(p)]


def keepable(path: str) -> bool:
    return (Path(path).suffix.lower() not in SKIP_SUFFIX
            and not any(g in path for g in SKIP_GLOB))


def shared(path: str) -> bool:
    """Files this checks the INSIDE of: the ones at the repo root.

    THE SCOPE IS THE TUNING, and it is the same unit check_scope.py already
    calls <root>. index.html, styles.css and script.js are what every session
    in this repo touches at once, and they are what the pre-commit hook stages
    WHOLE on its own initiative. Both incidents were root files.

    Restricting to them is what makes this quiet enough to be worth obeying:
    across the last forty commits, checking every file flagged eight, of which
    six were large honest feature commits whose prose subject simply did not
    happen to name one symbol. Checking root files only flags the two real
    sweeps and two others. A game's own files are edited by one session at a
    time and do not need this; if that stops being true, add them here and
    accept the noise deliberately rather than by default.
    """
    return "/" not in path or path.endswith("ARCHITECTURE.md")


GENERATED_MARK = ("assets/derived/", "<!-- img ", "<!-- /img -->", "srcset=",
                  "imagesrcset=")


def generated(text: str) -> bool:
    """Is this region machine-written markup rather than someone's edit?

    tools/bake_markup.py owns everything between `<!-- img -->` and
    `<!-- /img -->`, and CLAUDE.md forbids touching it by hand. A diff in there
    is a generator's output riding along with whatever caused a re-bake, so it
    is not evidence that a commit carries someone else's WORK — it flagged
    c1fd663 ("cut the wallpaper payload in half"), whose subject describes the
    change perfectly while the region's only tokens are derivative filenames.
    The genuine danger in generated markup is different in kind and is checked
    exactly, by dangling_derivatives() below, rather than guessed at.
    """
    lines = [l for l in text.splitlines() if l.strip()]
    if not lines:
        return False
    hits = sum(1 for l in lines if any(m in l for m in GENERATED_MARK))
    return hits >= max(2, len(lines) // 2)


def dangling_derivatives(files: list[str], blob_of, present: set) -> list[tuple[str, str]]:
    """Derived files the commit POINTS AT but does not contain.

    This is the exact half of b6ba02f, and it needs no guessing: that commit
    published a re-baked kong-fu <picture> whose derivatives were not staged,
    so main referenced kong-fu-1920.avif when no such blob existed anywhere in
    the repo. Any commit whose markup names a derivative that will not exist
    once it lands is broken on arrival, whoever wrote the hunk.

    Checked against the INDEX first and HEAD second, which together are exactly
    what the tree will look like after the commit.
    """
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for path in files:
        for ref in sorted(set(re.findall(r"assets/derived/[A-Za-z0-9_./-]+\.\w+",
                                         blob_of(path)))):
            if ref in seen:
                continue
            seen.add(ref)
            if ref not in present:
                out.append((path, ref))
    return out


def regions(diff: str) -> list[tuple[int, str]]:
    """Split a unified diff into (changed-line-count, text) regions.

    Hunks closer together than SEPARATION untouched lines are one region: they
    are the same edit spread over a few nearby places. Further apart, they are
    different parts of the file and are judged separately.
    """
    out: list[tuple[int, str]] = []
    cur_lines: list[str] = []
    cur_changed = 0
    prev_end = None
    for line in diff.splitlines():
        m = re.match(r"^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", line)
        if m:
            start = int(m.group(2))
            span = int(m.group(3) or 1)
            if prev_end is not None and start - prev_end > SEPARATION:
                if cur_lines:
                    out.append((cur_changed, "\n".join(cur_lines)))
                cur_lines, cur_changed = [], 0
            prev_end = start + span
            continue
        if line[:1] in "+-" and not line.startswith(("+++", "---")):
            cur_lines.append(line[1:])
            cur_changed += 1
    if cur_lines:
        out.append((cur_changed, "\n".join(cur_lines)))
    return out


def message_text(path: Path) -> str:
    try:
        raw = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return "\n".join(l for l in raw.splitlines() if not l.lstrip().startswith("#"))


def loose(text: str) -> set[str]:
    """Every word, stoplist and code-shape ignored. Used ONLY for the message:
    people write commit subjects in prose, so "the grid drops its empty cells"
    has to be able to account for a `.wp-thumbs-grid` region. Being generous
    here only ever makes the check quieter."""
    return {w.lower() for w in re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}", text)}


def analyse(files: list[str], diff_of, message: str) -> list[tuple[str, str]]:
    """Return (path, sample) for every region the commit does not explain."""
    per_file = {p: regions(diff_of(p)) for p in files}
    # Everything the commit says about itself, other than the region in hand.
    msg_tokens = loose(message)
    path_tokens: set[str] = set()
    for p in files:
        path_tokens |= tokens(p.replace("/", " "))

    flagged: list[tuple[str, str]] = []
    for path, regs in per_file.items():
        if len(regs) < 2:
            continue                      # one edit in one place: not a sweep
        for changed, text in regs:
            if changed < MIN_CHANGED:
                continue                  # a bump or a one-liner
            if generated(text):
                continue                  # bake_markup's output, not an edit
            mine = tokens(text)
            if not mine:
                continue
            # THE MESSAGE IS THE ONLY EXCUSE, and dropping the rest was the
            # fix. The first cut also excused a region sharing a token with
            # ANY other staged file's diff, meaning to keep multi-file changes
            # quiet. On a 38-file rename that set was so large it excused
            # everything, a minified bundle included, and the bundle contains
            # every short token there is. What a person wrote about this
            # commit on purpose is the message and the paths; a collision
            # inside someone else's build output is not evidence of anything.
            if mine & (msg_tokens | path_tokens):
                continue                  # the message accounts for it
            sample = next((l.strip() for l in text.splitlines()
                           if l.strip() and not l.strip().startswith(("*", "//", "#"))),
                          text.strip().splitlines()[0] if text.strip() else "")
            flagged.append((path, sample[:90]))
    return flagged


def report(flagged: list[tuple[str, str]], named: list[str]) -> None:
    print("commit-msg: this commit carries changes its message does not "
          "describe.", file=sys.stderr)
    print("", file=sys.stderr)
    for path, sample in flagged:
        print(f"  {path}", file=sys.stderr)
        print(f"      unexplained: {sample}", file=sys.stderr)
    print("", file=sys.stderr)
    print("  Usually this means a shared file was staged WHOLE and picked up", file=sys.stderr)
    print("  another session's hunk. Look at what you are about to commit:", file=sys.stderr)
    print("    git diff --cached -- " + " ".join(sorted({p for p, _ in flagged})), file=sys.stderr)
    print("    git restore --staged <path>   # then stage only your hunks", file=sys.stderr)
    print("", file=sys.stderr)
    print("  If the message simply does not mention it yet, say it there —", file=sys.stderr)
    print("  that is the cheaper fix and it is what the check is asking for.", file=sys.stderr)
    print("", file=sys.stderr)
    print("  If carrying it is deliberate, say so:", file=sys.stderr)
    print(f"    Carries: {', '.join(sorted(set(named)))} - <why>", file=sys.stderr)


def main() -> int:
    argv = sys.argv[1:]

    # --commit <sha>: run the rule against a commit that already happened. This
    # is how the two incidents above are kept as regression cases rather than
    # as anecdotes in a docstring.
    if argv and argv[0] == "--commit":
        if len(argv) < 2:
            print("check_sweep: --commit needs a sha", file=sys.stderr)
            return 2
        sha = argv[1]
        names = [p for p in git("show", "--name-only", "--format=", "--diff-filter=ACMR", sha).splitlines()
                 if p.strip() and keepable(p) and shared(p)]
        msg = git("show", "-s", "--format=%B", sha)
        flagged = analyse(names,
                          lambda p: git("show", "--format=", "-U0", sha, "--", p),
                          msg)
        subject = msg.splitlines()[0] if msg.splitlines() else sha
        dang = dangling_derivatives(
            [p for p in names if p.endswith((".html", ".css", ".js"))],
            lambda p: git("show", f"{sha}:{p}"),
            # Resolved against the commit's OWN tree. Resolving against today's
            # would call every later rename a dangling reference and report
            # nonsense about history.
            set(git("ls-tree", "-r", "--name-only", sha, "--",
                    "assets/derived/").splitlines()))
        if dang:
            print(f"{sha[:7]} {subject}")
            for path, ref in dang[:8]:
                print(f"  DANGLING {path} -> {ref}")
            return 1
        if flagged:
            print(f"{sha[:7]} {subject}")
            for path, sample in flagged:
                print(f"  CARRIES  {path}: {sample}")
            return 1
        print(f"{sha[:7]} {subject}\n  clean")
        return 0

    if not argv:
        print("check_sweep: no message file given", file=sys.stderr)
        return 1

    if (ROOT / ".git" / "MERGE_HEAD").exists():
        return 0

    files = staged_files()
    if not files:
        return 0

    # THE EXACT RULE FIRST, and it has no escape hatch because there is no
    # version of this that is fine. A commit whose markup names a derivative
    # that will not exist once it lands is broken for everyone who pulls it.
    dang = dangling_derivatives(
        [p for p in files if p.endswith((".html", ".css", ".js"))],
        lambda p: git("show", f":{p}"),
        # ONE call, not one per reference. The index is exactly what the tree
        # will look like after this commit — staged additions are in it and
        # staged deletions are out of it — and index.html alone names ~380
        # derivatives, so a cat-file each made the hook take minutes.
        set(git("ls-files", "--", "assets/derived/").splitlines()))
    if dang:
        print("commit-msg: this commit references derived files it does not "
              "contain.", file=sys.stderr)
        print("", file=sys.stderr)
        for path, ref in dang[:12]:
            print(f"  {path} -> {ref}", file=sys.stderr)
        print("", file=sys.stderr)
        print("  Half an image change is worse than none: main would 404 for", file=sys.stderr)
        print("  everyone until the other half lands. Stage the derivatives:", file=sys.stderr)
        print("    python tools/bake_images.py && git add assets/derived/", file=sys.stderr)
        return 1

    message = message_text(Path(argv[0]))
    flagged = analyse(files,
                      lambda p: git("diff", "--cached", "-U0", "--", p),
                      message)
    if not flagged:
        return 0

    named = [p for p, _ in flagged]
    carries = [l for l in message.splitlines()
               if l.strip().lower().startswith("carries:")]
    if carries:
        line = carries[0]
        missing = sorted({p for p in named if p not in line})
        if not missing:
            return 0
        print("commit-msg: the Carries: line does not name "
              + ", ".join(missing), file=sys.stderr)
        print("", file=sys.stderr)

    report(flagged, named)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
