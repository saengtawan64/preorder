/**
 * Runtime configuration.
 *
 * Everything here comes from build-time env vars only. There is no
 * localStorage override and no in-app "settings" modal — this is a closed
 * internal tool, so config lives in the Cloudflare Pages environment, not in
 * something a browser can rewrite.
 *
 * VITE_* values are embedded in the published bundle and are therefore
 * public. The Firebase web config is meant to be public (it identifies the
 * project, it does not grant access — Firestore security rules do that).
 * The staff login email is not a secret either: it names an account, and the
 * password that actually protects it never appears in this codebase.
 */

function fromEnv(name) {
  const raw = import.meta.env[name];
  return raw && String(raw).trim() !== '' ? String(raw).trim() : null;
}

/**
 * Firebase web config. Returns null when the project id is missing, so the
 * caller can fail loudly instead of silently running with no backend.
 */
export function getFirebaseConfig() {
  const projectId = fromEnv('VITE_FIREBASE_PROJECT_ID');
  if (!projectId) return null;

  return {
    apiKey: fromEnv('VITE_FIREBASE_API_KEY'),
    authDomain: fromEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId,
    storageBucket: fromEnv('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: fromEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: fromEnv('VITE_FIREBASE_APP_ID'),
  };
}

// The old email/password login is gone — unlocking is a 5-digit PIN checked by
// functions/api/pin-login.js, so no account identifier is needed on the client.
// VITE_STAFF_LOGIN_EMAIL in .env is unused and can be removed.
