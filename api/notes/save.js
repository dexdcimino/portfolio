/* POST /api/notes/save  { token, doc, baseRev }
 *                    ->  200 { rev, savedAt, backups, daily, token }
 *                    ->  409 { conflict, rev, savedAt, doc }
 *
 * Autosave lands here a second or two after the last keystroke, so it does the
 * least it can: verify the token (an HMAC check, no storage round trip), check
 * the rev, write the document, and keep the backup tiers in step.
 *
 * A 409 is not an error to the client. It means another device saved first,
 * and the current document rides along so the client can merge and try again
 * on the new rev -- rather than what used to happen, which was the later save
 * silently winning the whole document.
 *
 * A FRESH TOKEN COMES BACK on every save. Sessions last eight hours, and
 * without renewal a tab left open across a working day would hit the wall
 * mid-sentence and drop its owner back to the keypad with unsaved text on
 * screen. Renewing on save means the clock only runs while nothing is being
 * written, which is the thing an idle timeout is actually for.
 */

'use strict';

const store = require('../../lib/notes-store.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const missing = store.configError();
  if (missing) {
    console.error('notes/save: ' + missing);
    return res.status(503).json({ error: 'notes storage is not configured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || !store.tokenOk(body.token)) {
    // 401 rather than 403: the client's answer is to ask for the password
    // again, which is what an expired session needs it to do.
    return res.status(401).json({ error: 'session expired' });
  }
  if (!body.doc || typeof body.doc !== 'object' || Array.isArray(body.doc)) {
    return res.status(400).json({ error: 'doc must be an object' });
  }
  const baseRev = body.baseRev === undefined || body.baseRev === null
    ? undefined
    : Number(body.baseRev);
  if (baseRev !== undefined && !Number.isInteger(baseRev)) {
    return res.status(400).json({ error: 'baseRev must be an integer' });
  }

  try {
    const result = await store.writeNotes(body.doc, baseRev);
    if (result.conflict) {
      return res.status(409).json({
        conflict: true, rev: result.rev, savedAt: result.savedAt, doc: result.doc,
      });
    }
    return res.status(200).json({ ...result, token: store.mintToken() });
  } catch (err) {
    if (err && err.tooLarge) {
      return res.status(413).json({ error: err.message });
    }
    // Never a 200 on a failed write. The editor shows whatever this says, and
    // "saved" over a save that did not happen is the one lie that costs work.
    console.error('notes/save: write failed', err);
    return res.status(502).json({ error: 'could not save' });
  }
};
