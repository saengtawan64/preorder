/**
 * Marking a deposit as collected.
 *
 * Goes through the server rather than the client-only status flip
 * `firestore.rules` already allows: the timestamp this stamps
 * (`receivedAtIso`) is a field that rule doesn't list, so a client write
 * carrying it would be rejected outright. See functions/api/mark-received.js.
 */
export async function markReceived(idToken, depositId) {
  const response = await fetch('/api/mark-received', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ depositId }),
  });

  if (!response.ok) {
    const detail = response.status < 500 ? (await response.text()).trim() : '';
    throw new Error(detail || 'บันทึกไม่สำเร็จ');
  }
  return response.json();
}
