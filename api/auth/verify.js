/* Shared JWT verification utility.
   Import this in any API route that needs to check edit permissions:
   
   import { verifyJWT } from './verify.js';
   const payload = verifyJWT(token, process.env.AUTH_SECRET);
   if (!payload || payload.tier !== 'admin') return res.status(401).json(...);
*/
import { createHmac, timingSafeEqual } from 'crypto';

function base64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString();
}

export function verifyJWT(token, secret) {
  if (!token || !secret || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  try {
    const expectedSig = createHmac('sha256', secret)
      .update(header + '.' + body)
      .digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const payload = JSON.parse(base64urlDecode(body));
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) return null;
    if (!payload.tier) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

export function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

/* GET /api/auth/verify  (Authorization: Bearer <DexAuth JWT>)
     -> 200 { ok: true, tier, exp }  or  401 { ok: false }

   For apps that live on another deployment and so do not hold AUTH_SECRET --
   Mission Control (the work overlay, dexdcimino/work) asks here before it
   hands out its private half. It says only whether a token this site minted
   is still good; it grants nothing a token did not already grant. */
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false });
  }
  const payload = verifyJWT(getBearerToken(req), process.env.AUTH_SECRET);
  if (!payload) return res.status(401).json({ ok: false });
  return res.status(200).json({ ok: true, tier: payload.tier, exp: payload.exp });
}
