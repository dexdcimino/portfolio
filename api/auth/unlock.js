/* POST /api/auth/unlock  { idToken }  ->  { token, tier, expiresIn }

   The universal admin token (DexAuth): one token that music editing, Inko
   moderation and Mission Control's private half (dexdcimino/work) all accept.

   Since 2026-10-08 it is minted for ONE thing: a Firebase ID token for Dex's
   own Google account (lib/owner-auth.js). Dex: signed in as him is admin
   everywhere, automatically, and the DEXDC code is no more -- so no code is
   read here at all, and a `password` in the body changes nothing. The page
   asks for this the moment it sees Dex signed in (script.js dexOwnerCheck). */
'use strict';

const owner = require('../../lib/owner-auth.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const { idToken } = body || {};

  if (!process.env.AUTH_SECRET) {
    return res.status(500).json({ error: 'Auth not configured' });
  }

  const who = await owner.ownerOf(idToken);
  if (who === 'unverifiable') return res.status(502).json({ error: 'could not verify the sign-in' });
  if (who === 'not-owner') return res.status(403).json({ error: 'not the owner' });
  if (who !== 'owner') return res.status(401).json({ error: 'sign in' });

  return res.status(200).json(owner.mintAdmin());
};
