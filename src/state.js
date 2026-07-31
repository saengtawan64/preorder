/**
 * Application state.
 *
 * Deposits live in memory only — no localStorage cache. Before login there is
 * nothing to show anyway (Firestore rejects unauthenticated reads), and after
 * logout customer data must not sit in DevTools-visible storage on a shared
 * terminal. The real-time Firestore listener is the only source; a reload
 * just re-subscribes.
 *
 * Theme is the one thing worth persisting — it carries no customer data.
 */

const THEME_KEY = 'theme';

export const state = {
  theme: localStorage.getItem(THEME_KEY) || 'dark',
  isSignedIn: false,
  deposits: [],
};

export function persistTheme() {
  localStorage.setItem(THEME_KEY, state.theme);
}

/** Clears in-memory data on logout so nothing lingers past the session. */
export function resetOnSignOut() {
  state.deposits = [];
}
