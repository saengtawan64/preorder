/**
 * Installable onEdit trigger for the Deposits sheet.
 *
 * Two jobs when staff edit the "Deposits" tab:
 *   1. A brand-new row (blank column A) gets an id, the current date/time, and
 *      the default status filled in automatically — so staff only type a name.
 *   2. Every edited row is mirrored into Firestore via the Cloudflare Pages
 *      Function (Sheet -> Firestore half of the two-way sync).
 *
 * The status column (H) is a dropdown:
 *   รอการจัดส่งสินค้า  → status "pending"   (waiting for the customer)
 *   รับสินค้าแล้ว       → status "received"  (collected; the sync worker moves
 *                                             this row to the "รับของแล้ว" tab)
 *   ลบแล้ว              → soft-deleted
 *
 * Writes made through the Sheets API (how the sync worker writes) do NOT fire
 * onEdit — Google only fires it for edits through the Sheets UI — so the
 * worker's own writes never loop back here, and the setValue() calls below
 * (which come from this script) don't re-trigger it either.
 *
 * SETUP: paste into the sheet's Apps Script project, add Script Properties
 * SYNC_WEBHOOK_URL + SYNC_SHARED_SECRET, then add an installable "On edit"
 * trigger for onEditInstallable.
 */

const SHEET_NAME = 'Deposits';
const COLUMN_COUNT = 9; // A..I

const STATUS_PENDING = 'รอการจัดส่งสินค้า';
const STATUS_RECEIVED = 'รับสินค้าแล้ว';
const STATUS_DELETED = 'ลบแล้ว';

/** Thai display timestamp (Buddhist year), matching what the web app writes. */
function thaiTimestamp() {
  const d = new Date();
  const tz = 'Asia/Bangkok';
  const buddhistYear = Number(Utilities.formatDate(d, tz, 'yyyy')) + 543;
  return (
    Utilities.formatDate(d, tz, 'd/M/') + buddhistYear + Utilities.formatDate(d, tz, ' HH:mm:ss')
  );
}

function onEditInstallable(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return;
  if (e.range.getRow() === 1) return; // header row

  const row = e.range.getRow();
  const rowRange = sheet.getRange(row, 1, 1, COLUMN_COUNT);
  let [depositId, timestamp, firstName, nickname, phoneNumber, depositItem, depositAmount, status] =
    rowRange.getValues()[0];

  const hasContent = firstName || nickname || phoneNumber || depositItem;
  if (!hasContent && !depositId) return; // a fully blank row — nothing to sync

  // A brand-new row typed straight into the sheet: fill in the fields staff
  // shouldn't have to type. These setValue() calls don't re-fire this trigger.
  if (!depositId) {
    depositId = Utilities.getUuid();
    sheet.getRange(row, 1).setValue(depositId);
    if (!timestamp) {
      timestamp = thaiTimestamp();
      sheet.getRange(row, 2).setValue(timestamp);
    }
    if (!status) {
      status = STATUS_PENDING;
      sheet.getRange(row, 8).setValue(status);
    }
  }

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
    firstName: String(firstName || ''),
    nickname: String(nickname || ''),
    phoneNumber: String(phoneNumber || ''),
    depositItem: String(depositItem || ''),
    depositAmount: Number(depositAmount) || 0,
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

/**
 * One-time setup: run this manually once from the Apps Script editor.
 *   1. Creates the "รับของแล้ว" archive tab (same 9-column header) if missing.
 *   2. Puts the status dropdown on column H of both tabs.
 * Safe to run again — it skips whatever already exists.
 */
function setupSheet() {
  const ss = SpreadsheetApp.getActive();
  const active = ss.getSheetByName(SHEET_NAME);
  if (!active) throw new Error('ไม่พบแท็บ ' + SHEET_NAME);

  const RECEIVED_NAME = 'รับของแล้ว';
  let received = ss.getSheetByName(RECEIVED_NAME);
  if (!received) {
    // Copy keeps the header row and formatting; clear any data rows after.
    received = active.copyTo(ss).setName(RECEIVED_NAME);
    const lastRow = received.getLastRow();
    if (lastRow > 1) received.getRange(2, 1, lastRow - 1, COLUMN_COUNT).clearContent();
  }

  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList([STATUS_PENDING, STATUS_RECEIVED, STATUS_DELETED], true)
    .setAllowInvalid(false)
    .build();
  [active, received].forEach(function (sh) {
    sh.getRange(2, 8, 1000, 1).setDataValidation(rule);
  });

  SpreadsheetApp.getActive().toast('ตั้งค่าแท็บ "รับของแล้ว" + dropdown สถานะ เรียบร้อย', 'setupSheet', 5);
}

/**
 * Make both tabs look tidy. Run once from the editor (safe to re-run — it
 * rebuilds the same styles each time).
 */
function beautifySheet() {
  const ss = SpreadsheetApp.getActive();
  ['Deposits', 'รับของแล้ว'].forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const maxRows = Math.max(sh.getMaxRows(), 2);

    // Header: bold white on dark blue, centred, frozen.
    sh.getRange(1, 1, 1, 9)
      .setBackground('#1f3864').setFontColor('#ffffff').setFontWeight('bold')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    sh.setFrozenRows(1);
    sh.setRowHeight(1, 36);

    // Sensible column widths.
    [220, 155, 120, 100, 120, 180, 120, 150, 185].forEach(function (w, i) {
      sh.setColumnWidth(i + 1, w);
    });

    // Amount as Thai baht, right-aligned; system columns small and muted.
    sh.getRange(2, 7, maxRows - 1, 1).setNumberFormat('"฿"#,##0').setHorizontalAlignment('right');
    sh.getRange(2, 1, maxRows - 1, 1).setFontColor('#9aa0a6').setFontSize(8);
    sh.getRange(2, 9, maxRows - 1, 1).setFontColor('#9aa0a6').setFontSize(8);

    // Alternating row stripes (rebuild to stay idempotent).
    sh.getBandings().forEach(function (b) { b.remove(); });
    sh.getRange(2, 1, maxRows - 1, 9)
      .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);

    // Whole-row tint by status (replaces this tab's conditional-format rules).
    const dataRange = sh.getRange(2, 1, maxRows - 1, 9);
    sh.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$H2="ลบแล้ว"').setBackground('#fdecea').setRanges([dataRange]).build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$H2="รับสินค้าแล้ว"').setBackground('#e6f4ea').setRanges([dataRange]).build(),
    ]);
  });
  ss.toast('ตกแต่งชีตเรียบร้อย', 'beautifySheet', 5);
}
