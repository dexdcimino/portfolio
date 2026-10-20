# Music playlists: shared public catalog

## What was broken

All and Repeat were stored in the shared Vercel music document. Custom playlists
were stored in `localStorage['dex-music-playlists']`, separately on each browser
or installed app. Signing in did not upload or synchronize those collections.
Consequently a phone could have Shorts while a desktop had Stillness.

## Behavior implemented

There is one public music catalog: All, Repeat, and the curator's custom playlists.
Signed-out visitors and other signed-in accounts see the same collection.
Only the existing verified owner account (`dexdcimino@gmail.com`) can create,
delete, import or change memberships. Other users cannot publish their old local
playlists into this collection.

Adding a song or embed from a custom playlist saves it to both All and that
playlist in one operation. Removing a library song clears its memberships;
undo restores the server's actual membership snapshot. Deleting a playlist does
not delete its songs from All.

An open, visible Music overlay checks for changes every two seconds. Returning
to the tab or reopening Music checks immediately. Hidden pages pause polling.
This is near-live synchronization, not a WebSocket service or a zero-latency
guarantee. Failed saves show an error rather than creating a local-only playlist.

## Preserve and merge existing device collections

After deployment, open Music once while signed into the owner account on EACH
browser/profile/installed app where an original collection appears. In particular:

1. Open the existing phone app/browser that currently shows Shorts.
2. Open the existing desktop browser that currently shows Stillness.
3. Confirm both names and their songs appear on both devices.

Keep their website/browser data until that is confirmed. A desktop cannot fetch
an unopened phone's local storage. No manual export or database entry is needed
for the normal migration.

The new code never overwrites the original `dex-music-playlists` key. It also
keeps the first original bytes under `dex-music-playlists-legacy-backup-v1` and
archives each imported collection privately at `music/legacy/<sha256>.json` in
Vercel Blob before acknowledging migration. Unknown/unavailable track references
remain in those original backups; the shared playable memberships use tracks
that still exist in All.

Imports union songs from same-name collections instead of replacing them.
Distinct collections are retained; accidental legacy ID collisions get new IDs.
Legacy custom lists named All or Repeat get an `(imported)` suffix. Server-side
receipts make retries idempotent. Deleted playlist names and removed memberships
are recorded so a late device cannot resurrect a globally deleted collection or
undo a deliberate song removal. Local import acknowledgement is written only
after the server confirms success. It is not the only replay protection.

## Hosting and protection against lost writes

The implementation uses the EXISTING private Vercel Blob music store and owner
authentication. No new Firebase database, rules, environment variables or
separate synchronization service are required, assuming the existing music
backend is already configured and working.

`music/playlist.json` now includes custom playlists and migration/deletion
metadata alongside tracks. Public responses omit internal migration history.
Existing track-only documents upgrade without replacing their tracks. New
hourly/daily/weekly backups include playlists; restoring an old track-only
backup retains current custom collections.

All editing routes apply small operations to the latest document, rather than
accepting a device's whole stale collection. Existing blobs use ETag-conditional
writes; new blobs are created without overwrite permission. Conflicts re-read
and retry up to six times, then return an error rather than overwriting another
device's work. This uses the installed SDK's `BlobPreconditionFailedError` class
(its `.name` is `Error`, so name-string comparisons are insufficient).
See [Vercel's conditional-write documentation](https://vercel.com/docs/vercel-blob/using-blob-sdk).

## Later: individual account playlists

Keep the curator's public catalog and add a separate user-owned collection,
labelled “My playlists.” Each personal playlist should be keyed to the verified
Firebase UID and reference canonical track IDs. Server checks must enforce UID
ownership; ordinary users must never receive curator edit privileges. Personal
collections can be private by default, with sharing treated as a later feature.
This account-specific feature is NOT included in the present change.

## Verification and deployment status

`node tools/music_playlist_sync_check.mjs` exercises the real store/API on scratch
storage and a simulated Blob service with the actual SDK error class: merging,
permissions, archive originals, retry safety, delete/removal tombstones, atomic
add/undo, old backups, first-write races and conditional-write conflicts.

`node tools/music_admin_check.mjs --in-process` drives real browser pages and
real handlers with isolated storage, including desktop Stillness and phone
Shorts migration, automatic public updates, membership removal, deletion, an
old device returning later, and a non-owner import refusal. Provider playback
availability and production Blob access are not asserted by this harness.

Deployment must be confirmed separately. These are implementation and test
results, not confirmation that the live site's phone/desktop collections have
already migrated.
