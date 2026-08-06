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
 * Mark a deposit received (customer collected the goods), on behalf of a
 * signed-in staff user clicking the button in the web app.
 *
 * This has to run server-side even though a client-only status flip is what
 * `firestore.rules` already allows: that rule's status branch is an exact
 * field allowlist (`hasOnly(['status', 'updatedAtIso'])`), so a client write
 * that also set `receivedAtIso` in the same update would be rejected outright.
 * Capturing the timestamp therefore goes through here, past the service
 * account, the same way the follow-up write does.
 *
 * `receivedAtIso` is only set when the record wasn't already received —
 * idempotent against a duplicate click racing the snapshot listener, and it
 * mirrors the rule `upsertDepositFromSheet` uses for the same transition, so
 * a deposit marked received from the web or from the Sheet looks the same
 * afterward regardless of which side did it.
 *
 * Returns { updated: false } when the deposit doesn't exist.
 */
export async function markReceivedFromWeb(projectId, token, depositId) {
  const path = `projects/${projectId}/databases/(default)/documents/deposits/${encodeURIComponent(depositId)}`;
  const existing = await getDeposit(projectId, token, depositId);
  if (!existing) return { updated: false };

  const alreadyReceived = existing.fields?.status?.stringValue === 'received';
  const nowIso = new Date().toISOString();

  const fields = { status: 'received', updatedAtIso: nowIso };
  const maskFields = ['status', 'updatedAtIso'];
  if (!alreadyReceived) {
    fields.receivedAtIso = nowIso;
    maskFields.push('receivedAtIso');
  }

  const firestoreFields = {};
  for (const [key, value] of Object.entries(fields)) firestoreFields[key] = toFirestoreValue(value);

  const query = maskFields.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const response = await firestoreFetch(`${path}?${query}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ fields: firestoreFields }),
  });

  if (!response.ok) {
    throw new Error(`Firestore mark-received write failed: ${response.status} ${await response.text()}`);
  }

  return {
    updated: true,
    receivedAtIso: fields.receivedAtIso ?? existing.fields?.receivedAtIso?.stringValue ?? null,
  };
}

/**
 * Soft-delete a deposit, on behalf of a signed-in admin clicking "ลบ" in the
 * web app (see functions/api/delete-deposit.js — the caller has already
 * proven a fresh admin-PIN step-up before this runs).
 *
 * This used to be a direct client Firestore write, allowed by firestore.rules
 * for any signed-in user — but that rule couldn't tell a staff session from
 * an admin one (there's one shared Firebase session; see src/auth.js), so
 * restricting deletion to admins requires checking it somewhere that *can*
 * see the step-up proof. firestore.rules only ever sees `request.auth`, not
 * an arbitrary header, so the check has to happen here instead, and the rule
 * now refuses this write from the client entirely (see firestore.rules).
 *
 * Returns { updated: false } when the deposit doesn't exist.
 */
export async function softDeleteFromWeb(projectId, token, depositId) {
  const path = `projects/${projectId}/databases/(default)/documents/deposits/${encodeURIComponent(depositId)}`;
  const existing = await getDeposit(projectId, token, depositId);
  if (!existing) return { updated: false };

  const nowIso = new Date().toISOString();
  const query = ['deletedAt', 'updatedAtIso'].map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const response = await firestoreFetch(`${path}?${query}`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: { deletedAt: toFirestoreValue(nowIso), updatedAtIso: toFirestoreValue(nowIso) },
    }),
  });

  if (!response.ok) {
    throw new Error(`Firestore soft-delete write failed: ${response.status} ${await response.text()}`);
  }

  return { updated: true, deletedAt: nowIso };
}

/**
 * Upsert a deposit coming from a Sheet edit.
 *
 * Business fields (name, phone, item, amount, timestamp, deleted) always
 * overwrite — that is the point of two-way sync. `createdAtIso`/`createdAt`
 * are only set on first creation and never touched on an update, so editing
 * a row in the Sheet can't rewrite when the record was originally made.
 *
 * `receivedAtIso` follows the status transition, not the status value: it is
 * stamped the moment `status` moves TO 'received' and cleared the moment it
 * moves AWAY from it, so the field always means "when this deposit most
 * recently became received" rather than a first-ever timestamp that could go
 * stale if a row is reopened and marked received again. Every other edit to
 * an already-received row (fixing a typo, say) leaves it untouched, because
 * the field is only added to the write when a transition actually happened.
 * The Sheet is the shop's primary data-entry surface — staff toggling the
 * status dropdown there has to produce the same timestamp as clicking the
 * button on the web, or the field would silently under-count.
 */
export async function upsertDepositFromSheet(projectId, token, payload) {
  const path = `projects/${projectId}/databases/(default)/documents/deposits/${encodeURIComponent(payload.depositId)}`;
  const nowIso = new Date().toISOString();
  const existing = await getDeposit(projectId, token, payload.depositId);

  const prevStatus = existing?.fields?.status?.stringValue ?? 'pending';
  const nextStatus = payload.status === 'received' ? 'received' : 'pending';

  const businessFields = {
    depositId: payload.depositId,
    firstName: payload.firstName,
    nickname: payload.nickname,
    phoneNumber: payload.phoneNumber,
    depositItem: payload.depositItem,
    depositAmount: payload.depositAmount,
    timestamp: payload.timestamp,
    // Fulfilment status from the sheet's dropdown (defaults to pending).
    status: nextStatus,
    deletedAt: payload.deleted ? nowIso : null,
    updatedAtIso: nowIso,
    source: 'sheet',
  };

  const maskFields = Object.keys(businessFields);
  const fields = { ...businessFields };

  if (nextStatus === 'received' && prevStatus !== 'received') {
    fields.receivedAtIso = nowIso;
    maskFields.push('receivedAtIso');
  } else if (nextStatus !== 'received' && prevStatus === 'received') {
    fields.receivedAtIso = null;
    maskFields.push('receivedAtIso');
  }

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
