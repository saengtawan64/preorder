/**
 * The shape of `settings/pins`, shared by the login check and the management
 * screen so the two can never disagree about what a stored PIN looks like.
 *
 * Current shape:  { entries: [{ pin, label, addedAtIso, role }], updatedAtIso }
 * Legacy shape:   { pins: ["10005", ...] }
 *
 * The legacy array is what the first version seeded from the STAFF_PINS secret.
 * `readEntries` still understands it, and the first write through
 * `entriesToFields` empties it — otherwise a PIN removed from `entries` would
 * live on in `pins`, and a later reader that preferred the old field would
 * silently accept a PIN the shop believes it deleted.
 *
 * `role` is 'admin' or 'staff'. Any entry written before roles existed (or the
 * legacy `pins` array) has no role field — those default to 'admin' so that
 * shipping this feature never silently locks out whoever is already using an
 * existing PIN; the shop can then tag individual PINs down to 'staff'.
 */

/** Every stored PIN, normalised, whichever shape the document is in. */
export function readEntries(doc) {
  if (Array.isArray(doc?.entries)) {
    return doc.entries
      .filter((entry) => entry && entry.pin)
      .map((entry) => ({
        pin: String(entry.pin),
        label: String(entry.label || ''),
        addedAtIso: String(entry.addedAtIso || ''),
        role: entry.role === 'staff' ? 'staff' : 'admin',
      }));
  }
  if (Array.isArray(doc?.pins)) {
    return doc.pins.filter(Boolean).map((pin) => ({ pin: String(pin), label: '', addedAtIso: '', role: 'admin' }));
  }
  return [];
}

/** The fields to write back for a new list, including the legacy cleanup. */
export function entriesToFields(entries) {
  return {
    entries: entries.map((entry) => ({
      pin: entry.pin,
      label: entry.label || '',
      addedAtIso: entry.addedAtIso || '',
      role: entry.role === 'staff' ? 'staff' : 'admin',
    })),
    pins: [],
    updatedAtIso: new Date().toISOString(),
  };
}

/**
 * "12345" -> "1•••5". Enough to recognise a PIN you already know, not enough to
 * use one you don't. The label is what actually tells two PINs apart — two of
 * the shop's PINs can easily share a first and last digit.
 */
export const maskPin = (pin) =>
  pin.length < 3 ? '•'.repeat(pin.length) : pin[0] + '•'.repeat(pin.length - 2) + pin[pin.length - 1];

/** What the browser is allowed to see: never the PIN itself. */
export const toPublic = (entries) =>
  entries.map((entry, index) => ({
    index,
    label: entry.label,
    hint: maskPin(entry.pin),
    addedAtIso: entry.addedAtIso,
    role: entry.role === 'staff' ? 'staff' : 'admin',
  }));
