/* Sign in with Google and Discord, for the sketch gallery.
 *
 *   GET /api/sketch-auth/google      no code  -> off to Google, with a signed state
 *   GET /api/sketch-auth/google?code=...      -> back here; then to /inko/ with
 *                                               #auth=<session>  (an account exists)
 *                                               #claim=<ticket>  (pick a name first)
 *                                               #auth-error=<why>
 * and the same for discord. The session travels in the URL FRAGMENT, which no
 * server -- this one included -- ever receives, and the app removes it the
 * moment it has read it.
 *
 * WHAT THE STATE IS FOR. A callback can only complete a sign-in this server
 * started, from this browser: the state is signed, and its nonce must match a
 * short-lived cookie set when the sign-in began.
 *
 * Credentials are Vercel environment variables, GOOGLE_CLIENT_ID /
 * GOOGLE_CLIENT_SECRET and DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET. Until
 * they exist the buttons say so instead of failing somewhere opaque. The
 * provider URLs can be pointed elsewhere (SKETCH_OAUTH_<P>_*) for the check,
 * which runs a fake provider; nothing on a deploy sets them.
 */
'use strict';

const crypto = require('node:crypto');
const store = require('./sketch-store.js');

const SITE = () => process.env.SKETCH_OAUTH_BASE || 'https://dexcimino.com';
const APP = '/inko/';

const PROVIDERS = {
  google: {
    id: () => process.env.GOOGLE_CLIENT_ID, secret: () => process.env.GOOGLE_CLIENT_SECRET,
    authorize: () => process.env.SKETCH_OAUTH_GOOGLE_AUTHORIZE || 'https://accounts.google.com/o/oauth2/v2/auth',
    token: () => process.env.SKETCH_OAUTH_GOOGLE_TOKEN || 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    async identity(tokens) {
      // The id_token came straight from Google's token endpoint over TLS, which
      // is what OpenID Connect allows to be trusted without re-verifying it.
      const claims = JSON.parse(Buffer.from(String(tokens.id_token || '').split('.')[1] || '', 'base64url').toString() || '{}');
      if (!claims.sub) throw new Error('no subject in the id_token');
      return { provider: 'google', pid: String(claims.sub), email: claims.email || '', verified: claims.email_verified === true,
               suggest: claims.given_name || claims.name || (claims.email || '').split('@')[0] };
    },
  },
  discord: {
    id: () => process.env.DISCORD_CLIENT_ID, secret: () => process.env.DISCORD_CLIENT_SECRET,
    authorize: () => process.env.SKETCH_OAUTH_DISCORD_AUTHORIZE || 'https://discord.com/oauth2/authorize',
    token: () => process.env.SKETCH_OAUTH_DISCORD_TOKEN || 'https://discord.com/api/oauth2/token',
    user: () => process.env.SKETCH_OAUTH_DISCORD_USER || 'https://discord.com/api/users/@me',
    scope: 'identify',
    async identity(tokens) {
      const r = await fetch(PROVIDERS.discord.user(), { headers: { authorization: `Bearer ${tokens.access_token}` } });
      if (!r.ok) throw new Error(`discord user ${r.status}`);
      const u = await r.json();
      if (!u.id) throw new Error('no discord id');
      return { provider: 'discord', pid: String(u.id), email: '', verified: false, suggest: u.username || u.global_name || '' };
    },
  },
};

const redirectUri = (name) => `${SITE()}/api/sketch-auth/${name}`;
const back = (res, fragment) => { res.statusCode = 302; res.setHeader('Location', `${SITE()}${APP}#${fragment}`); res.end(); };
const cookieName = (name) => `sketch_oauth_${name}`;
function readCookie(req, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : null;
}
const suggestName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);

function handlerFor(name) {
  const p = PROVIDERS[name];
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
    if (!p.id() || !p.secret()) return back(res, `auth-error=${name}-not-ready`);

    // ---- the start: off to the provider -----------------------------------
    if (!q.code && !q.error) {
      const nonce = crypto.randomBytes(16).toString('base64url');
      res.setHeader('Set-Cookie', `${cookieName(name)}=${nonce}; Path=/api/sketch-auth; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);
      const url = new URL(p.authorize());
      url.search = new URLSearchParams({ client_id: p.id(), redirect_uri: redirectUri(name), response_type: 'code',
        scope: p.scope, state: store.mintState(name, nonce), prompt: name === 'google' ? 'select_account' : 'consent' }).toString();
      res.statusCode = 302; res.setHeader('Location', url.toString()); return res.end();
    }

    // ---- the return --------------------------------------------------------
    res.setHeader('Set-Cookie', `${cookieName(name)}=; Path=/api/sketch-auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    if (q.error) return back(res, 'auth-error=cancelled');
    const state = store.readState(q.state);
    const nonce = readCookie(req, cookieName(name));
    if (!state || state.p !== name || !nonce || state.n !== nonce) return back(res, 'auth-error=expired');
    try {
      const r = await fetch(p.token(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ code: String(q.code), client_id: p.id(), client_secret: p.secret(),
                                    redirect_uri: redirectUri(name), grant_type: 'authorization_code' }).toString() });
      if (!r.ok) throw new Error(`token ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
      const who = await p.identity(await r.json());
      const result = await store.identify(who);
      if (result.token) return back(res, `auth=${encodeURIComponent(JSON.stringify({ handle: result.handle, token: result.token }))}`);
      return back(res, `claim=${encodeURIComponent(result.ticket)}&suggest=${encodeURIComponent(suggestName(who.suggest))}`);
    } catch (err) {
      console.error(`sketch-auth ${name}:`, err && err.message);
      return back(res, 'auth-error=failed');
    }
  };
}

module.exports = { handlerFor, PROVIDERS, redirectUri };
