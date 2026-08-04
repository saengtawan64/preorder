/**
 * Cloudflare Pages Function: note that a customer was contacted about their
 * deposit.
 *
 * Separate from /api/update-deposit rather than folded into it: that endpoint
 * requires the record's whole business payload and validates it, because it is
 * an edit. This one carries no business data at all — it only stamps the time —
 * so it should not be able to change a name or an amount even by accident.
 */

import { verifyFirebaseToken } from '../_lib/verify-firebase-token.js';
import { getAccessToken } from '../_lib/google-auth.js';
import { recordFollowUp } from '../_lib/firestore-write.js';

export async function onRequestPost({ request, env }) {
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

  const depositId = String(payload?.depositId ?? '').trim();
  if (!depositId || depositId.length > 200) {
    return new Response('depositId is required', { status: 400 });
  }

  try {
    const serviceAccount = JSON.parse(env.GCP_SERVICE_ACCOUNT_KEY);
    const token = await getAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');
    const result = await recordFollowUp(env.FIRESTORE_PROJECT_ID, token, depositId);

    if (!result.updated) return new Response('Deposit not found', { status: 404 });
    return Response.json(result);
  } catch (error) {
    console.error('follow-up failed:', error);
    return new Response('Upstream write failed', { status: 502 });
  }
}

/** Only POST (with an auth token) makes sense here. */
export async function onRequestGet() {
  return new Response('Method Not Allowed', { status: 405 });
}
