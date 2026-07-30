/**
 * Installable onEdit trigger for the Deposits sheet.
 *
 * Sends every manual edit to the Cloudflare Pages Function at
 * functions/api/sheet-webhook.js, which mirrors it into Firestore. This is
 * the Sheet -> Firestore half of the two-way sync; the other half
 * (Firestore -> Sheet) is the cron worker in sync-worker/.
 *
 * Why this doesn't loop back on itself: edits made through the Sheets API
 * (which is how sync-worker writes) do NOT fire onEdit — only edits made
 * through the spreadsheet UI do. So the worker's own writes are invisible to
 * this trigger, and there is nothing to guard against here.
 *
 * SETUP (see README "Console setup checklist" for the full walkthrough):
 *   1. Open the Deposits sheet -> Extensions -> Apps Script.
 *   2. Paste this file in as a script file.
 *   3. Project Settings (gear icon) -> Script Properties -> add:
 *        SYNC_WEBHOOK_URL   = https://<your-site>.pages.dev/api/sheet-webhook
 *        SYNC_SHARED_SECRET = <same value as the SYNC_SHARED_SECRET Pages secret>
 *   4. Triggers (clock icon) -> Add Trigger -> onEditInstallable ->
 *      "On edit" (installable, not the simple trigger) -> Save, and
 *      authorize when prompted.
 */

const SHEET_NAME = 'Deposits';
const COLUMN_COUNT = 9; // A..I, see sync-worker/src/sheets.js for the layout

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

  if (!depositId) {
    // A brand-new row typed straight into the sheet needs an id before it can
    // be synced anywhere; write it back so this row has a stable identity
    // from here on. This write does not fire onEdit again (see file header).
    depositId = Utilities.getUuid();
    sheet.getRange(row, 1).setValue(depositId);
  }

  const props = PropertiesService.getScriptProperties();
  const webhookUrl = props.getProperty('SYNC_WEBHOOK_URL');
  const sharedSecret = props.getProperty('SYNC_SHARED_SECRET');
  if (!webhookUrl || !sharedSecret) {
    console.error('Script Properties SYNC_WEBHOOK_URL / SYNC_SHARED_SECRET are not set — see setup instructions in this file.');
    return;
  }

  const payload = {
    depositId: String(depositId),
    timestamp: String(timestamp || ''),
    firstName: String(firstName || ''),
    nickname: String(nickname || ''),
    phoneNumber: String(phoneNumber || ''),
    depositItem: String(depositItem || ''),
    depositAmount: Number(depositAmount) || 0,
    deleted: String(status || '').trim() === 'ลบแล้ว',
  };

  const response = UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { 'X-Sync-Secret': sharedSecret },
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() >= 300) {
    // Surfaced in Extensions > Apps Script > Executions if a sheet edit isn't
    // showing up on the web — that's the place to look when troubleshooting.
    console.error(
      'Webhook call failed: ' + response.getResponseCode() + ' ' + response.getContentText(),
    );
  }
}
