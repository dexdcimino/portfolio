/* POST /api/notes/unlock  { password | token }
 *                      ->  { content, format, rev, savedAt, token, seeded }
 *
 * The only door. Nothing about the notes -- not the text, not its length, not
 * whether anything has ever been saved -- comes back before the password is
 * checked, which is the point of doing this server-side rather than the way the
 * Idea Vault on the same page does it.
 *
 * A wrong password gets one word and nothing else. No "no notes yet", no byte
 * count, no timing difference worth measuring: the scrypt in passwordOk() runs
 * to completion either way.
 *
 * `format` is 'json' for the live document and 'html' for the one the
 * pre-rebuild overlay wrote, which the client migrates on first open. The
 * server never converts: it has no DOM, and the client is the only thing that
 * can parse that HTML the way the browser that wrote it did.
 */

'use strict';

const store = require('../../lib/notes-store.js');
const owner = require('../../lib/owner-auth.js');

module.exports = async function handler(req, res) {
  // The keypad is on dexcimino.com and this is same-origin. No CORS headers on
  // purpose: another site should not be able to ask this anything at all.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const missing = store.configError();
  if (missing) {
    // Says what to do, to the operator, and still tells the visitor nothing:
    // this only ever fires on a deploy that has not been finished.
    console.error('notes/unlock: ' + missing);
    return res.status(503).json({ error: 'notes storage is not configured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }

  /* TWO WAYS IN, and they are not equivalent. A password is what a person
   * types; a token is a session that password already opened, presented again
   * after a refresh so the overlay does not demand the password every time the
   * page reloads. The token proves nothing new -- it is an HMAC this server
   * minted, over an expiry it also set -- so accepting it here grants exactly
   * what the original unlock granted and no more.
   *
   * Checked in this order deliberately: a request carrying both is treated as
   * a password attempt, so a stale token can never mask a wrong password.
   */
  /* THREE WAYS IN: password (legacy), session token (legacy), or universal
     JWT from DexAuth. The JWT is preferred for new clients. */
  /* AND A FOURTH: the site account. A Firebase ID token for Dex's own Google
     account (identity.isOwner) opens the SAME store the keypad does -- the
     DexNote phone app and /dexnote/ signed in as Dex are the DEXDC notes, not
     a copy of them -- so there is one document and the rev check that already
     merges two devices covers this one too. Any other account is refused
     with 403, which the client reads as "this account keeps its own notes in
     Firebase"; a token that does not verify is a 401 like every other wrong
     answer here. */
  /* AND SINCE 2026-10-08 NO CODE OPENS THE DEXDC NOTES AT ALL. Dex: signed
     in as him is admin everywhere, and DEXDC "will no more". The private
     store opens for his own Google (the idToken above, lib/owner-auth.js), a
     DexAuth token minted for that sign-in, or a session token one of those
     opened; a password only ever reaches the public page ('notes'). The
     notes themselves are untouched -- the same store, the same bytes. */
  let storeId = null;
  if (body && typeof body.password === 'string') {
    storeId = await store.whichStore(body.password);
  } else if (body && typeof body.idToken === 'string' && body.idToken) {
    const who = await owner.ownerOf(body.idToken);
    if (who === 'unverifiable') return res.status(502).json({ error: 'could not verify the sign-in' });
    if (who === 'not-owner') return res.status(403).json({ error: 'not linked' });
    if (who === 'owner') storeId = 'private';
  } else if (body && typeof body.jwt === 'string' && body.jwt) {
    if (owner.adminOk(body.jwt)) storeId = 'private';
  } else if (body && body.token) {
    storeId = store.tokenOk(body.token);
  }

  if (!storeId) {
    return res.status(401).json({ error: 'wrong' });
  }

  try {
    const { content, format, rev, savedAt, seeded } = await store.readNotes(storeId);
    return res.status(200).json({
      content,
      format,
      rev,
      // Null rather than a made-up timestamp: the seed has never been saved,
      // and saying otherwise would put a save time on the screen that no save
      // produced.
      savedAt: savedAt || null,
      seeded: !!seeded,
      token: store.mintToken(storeId),
    });
  } catch (err) {
    /* Names the failure, because by here the password has ALREADY been checked
       -- this is only ever reachable by Dex. "could not read the notes" on its
       own sent a session to the Vercel logs to find a TypeError it could have
       been told about; the overlay shows this on the keypad. */
    console.error('notes/unlock: read failed', err);
    return res.status(502).json({
      error: 'could not read the notes',
      detail: `${(err && err.name) || 'Error'}: ${(err && err.message) || ''}`.slice(0, 200),
    });
  }
};
