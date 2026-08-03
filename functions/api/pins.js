/**
 * Cloudflare Pages Function: manage the unlock PINs.
 *
 * Only reachable by someone already signed in — so a staff member who is
 * already inside can add or change PINs, but nobody outside can enumerate them.
 * GET never returns the PINs themselves, only how many exist and a masked hint,
 * because there is no legitimate reason for the browser to hold them.
 */

import { verifyFirebaseToken } from '../_lib/verify-firebase-token.js';
import { getAccessToken } from '../_lib/google-auth.js';
import { getDocFields, setDocFields } from '../_lib/firestore-doc.js';

const PATH = 'settings/pins';

async function authed(request, env) {
  const authz = request.headers.get('Authorization') || '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  return verifyFirebaseToken(idToken, env.FIRESTORE_PROJECT_ID);
}

async function serviceToken(env) {
  return getAccessToken(JSON.parse(env.GCP_SERVICE_ACCOUNT_KEY), 'https://www.googleapis.com/auth/datastore');
}

/** "12345" -> "1•••5" — enough to tell two PINs apart, not enough to use one. */
const mask = (pin) => pin.length < 3 ? '•'.repeat(pin.length) : pin[0] + '•'.repeat(pin.length - 2) + pin[pin.length - 1];

export async function onRequestGet({ request, env }) {
  if (!(await authed(request, env))) return new Response('Unauthorized', { status: 401 });

  try {
    const token = await serviceToken(env);
    const doc = await getDocFields(env.FIRESTORE_PROJECT_ID, token, PATH);
    const pins = Array.isArray(doc?.pins) ? doc.pins.map(String) : [];
    return Response.json({ ok: true, count: pins.length, hints: pins.map(mask) });
  } catch (error) {
    console.error('pins get failed:', error);
    return new Response('Read failed', { status: 502 });
  }
}

export async function onRequestPost({ request, env }) {
  if (!(await authed(request, env))) return new Response('Unauthorized', { status: 401 });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const pins = Array.isArray(payload?.pins) ? payload.pins.map((p) => String(p).trim()) : null;
  if (!pins) return new Response('pins must be an array', { status: 400 });

  if (pins.length === 0) {
    // Saving an empty list would lock every staff member out permanently.
    return new Response('ต้องมีรหัสอย่างน้อย 1 ชุด', { status: 400 });
  }
  if (pins.some((p) => !/^\d{5}$/.test(p))) {
    return new Response('รหัสต้องเป็นตัวเลข 5 หลัก', { status: 400 });
  }
  if (new Set(pins).size !== pins.length) {
    return new Response('มีรหัสซ้ำกัน', { status: 400 });
  }

  try {
    const token = await serviceToken(env);
    await setDocFields(env.FIRESTORE_PROJECT_ID, token, PATH, {
      pins,
      updatedAtIso: new Date().toISOString(),
    });
    return Response.json({ ok: true, count: pins.length, hints: pins.map(mask) });
  } catch (error) {
    console.error('pins save failed:', error);
    return new Response('Save failed', { status: 502 });
  }
}
