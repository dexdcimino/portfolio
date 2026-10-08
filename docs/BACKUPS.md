# Inko backups — what is kept, and how to get it back

Written 2026-10-08, after a sign-in landed Dex in an empty account and it looked
like his canvases were gone. The code is `lib/sketch-backup.js`; the proof is
`node tools/backup_check.mjs`.

## What is kept

| layer | what | how long | cost |
|---|---|---|---|
| **Retired versions** | every canvas version a save, a delete or a restore replaces. Bytes stay where they were; the account's index (`~meta`) records when each one was live | the 5 newest and one per hour of the last day for a week; a deleted canvas's last version for 30 days; any version a kept snapshot names | 0 extra writes |
| **Snapshots** | the whole account as it stood (record, follows, canvas index, retired list), taken by the first write of each day, to `sketch-backup/<handle>/` | newest of each of the last 7 days, 4 weeks and 4 months (about 3 months back) | 1 put per active account per day |
| **Trash** | a deleted account, or the old name of a renamed one: off the site at once, bytes and a last snapshot kept, listed in `sketch/trash.json` | 30 days, then the daily cron purges it | 1 put per deletion |

Point-in-time: for the last week you can go back to any save; for about three
months you can go back to any kept snapshot.

**Not kept:** public copies (re-publish from the canvas), reactions and comments,
the profile picture's bytes (it is re-cut from a canvas). Drawings that were
never saved to an account (signed out) live only on the device.

**Why not every 5 minutes, and not copied elsewhere:** Vercel Blob on Hobby
includes 2,000 writes a month and going over **locks the whole store for 30
days**, which would take the site down. Per-save versions already give finer
than 5-minute recovery for free. A second copy off Vercel (the 3-2-1 rule's
"offsite") is the next step once the site is on Pro: a scheduled job that
copies `sketch-backup/` and the canvases to another provider. The repository
is public, so GitHub Actions artifacts are not a safe place for it.

## Getting it back

You need the admin token: the JWT `/api/auth/unlock` returns for the universal
password. Then:

```sh
export INKO_ADMIN=<the token>

# What exists for an account: live canvases, retired versions, snapshots, trash
node tools/inko_restore.mjs status dexcimino

# Put an account back as it was at a time. DRY RUN unless --go.
node tools/inko_restore.mjs restore dexcimino --at 2026-10-08T11:00:00Z
node tools/inko_restore.mjs restore dexcimino --at 2026-10-08T11:00:00Z --go

# Only bring back what is gone, leave everything else as it is now
node tools/inko_restore.mjs restore dexcimino --at 2026-10-08T11:00:00Z --mode missing --go

# Just some canvases
node tools/inko_restore.mjs restore dexcimino --at 2026-10-08T11:00:00Z --ids abc123,def456 --go

# Everyone (e.g. a bad deploy wrote over many accounts)
node tools/inko_restore.mjs restore --all --at 2026-10-08T11:00:00Z
node tools/inko_restore.mjs restore --all --at 2026-10-08T11:00:00Z --go

# A deleted account, exactly as it was (password, Google/Discord links, canvases, follows)
node tools/inko_restore.mjs undelete somebody

# A renamed account's canvases from before the rename, onto the new name
node tools/inko_restore.mjs restore newname --from oldname --at 2026-10-08T11:00:00Z --go
```

Every `--go` restore first snapshots the account (`pre-restore`), so a restore
that was wrong is undone by restoring to a moment before it. Restored canvases
are stamped with the current time, so every phone signed in to the account
takes them over whatever it holds.

`--mode exact` (the default) also retires canvases made after `--at`; they are
not lost, just retired like any other version, and a later restore can bring
them back.

## The daily cron

`vercel.json` runs `GET /api/sketch?cron=backup` at 04:17 UTC. It only purges
trash past its 30 days, never anything newer, so it is safe to call by hand. If
`CRON_SECRET` is set in Vercel, Vercel sends it and the endpoint checks it.
