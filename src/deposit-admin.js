/**
 * Admin-only deposit actions — currently just deleting.
 *
 * Goes through the server rather than the client-only soft-delete
 * `firestore.rules` used to allow: that rule couldn't tell a staff session
 * from an admin one (the shop's login is one shared Firebase session — see
 * src/auth.js), so it now refuses the write entirely and this, like marking
 * received, goes through the service account after the caller proves both a
 * valid session and a fresh admin-PIN step-up. See functions/api/delete-deposit.js
 * and requireAdminStepUp() in main.js.
 */
export async function deleteDeposit(idToken, elevationToken, depositId) {
  const response = await fetch('/api/delete-deposit', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
      'X-Admin-Elevation': elevationToken,
    },
    body: JSON.stringify({ depositId }),
  });

  if (!response.ok) {
    const detail = response.status < 500 ? (await response.text()).trim() : '';
    throw new Error(detail || 'ลบรายการไม่สำเร็จ');
  }
  return response.json();
}
