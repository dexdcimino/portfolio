/* Restore Inko accounts from their backups (lib/sketch-backup.js), through
 * the live /api/sketch admin actions. See docs/BACKUPS.md for when to use
 * which.
 *
 *   node tools/inko_restore.mjs status [handle]
 *   node tools/inko_restore.mjs restore <handle|--all> --at <time> [--mode exact|missing] [--ids a,b] [--from oldhandle] [--go]
 *   node tools/inko_restore.mjs undelete <handle>
 *
 * The admin token is Dex's universal JWT (the one /api/auth/unlock returns),
 * read from INKO_ADMIN; INKO_BASE defaults to https://dexcimino.com.
 *
 * `restore` is a DRY RUN unless --go is given: it prints what would come back
 * and what would be retired, and changes nothing. With --go every account is
 * snapshotted first ('pre-restore'), so a restore is itself undoable by
 * restoring to just before it.
 */
const BASE = (process.env.INKO_BASE || 'https://dexcimino.com').replace(/\/$/, '');
const ADMIN = process.env.INKO_ADMIN;
const [cmd, ...rest] = process.argv.slice(2);
const VALUED = new Set(['--at', '--mode', '--ids', '--from']);
const flag = (name) => { const i = rest.indexOf('--' + name); return i < 0 ? undefined : (VALUED.has('--' + name) ? rest[i + 1] : true); };
const positional = rest.filter((a, i) => !a.startsWith('--') && !VALUED.has(rest[i - 1]));

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node tools/inko_restore.mjs status [handle] | restore <handle|--all> --at <time> [--mode exact|missing] [--ids a,b] [--from h] [--go] | undelete <handle>');
  process.exit(2);
}
if (!ADMIN) usage('INKO_ADMIN is not set (the admin JWT from /api/auth/unlock).');

async function api(action, body) {
  const r = await fetch(`${BASE}/api/sketch`, { method: 'POST', headers: { 'content-type': 'application/json' },
                                               body: JSON.stringify({ action, admin: ADMIN, ...body }) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${action}: ${r.status} ${out.error || ''}`);
  return out;
}

if (cmd === 'status') {
  console.log(JSON.stringify(await api('backup-status', { handle: positional[0] }), null, 2));
} else if (cmd === 'undelete') {
  if (!positional[0]) usage('undelete: which handle?');
  console.log(JSON.stringify(await api('backup-undelete', { handle: positional[0] }), null, 2));
} else if (cmd === 'restore') {
  const at = flag('at');
  if (!at || at === true || !Number.isFinite(Date.parse(at))) usage('restore: --at <ISO time>, e.g. 2026-10-08T12:00:00Z');
  const go = !!flag('go');
  const handles = flag('all') ? (await api('backup-status', {})).handles : [positional[0]];
  if (!handles[0]) usage('restore: a handle, or --all');
  const opts = { at, mode: flag('mode') || 'exact', from: flag('from'), ids: flag('ids') ? String(flag('ids')).split(',') : undefined, dry: !go };
  let failed = 0;
  for (const handle of handles) {
    try {
      const r = await api('backup-restore', { handle, ...opts });
      console.log(`@${handle}: ${go ? '' : '(dry run) '}restored ${r.restored.length}, retired ${r.removed.length}, unchanged ${r.unchanged.length}, missing ${r.missing.length}`
        + (r.restored.length ? `\n   back: ${r.restored.map((c) => `${c.title} (${c.id} v${c.v})`).join(', ')}` : '')
        + (r.removed.length ? `\n   retired (made after ${at}): ${r.removed.join(', ')}` : '')
        + (r.missing.length ? `\n   NO BYTES for: ${r.missing.map((c) => `${c.id} v${c.v}`).join(', ')}` : ''));
    } catch (err) { failed++; console.error(`@${handle}: ${err.message}`); }
  }
  if (!go) console.log('\nNothing changed. Add --go to restore.');
  process.exit(failed ? 1 : 0);
} else usage();
