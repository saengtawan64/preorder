/**
 * Cloudflare Pages Function: manage the unlock PINs.
 *
 * Only reachable by someone already signed in — so a staff member who is
 * already inside can add, rename or remove a PIN, but nobody outside can
 * enumerate them. Neither GET nor POST ever returns a PIN: the browser gets a
 * label and a mask, which is all a management screen needs.
 *
 * POST takes one operation at a time rather than a whole list. The list can't
 * round-trip through the browser — the browser never holds the PINs — so a
 * replace-everything endpoint would have nothing to send back.
 */

import { verifyFirebaseToken } from '../_lib/verify-firebase-token.js';
import { getAccessToken } from '../_lib/google-auth.js';
import { getDocFields, setDocFields } from '../_lib/firestore-doc.js';
import { readEntries, entriesToFields, maskPin, toPublic } from '../_lib/pins-store.js';
import { verifyElevation } from '../_lib/elevation-token.js';
import { isCrossSite } from '../_lib/same-origin.js';

const PATH = 'settings/pins';
const MAX_PINS = 10;
const MAX_LABEL = 24;

/**
 * PIN management is an admin-only screen, gated by step-up (see
 * functions/api/verify-admin-pin.js), not by the signed-in session's own
 * role — the shop's login is one shared session, so a session opened by a
 * staff PIN (or an admin PIN left unattended on a shared device) proves
 * nothing about who is at the till right now. Returns a Response to
 * short-circuit with (401 not signed in, 403 no valid recent step-up), or
 * null to proceed.
 */
async function requireAdmin(request, env) {
  const authz = request.headers.get('Authorization') || '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  const claims = await verifyFirebaseToken(idToken, env.FIRESTORE_PROJECT_ID);
  if (!claims) return new Response('Unauthorized', { status: 401 });

  const elevated = await verifyElevation(request.headers.get('X-Admin-Elevation'), env.ADMIN_ELEVATION_SECRET);
  if (!elevated) return new Response('ต้องยืนยันรหัสแอดมินก่อน', { status: 403 });
  return null;
}

async function serviceToken(env) {
  return getAccessToken(JSON.parse(env.GCP_SERVICE_ACCOUNT_KEY), 'https://www.googleapis.com/auth/datastore');
}

const ok = (entries) => Response.json({ ok: true, count: entries.length, pins: toPublic(entries) });
const bad = (message) => new Response(message, { status: 400 });

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  try {
    const token = await serviceToken(env);
    return ok(readEntries(await getDocFields(env.FIRESTORE_PROJECT_ID, token, PATH)));
  } catch (error) {
    console.error('pins get failed:', error);
    return new Response('Read failed', { status: 502 });
  }
}

export async function onRequestPost({ request, env }) {
  if (isCrossSite(request)) return new Response('Forbidden', { status: 403 });

  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return bad('Invalid JSON body');
  }

  const action = String(payload?.action || '');
  const label = String(payload?.label ?? '').trim().slice(0, MAX_LABEL);
  // Adding is the one moment a role is chosen explicitly; every other entry's
  // role only ever changes through the 'setRole' action below.
  const requestedRole = payload?.role === 'admin' ? 'admin' : 'staff';

  try {
    const token = await serviceToken(env);
    const entries = readEntries(await getDocFields(env.FIRESTORE_PROJECT_ID, token, PATH));
    const adminCount = () => entries.filter((entry) => entry.role === 'admin').length;

    if (action === 'add') {
      const pin = String(payload?.pin ?? '').trim();
      if (!/^\d{5}$/.test(pin)) return bad('รหัสต้องเป็นตัวเลข 5 หลัก');
      // Naming the row it collides with turns this error into the only way to
      // tell two rows apart: masks alone can't (10005 and 19995 both show
      // "1•••5"), and the browser is never given the PINs to compare against.
      // It reveals nothing a caller couldn't already learn from a plain
      // "already exists" — they had to know the PIN to get this far.
      const clash = entries.findIndex((entry) => entry.pin === pin);
      if (clash >= 0) {
        return bad(`รหัสนี้มีอยู่แล้ว — คือ "${entries[clash].label || `รหัสที่ ${clash + 1}`}"`);
      }
      if (entries.length >= MAX_PINS) return bad(`เก็บได้สูงสุด ${MAX_PINS} รหัส`);
      entries.push({ pin, label, addedAtIso: new Date().toISOString(), role: requestedRole });
    } else if (action === 'remove') {
      const index = Number(payload?.index);
      if (!Number.isInteger(index) || index < 0 || index >= entries.length) return bad('ไม่พบรหัสที่จะลบ');
      // Removing the last PIN would lock every staff member out permanently.
      if (entries.length <= 1) return bad('ต้องเหลือรหัสอย่างน้อย 1 ชุด');
      // The screen sends back the mask it was showing. If someone else changed
      // the list in the meantime the positions have shifted, and deleting by a
      // stale index would quietly remove the wrong PIN.
      if (String(payload?.hint || '') !== maskPin(entries[index].pin)) {
        return bad('ข้อมูลบนหน้าจอไม่ตรงกับล่าสุด — โหลดหน้าใหม่แล้วลองอีกครั้ง');
      }
      // Removing the last admin PIN would lock everyone out of admin screens
      // — including this one — permanently (no admin left to add another).
      if (entries[index].role === 'admin' && adminCount() <= 1) {
        return bad('ต้องเหลือรหัสระดับแอดมินอย่างน้อย 1 ชุด');
      }
      entries.splice(index, 1);
    } else if (action === 'rename') {
      const index = Number(payload?.index);
      if (!Number.isInteger(index) || index < 0 || index >= entries.length) return bad('ไม่พบรหัสที่จะแก้ชื่อ');
      entries[index] = { ...entries[index], label };
    } else if (action === 'setRole') {
      const index = Number(payload?.index);
      if (!Number.isInteger(index) || index < 0 || index >= entries.length) return bad('ไม่พบรหัสที่จะแก้สิทธิ์');
      const role = payload?.role === 'admin' ? 'admin' : 'staff';
      // Same reasoning as remove: demoting the last admin locks out every
      // admin screen, permanently, with nobody able to promote a PIN back.
      if (entries[index].role === 'admin' && role !== 'admin' && adminCount() <= 1) {
        return bad('ต้องเหลือรหัสระดับแอดมินอย่างน้อย 1 ชุด');
      }
      entries[index] = { ...entries[index], role };
    } else {
      return bad('action ต้องเป็น add, remove, rename หรือ setRole');
    }

    await setDocFields(env.FIRESTORE_PROJECT_ID, token, PATH, entriesToFields(entries));
    return ok(entries);
  } catch (error) {
    console.error('pins save failed:', error);
    return new Response('Save failed', { status: 502 });
  }
}
