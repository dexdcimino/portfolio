/* The GitHub allowlist inside Inko: a github-<id> from the site account is
 * admitted end to end.
 *
 *   node tools/inko_github_allowlist_check.mjs
 *
 * A sibling of tools/github_projection_check.mjs (W2) and
 * tools/site_account_check.mjs, in their pattern: no browser and no
 * network. A local server stands in for Google's published certificates
 * (SITE_AUTH_CERTS_URL), the check signs its own Firebase-shaped ID
 * tokens, and Inko's store runs on a scratch NOTES_DEV_DIR.
 *
 * W2 made lib/site-identity.js person() file every provider in a token,
 * github-<id> among them -- but lib/sketch-store.js still filtered its
 * links through an allowlist written before GitHub existed on the site:
 * PROVIDER_ID named only google, discord and firebase, and the VIA map
 * gave only Google and Discord first look. So a github- entry was dropped
 * at identifySite's door, a claim ticket carrying one in its `also` was
 * refused by readTicket, and no Inko account could be found by, stored
 * under, or claimed through a GitHub sign-in. W2b widens those three
 * sites; this check pins the widened behavior down:
 *
 *   1. A first site GitHub sign-in claims a name, and the claim LINKS the
 *      github- id: it sits in the identities table and on the record.
 *   2. A later sign-in under another site uid carrying the same
 *      GitHub-projected identity FINDS that account, never a fresh one.
 *   3. VIA: with drawings in both accounts, a GitHub sign-in opens the
 *      GitHub account and a Google sign-in the uid's own -- GitHub keeps
 *      its own canvases exactly as Google and Discord do.
 *   4. Never-steal, on a github- id: an id owned by another live account
 *      is not taken from it, not listed on the wrong record, and the
 *      other uid is not linked onto the owner's record either.
 *   5. Malformed github- values -- empty, spaces, a slash, overlong, a
 *      traversal pid, a poisoned ticket -- are refused at the same
 *      boundaries that refuse them for every other provider.
 *
 * The Google and Discord paths are regression-pinned by
 * tools/site_account_check.mjs, which must pass unchanged alongside.
 *
 * FALSELY PASSES IF: the certificate server was never asked. It counts
 * its requests and the run asserts it served at least one.
 */
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const SCRATCH = await mkdtemp(join(tmpdir(), 'inko-github-check-'));
process.env.NOTES_DEV_DIR = SCRATCH;
delete process.env.VERCEL_ENV;
const PROJECT = 'site-check-project';
process.env.SITE_AUTH_PROJECT = PROJECT;

const good = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = (k) => k.publicKey.export({ type: 'spki', format: 'pem' });
let certHits = 0;
const certs = createServer((req, res) => {
  certHits++;
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' });
  res.end(JSON.stringify({ k1: pem(good) }));
});
await new Promise((r) => certs.listen(0, '127.0.0.1', r));
process.env.SITE_AUTH_CERTS_URL = `http://127.0.0.1:${certs.address().port}/certs`;

const site = require(join(ROOT, 'lib', 'site-identity.js'));
const store = require(join(ROOT, 'lib', 'sketch-store.js'));

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log(`  ok   ${what}`); } else { failed++; console.log(`  FAIL ${what}`); } };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
function token(claims = {}) {
  const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const t = now();
  const p = b64({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, iat: t - 10, exp: t + 3600, auth_time: t - 10,
    sub: 'uid-default', ...claims });
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), good.privateKey).toString('base64url')}`;
}
const fb = (uid, ids, provider) => ({ sub: uid, firebase: { identities: ids, sign_in_provider: provider } });
const whoFromToken = async (claims) => site.person(await site.verify(token(claims)));

const PNG = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');
const JPG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]).toString('base64');

try {
  console.log('1. a first GitHub sign-in claims a name, and the claim links the github- id');
  const who1 = await whoFromToken(fb('fb-gh-1', { 'github.com': ['424242'] }, 'github.com'));
  ok(who1.linked.join() === 'github-424242', `the projection W2 hands over (${who1.linked.join(', ')})`);
  ok(who1.provider === 'github.com' && who1.uid === 'fb-gh-1', 'and the sign-in provider is github.com');
  const r1 = await store.identifySite(who1);
  ok(!!r1.ticket && !r1.handle, 'a new GitHub person gets a ticket to pick a name');
  const c1 = await store.claim(r1.ticket, 'ghartist');
  ok(c1.handle === 'ghartist', 'and claims one (the ticket carried github-424242 in its also, and readTicket let it through)');
  const linkFile = await store.io.readJson('sketch/identities/github-424242.json');
  ok(!!linkFile && linkFile.handle === 'ghartist', 'the github- id is stored in the identities table, pointing at the account');
  const rec1 = await store.io.readJson('sketch/users/ghartist.json');
  ok(Array.isArray(rec1.identities) && rec1.identities.includes('github-424242') && rec1.identities.includes('firebase-fb-gh-1'),
    `and listed on the record beside the uid (${(rec1.identities || []).join(', ')})`);
  ok((await store.identify({ provider: 'github', pid: '424242' })).handle === 'ghartist', 'the identities table answers a github lookup directly');

  console.log('2. a later sign-in carrying the same GitHub identity finds the account');
  const r2 = await store.identifySite({ uid: 'fb-gh-2', linked: ['github-424242'], provider: 'github.com' });
  ok(r2.handle === 'ghartist' && !!r2.token, 'another site uid with the same GitHub account FINDS it, no fresh account');
  ok((await store.identifySite({ uid: 'fb-gh-2', linked: [] })).handle === 'ghartist', 'and from then on that uid alone finds it too');

  console.log('3. VIA: GitHub keeps its own canvases, like Google and Discord');
  const tVia = (await store.identifySite({ uid: 'fb-via', linked: [], provider: 'google.com' })).ticket;
  await store.claim(tVia, 'viaown');
  await store.putCanvas('viaown', { id: 'cvia1', title: 'Own', bg: {}, created: 1, ts: 1, png: PNG, thumb: JPG });
  const rDraw = await store.identifySite({ uid: 'fb-gh-9', linked: ['github-555'], provider: 'github.com' });
  await store.claim(rDraw.ticket, 'ghdraw');
  await store.putCanvas('ghdraw', { id: 'cgh1', title: 'GH', bg: {}, created: 1, ts: 1, png: PNG, thumb: JPG });
  const viaGh = await store.identifySite({ uid: 'fb-via', linked: ['github-555'], provider: 'github.com' });
  ok(viaGh.handle === 'ghdraw', `with drawings in both, a GitHub sign-in opens the GitHub account (${viaGh.handle})`);
  const viaGo = await store.identifySite({ uid: 'fb-via', linked: ['github-555'], provider: 'google.com' });
  ok(viaGo.handle === 'viaown', `and a Google sign-in the uid's own (${viaGo.handle})`);

  console.log('4. never-steal, on a github- id');
  const tThief = (await store.identifySite({ uid: 'fb-thief', linked: [], provider: 'google.com' })).ticket;
  await store.claim(tThief, 'thiefacct');
  const rThief = await store.identifySite({ uid: 'fb-thief', linked: ['github-424242'], provider: 'google.com' });
  ok(rThief.handle === 'thiefacct', 'a sign-in carrying someone else’s github- id opens the signer’s own account');
  ok((await store.identify({ provider: 'github', pid: '424242' })).handle === 'ghartist', 'the github- id still belongs to its owner');
  const recThief = await store.io.readJson('sketch/users/thiefacct.json');
  ok(!(recThief.identities || []).includes('github-424242'), 'and was not listed on the signer’s record');
  const recArtist = await store.io.readJson('sketch/users/ghartist.json');
  ok(!(recArtist.identities || []).includes('firebase-fb-thief'), 'and the signer’s uid was not linked onto the owner’s record');

  console.log('5. malformed github- values are refused at the same boundaries as any provider');
  const m1 = await store.identifySite({ uid: 'fb-mal', linked: ['github-'], provider: 'github.com' });
  ok(!!m1.ticket && !m1.handle, 'an empty github- id is filtered out, not matched or stored (a new person gets a ticket)');
  const m2 = await store.identifySite({ uid: 'fb-mal2', linked: ['github-bad space', 'github-a/b', `github-${'x'.repeat(129)}`], provider: 'github.com' });
  ok(!!m2.ticket && !m2.handle, 'a space, a slash and an overlong id are filtered out the same way');
  let refused400 = false;
  try { await store.identify({ provider: 'github', pid: '../etc' }); } catch (err) { refused400 = err.status === 400; }
  ok(refused400, 'a traversal pid is refused 400 by identify');
  ok(store.readTicket(store.mintTicket({ provider: 'firebase', pid: 'fb-mal', also: ['github-../evil'] })) === null,
    'a ticket whose also carries a malformed github- id does not read back');
  const goodAlso = store.readTicket(store.mintTicket({ provider: 'firebase', pid: 'fb-mal', also: ['github-777'] }));
  ok(!!goodAlso && goodAlso.also.join() === 'github-777', 'and a ticket whose also carries a well-formed github- id does');
  const goodPrimary = store.readTicket(store.mintTicket({ provider: 'github', pid: '777' }));
  ok(!!goodPrimary && goodPrimary.provider === 'github', 'a github- primary identity passes the same ticket validation');
  ok(certHits >= 1, `the certificate server was asked (${certHits} time(s), cached after)`);
} finally {
  certs.close();
  await rm(SCRATCH, { recursive: true, force: true });
}

const EXPECT = 22;
ok(passed + failed === EXPECT, `ran ${passed + failed} checks, expected ${EXPECT}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
