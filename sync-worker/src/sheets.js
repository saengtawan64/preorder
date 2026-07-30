/**
 * Sheets API v4 client for the Deposits tab.
 *
 * Column layout (row 1 is a header the sheet already has):
 *   A depositId     (system use — do not edit)
 *   B วันที่และเวลา
 *   C ชื่อจริง
 *   D ชื่อเล่น
 *   E เบอร์โทร
 *   F สินค้าที่มัดจำ
 *   G ยอดมัดจำ (บาท)
 *   H สถานะ            ("ปกติ" or "ลบแล้ว" — soft-delete marker)
 *   I อัปเดตล่าสุด      (updatedAtIso — system use, lets onEdit tell a real
 *                        edit apart from this worker's own write)
 */

const RANGE_COLUMNS = 'A:I';

function rowFromDeposit(d) {
  return [
    d.depositId,
    d.timestamp || '',
    d.firstName || '',
    d.nickname || '',
    d.phoneNumber || '',
    d.depositItem || '',
    d.depositAmount ?? 0,
    d.deletedAt ? 'ลบแล้ว' : 'ปกติ',
    d.updatedAtIso || '',
  ];
}

function rowsEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((value, i) => String(value ?? '') === String(b[i] ?? ''));
}

async function sheetsFetch(path, token, init = {}) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) {
    throw new Error(`Sheets API ${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

/** Read every existing row, keyed by depositId (column A). */
async function readExistingRows(sheetId, tabName, token) {
  const encodedRange = encodeURIComponent(`'${tabName}'!${RANGE_COLUMNS}`);
  const data = await sheetsFetch(`${sheetId}/values/${encodedRange}`, token);
  const rows = data.values || [];

  const byDepositId = new Map();
  // Row 1 is the header; sheet rows are 1-indexed.
  for (let i = 1; i < rows.length; i++) {
    const depositId = rows[i][0];
    if (depositId) byDepositId.set(depositId, { rowNumber: i + 1, values: rows[i] });
  }
  return byDepositId;
}

/**
 * Upsert every deposit into the sheet: update the row if its content
 * changed, append it if it doesn't exist yet, skip it otherwise. Returns a
 * summary for logging.
 */
export async function syncDepositsToSheet(sheetId, tabName, token, deposits) {
  const existing = await readExistingRows(sheetId, tabName, token);

  const updates = [];
  const appends = [];

  for (const deposit of deposits) {
    const desired = rowFromDeposit(deposit);
    const current = existing.get(deposit.depositId);

    if (!current) {
      appends.push(desired);
      continue;
    }
    if (rowsEqual(current.values, desired)) continue;

    updates.push({
      range: `'${tabName}'!A${current.rowNumber}:I${current.rowNumber}`,
      values: [desired],
    });
  }

  if (updates.length > 0) {
    await sheetsFetch(`${sheetId}/values:batchUpdate`, token, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
    });
  }

  if (appends.length > 0) {
    const encodedRange = encodeURIComponent(`'${tabName}'!${RANGE_COLUMNS}`);
    const query = 'valueInputOption=RAW&insertDataOption=INSERT_ROWS';
    await sheetsFetch(`${sheetId}/values/${encodedRange}:append?${query}`, token, {
      method: 'POST',
      body: JSON.stringify({ values: appends }),
    });
  }

  return { updated: updates.length, appended: appends.length };
}
