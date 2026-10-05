/* Unified auth: one password (snail) unlocks editing across ALL overlays.
   POST { password } -> { token: JWT } or 401.
   
   The JWT is signed with AUTH_SECRET and contains { tier, iat, exp }.
   Each backend (work, notes, music, future overlays) verifies the signature
   using the shared AUTH_SECRET env var.
   
   To add a new overlay: it just needs to accept this JWT. No new auth code.
   To change the password: update EDIT_PASSWORD_HASH env var (scrypt hash).
   To add tiers later: add another password hash -> different tier in JWT.
*/
import { scryptSync, timingSafeEqual, createHmac } from 'crypto';

const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, KEYLEN = 64;
const SALT = 'dex-universal-v1';
const TOKEN_TTL = 24 * 60 * 60; // 24 hours

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signJWT(payload, secret) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const sig = base64url(createHmac('sha256', secret).update(header + '.' + body).digest());
  return header + '.' + body + '.' + sig;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body || {};
  if (!password || typeof password !== 'string') {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const expectedHash = process.env.EDIT_PASSWORD_HASH;
  const authSecret = process.env.AUTH_SECRET;
  if (!expectedHash || !authSecret) {
    return res.status(500).json({ error: 'Auth not configured' });
  }

  try {
    const hash = scryptSync(password.toLowerCase().trim(), SALT, KEYLEN, {
      N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
    });
    const expected = Buffer.from(expectedHash, 'hex');
    if (hash.length !== expected.length || !timingSafeEqual(hash, expected)) {
      return res.status(401).json({ error: 'Invalid password' });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Auth error' });
  }

  // Valid: issue JWT with admin tier
  const now = Math.floor(Date.now() / 1000);
  const token = signJWT(
    { tier: 'admin', iat: now, exp: now + TOKEN_TTL },
    authSecret
  );

  return res.status(200).json({ token, tier: 'admin', expiresIn: TOKEN_TTL });
}
