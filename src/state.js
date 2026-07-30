/**
 * Application state plus its localStorage persistence.
 *
 * `deposits` is an offline cache so the dashboard renders instantly on load and
 * still shows something when the network is down. Firestore (when configured)
 * or the published sheet overwrites it on first successful read.
 */

import { LS_KEYS, getAdminPin } from './config.js';

function readCachedDeposits() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_KEYS.deposits) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const state = {
  theme: localStorage.getItem(LS_KEYS.theme) || 'dark',
  isAdminLoggedIn: localStorage.getItem(LS_KEYS.adminLoggedIn) === 'true',
  adminPin: getAdminPin(),
  isFirebaseActive: false,
  deposits: readCachedDeposits(),
  lastSyncTime: localStorage.getItem(LS_KEYS.lastSync) || null,
  isSyncing: false,
};

export function persistDeposits() {
  try {
    localStorage.setItem(LS_KEYS.deposits, JSON.stringify(state.deposits));
  } catch (error) {
    // Quota exceeded on a large dataset is not fatal — the live source still works.
    console.warn('Could not cache deposits locally:', error);
  }
}

export function persistTheme() {
  localStorage.setItem(LS_KEYS.theme, state.theme);
}

export function persistLoginState() {
  localStorage.setItem(LS_KEYS.adminLoggedIn, state.isAdminLoggedIn ? 'true' : 'false');
}

export function markSynced(date = new Date()) {
  state.lastSyncTime = date.toLocaleTimeString('th-TH');
  localStorage.setItem(LS_KEYS.lastSync, state.lastSyncTime);
}
