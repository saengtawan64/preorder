/**
 * Cloudflare Pages Function: on-demand Firestore → Sheet sync.
 *
 * The web app calls this right after it writes to Firestore (add a deposit,
 * mark received, delete) so the Sheet updates immediately instead of waiting
 * for the sync worker's 5-minute cron. It is a thin, authenticated proxy: it
 * verifies the caller's Firebase ID token, then triggers the standalone cron
 * worker's manual-run endpoint (which holds the service-account key and does
 * the actual sync). Keeping the sync logic in one place — the worker — avoids
 * duplicating it here.
 *
 * The worker's trigger secret never reaches the browser: the browser only ever
 * sends its Firebase ID token to this same-origin function.
 */

import { verifyFirebaseToken } from '../_lib/verify-firebase-token.js';
import { isCrossSite } from '../_lib/same-origin.js';

export async function onRequestPost({ request, env }) {
  if (isCrossSite(request)) return new Response('Forbidden', { status: 403 });

  const authz = request.headers.get('Authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';

  const claims = await verifyFirebaseToken(token, env.FIRESTORE_PROJECT_ID);
  if (!claims) return new Response('Unauthorized', { status: 401 });

  try {
    const res = await fetch(env.SYNC_WORKER_URL, {
      headers: { 'X-Manual-Trigger': env.MANUAL_TRIGGER_SECRET },
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('sync-now: worker trigger failed:', error);
    return new Response('Sync trigger failed', { status: 502 });
  }
}

/** Only POST (with an auth token) makes sense here. */
export async function onRequestGet() {
  return new Response('Method Not Allowed', { status: 405 });
}
