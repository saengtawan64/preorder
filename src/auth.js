/**
 * Unlock gate — a 5-digit PIN, like unlocking a phone.
 *
 * The PIN is never compared here. It goes to functions/api/pin-login.js, which
 * checks it against Firestore and answers with a Firebase custom token; this
 * exchanges that token for a real Auth session. Comparing the PIN in the
 * browser would put it in a file anyone can read — the exact hole this project
 * was built to close — and would prove nothing to Firestore, whose rules need
 * `request.auth != null`.
 */

import { getApp } from 'firebase/app';
import {
  getAuth,
  browserSessionPersistence,
  setPersistence,
  signInWithCustomToken,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';

let auth = null;

function getAuthInstance() {
  if (!auth) auth = getAuth(getApp());
  return auth;
}

/**
 * Unlock with a PIN. Resolves `{ ok }`, or `{ ok: false, reason }` where reason
 * is 'invalid' (wrong PIN), 'throttled' (too many tries) or 'offline'.
 *
 * Session persistence on purpose: closing the tab locks the shared till again,
 * which matters more here than staying signed in, since otherwise whoever sits
 * down next inherits the previous session.
 */
export async function signInWithPin(pin) {
  const instance = getAuthInstance();
  await setPersistence(instance, browserSessionPersistence);

  let response;
  try {
    response = await fetch('/api/pin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
  } catch {
    return { ok: false, reason: 'offline' };
  }

  if (!response.ok) {
    let reason = 'invalid';
    let attemptsLeft;
    try {
      const body = await response.json();
      reason = body.reason || reason;
      attemptsLeft = body.attemptsLeft;
    } catch {
      if (response.status >= 500) reason = 'offline';
    }
    return { ok: false, reason, attemptsLeft };
  }

  try {
    const { token } = await response.json();
    await signInWithCustomToken(instance, token);
    return { ok: true };
  } catch (error) {
    console.error('custom token sign-in failed:', error);
    return { ok: false, reason: 'offline' };
  }
}

export async function signOutUser() {
  await signOut(getAuthInstance());
}

/**
 * Current user's Firebase ID token, or null when signed out. The instant-sync
 * Pages Function verifies this token before it will run a Firestore→Sheet push,
 * so a logged-out browser can't trigger syncs.
 */
export async function getIdToken() {
  const user = getAuthInstance().currentUser;
  if (!user) return null;
  return user.getIdToken();
}

/** Subscribe to sign-in state. Returns the unsubscribe function. */
export function onAuthChange(callback) {
  return onAuthStateChanged(getAuthInstance(), (user) => callback(!!user));
}

/**
 * Step-up re-auth for admin-only actions (PIN management, sales targets, CSV
 * export, deleting a deposit): proves the PIN just typed belongs to an admin,
 * without opening a new session. Needed even when the current session is
 * already admin-tier, because the shop's login is one shared account — the
 * session itself doesn't say *who* is standing at the till right now.
 *
 * Resolves `{ ok }`, or `{ ok: false, reason }` where reason is 'invalid'
 * (wrong or non-admin PIN), 'throttled', or 'offline'.
 */
export async function verifyAdminPin(pin) {
  const idToken = await getIdToken();
  if (!idToken) return { ok: false, reason: 'offline' };

  let response;
  try {
    response = await fetch('/api/verify-admin-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ pin }),
    });
  } catch {
    return { ok: false, reason: 'offline' };
  }

  if (response.ok) return { ok: true };

  let reason = 'invalid';
  let attemptsLeft;
  try {
    const body = await response.json();
    reason = body.reason || reason;
    attemptsLeft = body.attemptsLeft;
  } catch {
    if (response.status >= 500) reason = 'offline';
  }
  return { ok: false, reason, attemptsLeft };
}
