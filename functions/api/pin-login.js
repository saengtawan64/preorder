/**
 * Cloudflare Pages Function: unlock the app with a 5-digit PIN.
 *
 * The shop wanted a phone-style unlock instead of a password field. The naive
 * version of that — comparing the PIN in browser JavaScript — is what this
 * project replaced in the first place: anyone can read it from View Source, and
 * it protects nothing, because the data lives behind Firestore rules that need
 * a real signed-in user.
 *
 * So the PIN never reaches the client. It is checked here against
 * `settings/pins` in Firestore, and a correct PIN is answered with a Firebase
 * custom token that the browser exchanges for a genuine Auth session. From
 * Firestore's point of view nothing changed — `request.auth` is still a real
 * user — the login screen just looks like a keypad now.
 *
 * A 5-digit PIN is only 100k combinations, so guesses are rate-limited per
 * caller IP; without that, a script could walk the whole space in minutes.
 */

import { createFirebaseCustomToken } from '../_lib/google-auth.js';
import { getAccessToken } from '../_lib/google-auth.js';
import { getDocFields, setDocFields } from '../_lib/firestore-doc.js';
import { readEntries, entriesToFields } from '../_lib/pins-store.js';

const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;
const UID = 'shop-staff'; // one shared identity, same as the old single account

/** Hash the caller IP — enough to count attempts without storing addresses. */
async function ipKey(ip) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compare without an early exit, so timing doesn't leak how much matched. */
function equals(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The PIN list, from Firestore. Seeded once from the STAFF_PINS secret so the
 * PINs are never in this repo (which is public) — after that Firestore is the
 * source of truth and PINs can be changed without a redeploy.
 */
async function loadPins(projectId, token, env) {
  const doc = await getDocFields(projectId, token, 'settings/pins');
  const stored = readEntries(doc);
  if (stored.length > 0) return stored.map((entry) => entry.pin);

  const seed = String(env.STAFF_PINS || '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => /^\d{4,8}$/.test(p));
  if (seed.length === 0) return [];

  const now = new Date().toISOString();
  await setDocFields(
    projectId,
    token,
    'settings/pins',
    entriesToFields(seed.map((pin, i) => ({ pin, label: `รหัสที่ ${i + 1}`, addedAtIso: now }))),
  );
  return seed;
}

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const pin = String(payload?.pin ?? '');
  if (!/^\d{4,8}$/.test(pin)) {
    return Response.json({ ok: false, reason: 'invalid' }, { status: 400 });
  }

  const projectId = env.FIRESTORE_PROJECT_ID;
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(env.GCP_SERVICE_ACCOUNT_KEY);
  } catch {
    console.error('pin-login: GCP_SERVICE_ACCOUNT_KEY is missing or unparseable');
    return new Response('Server not configured', { status: 500 });
  }

  try {
    const token = await getAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');

    // --- throttle -------------------------------------------------------
    const key = await ipKey(request.headers.get('CF-Connecting-IP') || 'unknown');
    const path = `settings/pinAttempts/entries/${key}`;
    const record = await getDocFields(projectId, token, path);
    const now = Date.now();

    if (record?.lockedUntil && now < Number(record.lockedUntil)) {
      return Response.json({ ok: false, reason: 'throttled' }, { status: 429 });
    }

    // --- check ----------------------------------------------------------
    const pins = await loadPins(projectId, token, env);
    if (pins.length === 0) {
      console.error('pin-login: no PINs configured (set the STAFF_PINS secret)');
      return new Response('Server not configured', { status: 500 });
    }

    const matched = pins.some((candidate) => equals(candidate, pin));

    if (!matched) {
      // A lockout that survives past the window resets rather than compounding.
      const fails = (record?.lockedUntil && now >= Number(record.lockedUntil) ? 0 : Number(record?.fails || 0)) + 1;
      await setDocFields(projectId, token, path, {
        fails,
        lockedUntil: fails >= MAX_ATTEMPTS ? now + LOCKOUT_MS : 0,
        lastAtIso: new Date().toISOString(),
      });
      const locked = fails >= MAX_ATTEMPTS;
      return Response.json(
        { ok: false, reason: locked ? 'throttled' : 'invalid', attemptsLeft: Math.max(MAX_ATTEMPTS - fails, 0) },
        { status: locked ? 429 : 401 },
      );
    }

    if (record) await setDocFields(projectId, token, path, { fails: 0, lockedUntil: 0 });

    const customToken = await createFirebaseCustomToken(serviceAccount, UID);
    return Response.json({ ok: true, token: customToken });
  } catch (error) {
    console.error('pin-login failed:', error);
    return new Response('Login check failed', { status: 502 });
  }
}

/** Only POST makes sense here. */
export async function onRequestGet() {
  return new Response('Method Not Allowed', { status: 405 });
}
