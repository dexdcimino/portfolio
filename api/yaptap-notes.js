/* YapTap notes under the SITE account — the one account for the whole
 * dexcimino.com domain. There is no YapTap login: the client signs in
 * through /account/site-auth.js (Firebase, project dexnote-d7047 — the
 * same module Inko, DexNote and MindSplit use, and the session it keeps
 * is on the domain origin, so signing in anywhere signs in everywhere),
 * and this endpoint verifies the Firebase ID token that session hands
 * out with lib/site-identity.js, exactly like api/sketch.js's 'site'
 * action and the DexNote vault do. Notes live with the rest of the
 * site's per-user data, in the same Vercel Blob store, keyed by the
 * verified uid: yaptap/users/<uid>.json (lib/yaptap-store.js).
 *
 *   POST /api/yaptap-notes { action, idToken, ... }
 *     pull   { idToken }                        -> { notes, deleted }
 *     push   { idToken, notes, deleted }        -> { notes, deleted }  the
 *            merged canonical notebook: the client's document is merged
 *            into the stored one (lib/yaptap-merge.js) and the result is
 *            both saved and returned, so one round trip syncs both ways.
 *
 * Signed out is a first-class state: the app keeps notes in localStorage
 * and simply never calls this. Nothing here locks a note behind sign-in.
 */
'use strict';

const store = require('../lib/yaptap-store.js');
const site = require('../lib/site-identity.js');

module.exports = async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex');
  const missing = store.configError();
  if (missing) { console.error('yaptap: ' + missing); return res.status(503).json({ error: 'note sync is not configured' }); }

  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'POST' }); }
    res.setHeader('Cache-Control', 'no-store');

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    body = body || {};
    const action = String(body.action || '');

    // The shared session, checked the shared way. No token of our own.
    let claims;
    try { claims = await site.verify(body.idToken); }
    catch (err) {
      if (err instanceof site.Invalid) return res.status(401).json({ error: 'Sign in again' });
      throw err;
    }
    const who = site.person(claims);

    if (action === 'pull') {
      return res.status(200).json(await store.getDoc(who.uid));
    }
    if (action === 'push') {
      // A whole notebook per push, capped so one request stays sane; the
      // shapes themselves are sanitized in the store.
      if (Array.isArray(body.notes) && body.notes.length > 5000) return res.status(413).json({ error: 'too many notes' });
      if (Array.isArray(body.deleted) && body.deleted.length > 5000) return res.status(413).json({ error: 'too many deletions' });
      const merged = await store.mergeInto(who.uid, { notes: body.notes, deleted: body.deleted });
      return res.status(200).json(merged);
    }
    return res.status(400).json({ error: 'pull or push' });
  } catch (err) {
    console.error('yaptap: failed', err);
    return res.status(502).json({ error: 'note sync could not be reached' });
  }
};
