/**
 * Single-account authentication gate.
 *
 * There is one shared Firebase Auth account for the whole shop. The login
 * screen only asks for a password — the email is fixed and never shown —
 * so using the app feels like unlocking a phone, not managing an account.
 * Firestore security rules require `request.auth != null`, so this password
 * is what actually protects the data, not a client-side check.
 */

import { getApp } from 'firebase/app';
import {
  getAuth,
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';

import { getStaffLoginEmail } from './config.js';

let auth = null;

function getAuthInstance() {
  if (!auth) auth = getAuth(getApp());
  return auth;
}

/**
 * Sign in with the shared password.
 *
 * Uses session persistence on purpose: closing the browser/tab signs the
 * shared terminal out again, which matters more here than staying logged in
 * forever, since anyone at the till otherwise inherits the previous login.
 */
export async function signIn(password) {
  const instance = getAuthInstance();
  await setPersistence(instance, browserSessionPersistence);

  try {
    await signInWithEmailAndPassword(instance, getStaffLoginEmail(), password);
    return { ok: true };
  } catch (error) {
    // Firebase distinguishes wrong-password from invalid-credential depending
    // on SDK version/config; both mean "the password was wrong" here since
    // there is only one account and its email is fixed.
    const code = error?.code || '';
    if (code === 'auth/too-many-requests') {
      return { ok: false, reason: 'throttled' };
    }
    return { ok: false, reason: 'invalid' };
  }
}

export async function signOutUser() {
  await signOut(getAuthInstance());
}

/** Subscribe to sign-in state. Returns the unsubscribe function. */
export function onAuthChange(callback) {
  return onAuthStateChanged(getAuthInstance(), (user) => callback(!!user));
}
