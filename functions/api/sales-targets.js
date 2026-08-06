/**
 * Cloudflare Pages Function: the shop's monthly sales targets — read-only
 * here.
 *
 * Staff see progress against the target on their own dashboard; setting the
 * target is a financial decision that now lives exclusively in the separate
 * admin portal (bsd-admin-cbb7f2.pages.dev), which writes to the same
 * `settings/salesTargets` document via its own Cloudflare Function.
 *
 * `settings/*` is outside the `deposits` collection and firestore.rules denies
 * clients everything there, so reading goes through here, after the caller's
 * Firebase ID token is verified.
 */

import { verifyFirebaseToken } from '../_lib/verify-firebase-token.js';
import { getAccessToken } from '../_lib/google-auth.js';
import { getDocFields } from '../_lib/firestore-doc.js';

const PATH = 'settings/salesTargets';

/** Brands the dashboard tracks; anything else in the stored doc is ignored. */
const BRANDS = ['OPPO', 'VIVO', 'SS', 'REALME', 'TECNO', 'Honor', 'XIAOMI', 'IPHONE'];

/** Used until someone saves their own — matches the figures the shop started with. */
const FALLBACK = {
  OPPO: 300000, VIVO: 250000, SS: 150000, REALME: 50000,
  TECNO: 30000, Honor: 30000, XIAOMI: 100000, IPHONE: 600000,
};

export async function onRequestGet({ request, env }) {
  const authz = request.headers.get('Authorization') || '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!(await verifyFirebaseToken(idToken, env.FIRESTORE_PROJECT_ID))) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const serviceAccount = JSON.parse(env.GCP_SERVICE_ACCOUNT_KEY);
    const token = await getAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');
    const doc = await getDocFields(env.FIRESTORE_PROJECT_ID, token, PATH);
    const saved = doc?.targets || {};

    // Fill any brand that has never been set, so the dashboard always has a
    // complete set to work with.
    const targets = Object.fromEntries(
      BRANDS.map((b) => [b, Number.isFinite(Number(saved[b])) ? Number(saved[b]) : FALLBACK[b]]),
    );
    return Response.json({ ok: true, targets, updatedAtIso: doc?.updatedAtIso || null });
  } catch (error) {
    console.error('sales-targets get failed:', error);
    return new Response('Read failed', { status: 502 });
  }
}

/** Setting targets moved to the admin portal — this route no longer writes. */
export async function onRequestPost() {
  return new Response('Method Not Allowed', { status: 405 });
}
