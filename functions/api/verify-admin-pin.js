/**
 * Cloudflare Pages Function: step-up re-auth for admin-only actions.
 *
 * The shop's login is one shared account behind many PINs — a staff PIN and
 * an admin PIN sign into the exact same Firebase session. So "restrict admin
 * settings to admins" can't just mean "check who's logged in": it has to mean
 * "prove, right now, that you hold an admin-tier PIN" every time someone
 * opens PIN management, edits sales targets, exports customer data, or
 * deletes a deposit — even if the session itself was opened hours ago by
 * someone else on a shared device.
 *
 * This endpoint only answers "does this PIN belong to an admin?" — it never
 * mints a new session (the caller is already signed in; see pin-login.js for
 * that). Rate-limited the same way pin-login is, and separately from it, so
 * failed guesses here can't be laundered through the unlock screen's budget
 * or vice versa.
 */

import { getAccessToken } from '../_lib/google-auth.js';
import { getDocFields, setDocFields } from '../_lib/firestore-doc.js';
import { readEntries } from '../_lib/pins-store.js';
import { verifyFirebaseToken } from '../_lib/verify-firebase-token.js';
import { timingSafeEquals as equals, throttlePath, isLockedOut, recordFailure, clearedFields } from '../_lib/pin-throttle.js';
import { signElevation } from '../_lib/elevation-token.js';
import { isCrossSite } from '../_lib/same-origin.js';

export async function onRequestPost({ request, env }) {
  if (isCrossSite(request)) return new Response('Forbidden', { status: 403 });

  const authz = request.headers.get('Authorization') || '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  const claims = await verifyFirebaseToken(idToken, env.FIRESTORE_PROJECT_ID);
  if (!claims) return new Response('Unauthorized', { status: 401 });

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
    console.error('verify-admin-pin: GCP_SERVICE_ACCOUNT_KEY is missing or unparseable');
    return new Response('Server not configured', { status: 500 });
  }

  try {
    const token = await getAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');

    const path = await throttlePath(request, 'stepup');
    const record = await getDocFields(projectId, token, path);
    if (isLockedOut(record)) {
      return Response.json({ ok: false, reason: 'throttled' }, { status: 429 });
    }

    const entries = readEntries(await getDocFields(projectId, token, 'settings/pins'));
    const matched = entries.find((entry) => equals(entry.pin, pin));

    if (!matched || matched.role !== 'admin') {
      const { fields, locked, attemptsLeft } = recordFailure(record);
      await setDocFields(projectId, token, path, fields);
      return Response.json(
        { ok: false, reason: locked ? 'throttled' : 'invalid', attemptsLeft },
        { status: locked ? 429 : 401 },
      );
    }

    if (record) await setDocFields(projectId, token, path, clearedFields);

    if (!env.ADMIN_ELEVATION_SECRET) {
      console.error('verify-admin-pin: ADMIN_ELEVATION_SECRET is not set');
      return new Response('Server not configured', { status: 500 });
    }
    const { token: elevation, expiresAtMs } = await signElevation(env.ADMIN_ELEVATION_SECRET);
    return Response.json({ ok: true, elevation, expiresAtMs });
  } catch (error) {
    console.error('verify-admin-pin failed:', error);
    return new Response('Verification failed', { status: 502 });
  }
}

/** Only POST (with an auth token) makes sense here. */
export async function onRequestGet() {
  return new Response('Method Not Allowed', { status: 405 });
}
