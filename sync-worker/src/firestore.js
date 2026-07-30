/**
 * Minimal Firestore REST client — just enough to list the deposits collection.
 * This direction only reads Firestore; it never writes back (the Sheet is
 * the mirror here, not the other way around).
 */

function fromFirestoreValue(value) {
  if (value == null) return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('doubleValue' in value) return value.doubleValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  return null;
}

function fromFirestoreDocument(doc) {
  const fields = {};
  for (const [key, value] of Object.entries(doc.fields || {})) {
    fields[key] = fromFirestoreValue(value);
  }
  // The document's resource name ends in .../deposits/{depositId}.
  fields.depositId = fields.depositId || doc.name.split('/').pop();
  return fields;
}

/** List every document in the deposits collection, following pagination. */
export async function listDeposits(projectId, accessToken) {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/deposits`;
  const results = [];
  let pageToken = '';

  do {
    const url = new URL(base);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Firestore list failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    for (const doc of data.documents || []) {
      results.push(fromFirestoreDocument(doc));
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return results;
}
