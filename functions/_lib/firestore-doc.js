/**
 * Small Firestore REST helper for the app's own settings documents
 * (`settings/pins`, `settings/salesTargets`, `settings/pinAttempts/...`).
 *
 * These live outside the `deposits` collection, which firestore.rules denies to
 * clients entirely — the browser can never read or write them. Only Pages
 * Functions touch them, using the service account, after checking whoever is
 * asking. That is what keeps the login PINs off the client.
 */

function toValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return { doubleValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toValue) } };
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toValue(v)])) } };
  }
  throw new Error(`Unsupported value type for Firestore: ${typeof value}`);
}

function fromValue(value) {
  if (!value) return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('doubleValue' in value) return value.doubleValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromValue);
  if ('mapValue' in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, fromValue(v)]),
    );
  }
  return null;
}

const base = (projectId, path) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;

/** Read a document's fields as a plain object, or null when it doesn't exist. */
export async function getDocFields(projectId, token, path) {
  const response = await fetch(base(projectId, path), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Firestore get ${path} failed: ${response.status} ${await response.text()}`);
  }
  const doc = await response.json();
  return Object.fromEntries(
    Object.entries(doc.fields || {}).map(([k, v]) => [k, fromValue(v)]),
  );
}

/** Create or overwrite the given fields on a document. */
export async function setDocFields(projectId, token, path, fields) {
  const mask = Object.keys(fields)
    .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
    .join('&');

  const response = await fetch(`${base(projectId, path)}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, toValue(v)])),
    }),
  });

  if (!response.ok) {
    throw new Error(`Firestore set ${path} failed: ${response.status} ${await response.text()}`);
  }
}
