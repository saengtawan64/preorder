/**
 * OAuth2 for a Google service account, from a Cloudflare Pages Function.
 *
 * Identical approach to sync-worker/src/google-auth.js (Pages Functions and
 * standalone Workers are separate deploy targets with separate builds, so
 * this small file is duplicated rather than shared across them).
 */

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeString(str) {
  return base64UrlEncode(new TextEncoder().encode(str));
}

function pemToPkcs8(pem) {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function importPrivateKey(pem) {
  return crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/** Sign a JWT with the service account's private key (RS256). */
export async function signJwt(serviceAccount, claims) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const unsigned = `${base64UrlEncodeString(JSON.stringify(header))}.${base64UrlEncodeString(JSON.stringify(claims))}`;

  const key = await importPrivateKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Mint a Firebase Auth custom token.
 *
 * This is what lets the PIN gate stay real authentication: the PIN is checked
 * server-side, and on success the browser gets a token it can exchange for a
 * genuine Firebase session — so firestore.rules still sees `request.auth`, and
 * no credential the client holds can be replayed into one.
 *
 * Signed locally with the service account key, so it needs no extra IAM role.
 */
export async function createFirebaseCustomToken(serviceAccount, uid, claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(serviceAccount, {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    uid,
    iat: now,
    exp: now + 3600, // Firebase caps custom tokens at one hour
    ...(Object.keys(claims).length ? { claims } : {}),
  });
}

/** Exchange a service account key for an OAuth2 access token scoped to `scope`. */
export async function getAccessToken(serviceAccount, scope) {
  const now = Math.floor(Date.now() / 1000);

  const jwt = await signJwt(serviceAccount, {
    iss: serviceAccount.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.access_token;
}
