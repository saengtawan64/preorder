/**
 * Cloudflare Pages Function: edit an existing deposit from the web app.
 *
 * The browser cannot rewrite a record's business fields itself — firestore.rules
 * only lets a client soft-delete or flip status, so that a compromised session
 * can't quietly rewrite history. Editing therefore goes through here: the
 * caller's Firebase ID token is verified first, then the write is made with the
 * service account (which bypasses rules), touching only the editable fields.
 *
 * Same shape of guard as functions/api/sync-now.js, and the same validation
 * limits as functions/api/sheet-webhook.js so a row edited from the web can
 * never end up in a state the Sheet side would reject.
 */

import { verifyFirebaseToken } from '../_lib/verify-firebase-token.js';
import { getAccessToken } from '../_lib/google-auth.js';
import { updateDepositFromWeb } from '../_lib/firestore-write.js';
import { isCrossSite } from '../_lib/same-origin.js';

const LIMITS = {
  depositId: 200,
  firstName: 100,
  nickname: 100,
  phoneNumber: 20,
  depositItem: 300,
};

function validationError(payload) {
  if (typeof payload !== 'object' || payload === null) return 'body must be a JSON object';

  for (const [field, maxLength] of Object.entries(LIMITS)) {
    const value = payload[field];
    if (typeof value !== 'string') return `${field} must be a string`;
    if (value.length > maxLength) return `${field} exceeds ${maxLength} characters`;
  }
  if (!payload.depositId) return 'depositId is required';
  if (!payload.firstName) return 'firstName is required';

  if (typeof payload.depositAmount !== 'number' || !Number.isFinite(payload.depositAmount)) {
    return 'depositAmount must be a number';
  }
  if (payload.depositAmount <= 0 || payload.depositAmount > 10_000_000) {
    return 'depositAmount out of range';
  }

  return null;
}

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

  const error = validationError(payload);
  if (error) return new Response(`Invalid payload: ${error}`, { status: 400 });

  try {
    const serviceAccount = JSON.parse(env.GCP_SERVICE_ACCOUNT_KEY);
    const token = await getAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');
    const result = await updateDepositFromWeb(env.FIRESTORE_PROJECT_ID, token, payload);

    if (!result.updated) return new Response('Deposit not found', { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('update-deposit failed:', err);
    return new Response('Upstream write failed', { status: 502 });
  }
}

/** Only POST (with an auth token) makes sense here. */
export async function onRequestGet() {
  return new Response('Method Not Allowed', { status: 405 });
}
