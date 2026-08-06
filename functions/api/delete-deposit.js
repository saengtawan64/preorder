/**
 * Cloudflare Pages Function: soft-delete a deposit.
 *
 * Admin-only, gated by step-up (see functions/api/verify-admin-pin.js) rather
 * than the caller's own session role — the shop's login is one shared
 * account, so the session can't say who is actually at the till right now.
 *
 * firestore.rules refuses this write from the client entirely (see
 * firestore.rules — deleting used to be a direct client write any signed-in
 * user could make), so this, like mark-received and update-deposit, goes
 * through the service account after checking the caller's ID token and a
 * fresh elevation token together.
 */

import { verifyFirebaseToken } from '../_lib/verify-firebase-token.js';
import { verifyElevation } from '../_lib/elevation-token.js';
import { getAccessToken } from '../_lib/google-auth.js';
import { softDeleteFromWeb } from '../_lib/firestore-write.js';
import { isCrossSite } from '../_lib/same-origin.js';

export async function onRequestPost({ request, env }) {
  if (isCrossSite(request)) return new Response('Forbidden', { status: 403 });

  const authz = request.headers.get('Authorization') || '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';

  const claims = await verifyFirebaseToken(idToken, env.FIRESTORE_PROJECT_ID);
  if (!claims) return new Response('Unauthorized', { status: 401 });

  const elevated = await verifyElevation(request.headers.get('X-Admin-Elevation'), env.ADMIN_ELEVATION_SECRET);
  if (!elevated) return new Response('ต้องยืนยันรหัสแอดมินก่อน', { status: 403 });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const depositId = String(payload?.depositId ?? '').trim();
  if (!depositId || depositId.length > 200) {
    return new Response('depositId is required', { status: 400 });
  }

  try {
    const serviceAccount = JSON.parse(env.GCP_SERVICE_ACCOUNT_KEY);
    const token = await getAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');
    const result = await softDeleteFromWeb(env.FIRESTORE_PROJECT_ID, token, depositId);

    if (!result.updated) return new Response('Deposit not found', { status: 404 });
    return Response.json(result);
  } catch (error) {
    console.error('delete-deposit failed:', error);
    return new Response('Upstream write failed', { status: 502 });
  }
}

/** Only POST (with an auth token) makes sense here. */
export async function onRequestGet() {
  return new Response('Method Not Allowed', { status: 405 });
}
