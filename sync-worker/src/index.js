import { getAccessToken } from './google-auth.js';
import { listDeposits } from './firestore.js';
import { syncDepositsToSheet } from './sheets.js';

// Read-only for Firestore, read/write for Sheets — this worker only ever
// pushes Firestore's state into the sheet, never the other way. The Sheet
// side of the round trip is a separate Apps Script + Pages Function; see
// appsscript/onEditSync.gs and functions/api/sheet-webhook.js.
const SCOPES = [
  'https://www.googleapis.com/auth/datastore.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ');

async function runSync(env) {
  const serviceAccount = JSON.parse(env.GCP_SERVICE_ACCOUNT_KEY);
  const token = await getAccessToken(serviceAccount, SCOPES);

  const deposits = await listDeposits(env.FIRESTORE_PROJECT_ID, token);
  const result = await syncDepositsToSheet(env.SHEET_ID, env.SHEET_TAB_NAME, token, deposits);

  console.log(
    `Synced ${deposits.length} deposits: ${result.updated} updated, ${result.appended} appended`,
  );
  return result;
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      runSync(env).catch((error) => {
        // Cron failures are silent by default — log loudly so `wrangler tail`
        // (or Cloudflare's dashboard logs) actually shows a problem run.
        console.error('Sync failed:', error);
        throw error;
      }),
    );
  },

  // Manual trigger for testing — GET this Worker's URL with the right header.
  // Not meant for routine use; the cron trigger above is the real schedule.
  async fetch(request, env) {
    if (request.headers.get('X-Manual-Trigger') !== env.MANUAL_TRIGGER_SECRET) {
      return new Response('Not found', { status: 404 });
    }
    try {
      const result = await runSync(env);
      return Response.json(result);
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  },
};
