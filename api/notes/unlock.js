/* POST /api/notes/unlock  { password }  ->  { content, token, savedAt }
 *
 * The only door. Nothing about the notes -- not the text, not its length, not
 * whether anything has ever been saved -- comes back before the password is
 * checked, which is the point of doing this server-side rather than the way the
 * Idea Vault on the same page does it.
 *
 * A wrong password gets one word and nothing else. No "no notes yet", no byte
 * count, no timing difference worth measuring: the scrypt in passwordOk() runs
 * to completion either way.
 */

'use strict';

const store = require('../../lib/notes-store.js');

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
  const ok = (body && typeof body.password === 'string')
    ? await store.passwordOk(body.password)
    : !!(body && store.tokenOk(body.token));

  if (!ok) {
    return res.status(401).json({ error: 'wrong' });
  }

  try {
    const { content, seeded } = await store.readNotes();
    return res.status(200).json({
      content,
      token: store.mintToken(),
      // Null rather than a made-up timestamp: the seed has never been saved,
      // and saying otherwise would put a save time on the screen that no save
      // produced.
      savedAt: seeded ? null : undefined,
      seeded,
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
