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
 * Update the editable fields of an existing deposit, on behalf of a signed-in
 * staff user editing a row in the web app.
 *
 * This runs server-side rather than letting the browser write Firestore
 * directly: firestore.rules deliberately refuses to let a client rewrite a
 * record's business fields, so the browser can still only ever soft-delete or
 * flip status. Editing goes through here, where the caller's Firebase ID token
 * has already been verified, and only the fields below can move — `depositId`,
 * `createdAtIso` and `createdAt` are never touched, so a record's identity and
 * creation time stay fixed.
 *
 * Returns { updated: false } when the deposit doesn't exist.
 */
export async function updateDepositFromWeb(projectId, token, payload) {
  const path = `projects/${projectId}/databases/(default)/documents/deposits/${encodeURIComponent(payload.depositId)}`;
  const existing = await getDeposit(projectId, token, payload.depositId);
  if (!existing) return { updated: false };

  const fields = {
    firstName: payload.firstName,
    nickname: payload.nickname,
    phoneNumber: payload.phoneNumber,
    depositItem: payload.depositItem,
    depositAmount: payload.depositAmount,
    updatedAtIso: new Date().toISOString(),
    source: 'web',
  };

  const firestoreFields = {};
  for (const [key, value] of Object.entries(fields)) {
    firestoreFields[key] = toFirestoreValue(value);
  }

  const query = Object.keys(fields)
    .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
    .join('&');

  const response = await firestoreFetch(`${path}?${query}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ fields: firestoreFields }),
  });

  if (!response.ok) {
    throw new Error(`Firestore update failed: ${response.status} ${await response.text()}`);
  }

  return { updated: true };
}

/**
 * Note that a customer was contacted about their deposit.
 *
 * Touches only the two follow-up fields, so it can never disturb the record
 * itself — and neither writer that owns the record touches them back:
 * `upsertDepositFromSheet` and `updateDepositFromWeb` both write through an
 * updateMask that doesn't list them, so a Sheet edit or a web edit leaves the
 * follow-up history intact.
 *
 * Deliberately not mirrored to the Google Sheet. The sheet's column layout is
 * load-bearing — the sync worker writes fixed ranges and a shifted column is
 * what caused the duplicate-row bugs — so a web-only field stays web-only.
 *
 * Returns { updated: false } when the deposit doesn't exist.
 */
export async function recordFollowUp(projectId, token, depositId) {
  const path = `projects/${projectId}/databases/(default)/documents/deposits/${encodeURIComponent(depositId)}`;
  const existing = await getDeposit(projectId, token, depositId);
  if (!existing) return { updated: false };

  const previous = Number(existing.fields?.followUpCount?.doubleValue ?? 0);
  const followedUpAtIso = new Date().toISOString();
  const followUpCount = (Number.isFinite(previous) ? previous : 0) + 1;

  const query = ['followedUpAtIso', 'followUpCount']
    .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
    .join('&');

  const response = await firestoreFetch(`${path}?${query}`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        followedUpAtIso: toFirestoreValue(followedUpAtIso),
        followUpCount: toFirestoreValue(followUpCount),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Firestore follow-up write failed: ${response.status} ${await response.text()}`);
  }

  return { updated: true, followedUpAtIso, followUpCount };
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
    // Fulfilment status from the sheet's dropdown (defaults to pending).
    status: payload.status === 'received' ? 'received' : 'pending',
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
