/** Small formatting and parsing helpers shared across the app. */

/** Escape a value for safe interpolation into an innerHTML template. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[ch]);
}

/** Format a Thai mobile number as 0XX-XXX-XXXX while it is being typed. */
export function formatPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 10);
  if (!digits) return String(value ?? '');
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

/** Strip formatting from a phone number, leaving up to 10 digits. */
export function phoneDigits(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 10);
}

/** A valid Thai mobile number is 10 digits starting with 0. */
export function isValidPhone(value) {
  const digits = phoneDigits(value);
  return digits.length === 10 && digits.startsWith('0');
}

/** Coerce a sheet cell (possibly "฿1,500") into a number. */
export function parseAmount(value) {
  if (typeof value === 'number') return value;
  const cleaned = String(value ?? '').replace(/[^\d.]/g, '');
  return parseFloat(cleaned) || 0;
}

/** Render an amount as Thai baht. */
export function formatBaht(value) {
  return '฿' + Number(value || 0).toLocaleString('th-TH');
}

/**
 * Current wall-clock timestamp in Bangkok, e.g. "1/8/2569 02:21".
 *
 * Built part-by-part rather than with toLocaleString('th-TH'): that helper's
 * exact output (separator, comma, seconds, digit shapes) depends on the
 * browser's ICU build, so the same save could land in the Sheet as
 * "1/8/2569 02:21:42" from one machine and "1/8/2569, 02:21" from another —
 * and Apps Script's own formatter produced a third shape again. This is the one
 * canonical format; appsscript/onEditSync.gs's thaiTimestamp() builds the exact
 * same string, so a row reads identically whether it was typed into the Sheet
 * or saved from the web.
 */
export function bangkokTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
  const buddhistYear = Number(get('year')) + 543;

  return `${Number(get('day'))}/${Number(get('month'))}/${buddhistYear} ${get('hour')}:${get('minute')}`;
}

/**
 * The date half of a timestamp produced by bangkokTimestamp(), e.g. "30/7/2569".
 * Records grouped by this string are grouped by calendar day.
 */
export function datePart(timestamp) {
  const text = String(timestamp ?? '').trim();
  if (!text) return '';
  return text.split(' ')[0] || '';
}

/** Today's date in the same format datePart() returns. */
export function todayDatePart() {
  return datePart(bangkokTimestamp());
}

/**
 * Parse a d/m/yyyy date part into a sortable key. Returns null when the string
 * is not a recognisable date, so callers can push those groups to the end.
 */
export function dateSortKey(part) {
  const match = String(part ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return Number(year) * 10000 + Number(month) * 100 + Number(day);
}

/** Parse CSV text into rows, honouring quoted fields and embedded newlines. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(field.trim());
      field = '';
      continue;
    }

    if ((ch === '\r' || ch === '\n') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(field.trim());
      field = '';
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    field += ch;
  }

  if (field || row.length > 0) {
    row.push(field.trim());
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }

  return rows;
}

/** Quote a single value for inclusion in a CSV line. */
export function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}
