/**
 * Short-lived signed proof of a recent admin-PIN step-up (see
 * functions/api/verify-admin-pin.js). Not a Firebase token — the shop's login
 * is one shared Firebase session (see src/auth.js), so "prove you hold an
 * admin PIN right now" has to be a credential separate from "who is signed
 * in", carried as its own `X-Admin-Elevation` header alongside the normal
 * Bearer ID token on admin-only writes (functions/api/pins.js,
 * functions/api/sales-targets.js, functions/api/delete-deposit.js).
 *
 * HMAC-SHA256 over a tiny JSON payload, keyed by ADMIN_ELEVATION_SECRET (a
 * Cloudflare Pages secret, set the same way STAFF_PINS and
 * SYNC_SHARED_SECRET already are). Expires in 10 minutes — long enough to do
 * a few admin tasks in a row without re-entering the PIN each time, short
 * enough that a token isn't worth much if it leaked.
 */

const TTL_SECONDS = 10 * 60;

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toB64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '=');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Mint a token good for TTL_SECONDS from now. Returns { token, expiresAtMs }. */
export async function signElevation(secret) {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payloadB64 = toB64Url(new TextEncoder().encode(JSON.stringify({ exp })));
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return { token: `${payloadB64}.${toB64Url(new Uint8Array(signature))}`, expiresAtMs: exp * 1000 };
}

/** Verify a token's signature and expiry. Never throws. */
export async function verifyElevation(token, secret) {
  if (!token || typeof token !== 'string') return false;
  const [payloadB64, sigB64] = token.split('.');
  if (!payloadB64 || !sigB64) return false;

  try {
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify('HMAC', key, fromB64Url(sigB64), new TextEncoder().encode(payloadB64));
    if (!valid) return false;

    const payload = JSON.parse(new TextDecoder().decode(fromB64Url(payloadB64)));
    return typeof payload.exp === 'number' && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
