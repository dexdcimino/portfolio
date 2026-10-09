/* The site's one account, checked on the server.
 *
 * Every app on dexcimino.com signs in through the same Firebase project
 * (dexnote-d7047, the one dexnote.dev already used), in the browser, with
 * /account/site-auth.js. An app whose data lives on THIS server rather than in
 * Firebase -- Inko's gallery is the first -- is handed the account's Firebase
 * ID token and asks this module who it belongs to.
 *
 * An ID token is a JWT signed RS256 by Google. Verifying one needs no secret
 * and no Admin SDK: the public certificates are published, rotated, and carry
 * their own Cache-Control, which is how long they are kept here. What is
 * checked is what Firebase documents for "verify ID tokens using a third-party
 * JWT library": alg, kid, signature, aud, iss, exp, iat, auth_time and sub.
 *
 * SITE_AUTH_CERTS_URL / SITE_AUTH_PROJECT point it elsewhere for the check,
 * which signs its own tokens; nothing on a deploy sets them.
 */
'use strict';

const crypto = require('node:crypto');

const PROJECT = () => process.env.SITE_AUTH_PROJECT || 'dexnote-d7047';
const CERTS_URL = () => process.env.SITE_AUTH_CERTS_URL
  || 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const SKEW = 300;          // seconds of clock difference forgiven on iat/auth_time

let cached = { certs: null, until: 0, url: '' };

async function certs(now = Date.now()) {
  const url = CERTS_URL();
  if (cached.certs && cached.url === url && now < cached.until) return cached.certs;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`certificates ${r.status}`);
  const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  cached = { certs: await r.json(), until: now + (m ? Number(m[1]) : 3600) * 1000, url };
  return cached.certs;
}

class Invalid extends Error {}

const part = (s) => { try { return JSON.parse(Buffer.from(s, 'base64url').toString()); } catch { return null; } };

/* The token's claims if it is a live sign-in to this project, else throws
   Invalid. Never returns a half-checked token. */
async function verify(idToken, now = Date.now()) {
  const bits = typeof idToken === 'string' ? idToken.split('.') : [];
  if (bits.length !== 3) throw new Invalid('not a token');
  const [h, p, s] = bits;
  const head = part(h), claims = part(p);
  if (!head || !claims) throw new Invalid('not a token');
  if (head.alg !== 'RS256') throw new Invalid('wrong algorithm');
  const all = await certs(now);
  const pem = head.kid && Object.prototype.hasOwnProperty.call(all, head.kid) ? all[head.kid] : null;
  if (!pem) throw new Invalid('unknown key');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), crypto.createPublicKey(pem), Buffer.from(s, 'base64url'));
  if (!ok) throw new Invalid('bad signature');
  const t = Math.floor(now / 1000);
  if (claims.aud !== PROJECT()) throw new Invalid('wrong project');
  if (claims.iss !== `https://securetoken.google.com/${PROJECT()}`) throw new Invalid('wrong issuer');
  if (!(claims.exp > t)) throw new Invalid('expired');
  if (!(claims.iat <= t + SKEW)) throw new Invalid('issued in the future');
  if (!(claims.auth_time <= t + SKEW)) throw new Invalid('signed in in the future');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) throw new Invalid('no subject');
  return claims;
}

/* Who the claims are, in the shape the apps' stores link on:
     uid        the site account, the one id everything hangs off
     linked     the provider accounts it signed in with, as "<provider>-<id>"
                in the names Inko already filed them under (google, discord),
                so an account made before the site account existed is found */
function person(claims) {
  const ids = (claims.firebase && claims.firebase.identities) || {};
  const first = (k) => (Array.isArray(ids[k]) && ids[k].length ? String(ids[k][0]) : null);
  const linked = [];
  if (first('google.com')) linked.push(`google-${first('google.com')}`);
  if (first('oidc.discord')) linked.push(`discord-${first('oidc.discord')}`);
  return {
    uid: claims.sub,
    linked,
    email: claims.email || '',
    verified: claims.email_verified === true,
    provider: (claims.firebase && claims.firebase.sign_in_provider) || '',
    name: claims.name || '',
  };
}

/* Whether this person is Dex, for the notes behind the keypad (DEXDC).
   Google only, and only the verified address: Google is the provider that
   proves the address belongs to whoever signed in, so a GitHub or Discord
   account carrying the same email -- which another person could register --
   opens nothing. The same address sketch-store.js reserves @dex for. */
const OWNER_EMAIL = 'dexdcimino@gmail.com';
function isOwner(p) {
  return !!p && p.provider === 'google.com' && p.verified === true
    && String(p.email || '').toLowerCase() === OWNER_EMAIL;
}

/* Firebase's own sign-in API, called from the server for the one thing the
   browser cannot be trusted to do: give a name-and-password account (Inko's
   kind) a site account of its own (lib/sketch-store.js siteBridge). The key
   is the public web key in account/site-auth.js; nothing here needs a secret.
   SITE_AUTH_IDP_URL points it at a stand-in for the check. Fails with the
   message Firebase answered (EMAIL_EXISTS, INVALID_LOGIN_CREDENTIALS, ...) in
   err.code. */
const IDP_URL = () => process.env.SITE_AUTH_IDP_URL || 'https://identitytoolkit.googleapis.com/v1';
const WEB_KEY = () => process.env.SITE_AUTH_WEB_KEY || 'AIzaSyCU7xuhuILTkbdcP-E2qBH3EnNKT_eWTjA';
async function idp(method, body) {
  const r = await fetch(`${IDP_URL()}/accounts:${method}?key=${encodeURIComponent(WEB_KEY())}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Referer: 'https://dexcimino.com/' },
    body: JSON.stringify(body),
  });
  let j = null;
  try { j = await r.json(); } catch { /* said below */ }
  if (!r.ok || !j) {
    const code = String((j && j.error && j.error.message) || `HTTP ${r.status}`).split(' ')[0];
    throw Object.assign(new Error(`account service: ${code}`), { code });
  }
  return j;
}

module.exports = { verify, person, isOwner, idp, OWNER_EMAIL, Invalid, _reset: () => { cached = { certs: null, until: 0, url: '' }; } };
