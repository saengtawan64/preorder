/**
 * Sheets API v4 client for the two Deposits tabs.
 *
 * Column layout (row 1 is a header both tabs already have):
 *   A depositId     (system use — do not edit)
 *   B วันที่และเวลา
 *   C ชื่อจริง
 *   D ชื่อเล่น
 *   E เบอร์โทร
 *   F สินค้าที่มัดจำ
 *   G ยอดมัดจำ (บาท)
 *   H สถานะ            (dropdown: รอการจัดส่งสินค้า / รับสินค้าแล้ว / ลบแล้ว)
 *   I อัปเดตล่าสุด      (updatedAtIso — system use, lets onEdit tell a real
 *                        edit apart from this worker's own write)
 *
 * Two tabs:
 *   activeTab   ("Deposits")   — pending deposits (and soft-deleted ones,
 *                                marked "ลบแล้ว").
 *   receivedTab ("รับของแล้ว") — the archive of deposits the customer collected.
 *
 * When a deposit flips to received it is appended to receivedTab and its old
 * row in activeTab is blanked out (a move). Blank rows are ignored on read, so
 * they are harmless; we never delete rows (which would shift row numbers and
 * fight with anyone editing the sheet).
 */

const RANGE_COLUMNS = 'A:I';
const EMPTY_ROW = ['', '', '', '', '', '', '', '', ''];

const STATUS_PENDING = 'รอการจัดส่งสินค้า';
const STATUS_RECEIVED = 'รับสินค้าแล้ว';
const STATUS_DELETED = 'ลบแล้ว';

function statusText(d) {
  if (d.deletedAt) return STATUS_DELETED;
  if (d.status === 'received') return STATUS_RECEIVED;
  return STATUS_PENDING;
}

function rowFromDeposit(d) {
  return [
    d.depositId,
    d.timestamp || '',
    d.firstName || '',
    d.nickname || '',
    d.phoneNumber || '',
    d.depositItem || '',
    d.depositAmount ?? 0,
    statusText(d),
    d.updatedAtIso || '',
  ];
}

/** A collected (received, not deleted) deposit lives in the archive tab. */
function isArchived(d) {
  return d.status === 'received' && !d.deletedAt;
}

function rowsEqual(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
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

/** Read every existing row of a tab, keyed by depositId (column A). */
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

const HEADER_ROW = [
  'depositId', 'วันที่และเวลา', 'ชื่อจริง', 'ชื่อเล่น', 'เบอร์โทร',
  'สินค้าที่มัดจำ', 'ยอดมัดจำ (บาท)', 'สถานะ', 'อัปเดตล่าสุด',
];

/**
 * Make sure the sheet is structured for two-tab syncing: the "รับของแล้ว"
 * archive tab exists (with a header), and column H of both tabs has the status
 * dropdown. Runs once — when the archive tab already exists, it does nothing —
 * so the shop owner never has to set the sheet up by hand.
 */
async function ensureSheetStructure(sheetId, activeTab, receivedTab, token) {
  const meta = await sheetsFetch(`${sheetId}?fields=sheets(properties(sheetId,title))`, token);
  const idByTitle = {};
  for (const s of meta.sheets || []) idByTitle[s.properties.title] = s.properties.sheetId;

  if (idByTitle[receivedTab] !== undefined) return; // already set up

  // Create the archive tab and remember its numeric id.
  const added = await sheetsFetch(`${sheetId}:batchUpdate`, token, {
    method: 'POST',
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: receivedTab } } }] }),
  });
  idByTitle[receivedTab] = added.replies[0].addSheet.properties.sheetId;

  // Header row on the new tab.
  const headerRange = encodeURIComponent(`'${receivedTab}'!A1:I1`);
  await sheetsFetch(`${sheetId}/values/${headerRange}?valueInputOption=RAW`, token, {
    method: 'PUT',
    body: JSON.stringify({ values: [HEADER_ROW] }),
  });

  // Status dropdown on column H (rows 2..1001) of both tabs. strict:false so
  // the worker's own RAW writes are never rejected; the dropdown just guides
  // staff editing in the UI.
  const dropdown = [activeTab, receivedTab]
    .filter((t) => idByTitle[t] !== undefined)
    .map((t) => ({
      setDataValidation: {
        range: {
          sheetId: idByTitle[t],
          startRowIndex: 1,
          endRowIndex: 1001,
          startColumnIndex: 7,
          endColumnIndex: 8,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: STATUS_PENDING },
              { userEnteredValue: STATUS_RECEIVED },
              { userEnteredValue: STATUS_DELETED },
            ],
          },
          showCustomUi: true,
          strict: false,
        },
      },
    }));
  await sheetsFetch(`${sheetId}:batchUpdate`, token, {
    method: 'POST',
    body: JSON.stringify({ requests: dropdown }),
  });
}

/**
 * Mirror every deposit into the right tab: pending → activeTab, received →
 * receivedTab, moving rows between the two when a deposit's status flips.
 * Returns a summary for logging.
 */
export async function syncDepositsToSheet(sheetId, activeTab, receivedTab, token, deposits) {
  await ensureSheetStructure(sheetId, activeTab, receivedTab, token);

  const tabs = {
    [activeTab]: await readExistingRows(sheetId, activeTab, token),
    [receivedTab]: await readExistingRows(sheetId, receivedTab, token),
  };

  const batch = []; // value-range updates: row rewrites and blank-outs
  const appends = { [activeTab]: [], [receivedTab]: [] };

  for (const deposit of deposits) {
    const target = isArchived(deposit) ? receivedTab : activeTab;
    const other = target === activeTab ? receivedTab : activeTab;
    const desired = rowFromDeposit(deposit);

    const inTarget = tabs[target].get(deposit.depositId);
    if (!inTarget) {
      appends[target].push(desired);
    } else if (!rowsEqual(inTarget.values, desired)) {
      batch.push({ range: `'${target}'!A${inTarget.rowNumber}:I${inTarget.rowNumber}`, values: [desired] });
    }

    // If the record also still occupies a row in the other tab, it just moved —
    // blank that stale row so it doesn't show in both places.
    const inOther = tabs[other].get(deposit.depositId);
    if (inOther) {
      batch.push({ range: `'${other}'!A${inOther.rowNumber}:I${inOther.rowNumber}`, values: [EMPTY_ROW] });
    }
  }

  if (batch.length > 0) {
    await sheetsFetch(`${sheetId}/values:batchUpdate`, token, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data: batch }),
    });
  }

  let appendedCount = 0;
  for (const tab of [activeTab, receivedTab]) {
    if (appends[tab].length === 0) continue;
    appendedCount += appends[tab].length;
    const encodedRange = encodeURIComponent(`'${tab}'!${RANGE_COLUMNS}`);
    const query = 'valueInputOption=RAW&insertDataOption=INSERT_ROWS';
    await sheetsFetch(`${sheetId}/values/${encodedRange}:append?${query}`, token, {
      method: 'POST',
      body: JSON.stringify({ values: appends[tab] }),
    });
  }

  return { updated: batch.length, appended: appendedCount };
}
