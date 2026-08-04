/**
 * Client for /api/pins — the unlock-PIN list.
 *
 * The browser never holds a PIN. It sends one up when adding, and from then on
 * only ever sees `{index, label, hint}`. That is why every change is an
 * operation ("add this", "remove #2") instead of "here is the new list":
 * the client has nothing to build a full list out of.
 */

const ENDPOINT = '/api/pins';

async function call(idToken, init) {
  const response = await fetch(ENDPOINT, {
    ...init,
    headers: { Authorization: `Bearer ${idToken}`, ...(init?.headers || {}) },
  });
  if (!response.ok) {
    // 4xx bodies are Thai messages meant for the user; 5xx are not.
    const detail = response.status < 500 ? (await response.text()).trim() : '';
    throw new Error(detail || 'เชื่อมต่อไม่สำเร็จ');
  }
  return response.json();
}

/** `{ count, pins: [{ index, label, hint, addedAtIso }] }` */
export const fetchPins = (idToken) => call(idToken, { method: 'GET' });

const post = (idToken, body) =>
  call(idToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const addPin = (idToken, pin, label) => post(idToken, { action: 'add', pin, label });
/** `hint` is the mask the screen was showing — the server rejects a stale one. */
export const removePin = (idToken, index, hint) => post(idToken, { action: 'remove', index, hint });
export const renamePin = (idToken, index, label) => post(idToken, { action: 'rename', index, label });
