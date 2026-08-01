/**
 * Apps Script for the DepositTracker sheet.
 *
 * The sheet is the shop's PRIMARY place to record deposits — not a mirror — so
 * this script has to make typing a row feel instant and tidy: it fills in the
 * date, the id and the default status for a brand-new row, and pushes every
 * finished row up to the web app.
 *
 * Column layout — ONE tab holds every deposit whatever its status:
 *   A วันที่และเวลา     filled in automatically for a new row
 *   B ชื่อจริง
 *   C ชื่อเล่น
 *   D เบอร์โทร
 *   E สินค้าที่มัดจำ
 *   F ยอดมัดจำ (บาท)
 *   G สถานะ             dropdown; changing it here updates the web app
 *   H depositId          system — hidden, filled automatically, never typed
 *   I อัปเดตล่าสุด       system — hidden
 *
 * Nothing is ever moved or blanked: a collected deposit just flips column G and
 * stays on its row, so the sheet is the permanent record.
 *
 * Writes made through the Sheets API (how the sync worker writes) do NOT fire
 * onEdit — Google only fires it for edits through the Sheets UI — so the
 * worker's writes never loop back, and the setValue() calls below don't
 * re-trigger this either.
 *
 * SETUP: paste into the sheet's Apps Script project, add Script Properties
 * SYNC_WEBHOOK_URL + SYNC_SHARED_SECRET, add an installable "On edit" trigger
 * for onEditInstallable, then run setupSheet() once from the editor (or use the
 * "DepositTracker" menu that appears in the sheet).
 */

const SHEET_NAME = 'Deposits';
const COLUMN_COUNT = 9; // A..I

// 1-based column positions, so the layout is stated once.
const COL = {
  timestamp: 1,   // A
  firstName: 2,   // B
  nickname: 3,    // C
  phone: 4,       // D
  item: 5,        // E
  amount: 6,      // F
  status: 7,      // G
  depositId: 8,   // H
  updatedAt: 9,   // I
};

const HEADER_ROW = [
  'วันที่และเวลา', 'ชื่อจริง', 'ชื่อเล่น', 'เบอร์โทร',
  'สินค้าที่มัดจำ', 'ยอดมัดจำ (บาท)', 'สถานะ', 'depositId', 'อัปเดตล่าสุด',
];

const STATUS_PENDING = 'รอการจัดส่งสินค้า';
const STATUS_RECEIVED = 'รับสินค้าแล้ว';
const STATUS_DELETED = 'ลบแล้ว';

/**
 * Display timestamp in Bangkok time with a Buddhist year, e.g. "1/8/2569 02:21".
 *
 * Built part-by-part on purpose. src/utils.js's bangkokTimestamp() produces the
 * byte-identical string, so a row reads the same whether it was typed here or
 * saved from the web — an earlier version used `new Date()` directly and left
 * rows like "Tue Aug 01 2569 02:21:42 GMT+0700 (Indochina Time)" next to Thai
 * ones. Keep the two in sync if this ever changes.
 */
function thaiTimestamp() {
  const d = new Date();
  const tz = 'Asia/Bangkok';
  const buddhistYear = Number(Utilities.formatDate(d, tz, 'yyyy')) + 543;
  return Utilities.formatDate(d, tz, 'd/M/') + buddhistYear + Utilities.formatDate(d, tz, ' HH:mm');
}

/** Strip "฿" / thousands separators so a typed amount still reads as a number. */
function toAmount(value) {
  if (typeof value === 'number') return value;
  const cleaned = String(value == null ? '' : value).replace(/[^\d.]/g, '');
  return Number(cleaned) || 0;
}

function onEditInstallable(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return;

  const row = e.range.getRow();
  if (row === 1) return; // header

  const rowRange = sheet.getRange(row, 1, 1, COLUMN_COUNT);
  const values = rowRange.getValues()[0];

  let timestamp = values[COL.timestamp - 1];
  const firstName = values[COL.firstName - 1];
  const nickname = values[COL.nickname - 1];
  const phoneNumber = values[COL.phone - 1];
  const depositItem = values[COL.item - 1];
  const depositAmount = values[COL.amount - 1];
  let status = values[COL.status - 1];
  let depositId = values[COL.depositId - 1];

  const hasContent = firstName || nickname || phoneNumber || depositItem || depositAmount;
  if (!hasContent && !depositId) return; // fully blank row — nothing to do

  // A brand-new row typed straight into the sheet: fill in what staff shouldn't
  // have to type. These setValue() calls don't re-fire this trigger.
  if (!depositId) {
    depositId = Utilities.getUuid();
    sheet.getRange(row, COL.depositId).setValue(depositId);
    if (!timestamp) {
      timestamp = thaiTimestamp();
      sheet.getRange(row, COL.timestamp).setValue(timestamp);
    }
    if (!status) {
      status = STATUS_PENDING;
      sheet.getRange(row, COL.status).setValue(status);
    }
  }

  // Don't publish a half-typed row. onEdit fires on every single cell, so a row
  // being filled in left-to-right would otherwise hit the webhook once per
  // keystroke-group and be rejected (it requires a name and a positive amount)
  // until the last field lands. Waiting for both keeps the sheet quiet while
  // typing; the row syncs the moment it is actually complete.
  const amount = toAmount(depositAmount);
  if (!firstName || amount <= 0) return;

  const props = PropertiesService.getScriptProperties();
  const webhookUrl = props.getProperty('SYNC_WEBHOOK_URL');
  const sharedSecret = props.getProperty('SYNC_SHARED_SECRET');
  if (!webhookUrl || !sharedSecret) {
    console.error('Script Properties SYNC_WEBHOOK_URL / SYNC_SHARED_SECRET are not set.');
    return;
  }

  const statusStr = String(status || '').trim();
  const payload = {
    depositId: String(depositId),
    timestamp: String(timestamp || ''),
    firstName: String(firstName),
    nickname: String(nickname || ''),
    phoneNumber: String(phoneNumber || ''),
    depositItem: String(depositItem || ''),
    depositAmount: amount,
    status: statusStr === STATUS_RECEIVED ? 'received' : 'pending',
    deleted: statusStr === STATUS_DELETED,
  };

  const response = UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { 'X-Sync-Secret': sharedSecret },
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() >= 300) {
    // Shows in Extensions > Apps Script > Executions when a sheet edit isn't
    // reaching the web — the place to look when troubleshooting.
    console.error(
      'Webhook call failed: ' + response.getResponseCode() + ' ' + response.getContentText(),
    );
  }
}

/** Adds a menu so setupSheet() can be run from the sheet, not the editor. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('DepositTracker')
    .addItem('จัดรูปแบบชีตให้สวยงาม', 'setupSheet')
    .addToUi();
}

/**
 * Lay out and style the sheet. Run once after pasting this script; safe to
 * re-run any time the sheet starts looking wrong — it rebuilds the same result.
 *
 * Presentation and validation only: it never reads or writes deposit values, so
 * it cannot disturb the sync.
 *
 * Note on hiding columns: the id column lives at H, away from column A, and the
 * sync worker writes rows at explicit A{n}:I{n} ranges rather than using
 * values.append. That combination is what makes hiding H and I safe — append
 * anchors on the first *visible* column, so with a hidden column A it used to
 * shift every new row one column right and duplicate deposits forever.
 */
function setupSheet() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('ไม่พบแท็บ ' + SHEET_NAME);

  const NAVY = '#0F172A';
  const MUTED = '#C5CAD3';
  const maxRows = Math.max(sh.getMaxRows(), 2);
  const numData = maxRows - 1;

  // --- header ---------------------------------------------------------------
  sh.getRange(1, 1, 1, COLUMN_COUNT).setValues([HEADER_ROW])
    .setBackground(NAVY).setFontColor('#FFFFFF').setFontWeight('bold')
    .setFontSize(11).setFontFamily('Sarabun')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setFrozenRows(1);
  sh.setRowHeight(1, 42);
  sh.setTabColor('#0F172A');

  // --- body -----------------------------------------------------------------
  sh.setRowHeights(2, numData, 30);
  sh.getRange(2, 1, numData, COLUMN_COUNT)
    .setFontFamily('Sarabun').setFontSize(10).setFontColor('#1E293B')
    .setVerticalAlignment('middle');

  sh.getRange(2, COL.timestamp, numData, 1).setHorizontalAlignment('center');
  sh.getRange(2, COL.firstName, numData, 2).setHorizontalAlignment('left');
  sh.getRange(2, COL.phone, numData, 1).setHorizontalAlignment('center');
  sh.getRange(2, COL.item, numData, 1).setHorizontalAlignment('left').setWrap(true);
  sh.getRange(2, COL.amount, numData, 1)
    .setNumberFormat('"฿"#,##0').setHorizontalAlignment('right')
    .setFontWeight('bold').setFontColor(NAVY);
  sh.getRange(2, COL.status, numData, 1).setHorizontalAlignment('center').setFontWeight('bold');
  sh.getRange(2, COL.depositId, numData, 2).setFontColor(MUTED).setFontSize(8);

  // --- columns --------------------------------------------------------------
  [150, 120, 100, 130, 260, 130, 170, 60, 60].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });
  sh.showColumns(1, COLUMN_COUNT);
  sh.hideColumns(COL.depositId, 2); // H (id) + I (updatedAt) — system only

  // --- alternating stripes (rebuilt so re-running stays idempotent) ----------
  // Clear any hard-set cell background first. Rows appended by the old sync
  // inherited the header's dark navy, and hand-colouring left other rows tinted;
  // an explicit background always wins over banding and conditional formatting,
  // so those rows would keep showing the wrong colour otherwise.
  sh.getRange(2, 1, numData, COLUMN_COUNT).setBackground(null);
  sh.getBandings().forEach(function (b) { b.remove(); });
  sh.getRange(2, 1, numData, COLUMN_COUNT).applyRowBanding()
    .setHeaderRowColor(null).setFooterRowColor(null)
    .setFirstRowColor('#FFFFFF').setSecondRowColor('#F1F5F9');

  // --- status dropdown + colours -------------------------------------------
  const statusCol = sh.getRange(2, COL.status, numData, 1);
  statusCol.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList([STATUS_PENDING, STATUS_RECEIVED, STATUS_DELETED], true)
      .setAllowInvalid(false)
      .build(),
  );

  // Chip rules come first so a deleted row keeps its red status chip while the
  // rest of the row greys out.
  const dataRange = sh.getRange(2, 1, numData, COLUMN_COUNT);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(STATUS_PENDING).setBackground('#FEF3C7').setFontColor('#92400E').setBold(true)
      .setRanges([statusCol]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(STATUS_RECEIVED).setBackground('#DCFCE7').setFontColor('#166534').setBold(true)
      .setRanges([statusCol]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(STATUS_DELETED).setBackground('#FEE2E2').setFontColor('#991B1B').setBold(true)
      .setRanges([statusCol]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$G2="' + STATUS_DELETED + '"')
      .setBackground('#FEF2F2').setFontColor('#9CA3AF').setStrikethrough(true)
      .setRanges([dataRange]).build(),
  ]);

  ss.toast('จัดรูปแบบชีตเรียบร้อย', 'DepositTracker', 5);
}
