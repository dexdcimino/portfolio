/* Admin is Dex SIGNED IN, and no code opens anything of his (Dex, 2026-10-08:
 * "being signed in on my account automatically gives me permissions
 * everywhere ... dexdc will no more").
 *
 *   node tools/owner_gate_check.mjs        (no server, no browser)
 *
 * Every admin door on the site, run as the REAL handler in this process, with
 * its own stand-in for Google's certificates (SITE_AUTH_CERTS_URL) so the ID
 * tokens it signs go through the real lib/site-identity.js:
 *
 *   1. who is Dex -- lib/owner-auth.js ownerOf: nobody, a forgery, someone
 *      else's Google, Dex's address through GitHub, Dex's Google, and Google's
 *      certificates unreachable (a refusal, never a way in).
 *   2. /api/auth/unlock: the old universal code refused on its own and
 *      alongside every sign-in that is not Dex; Dex signed in getting a token
 *      with no code at all.
 *   3. /api/auth/verify (Mission Control asks it): the new token good, an
 *      old code-only token (no `owner`) and an expired one refused.
 *   4. /api/notes/unlock and /save: DEXDC and the universal code refused for
 *      everyone INCLUDING Dex signed in (the code is no more); Dex's sign-in
 *      alone opening them; the public code still open to anyone; an old
 *      private token, the older bare-number token and an old universal token
 *      all refused; a save in the PUBLIC notes handing back a public token;
 *      and the DEXDC notes byte-identical at the end.
 *   5. /api/music/playlist unlock: TUNES refused for everyone, Dex signed in
 *      editing with no code, the universal token, an old edit token refused.
 *   6. Inko moderation (sketch-store isAdmin): the new token yes, an old no.
 *
 * FALSELY PASSES IF the certificate server is never asked (counted and
 * asserted), or a section stops running (the total is asserted).
 */
import { createServer } from 'node:http';
import { createHmac, generateKeyPairSync, scryptSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const SCRATCH = await mkdtemp(join(tmpdir(), 'owner-gate-check-'));
const PROJECT = 'owner-gate-project';
const UNIVERSAL = 'snailcheck', DEXDC = 'dxdcx', TUNES = 'TUNEZ';
Object.assign(process.env, {
  NOTES_DEV_DIR: SCRATCH, SITE_AUTH_PROJECT: PROJECT, AUTH_SECRET: 'owner-gate-secret',
  NOTES_PASSWORD: DEXDC, TUNES_PASSWORD: TUNES,
  EDIT_PASSWORD_HASH: scryptSync(UNIVERSAL, 'dex-universal-v1', 64, { N: 16384, r: 8, p: 1 }).toString('hex'),
});
delete process.env.VERCEL_ENV;
delete process.env.BLOB_READ_WRITE_TOKEN;

let passed = 0, failed = 0;
const ok = (cond, what) => { cond ? passed++ : failed++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`); };

const good = generateKeyPairSync('rsa', { modulusLength: 2048 });
const evil = generateKeyPairSync('rsa', { modulusLength: 2048 });
let certHits = 0;
const certs = createServer((req, res) => {
  certHits++;
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' });
  res.end(JSON.stringify({ k1: good.publicKey.export({ type: 'spki', format: 'pem' }) }));
});
await new Promise((r) => certs.listen(0, '127.0.0.1', r));
const CERTS = `http://127.0.0.1:${certs.address().port}/certs`;
process.env.SITE_AUTH_CERTS_URL = CERTS;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken({ email = 'dexdcimino@gmail.com', provider = 'google.com', verified = true, sub = 'site-dex' } = {}, key = good.privateKey) {
  const t = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const p = b64({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, iat: t - 5, exp: t + 3600, auth_time: t - 5, sub,
    email, email_verified: verified, firebase: { identities: { [provider]: [`${sub}-id`] }, sign_in_provider: provider } });
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`;
}
const DEX = idToken();
const OTHERS = [
  [undefined, 'signed out'],
  [idToken({ email: 'someone@gmail.com', sub: 'site-someone' }), 'someone else’s Google'],
  [idToken({ provider: 'github.com', sub: 'site-gh' }), 'Dex’s address through GitHub'],
  [idToken({}, evil.privateKey), 'a forged token'],
];
/* A DexAuth token the way api/auth/unlock minted them before 2026-10-08. */
function oldJwt(payload) {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), b = b64(payload);
  return `${h}.${b}.${createHmac('sha256', process.env.AUTH_SECRET).update(`${h}.${b}`).digest('base64url')}`;
}
const now = () => Math.floor(Date.now() / 1000);

const route = (h, body, headers = {}, method = 'POST') => new Promise((done) => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; }, json(o) { done({ status: this.statusCode, body: o }); return this; },
    end() { done({ status: this.statusCode }); } };
  Promise.resolve(h({ method, body, headers, query: {}, url: '/' }, res)).catch((e) => done({ status: 'threw', body: String(e) }));
});

try {
  const owner = require(join(ROOT, 'lib', 'owner-auth.js'));

  console.log('1. who is Dex');
  ok(OTHERS.length === 4, `${OTHERS.length} people who are not Dex`);
  const want = ['signed-out', 'not-owner', 'not-owner', 'signed-out'];
  for (let i = 0; i < OTHERS.length; i++) {
    const got = await owner.ownerOf(OTHERS[i][0]);
    ok(got === want[i], `${OTHERS[i][1]}: ${got}`);
  }
  ok(await owner.ownerOf(idToken({ verified: false })) === 'not-owner', 'an unverified address is not Dex');
  ok(await owner.ownerOf(DEX) === 'owner', 'Dex’s Google is');
  process.env.SITE_AUTH_CERTS_URL = 'http://127.0.0.1:1/down';
  ok(await owner.ownerOf(DEX) === 'unverifiable', 'with Google’s certificates unreachable, Dex is NOT let in on trust');
  process.env.SITE_AUTH_CERTS_URL = CERTS;

  console.log('2. the universal token (/api/auth/unlock)');
  const authUnlock = require(join(ROOT, 'api', 'auth', 'unlock.js'));
  for (const [t, who] of OTHERS) {
    const r = await route(authUnlock, { password: UNIVERSAL, idToken: t });
    ok(r.status >= 400 && !r.body.token, `the old code refused: ${who} (${r.status})`);
  }
  ok((await route(authUnlock, { idToken: idToken({ email: 'someone@gmail.com', sub: 'site-x' }) })).status === 403, 'someone else signed in is told they are not the owner');
  const minted = await route(authUnlock, { idToken: DEX });
  ok(minted.status === 200 && typeof minted.body.token === 'string', `Dex signed in gets a token with NO code (${minted.status})`);
  const ADMIN = minted.body.token;

  console.log('3. Mission Control’s check (/api/auth/verify)');
  const verify = require(join(ROOT, 'api', 'auth', 'verify.js'));
  const v = (t) => route(verify, null, { authorization: `Bearer ${t}` }, 'GET');
  const vGood = await v(ADMIN);
  ok(vGood.status === 200 && vGood.body.owner === true, 'the token Dex just got is good');
  const OLD_ADMIN = oldJwt({ tier: 'admin', iat: now(), exp: now() + 3600 });
  ok((await v(OLD_ADMIN)).status === 401, 'an old code-only token (no owner) is refused');
  ok((await v(oldJwt({ tier: 'admin', owner: true, iat: now() - 7200, exp: now() - 3600 }))).status === 401, 'an expired one is refused');

  console.log('4. the DEXDC notes');
  const notesStore = require(join(ROOT, 'lib', 'notes-store.js'));
  const unlock = require(join(ROOT, 'api', 'notes', 'unlock.js'));
  const save = require(join(ROOT, 'api', 'notes', 'save.js'));
  const FIXTURE = { v: 1, active: 's1', sessions: [{ id: 's1', title: 'owner gate fixture', cats: [] }] };
  const first = await notesStore.writeNotes(FIXTURE, undefined, Date.now(), 'private');
  const before = JSON.stringify((await notesStore.readNotes('private')).content);
  for (const [t, who] of [...OTHERS, [DEX, 'DEX signed in']]) {
    const r = await route(unlock, { password: DEXDC, idToken: t });
    ok(r.status === 401 && !r.body.content && !r.body.token, `DEXDC opens nothing: ${who} (${r.status})`);
    const u = await route(unlock, { password: UNIVERSAL.slice(0, 5), idToken: t });
    ok(u.status === 401 && !u.body.content, `nor the universal code: ${who}`);
  }
  const signedIn = await route(unlock, { idToken: DEX });
  ok(signedIn.status === 200 && signedIn.body.rev === first.rev && signedIn.body.content.sessions[0].title === 'owner gate fixture', `Dex’s sign-in alone opens them (${signedIn.status})`);
  ok((await route(unlock, { token: signedIn.body.token })).status === 200, 'and the token they hand back works');
  ok((await route(unlock, { idToken: OTHERS[1][0] })).status === 403, 'someone else’s sign-in is told to keep their own notes (403)');
  const pub = await route(unlock, { password: 'notes' });
  ok(pub.status === 200 && JSON.stringify(pub.body.content) !== before, `the public code still opens the public page, signed out (${pub.status})`);
  const tok = (payload) => { const p = JSON.stringify(payload);
    return `${Buffer.from(p).toString('base64url')}.${createHmac('sha256', DEXDC).update(p).digest('base64url')}`; };
  ok(!notesStore.tokenOk(tok({ exp: Date.now() + 60000, store: 'private' })), 'an old private session token (no owner) is refused');
  ok(!notesStore.tokenOk(tok(Date.now() + 60000)), 'the older bare-number token is refused');
  ok((await route(unlock, { jwt: OLD_ADMIN })).status === 401, 'an old universal token is refused');
  ok((await route(unlock, { jwt: ADMIN })).status === 200, 'the new universal token opens them');
  const pubSave = await route(save, { token: pub.body.token, doc: { v: 1, active: 'p', sessions: [{ id: 'p', title: 'public page', cats: [] }] }, baseRev: pub.body.rev });
  ok(pubSave.status === 200 && notesStore.tokenOk(pubSave.body.token) === 'public', `a save in the public notes hands back a PUBLIC token (${notesStore.tokenOk(pubSave.body.token)})`);
  const viaPub = await route(unlock, { token: pubSave.body.token });
  ok(viaPub.status === 200 && JSON.stringify(viaPub.body.content) !== before, 'and that token opens the public page, not Dex’s');
  ok(JSON.stringify((await notesStore.readNotes('private')).content) === before, 'the DEXDC notes are byte-identical');

  console.log('5. TUNES (/api/music/playlist)');
  const musicStore = require(join(ROOT, 'lib', 'music-store.js'));
  const playlist = require(join(ROOT, 'api', 'music', 'playlist.js'));
  for (const [t, who] of OTHERS) {
    const r = await route(playlist, { action: 'unlock', code: TUNES, idToken: t });
    ok(r.status === 401 && !r.body.token, `TUNES refused: ${who} (${r.status})`);
  }
  const tunes = await route(playlist, { action: 'unlock', idToken: DEX });
  ok(tunes.status === 200 && musicStore.tokenOk(tunes.body.token), `Dex signed in gets an edit token with NO code (${tunes.status})`);
  ok((await route(playlist, { action: 'unlock', jwt: ADMIN })).status === 200, 'so does the new universal token');
  ok((await route(playlist, { action: 'unlock', jwt: OLD_ADMIN, code: TUNES })).status === 401, 'an old universal token with the code, signed out, is refused');
  const oldMusic = (() => { const p = String(Date.now() + 60000);
    return `${Buffer.from(p).toString('base64url')}.${createHmac('sha256', `tunes:${TUNES}`).update(p).digest('base64url')}`; })();
  ok(!musicStore.tokenOk(oldMusic), 'an old edit token (minted by the code alone) is refused');

  console.log('6. Inko moderation');
  const sketch = require(join(ROOT, 'lib', 'sketch-store.js'));
  ok(sketch.isAdmin(ADMIN) && !sketch.isAdmin(OLD_ADMIN), 'the new universal token moderates, an old one does not');

  ok(certHits > 0, `the certificate server was asked (${certHits})`);
} finally {
  certs.close();
  await rm(SCRATCH, { recursive: true, force: true });
}

const EXPECT = 48;
ok(passed + failed === EXPECT, `ran ${passed + failed} checks, expected ${EXPECT}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
