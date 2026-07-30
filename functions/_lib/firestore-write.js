/**
 * Firestore REST writes for the Sheet -> Firestore direction.
 *
 * This bypasses firestore.rules entirely (a service account authenticates as
 * a Google Cloud principal, not a Firebase Auth user, and Firestore grants
 * admin access to anyone with sufficient IAM permission regardless of
 * security rules) — so this file has to do the validation the rules would
 * normally do, since nothing else stands between this and the database.
 */

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return { doubleValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  throw new Error(`Unsupported value type for Firestore: ${typeof value}`);
}

async function firestoreFetch(path, token, init = {}) {
  const response = await fetch(`https://firestore.googleapis.com/v1/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  return response;
}

/** Fetch a deposit by id. Returns its fields, or null if it doesn't exist. */
async function getDeposit(projectId, token, depositId) {
  const response = await firestoreFetch(
    `projects/${projectId}/databases/(default)/documents/deposits/${encodeURIComponent(depositId)}`,
    token,
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Firestore get failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

/**
 * Upsert a deposit coming from a Sheet edit.
 *
 * Business fields (name, phone, item, amount, timestamp, deleted) always
 * overwrite — that is the point of two-way sync. `createdAtIso`/`createdAt`
 * are only set on first creation and never touched on an update, so editing
 * a row in the Sheet can't rewrite when the record was originally made.
 */
export async function upsertDepositFromSheet(projectId, token, payload) {
  const path = `projects/${projectId}/databases/(default)/documents/deposits/${encodeURIComponent(payload.depositId)}`;
  const nowIso = new Date().toISOString();
  const existing = await getDeposit(projectId, token, payload.depositId);

  const businessFields = {
    depositId: payload.depositId,
    firstName: payload.firstName,
    nickname: payload.nickname,
    phoneNumber: payload.phoneNumber,
    depositItem: payload.depositItem,
    depositAmount: payload.depositAmount,
    timestamp: payload.timestamp,
    deletedAt: payload.deleted ? nowIso : null,
    updatedAtIso: nowIso,
    source: 'sheet',
  };

  const maskFields = Object.keys(businessFields);
  const fields = { ...businessFields };

  if (!existing) {
    // Brand-new row typed directly into the Sheet — this is its creation.
    fields.createdAtIso = nowIso;
    maskFields.push('createdAtIso', 'createdAt');
  }

  const firestoreFields = {};
  for (const [key, value] of Object.entries(fields)) {
    firestoreFields[key] = toFirestoreValue(value);
  }
  if (!existing) {
    // Firestore Timestamp, not a plain string — this is what the web client's
    // `orderBy('createdAt', 'desc')` query sorts on.
    firestoreFields.createdAt = { timestampValue: nowIso };
  }

  const query = maskFields.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const response = await firestoreFetch(`${path}?${query}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ fields: firestoreFields }),
  });

  if (!response.ok) {
    throw new Error(`Firestore upsert failed: ${response.status} ${await response.text()}`);
  }

  return { created: !existing };
}
