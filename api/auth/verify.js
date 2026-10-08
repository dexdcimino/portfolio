/* GET /api/auth/verify  (Authorization: Bearer <DexAuth JWT>)
     -> 200 { ok: true, tier, owner, exp }  or  401 { ok: false }

   For apps that live on another deployment and so do not hold AUTH_SECRET --
   Mission Control (the work overlay, dexdcimino/work) asks here before it
   hands out its private half. It says only whether a token this site minted
   for Dex signed in is still good (lib/owner-auth.js adminOk); it grants
   nothing a token did not already grant. A token minted by a code, before
   admin became Dex signed in, carries no `owner` and is refused. */
'use strict';

const owner = require('../../lib/owner-auth.js');

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false });
  }
  const auth = (req.headers && req.headers.authorization) || '';
  const payload = owner.adminOk(auth.startsWith('Bearer ') ? auth.slice(7) : null);
  if (!payload) return res.status(401).json({ ok: false });
  return res.status(200).json({ ok: true, tier: payload.tier, owner: true, exp: payload.exp });
};
