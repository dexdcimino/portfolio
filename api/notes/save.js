/* POST /api/notes/save  { token, content }  ->  { savedAt, backups, token }
 *
 * Autosave lands here about once a second while Dex is typing, so it does the
 * least it can: verify the token (an HMAC check, no storage round trip), write
 * the document and a timestamped copy, prune the copies past the limit.
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
  if (typeof body.content !== 'string') {
    return res.status(400).json({ error: 'content must be a string' });
  }

  try {
    const { savedAt, backups } = await store.writeNotes(body.content);
    return res.status(200).json({ savedAt, backups, token: store.mintToken() });
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
