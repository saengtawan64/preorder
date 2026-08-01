/**
 * Sheets API v4 client — mirrors Firestore into the single "Deposits" tab.
 *
 * Column layout (row 1 is the header):
 *   A วันที่และเวลา     display timestamp, same format the web writes
 *   B ชื่อจริง
 *   C ชื่อเล่น
 *   D เบอร์โทร
 *   E สินค้าที่มัดจำ
 *   F ยอดมัดจำ (บาท)
 *   G สถานะ             dropdown: รอการจัดส่งสินค้า / รับสินค้าแล้ว / ลบแล้ว
 *   H depositId          system — hidden in the UI, never typed by hand
 *   I อัปเดตล่าสุด       system (updatedAtIso) — hidden; lets onEdit tell a real
 *                        edit apart from this worker's own write
 *
 * ONE tab holds every deposit whatever its status. There is no archive tab and
 * nothing is ever moved or blanked: a collected deposit just flips column G to
 * "รับสินค้าแล้ว" and stays on its row, so the sheet doubles as the permanent
 * record. (An earlier design moved received rows to a "รับของแล้ว" tab and
 * blanked the original — that destroyed the row the shop wanted to keep.)
 *
 * Two rules this file exists to enforce, both learned from live breakage:
 *
 *  1. NEVER use values.append. It anchors on the first *visible* column, so a
 *     hidden column made every appended row land one column to the right,
 *     leaving the id column empty and re-appending the same deposit forever.
 *     With insertDataOption=INSERT_ROWS it also inherited the header's dark
 *     formatting into new rows and pushed the banded-range down. Rows are
 *     written at explicit A{n}:I{n} ranges instead — no format inheritance, no
 *     row insertion, and hiding columns stays safe.
 *
 *  2. Writes go through values.batchUpdate (values only). Formatting is set
 *     once by the sheet-setup script and never touched here, so the sheet keeps
 *     its banding and status colours run after run.
 *
 * Writes made through the Sheets API do NOT fire onEdit, so nothing here loops
 * back into the Sheet -> Firestore direction.
 */

const RANGE_COLUMNS = 'A:I';
const COLUMN_COUNT = 9;
const ID_COLUMN_INDEX = 7; // column H

const STATUS_PENDING = 'รอการจัดส่งสินค้า';
const STATUS_RECEIVED = 'รับสินค้าแล้ว';
const STATUS_DELETED = 'ลบแล้ว';

const HEADER_ROW = [
  'วันที่และเวลา', 'ชื่อจริง', 'ชื่อเล่น', 'เบอร์โทร',
  'สินค้าที่มัดจำ', 'ยอดมัดจำ (บาท)', 'สถานะ', 'depositId', 'อัปเดตล่าสุด',
];

function statusText(d) {
  if (d.deletedAt) return STATUS_DELETED;
  if (d.status === 'received') return STATUS_RECEIVED;
  return STATUS_PENDING;
}

function rowFromDeposit(d) {
  return [
    d.timestamp || '',
    d.firstName || '',
    d.nickname || '',
    d.phoneNumber || '',
    d.depositItem || '',
    d.depositAmount ?? 0,
    statusText(d),
    d.depositId,
    d.updatedAtIso || '',
  ];
}

function rowsEqual(a, b) {
  for (let i = 0; i < COLUMN_COUNT; i++) {
    if (String(a[i] ?? '') !== String(b[i] ?? '')) return false;
  }
  return true;
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

/**
 * Read every existing data row, keyed by depositId (column H).
 *
 * UNFORMATTED_VALUE so we compare the raw stored values rather than what the
 * cell's number format renders — otherwise the currency format on the amount
 * column ("฿5,000") never equals the plain number the sync writes (5000) and
 * every row looks changed on every run.
 */
async function readExistingRows(sheetId, tabName, token) {
  const encodedRange = encodeURIComponent(`'${tabName}'!${RANGE_COLUMNS}`);
  const data = await sheetsFetch(
    `${sheetId}/values/${encodedRange}?valueRenderOption=UNFORMATTED_VALUE`,
    token,
  );
  const rows = data.values || [];

  const byDepositId = new Map();
  let lastUsedRow = 1; // the header always occupies row 1

  // Row 1 is the header; sheet rows are 1-indexed.
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.some((cell) => cell !== '' && cell != null)) lastUsedRow = i + 1;

    const depositId = row[ID_COLUMN_INDEX];
    if (depositId) byDepositId.set(String(depositId), { rowNumber: i + 1, values: row });
  }

  return { byDepositId, lastUsedRow };
}

/** Grow the grid if new rows would fall past the last row that exists. */
async function ensureRowCapacity(sheetId, tabName, token, neededRow) {
  const meta = await sheetsFetch(
    `${sheetId}?fields=${encodeURIComponent('sheets(properties(sheetId,title,gridProperties(rowCount)))')}`,
    token,
  );
  const sheet = (meta.sheets || []).find((s) => s.properties.title === tabName);
  if (!sheet) throw new Error(`Sheet tab "${tabName}" not found`);

  const rowCount = sheet.properties.gridProperties?.rowCount ?? 0;
  if (neededRow <= rowCount) return;

  await sheetsFetch(`${sheetId}:batchUpdate`, token, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{
        appendDimension: {
          sheetId: sheet.properties.sheetId,
          dimension: 'ROWS',
          length: neededRow - rowCount + 100, // headroom so this is rare
        },
      }],
    }),
  });
}

/**
 * Mirror every deposit into the sheet: existing rows are updated in place,
 * new ones are written to the first free row below the data. Rows are never
 * moved, blanked, or deleted. Returns a summary for logging.
 */
export async function syncDepositsToSheet(sheetId, tabName, token, deposits) {
  const { byDepositId, lastUsedRow } = await readExistingRows(sheetId, tabName, token);

  const data = []; // value ranges to write in one batch
  let nextFreeRow = lastUsedRow + 1;
  let created = 0;
  let updated = 0;

  for (const deposit of deposits) {
    if (!deposit.depositId) continue;
    const desired = rowFromDeposit(deposit);
    const existing = byDepositId.get(String(deposit.depositId));

    if (existing) {
      if (rowsEqual(existing.values, desired)) continue;
      data.push({ range: `'${tabName}'!A${existing.rowNumber}:I${existing.rowNumber}`, values: [desired] });
      updated += 1;
    } else {
      const rowNumber = nextFreeRow++;
      data.push({ range: `'${tabName}'!A${rowNumber}:I${rowNumber}`, values: [desired] });
      created += 1;
    }
  }

  if (data.length === 0) return { created: 0, updated: 0 };

  if (created > 0) await ensureRowCapacity(sheetId, tabName, token, nextFreeRow - 1);

  // Header last-resort repair: cheap, and it keeps the id column labelled even
  // if someone clears it by hand. Values only — formatting is left alone.
  data.push({ range: `'${tabName}'!A1:I1`, values: [HEADER_ROW] });

  await sheetsFetch(`${sheetId}/values:batchUpdate`, token, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });

  return { created, updated };
}
