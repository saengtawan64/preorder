/**
 * Client for /api/pins — the unlock-PIN list.
 *
 * The browser never holds a PIN. It sends one up when adding, and from then on
 * only ever sees `{index, label, hint}`. That is why every change is an
 * operation ("add this", "remove #2") instead of "here is the new list":
 * the client has nothing to build a full list out of.
 */

const ENDPOINT = '/api/pins';

// PIN management is admin-only — every call needs both the caller's Firebase
// ID token (who is signed in) and a fresh admin-PIN step-up token (proof
// someone just typed an admin PIN; see requireAdminStepUp() in main.js and
// functions/api/verify-admin-pin.js). The shared-login model means the first
// alone can't say who's actually at the till right now.
async function call(idToken, elevation, init) {
  const response = await fetch(ENDPOINT, {
    ...init,
    headers: {
      Authorization: `Bearer ${idToken}`,
      'X-Admin-Elevation': elevation,
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    // 4xx bodies are Thai messages meant for the user; 5xx are not.
    const detail = response.status < 500 ? (await response.text()).trim() : '';
    throw new Error(detail || 'เชื่อมต่อไม่สำเร็จ');
  }
  return response.json();
}

/** `{ count, pins: [{ index, label, hint, addedAtIso, role }] }` */
export const fetchPins = (idToken, elevation) => call(idToken, elevation, { method: 'GET' });

const post = (idToken, elevation, body) =>
  call(idToken, elevation, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const addPin = (idToken, elevation, pin, label, role) =>
  post(idToken, elevation, { action: 'add', pin, label, role });
/** `hint` is the mask the screen was showing — the server rejects a stale one. */
export const removePin = (idToken, elevation, index, hint) =>
  post(idToken, elevation, { action: 'remove', index, hint });
export const renamePin = (idToken, elevation, index, label) =>
  post(idToken, elevation, { action: 'rename', index, label });
export const setPinRole = (idToken, elevation, index, role) =>
  post(idToken, elevation, { action: 'setRole', index, role });
