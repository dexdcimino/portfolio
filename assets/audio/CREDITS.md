# Audio credits

Every file under `assets/audio/` and each game's `assets/audio/` is listed here
with its source URL and licence. **A file with no row in this table must not
ship** — an unattributed asset is a licensing problem regardless of where it
came from.

Sources permitted: Freesound (CC0 filter only), OpenGameArt (CC0 entries only),
Kenney.nl (CC0 by default). CC-BY is *not* interchangeable with CC0 — it
requires attribution in a place users can see, not just a repo file, so it is
excluded here to keep the rule simple.

## Format

| File | Game | Used for | Source URL | Author | Licence |
| ---- | ---- | -------- | ---------- | ------ | ------- |

## Files

*None yet.* MD 26 items 2 and 3 are not implemented — see the report for why.
The shared mixer (MD 26 item 1) ships without any samples; both games are still
running their synthesized SFX through the new `fx` bus.

## Checklist for adding a sound

1. Confirm the licence on the source page itself, not from a search result.
2. Drop the file in the owning game's `assets/audio/`.
3. Add a row above **in the same commit**.
4. Normalise to the same perceived level as its neighbours — the compressor on
   the master bus is a safety net, not a mixing tool.
