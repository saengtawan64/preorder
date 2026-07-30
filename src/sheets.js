/**
 * Google Sheets integration.
 *
 * Reads come from a published-to-web CSV URL; writes go to an Apps Script Web
 * App endpoint. Both are best-effort — the app treats Sheets as a mirror, not
 * as the source of truth.
 */

import { getSheetCsvUrl, getSheetScriptUrl } from './config.js';
import { parseCsv, parseAmount, formatPhone } from './utils.js';

/**
 * Column order of the published sheet, matching Deposit_Sheet_Template.csv:
 * timestamp, firstName, nickname, phoneNumber, depositItem, depositAmount
 */
const COL = {
  timestamp: 0,
  firstName: 1,
  nickname: 2,
  phoneNumber: 3,
  depositItem: 4,
  depositAmount: 5,
};

/**
 * Fetch and parse every deposit row from the published sheet.
 *
 * Returns rows oldest-first as they appear in the sheet; the caller decides the
 * display order. Throws when the sheet cannot be reached so the caller can
 * surface the failure rather than silently showing nothing.
 */
export async function fetchDepositsFromSheet() {
  const url = getSheetCsvUrl();
  if (!url) throw new Error('No Google Sheet CSV URL configured');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Sheet fetch failed with status ${response.status}`);
  }

  const rows = parseCsv(await response.text());
  const records = [];

  // Row 0 is the header.
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 4) continue;

    const hasIdentity = row[COL.timestamp] || row[COL.firstName] || row[COL.phoneNumber];
    if (!hasIdentity) continue;

    records.push({
      id: `sheet-${i}`,
      timestamp: row[COL.timestamp] || 'ไม่ระบุวันที่',
      firstName: row[COL.firstName] || '',
      nickname: row[COL.nickname] || '',
      phoneNumber: formatPhone(row[COL.phoneNumber] || ''),
      depositItem: row[COL.depositItem] || '',
      depositAmount: parseAmount(row[COL.depositAmount]),
      source: 'sheet',
    });
  }

  return records;
}

/**
 * Append a record to the sheet through the Apps Script Web App.
 *
 * Apps Script does not send CORS headers for this kind of endpoint, so the
 * request goes out as `no-cors`. That makes the response opaque: a resolved
 * promise means the request left the browser, not that the row was written.
 * Sheets is the mirror, so that trade-off is acceptable here — Firestore is
 * where a write failure actually matters.
 */
export async function postDepositToSheet(record) {
  const url = getSheetScriptUrl();
  if (!url) return false;

  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    return true;
  } catch (error) {
    console.error('Failed to post to Apps Script webhook:', error);
    return false;
  }
}
