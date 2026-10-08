/* The site account, on the server: the ID-token check and Inko linking to it.
 *
 *   node tools/site_account_check.mjs
 *
 * No browser and no network. A local server stands in for Google's published
 * certificates (SITE_AUTH_CERTS_URL), the check signs its own Firebase-shaped
 * ID tokens with a key it made, and Inko's store runs on a scratch
 * NOTES_DEV_DIR.
 *
 *   1. lib/site-identity.js verify(): a good token passes, and every way a
 *      token can be wrong is refused -- counted, so a refusal case that stopped
 *      running cannot pass as "no failures".
 *   2. lib/sketch-store.js identifySite(): an Inko account made through Inko's
 *      OWN Google or Discord sign-in, before the site account existed, is FOUND
 *      by the site account and linked to it (nothing duplicated, nothing moved);
 *      a new person gets a ticket and a claim that links every id at once; an
 *      id already on another live account is not taken from it; only Dex's
 *      verified address claims @dex; a rename carries the link and a deletion
 *      removes it.
 *   3. api/sketch.js action "site": a forged token is a 401, a real one signs in.
 *
 * FALSELY PASSES IF: the certificate server was never asked. It counts its
 * requests and the run asserts it served at least one.
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
const SCRATCH = await mkdtemp(join(tmpdir(), 'site-account-check-'));
process.env.NOTES_DEV_DIR = SCRATCH;
delete process.env.VERCEL_ENV;
const PROJECT = 'site-check-project';
process.env.SITE_AUTH_PROJECT = PROJECT;

const good = generateKeyPairSync('rsa', { modulusLength: 2048 });
const evil = generateKeyPairSync('rsa', { modulusLength: 2048 });
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
const handler = require(join(ROOT, 'api', 'sketch.js'));

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log(`  ok   ${what}`); } else { failed++; console.log(`  FAIL ${what}`); } };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
function token(claims = {}, { key = good.privateKey, head = {} } = {}) {
  const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT', ...head });
  const t = now();
  const p = b64({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, iat: t - 10, exp: t + 3600, auth_time: t - 10,
    sub: 'uid-default', firebase: { identities: {}, sign_in_provider: 'google.com' }, ...claims });
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`;
}
const fbClaims = (uid, ids = {}, extra = {}) => ({ sub: uid, firebase: { identities: ids, sign_in_provider: 'google.com' }, ...extra });

async function refused(tok, what) {
  try { await site.verify(tok); ok(false, `refused: ${what}`); }
  catch (err) { ok(err instanceof site.Invalid, `refused: ${what}`); }
}

try {
  console.log('1. verify()');
  const c = await site.verify(token({ sub: 'abc' }));
  ok(c.sub === 'abc', 'a good token passes and names its uid');
  const REFUSALS = [
    [token({ aud: 'someone-else' }), 'another project'],
    [token({ iss: 'https://securetoken.google.com/someone-else' }), 'another issuer'],
    [token({ exp: now() - 1 }), 'expired'],
    [token({ iat: now() + 3600 }), 'issued in the future'],
    [token({ auth_time: now() + 3600 }), 'signed in in the future'],
    [token({ sub: '' }), 'no subject'],
    [token({}, { key: evil.privateKey }), 'signed by another key'],
    [token({}, { head: { kid: 'k2' } }), 'an unknown key id'],
    [token({}, { head: { alg: 'HS256' } }), 'another algorithm'],
    ['not.a', 'not a token'],
    [token({ sub: 'x' }).replace(/\.[^.]+\./, `.${b64({ sub: 'someone-else', aud: PROJECT })}.`), 'claims swapped under a good signature'],
  ];
  ok(REFUSALS.length === 11, `${REFUSALS.length} refusal cases`);
  for (const [t, what] of REFUSALS) await refused(t, what);
  ok(certHits >= 1, `the certificate server was asked (${certHits} time(s), cached after)`);

  const p = site.person(await site.verify(token(fbClaims('u1', { 'google.com': ['g-111'], 'oidc.discord': ['d-222'], email: ['a@b.c'] }, { email: 'a@b.c', email_verified: true, name: 'Ann B' }))));
  ok(p.uid === 'u1' && p.linked.join() === 'google-g-111,discord-d-222', `person(): uid and the links Inko knows (${p.linked.join(', ')})`);

  console.log('2. Inko linking to the site account');
  // An Inko account from BEFORE the site account: Inko's own Google sign-in.
  const t1 = (await store.identify({ provider: 'google', pid: 'g-old', email: 'old@x.y', verified: true })).ticket;
  const old = await store.claim(t1, 'oldtimer');
  ok(old.handle === 'oldtimer', 'an account made through Inko’s own Google sign-in');
  const r1 = await store.identifySite({ uid: 'site-old', linked: ['google-g-old'] });
  ok(r1.handle === 'oldtimer' && !!r1.token, 'the site account with the same Google FINDS it');
  const rec1 = JSON.parse(JSON.stringify(await store.me('oldtimer')));
  ok(!!rec1, 'and it is still the same live account');
  const r1b = await store.identifySite({ uid: 'site-old', linked: [] });
  ok(r1b.handle === 'oldtimer', 'and from then on the uid alone finds it (signed in with GitHub, say)');

  // Discord, the same way.
  const t2 = (await store.identify({ provider: 'discord', pid: '9001', email: '', verified: false })).ticket;
  await store.claim(t2, 'discordian');
  const r2 = await store.identifySite({ uid: 'site-disc', linked: ['discord-9001'] });
  ok(r2.handle === 'discordian', 'an Inko Discord account is found through oidc.discord');

  // Someone new.
  const r3 = await store.identifySite({ uid: 'site-new', linked: ['google-g-new', 'discord-777'], email: 'n@x.y', verified: true });
  ok(!!r3.ticket && !r3.handle, 'a new person gets a ticket to pick a name');
  const c3 = await store.claim(r3.ticket, 'newbie');
  ok(c3.handle === 'newbie', 'and claims one');
  ok((await store.identifySite({ uid: 'site-new', linked: [] })).handle === 'newbie', 'the uid finds it');
  ok((await store.identify({ provider: 'google', pid: 'g-new' })).handle === 'newbie', 'and so does Inko’s own Google sign-in, linked in the same claim');
  ok((await store.identify({ provider: 'discord', pid: '777' })).handle === 'newbie', 'and Inko’s own Discord sign-in');

  // An id on another live account is not taken from it.
  const r4 = await store.identifySite({ uid: 'site-other', linked: [] });
  const c4 = await store.claim(r4.ticket, 'second');
  await store.identifySite({ uid: 'site-other', linked: ['google-g-old'] });
  ok((await store.identify({ provider: 'google', pid: 'g-old' })).handle === 'oldtimer', 'an id already on a live account stays with it');
  ok(c4.handle === 'second', 'while the other account still signs in');

  // The reserved names.
  const strangerT = (await store.identifySite({ uid: 'site-x', linked: [], email: 'dexdcimino@gmail.com', verified: false })).ticket;
  let refusedDex = false;
  try { await store.claim(strangerT, 'dex'); } catch (err) { refusedDex = err.status === 409; }
  ok(refusedDex, '@dex refused to an UNverified claim of Dex’s address');
  const dexT = (await store.identifySite({ uid: 'site-dex', linked: [], email: 'dexdcimino@gmail.com', verified: true })).ticket;
  ok((await store.claim(dexT, 'dex')).handle === 'dex', '@dex claimed by Dex’s verified address');

  // Rename and delete carry the link.
  const ren = await store.rename('newbie', 'renamed');
  ok((await store.identifySite({ uid: 'site-new', linked: [] })).handle === ren.handle, 'a rename carries the site link');
  await store.deleteAccount(ren.handle);
  const after = await store.identifySite({ uid: 'site-new', linked: [] });
  ok(!!after.ticket, 'a deletion removes it (the uid is offered a new name)');

  console.log('3. the API');
  const call = (body) => new Promise((done) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, getHeader(k) { return this.headers[k.toLowerCase()]; },
      status(code) { this.statusCode = code; return this; }, json(o) { done({ status: this.statusCode, body: o }); return this; },
      send(b) { done({ status: this.statusCode, body: b }); return this; }, end() { done({ status: this.statusCode }); } };
    handler({ method: 'POST', body, headers: {}, url: '/api/sketch' }, res);
  });
  const bad = await call({ action: 'site', idToken: token({}, { key: evil.privateKey }) });
  ok(bad.status === 401, `a forged token is a 401 (${bad.status})`);
  const okr = await call({ action: 'site', idToken: token(fbClaims('site-old', { 'google.com': ['g-old'] })) });
  ok(okr.status === 200 && okr.body.handle === 'oldtimer' && !!okr.body.token, 'a real one signs in to the linked account');
  const fresh = await call({ action: 'site', idToken: token(fbClaims('site-api-new', {}, { name: 'Zoë Q', email: 'z@q.r' })) });
  ok(fresh.status === 200 && !!fresh.body.ticket && fresh.body.suggest === 'zo_q', `a new one gets a ticket and a suggested name (${fresh.body.suggest})`);
  const me = await call({ action: 'me', token: okr.body.token });
  ok(me.status === 200 && me.body.handle === 'oldtimer', 'the token it hands back works on the rest of the API');
} finally {
  certs.close();
  await rm(SCRATCH, { recursive: true, force: true });
}

const EXPECT = 35;
ok(passed + failed === EXPECT, `ran ${passed + failed} checks, expected ${EXPECT}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
