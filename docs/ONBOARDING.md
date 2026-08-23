# Onboarding a new AI session

**Paste `context-pack.zip` from the repo root. That is the whole job.** No prompt on top —
if one is needed, the pack is incomplete and the pack gets fixed, not the prompt
(`DOCTRINE.md` rule 28).

The zip carries every tracked text file the site is made of plus a generated `START-HERE.md`
that tells the session what to read, what its role is, and exactly what its first reply may
contain. It is rebuilt by a post-commit hook against every commit, so it always describes
the current HEAD, and its state numbers are measured by running the repo rather than typed.

**A fresh clone installs the hooks once:**

```
python tools/bake_images.py --install-hooks
```

That installs all three — `pre-commit`, `commit-msg`, `post-commit`. Until it is run there is
no pack in the root; that is fine and the session simply has none. What is not fine is a pack
that is present and stale, so `tools/check_pack.py` refuses a commit whenever the pack's
stamp names a HEAD that is no longer current. Rebuild by hand with
`python tools/context_pack.py`.

Game source is held back by default — four games at 4 MB would drown everything else. Every
game's docs always ship. To include one:

```
python tools/context_pack.py --game surveyor     # or --all
```

## If the session has a shell and the repo

```
Read DOCTRINE.md, then CLAUDE.md, then:

[what I want to build]
```

- It reads the last **pushed** commit — push first if mid-change, and another session's
  uncommitted work is invisible to it.
- Per-area docs sit beside the root ones: `games/surveyor/ARCHITECTURE.md` and the three
  other games.
- Structural changes update the relevant `ARCHITECTURE.md` in the same commit.
