/**
 * Verify a Firebase Auth ID token inside a Cloudflare Pages Function.
 *
 * There is no firebase-admin here (Workers isolate), so the RS256 JWT is
 * verified directly with Web Crypto against Google's public signing keys.
 * Only what this app needs is checked: signature, issuer, audience (our
 * Firebase project), and expiry. Returns the token claims on success, or null
 * on any failure — callers treat null as "not authenticated".
 *
 * Public keys come from Google's JWK endpoint (keyed by the token header's
 * `kid`); they rotate, so we fetch fresh each call. At this app's traffic that
 * is negligible, and it avoids caching-staleness bugs.
 */

const JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

function base64UrlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson(b64url) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(b64url)));
}

export async function verifyFirebaseToken(token, projectId) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header;
  let claims;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
  } catch {
    return null;
  }

  if (header.alg !== 'RS256' || !header.kid) return null;

  // Claim checks (Firebase ID token spec).
  const now = Math.floor(Date.now() / 1000);
  const issuer = `https://securetoken.google.com/${projectId}`;
  if (claims.aud !== projectId) return null;
  if (claims.iss !== issuer) return null;
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) return null;
  if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
  if (typeof claims.iat !== 'number' || claims.iat > now + 300) return null;

  // Fetch the matching public key and verify the signature.
  let jwk;
  try {
    const res = await fetch(JWK_URL);
    if (!res.ok) return null;
    const { keys } = await res.json();
    jwk = (keys || []).find((k) => k.kid === header.kid);
  } catch {
    return null;
  }
  if (!jwk) return null;

  let key;
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  } catch {
    return null;
  }

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlToBytes(parts[2]);

  let valid = false;
  try {
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed);
  } catch {
    return null;
  }

  return valid ? claims : null;
}
