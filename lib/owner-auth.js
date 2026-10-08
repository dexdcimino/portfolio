/* Admin on dexcimino.com is Dex SIGNED IN. Nothing else.
 *
 * Every admin door on the site -- the DEXDC notes, the universal DexAuth token
 * (music editing, Inko moderation, Mission Control's private half) and the
 * TUNES editor -- used to open on a code alone, so anyone who guessed five
 * letters was Dex. Dex, 2026-10-08: "being signed in on my account
 * automatically gives me permissions everywhere ... dexdc will no more." So
 * every one of those doors asks this module, and the answer comes from a
 * Firebase ID token verified on the server (lib/site-identity.js), never from
 * anything the page says and never from a code.
 *
 * Everything this server mints for admin carries `owner`, and every check
 * refuses a token without it -- which retires, on deploy, every token a bare
 * code minted before this existed.
 */
'use strict';

const crypto = require('node:crypto');
const identity = require('./site-identity.js');

/* 'owner' | 'signed-out' | 'not-owner' | 'unverifiable'. Never throws: an
   outage at Google's certificate server is a refusal, not a way in. */
async function ownerOf(idToken) {
  if (typeof idToken !== 'string' || !idToken) return 'signed-out';
  let who;
  try { who = identity.person(await identity.verify(idToken)); }
  catch (err) {
    if (err instanceof identity.Invalid) return 'signed-out';
    console.error('owner-auth: could not verify the sign-in', err);
    return 'unverifiable';
  }
  return identity.isOwner(who) ? 'owner' : 'not-owner';
}

/* ---- the DexAuth token -------------------------------------------------- */

const b64u = (s) => Buffer.from(s).toString('base64url');
const TTL = 24 * 60 * 60;

function mintAdmin(secret = process.env.AUTH_SECRET, now = Date.now()) {
  const t = Math.floor(now / 1000);
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ tier: 'admin', owner: true, iat: t, exp: t + TTL }));
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return { token: `${head}.${body}.${sig}`, tier: 'admin', expiresIn: TTL };
}

/* The payload of a live admin token minted behind the owner check, else null. */
function adminOk(jwt, secret = process.env.AUTH_SECRET, now = Date.now()) {
  if (!secret || typeof jwt !== 'string' || jwt.length > 2048) return null;
  const [h, b, s] = jwt.split('.');
  if (!h || !b || !s) return null;
  const want = Buffer.from(crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url'));
  const got = Buffer.from(s);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(b, 'base64url').toString()); } catch { return null; }
  if (!p || p.tier !== 'admin' || p.owner !== true) return null;
  if (!p.exp || p.exp <= Math.floor(now / 1000)) return null;
  return p;
}

module.exports = { ownerOf, mintAdmin, adminOk, TTL };
