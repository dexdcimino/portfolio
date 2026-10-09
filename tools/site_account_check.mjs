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
 *   4. api/notes/unlock.js with an ID token: Dex's verified Google opens the
 *      DEXDC store itself (the same document, its rev, a token that saves to
 *      it), and every other account -- the same address through GitHub, an
 *      unverified one, someone else's Google, a forgery -- opens nothing and
 *      changes nothing.
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

/* A stand-in for Firebase's sign-in API (SITE_AUTH_IDP_URL), for the
   name-and-password bridge: users by email, as Firebase keeps them. */
const idpUsers = new Map();
let idpHits = 0, idpRefuse = '';
const idp = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    idpHits++;
    const body = JSON.parse(raw || '{}');
    const method = (/accounts:(\w+)/.exec(req.url) || [])[1];
    const say = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const no = (m) => say(400, { error: { code: 400, message: m } });
    if (idpRefuse) return no(idpRefuse);
    if (method === 'signUp') {
      if (idpUsers.has(body.email)) return no('EMAIL_EXISTS');
      const u = { localId: `fb-${idpUsers.size + 1}`, email: body.email, password: body.password, displayName: '' };
      idpUsers.set(body.email, u);
      return say(200, { localId: u.localId, idToken: `tok:${body.email}` });
    }
    if (method === 'signInWithPassword') {
      const u = idpUsers.get(body.email);
      if (!u || u.password !== body.password) return no('INVALID_LOGIN_CREDENTIALS');
      return say(200, { localId: u.localId, idToken: `tok:${body.email}` });
    }
    if (method === 'update') {
      const u = idpUsers.get(String(body.idToken).replace(/^tok:/, ''));
      if (!u) return no('INVALID_ID_TOKEN');
      u.displayName = body.displayName;
      return say(200, { localId: u.localId });
    }
    return no('UNKNOWN');
  });
});
await new Promise((r) => idp.listen(0, '127.0.0.1', r));
process.env.SITE_AUTH_IDP_URL = `http://127.0.0.1:${idp.address().port}/v1`;

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

  // THE 2026-10-08 LOSS: the uid's own link had landed on an EMPTY account
  // (a name picked on a sign-in that found nothing), and it was looked at
  // first, so Google and Discord both opened it while the drawings sat under
  // the old name. Now the account with drawings wins, the other is offered,
  // and nothing is moved or rewritten.
  const tDraw = (await store.identify({ provider: 'google', pid: 'g-draw', email: 'd@x.y', verified: true })).ticket;
  await store.claim(tDraw, 'drawer');
  const PNG = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');
  const JPG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]).toString('base64');
  await store.putCanvas('drawer', { id: 'cdraw1', title: 'Mine', bg: {}, created: 1, ts: 1, png: PNG, thumb: JPG });
  const tEmpty = (await store.identifySite({ uid: 'site-loss', linked: [] })).ticket;
  await store.claim(tEmpty, 'blankslate');
  ok((await store.identifySite({ uid: 'site-loss', linked: [] })).handle === 'blankslate', 'set-up: the uid is linked to an empty account');
  const tDisc = (await store.identify({ provider: 'discord', pid: 'd-loss', email: '', verified: false })).ticket;
  await store.claim(tDisc, 'discblank');
  const viaG = await store.identifySite({ uid: 'site-loss', linked: ['google-g-draw', 'discord-d-loss'], provider: 'google.com' });
  ok(viaG.handle === 'drawer', `Google opens the account with the drawings (${viaG.handle})`);
  ok((viaG.others || []).map((o) => o.handle).sort().join() === 'blankslate,discblank' && viaG.others.every((o) => !!o.token),
    `and offers the others, each with a token (${(viaG.others || []).map((o) => o.handle).join(', ')})`);
  const viaD = await store.identifySite({ uid: 'site-loss', linked: ['google-g-draw', 'discord-d-loss'], provider: 'oidc.discord' });
  ok(viaD.handle === 'drawer', `Discord, whose own account is empty, opens the drawings too (${viaD.handle})`);
  ok((await store.listCanvases('drawer')).length === 1 && (await store.listCanvases('blankslate')).length === 0, 'nothing was moved between accounts');
  // Two accounts that both have drawings: each provider keeps its own.
  await store.putCanvas('discblank', { id: 'cdisc1', title: 'Disc', bg: {}, created: 1, ts: 1, png: PNG, thumb: JPG });
  const viaD2 = await store.identifySite({ uid: 'site-loss', linked: ['google-g-draw', 'discord-d-loss'], provider: 'oidc.discord' });
  ok(viaD2.handle === 'discblank', `with drawings in both, Discord opens the Discord account (${viaD2.handle})`);
  const viaG2 = await store.identifySite({ uid: 'site-loss', linked: ['google-g-draw', 'discord-d-loss'], provider: 'google.com' });
  ok(viaG2.handle === 'drawer', `and Google the Google one (${viaG2.handle})`);

  // FRESH: only the call that MADE an account says so; that alone lets the
  // app move a device's signed-out canvases in (Dex, 2026-10-08).
  const fT = (await store.identify({ provider: 'google', pid: 'g-fresh', email: 'f@x.y', verified: true })).ticket;
  const f1 = await store.claim(fT, 'freshling');
  ok(f1.fresh === true, 'a claim that makes the account is fresh');
  const f2 = await store.claim(fT, 'freshling2');
  ok(f2.handle === 'freshling' && !f2.fresh, `the same ticket again is the same account and NOT fresh (${JSON.stringify({ h: f2.handle, fresh: f2.fresh })})`);
  ok(!(await store.identify({ provider: 'google', pid: 'g-fresh' })).fresh, 'a Google sign-in to it is not fresh');
  ok(!(await store.identifySite({ uid: 'site-fresh', linked: ['google-g-fresh'], provider: 'google.com' })).fresh, 'nor a site sign-in to it');
  ok((await store.signup('pw_fresh', 'correct horse')).fresh === true, 'a signup is fresh');
  ok(!(await store.login('pw_fresh', 'correct horse')).fresh, 'a password sign-in is not');

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

  console.log('3b. a name and password typed into the SITE sign-in');
  /* Dex, 2026-10-09: an Inko name and password "same sign in for
     everything". The site-password action checks them as Inko does and
     answers with the Firebase sign-in that account owns. */
  const pw = await call({ action: 'site-password', handle: 'pw_fresh', password: 'correct horse' });
  const fbUser = pw.body && idpUsers.get(pw.body.email);
  ok(pw.status === 200 && /^inko-[0-9a-f]{24}@accounts\.dexcimino\.com$/.test(pw.body.email || '') && fbUser && fbUser.password === pw.body.password && fbUser.displayName === 'pw_fresh',
    `an Inko name and password get a Firebase sign-in of their own, named after the account (${pw.status}, ${pw.body && pw.body.email})`);
  const viaUid = await store.identifySite({ uid: fbUser && fbUser.localId, linked: [], provider: 'password' });
  ok(viaUid.handle === 'pw_fresh', `and that sign-in opens the SAME Inko account (${viaUid.handle || 'a ticket'})`);
  const usersBefore = idpUsers.size;
  const pw2 = await call({ action: 'site-password', handle: '@PW_Fresh', password: 'correct horse' });
  ok(pw2.status === 200 && pw2.body.email === pw.body.email && pw2.body.password === pw.body.password && idpUsers.size === usersBefore,
    'signing in again (as @PW_Fresh) is the same Firebase user, not a second one');
  const hitsBefore = idpHits;
  const wrong = await call({ action: 'site-password', handle: 'pw_fresh', password: 'wrong horse' });
  ok(wrong.status === 401 && !wrong.body.email && idpHits === hitsBefore, `a wrong password is a 401 and never reaches Firebase (${wrong.status})`);
  const gOnly = await call({ action: 'site-password', handle: 'oldtimer', password: 'anything at all' });
  ok(gOnly.status === 401 && /Google or Discord/.test(gOnly.body.error || ''), `an account with no password says how it signs in (${gOnly.body.error})`);
  const made = await call({ action: 'site-password', handle: 'site_made', password: 'a long password', create: true });
  const madeUser = made.body && idpUsers.get(made.body.email);
  ok(made.status === 200 && madeUser && madeUser.email !== pw.body.email && (await store.login('site_made', 'a long password')).handle === 'site_made',
    'Create account makes the Inko account AND its Firebase sign-in, at a different address');
  ok((await store.identifySite({ uid: madeUser && madeUser.localId, linked: [], provider: 'password' })).handle === 'site_made', 'and that sign-in opens it in Inko');
  const taken = await call({ action: 'site-password', handle: 'site_made', password: 'another password', create: true });
  ok(taken.status === 409 && idpUsers.size === usersBefore + 1, `creating a name that is taken is refused and makes nothing (${taken.status})`);
  const rawRecord = JSON.stringify(await store.io.readJson('sketch/users/pw_fresh.json'));
  ok(rawRecord.includes(pw.body.email) && !rawRecord.includes(pw.body.password), 'the record keeps the address but never the password that signs in to it');
  const moved = await store.rename('pw_fresh', 'pw_moved');
  const afterMove = await call({ action: 'site-password', handle: 'pw_moved', password: 'correct horse' });
  ok(moved.handle === 'pw_moved' && afterMove.status === 200 && afterMove.body.email === pw.body.email && fbUser.displayName === 'pw_moved'
    && (await store.identifySite({ uid: fbUser.localId, linked: [], provider: 'password' })).handle === 'pw_moved',
    'a rename keeps the same Firebase sign-in, renames it, and it opens the renamed account');
  idpRefuse = 'OPERATION_NOT_ALLOWED';
  const off = await call({ action: 'site-password', handle: 'pw_moved', password: 'correct horse' });
  idpRefuse = '';
  ok(off.status === 503 && /not switched on/.test(off.body.error || ''), `Firebase refusing password accounts says so (${off.status})`);

  console.log('4. the DEXDC notes, opened by Dex\u2019s account');
  process.env.NOTES_PASSWORD = 'check-password';
  const notesStore = require(join(ROOT, 'lib', 'notes-store.js'));
  const unlock = require(join(ROOT, 'api', 'notes', 'unlock.js'));
  const saveH = require(join(ROOT, 'api', 'notes', 'save.js'));
  const route = (h, body) => new Promise((done) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(code) { this.statusCode = code; return this; }, json(o) { done({ status: this.statusCode, body: o }); return this; } };
    h({ method: 'POST', body, headers: {} }, res);
  });
  const FIXTURE = { v: 1, active: 's1', sessions: [{ id: 's1', title: 'DEXDC fixture', cats: [] }] };
  const first = await notesStore.writeNotes(FIXTURE, undefined, Date.now(), 'private');
  const owner = (extra = {}, provider = 'google.com') => token({ sub: 'site-dex', email: 'dexdcimino@gmail.com', email_verified: true,
    firebase: { identities: { 'google.com': ['g-dex'] }, sign_in_provider: provider }, ...extra });
  const opened = await route(unlock, { idToken: owner() });
  ok(opened.status === 200 && opened.body.content && opened.body.content.sessions[0].title === 'DEXDC fixture' && opened.body.rev === first.rev,
    `Dex's Google opens the DEXDC document itself, at its rev (${opened.status}, rev ${opened.body.rev})`);
  const saved = await route(saveH, { token: opened.body.token, doc: { ...FIXTURE, sessions: [{ id: 's1', title: 'edited on the phone', cats: [] }] }, baseRev: opened.body.rev });
  ok(saved.status === 200 && saved.body.rev === first.rev + 1, `and the token it hands back saves to it (${saved.status}, rev ${saved.body.rev})`);
  const stale = await route(saveH, { token: opened.body.token, doc: FIXTURE, baseRev: opened.body.rev });
  ok(stale.status === 409 && stale.body.doc.sessions[0].title === 'edited on the phone', 'a save from an older rev is a 409 carrying the newer document, never an overwrite');
  const NOT_DEX = [
    [owner({}, 'github.com'), 403, 'the same address signed in through GitHub'],
    [owner({ email_verified: false }), 403, 'an unverified address'],
    [owner({ email: 'someone@gmail.com' }), 403, 'someone else\u2019s Google'],
    [owner({}).replace(/\.[^.]+$/, '.' + Buffer.from('forged').toString('base64url')), 401, 'a forged signature'],
    [token({}, { key: evil.privateKey }), 401, 'a token signed by another key'],
  ];
  ok(NOT_DEX.length === 5, `${NOT_DEX.length} accounts that are not Dex`);
  for (const [t, code, what] of NOT_DEX) {
    const r = await route(unlock, { idToken: t });
    ok(r.status === code && !r.body.content && !r.body.token, `refused (${r.status}): ${what}`);
  }
  /* THE PUBLIC CODE IS NOT A WAY IN. 'notes' opens the public page for
     anyone, and a save there used to hand back a PRIVATE token (save.js
     minted the default store), so one save turned it into the DEXDC notes. */
  const pub = await route(unlock, { password: 'notes' });
  const pubSaved = await route(saveH, { token: pub.body.token, doc: { v: 1, active: 'p', sessions: [{ id: 'p', title: 'public page', cats: [] }] }, baseRev: pub.body.rev });
  ok(pubSaved.status === 200 && notesStore.tokenOk(pubSaved.body.token) === 'public', `a save in the public notes hands back a PUBLIC token (${notesStore.tokenOk(pubSaved.body.token)})`);
  const viaPub = await route(unlock, { token: pubSaved.body.token });
  ok(viaPub.status === 200 && viaPub.body.content.sessions[0].title === 'public page', 'and that token opens the public page, not the DEXDC notes');
  const still = await notesStore.readNotes('private');
  ok(still.rev === first.rev + 1 && still.content.sessions[0].title === 'edited on the phone', 'and the DEXDC notes are exactly as the one real save left them');
} finally {
  certs.close();
  idp.close();
  await rm(SCRATCH, { recursive: true, force: true });
}

const EXPECT = 71;
ok(passed + failed === EXPECT, `ran ${passed + failed} checks, expected ${EXPECT}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
