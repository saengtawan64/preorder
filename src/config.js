/**
 * Runtime configuration.
 *
 * Every value resolves in the same order:
 *   1. localStorage  — what the user saved through the in-app setup modals
 *   2. build-time env — VITE_* vars baked in by Vite at build time
 *   3. nothing       — the caller decides how to degrade
 *
 * Note that VITE_* values are embedded in the published bundle and are
 * therefore public. Only put values here that are safe to expose (the
 * published-CSV URL, the Apps Script endpoint, the Firebase web config).
 * Anything that must stay private belongs behind Firestore security rules
 * or a server, not in this file.
 */

const LS_KEYS = {
  sheetCsvUrl: 'sheet_csv_url',
  sheetScriptUrl: 'sheet_script_url',
  firebaseConfig: 'firebase_config',
  adminPin: 'admin_pin',
  theme: 'theme',
  adminLoggedIn: 'admin_logged_in',
  deposits: 'deposits_data',
  lastSync: 'last_sync_time',
};

const DEFAULT_ADMIN_PIN = '1234';

function fromStorage(key) {
  const raw = localStorage.getItem(key);
  return raw && raw.trim() !== '' ? raw.trim() : null;
}

function fromEnv(name) {
  const raw = import.meta.env[name];
  return raw && String(raw).trim() !== '' ? String(raw).trim() : null;
}

/** Published Google Sheet CSV endpoint used to pull existing records. */
export function getSheetCsvUrl() {
  return fromStorage(LS_KEYS.sheetCsvUrl) || fromEnv('VITE_SHEET_CSV_URL') || '';
}

/** Apps Script Web App endpoint used to append new records to the sheet. */
export function getSheetScriptUrl() {
  return fromStorage(LS_KEYS.sheetScriptUrl) || fromEnv('VITE_SHEET_SCRIPT_URL') || '';
}

/**
 * Firebase web config, either pasted into the setup modal or supplied via env.
 * Returns null when neither source has a usable config.
 */
export function getFirebaseConfig() {
  const stored = fromStorage(LS_KEYS.firebaseConfig);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.projectId) return parsed;
    } catch {
      // Corrupt entry — fall through to env so the app still starts.
    }
  }

  const projectId = fromEnv('VITE_FIREBASE_PROJECT_ID');
  if (!projectId) return null;

  return {
    apiKey: fromEnv('VITE_FIREBASE_API_KEY'),
    authDomain: fromEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId,
    storageBucket: fromEnv('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: fromEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: fromEnv('VITE_FIREBASE_APP_ID'),
  };
}

/**
 * PIN that unlocks the admin dashboard.
 *
 * This gate only hides the dashboard UI — it is not access control. The PIN
 * ships in the client bundle and the underlying data is readable by anyone who
 * can reach the CSV URL or Firestore. See README "Security model".
 */
export function getAdminPin() {
  return fromStorage(LS_KEYS.adminPin) || fromEnv('VITE_ADMIN_PIN') || DEFAULT_ADMIN_PIN;
}

/** True when the admin PIN is still the shipped default. */
export function isUsingDefaultPin() {
  return getAdminPin() === DEFAULT_ADMIN_PIN;
}

export function saveSheetCsvUrl(url) {
  localStorage.setItem(LS_KEYS.sheetCsvUrl, url || '');
}

export function saveSheetScriptUrl(url) {
  localStorage.setItem(LS_KEYS.sheetScriptUrl, url || '');
}

export function saveFirebaseConfig(config) {
  localStorage.setItem(LS_KEYS.firebaseConfig, JSON.stringify(config));
}

export { LS_KEYS };
