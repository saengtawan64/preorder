/**
 * Cloudflare Pages Function: the shop's monthly sales targets.
 *
 * Targets are shared by the whole shop, so they live in Firestore
 * (`settings/salesTargets`) rather than in each browser — a manager setting a
 * target on the back-office PC should be what the staff tablet sees too.
 *
 * `settings/*` is outside the `deposits` collection and firestore.rules denies
 * clients everything there, so both reading and writing go through here, after
 * the caller's Firebase ID token is verified.
 */

import { verifyFirebaseToken } from '../_lib/verify-firebase-token.js';
import { getAccessToken } from '../_lib/google-auth.js';
import { getDocFields, setDocFields } from '../_lib/firestore-doc.js';
import { verifyElevation } from '../_lib/elevation-token.js';
import { isCrossSite } from '../_lib/same-origin.js';

const PATH = 'settings/salesTargets';

/** Brands the dashboard tracks; anything else in a payload is ignored. */
const BRANDS = ['OPPO', 'VIVO', 'SS', 'REALME', 'TECNO', 'Honor', 'XIAOMI', 'IPHONE'];

/** Used until someone saves their own — matches the figures the shop started with. */
const FALLBACK = {
  OPPO: 300000, VIVO: 250000, SS: 150000, REALME: 50000,
  TECNO: 30000, Honor: 30000, XIAOMI: 100000, IPHONE: 600000,
};

async function authed(request, env) {
  const authz = request.headers.get('Authorization') || '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  return verifyFirebaseToken(idToken, env.FIRESTORE_PROJECT_ID);
}

async function serviceToken(env) {
  const serviceAccount = JSON.parse(env.GCP_SERVICE_ACCOUNT_KEY);
  return getAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');
}

export async function onRequestGet({ request, env }) {
  if (!(await authed(request, env))) return new Response('Unauthorized', { status: 401 });

  try {
    const token = await serviceToken(env);
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

export async function onRequestPost({ request, env }) {
  if (isCrossSite(request)) return new Response('Forbidden', { status: 403 });

  // Reading targets is normal staff work (the dashboard shows progress against
  // them); setting them is a financial decision, so only that write requires
  // a fresh admin-PIN step-up — see functions/api/verify-admin-pin.js.
  const claims = await authed(request, env);
  if (!claims) return new Response('Unauthorized', { status: 401 });
  const elevated = await verifyElevation(request.headers.get('X-Admin-Elevation'), env.ADMIN_ELEVATION_SECRET);
  if (!elevated) return new Response('ต้องยืนยันรหัสแอดมินก่อน', { status: 403 });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const incoming = payload?.targets;
  if (typeof incoming !== 'object' || incoming === null) {
    return new Response('targets must be an object', { status: 400 });
  }

  const targets = {};
  for (const brand of BRANDS) {
    const value = Number(incoming[brand]);
    if (!Number.isFinite(value) || value < 0 || value > 100_000_000) {
      return new Response(`เป้าของ ${brand} ไม่ถูกต้อง`, { status: 400 });
    }
    targets[brand] = Math.round(value);
  }

  try {
    const token = await serviceToken(env);
    await setDocFields(env.FIRESTORE_PROJECT_ID, token, PATH, {
      targets,
      updatedAtIso: new Date().toISOString(),
    });
    return Response.json({ ok: true, targets });
  } catch (error) {
    console.error('sales-targets save failed:', error);
    return new Response('Save failed', { status: 502 });
  }
}
