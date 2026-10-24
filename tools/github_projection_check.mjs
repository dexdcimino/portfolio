/* The GitHub projection: person() files the GitHub account in a token,
 * not just Google and Discord -- and, since the NS-1 correction, files
 * NOTHING that is not on its explicit approved list.
 *
 *   node tools/github_projection_check.mjs
 *
 * A companion to tools/site_account_check.mjs, in its pattern: no browser
 * and no network. A local server stands in for Google's published
 * certificates (SITE_AUTH_CERTS_URL) and the check signs its own
 * Firebase-shaped ID tokens, runs them through lib/site-identity.js
 * verify(), and reads person().linked off the verified claims.
 *
 * What is pinned down here:
 *   1. A GitHub sign-in projects github-<id> (the gap this fixes: Inko's
 *      account finding was blind to GitHub sign-ins because linked never
 *      carried them).
 *   2. Google-only and Google+Discord tokens project EXACTLY what they
 *      projected before the fix -- the regression cases.
 *   3. The filing list is EXPLICIT and closed: only google.com, oidc.discord
 *      and github.com file, under google-, discord- and github-. Those
 *      names are trusted namespaces (a store matches on them to open an
 *      account), so no name is ever inferred from a provider id's shape:
 *      oidc.google is not google.com, and another provider's subject must
 *      never walk into a trusted namespace on the strength of the token's
 *      signature. Every other provider id -- facebook.com, oidc.customthing,
 *      ids with no dot (email, phone) -- is omitted from linked entirely.
 *      The collision cases at the end of this check pin that down.
 *   4. A malformed identities claim -- missing, a string, null, values
 *      that are not arrays of one non-empty string -- projects nothing
 *      for that provider and NEVER throws: person() reads tokens, and a
 *      token that verified is not a reason to fall over.
 *
 * FALSELY PASSES IF: the certificate server was never asked. It counts
 * its requests and the run asserts it served at least one.
 */
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
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
const fb = (ids, provider, extra = {}) => ({ firebase: { identities: ids, sign_in_provider: provider }, ...extra });
const linkedOf = async (claims) => site.person(await site.verify(token(claims))).linked;
const same = (a, b) => a.join('\n') === b.join('\n');

try {
  console.log('1. the projection');
  const gh = site.person(await site.verify(token(fb({ 'github.com': ['424242'] }, 'github.com'))));
  ok(same(gh.linked, ['github-424242']), `a GitHub sign-in projects its account (${gh.linked.join(', ')})`);
  ok(gh.provider === 'github.com' && gh.uid === 'uid-default', 'and the rest of person() is untouched by it');

  const all = await linkedOf(fb({ 'google.com': ['g-1'], 'oidc.discord': ['d-2'], 'github.com': ['gh-3'], email: ['a@b.c'] }, 'google.com'));
  ok(same(all, ['google-g-1', 'discord-d-2', 'github-gh-3']), `all three providers project, in the order consumers have always seen (${all.join(', ')})`);

  const gOnly = await linkedOf(fb({ 'google.com': ['g-111'] }, 'google.com'));
  ok(same(gOnly, ['google-g-111']), 'REGRESSION: a Google-only token projects exactly what it did before');

  const gd = site.person(await site.verify(token(fb({ 'google.com': ['g-111'], 'oidc.discord': ['d-222'], email: ['a@b.c'] }, 'google.com',
    { sub: 'u1', email: 'a@b.c', email_verified: true, name: 'Ann B' }))));
  ok(same(gd.linked, ['google-g-111', 'discord-d-222']), 'REGRESSION: Google+Discord (with an email identity riding along) projects exactly what it did before');
  ok(gd.uid === 'u1' && gd.email === 'a@b.c' && gd.verified === true && gd.provider === 'google.com' && gd.name === 'Ann B',
    'and person() still returns uid, email, verified, provider and name as before');

  const scrambled = await linkedOf(fb({ 'github.com': ['gh-3'], 'google.com': ['g-1'], 'oidc.discord': ['d-2'] }, 'github.com'));
  ok(same(scrambled, ['google-g-1', 'discord-d-2', 'github-gh-3']),
    `the order is stable however the token ordered its identities (${scrambled.join(', ')})`);

  console.log('2. malformed identities: nothing projected, nothing thrown');
  const MALFORMED = [
    [{ sub: 'u-m1' }, 'no firebase claim at all'],
    [fb(undefined, 'google.com'), 'firebase with no identities'],
    [fb('garbage', 'google.com'), 'identities is a string'],
    [fb(null, 'google.com'), 'identities is null'],
    [fb({ 'github.com': 'not-an-array' }, 'github.com'), 'a GitHub value that is not an array'],
    [fb({ 'github.com': [] }, 'github.com'), 'a GitHub value that is an empty array'],
    [fb({ 'github.com': [123] }, 'github.com'), 'a GitHub value whose first entry is not a string'],
    [fb({ 'github.com': [''] }, 'github.com'), 'a GitHub value whose first entry is empty'],
  ];
  ok(MALFORMED.length === 8, `${MALFORMED.length} malformed cases`);
  for (const [claims, what] of MALFORMED) {
    let out = null, threw = false;
    try { out = await linkedOf(claims); } catch { threw = true; }
    ok(!threw && out !== null && out.length === 0, `projects nothing and does not throw: ${what}`);
  }
  ok(certHits >= 1, `the certificate server was asked (${certHits} time(s), cached after)`);

  console.log('3. namespace collisions: unlisted providers project nothing');
  // The identities below all sit under provider ids whose SHAPE points at
  // a trusted namespace. None of them is that provider: oidc.google is
  // not google.com, saml.github is not github.com, and a first label of
  // "google" in someone else's domain is not an identity. The value
  // 424242 is a real GitHub id in this check's world, so if any of these
  // projected, it would land on an actual account.
  const COLLISIONS = [
    [fb({ 'oidc.google': ['g-111'] }, 'oidc.google'), 'an OIDC provider named google'],
    [fb({ 'oidc.github': ['424242'] }, 'oidc.github'), 'an OIDC provider named github, carrying a real GitHub id'],
    [fb({ 'saml.github': ['424242'] }, 'saml.github'), 'a SAML provider named github, carrying a real GitHub id'],
    [fb({ 'oidc.firebase': ['uid-9'] }, 'oidc.firebase'), 'an OIDC provider named firebase, carrying a Firebase-looking uid'],
    [fb({ 'google.evil.com': ['g-111'] }, 'google.evil.com'), 'a domain whose first label is google'],
    [fb({ 'oidc.customthing': ['424242'] }, 'oidc.customthing'), 'an unknown provider carrying a real GitHub id'],
  ];
  ok(COLLISIONS.length === 6, `${COLLISIONS.length} collision cases`);
  for (const [claims, what] of COLLISIONS) {
    const out = await linkedOf(claims);
    ok(out.length === 0, `projects nothing at all: ${what} (${out.join(', ') || 'empty'})`);
  }

  const mixed = await linkedOf(fb({ 'github.com': ['424242'], 'oidc.github': ['424242'] }, 'github.com'));
  ok(same(mixed, ['github-424242']), `a real GitHub identity beside its oidc.github impostor projects exactly the true one (${mixed.join(', ')})`);

  const gImpostor = await linkedOf(fb({ 'google.com': ['g-1'], 'oidc.google': ['g-1'] }, 'google.com'));
  ok(same(gImpostor, ['google-g-1']), `a real Google identity beside its oidc.google impostor projects exactly the true one (${gImpostor.join(', ')})`);
} finally {
  certs.close();
}

const EXPECT = 26;
ok(passed + failed === EXPECT, `ran ${passed + failed} checks, expected ${EXPECT}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
