/**
 * Cloudflare Pages Function: receives an edit made directly in the Google
 * Sheet and mirrors it into Firestore. This is the Sheet -> Firestore half
 * of the two-way sync; the other half (Firestore -> Sheet) is the standalone
 * cron worker in sync-worker/.
 *
 * Called by appsscript/onEditSync.gs's installable onEdit trigger, never by
 * the browser — this path is not linked from the web app.
 */

import { getAccessToken } from '../_lib/google-auth.js';
import { upsertDepositFromSheet } from '../_lib/firestore-write.js';

const LIMITS = {
  depositId: 200,
  firstName: 100,
  nickname: 100,
  phoneNumber: 20,
  depositItem: 300,
  timestamp: 60,
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
  if (typeof payload.deleted !== 'boolean') return 'deleted must be a boolean';
  if (payload.status !== undefined && payload.status !== 'pending' && payload.status !== 'received') {
    return 'status must be "pending" or "received"';
  }

  return null;
}

export async function onRequestPost({ request, env }) {
  const secret = request.headers.get('X-Sync-Secret');
  if (!secret || secret !== env.SYNC_SHARED_SECRET) {
    // Same response whether the header is missing or wrong, so a caller can't
    // tell those apart.
    return new Response('Unauthorized', { status: 401 });
  }

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
    const result = await upsertDepositFromSheet(env.FIRESTORE_PROJECT_ID, token, payload);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error('sheet-webhook upsert failed:', err);
    return new Response('Upstream write failed', { status: 502 });
  }
}

/** Anything other than POST is not a valid use of this endpoint. */
export async function onRequestGet() {
  return new Response('Method Not Allowed', { status: 405 });
}
