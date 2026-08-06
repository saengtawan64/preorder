/**
 * PIN rate-limiting for /api/pin-login. A 5-digit PIN is only 100k
 * combinations, so guesses are lockout-limited per caller IP or a script
 * could walk the whole space in minutes.
 */

const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

/** Hash the caller IP — enough to count attempts without storing addresses. */
async function ipKey(ip) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compare without an early exit, so timing doesn't leak how much matched. */
export function timingSafeEquals(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Path this caller's attempt record lives at, namespaced per endpoint. */
export async function throttlePath(request, bucket) {
  const key = await ipKey(request.headers.get('CF-Connecting-IP') || 'unknown');
  return `settings/pinAttempts/${bucket}/${key}`;
}

export function isLockedOut(record) {
  return Boolean(record?.lockedUntil && Date.now() < Number(record.lockedUntil));
}

/** Record a failed attempt; returns whether this failure just triggered a lockout. */
export function recordFailure(record) {
  const now = Date.now();
  const fails = (record?.lockedUntil && now >= Number(record.lockedUntil) ? 0 : Number(record?.fails || 0)) + 1;
  const locked = fails >= MAX_ATTEMPTS;
  return {
    fields: { fails, lockedUntil: locked ? now + LOCKOUT_MS : 0, lastAtIso: new Date().toISOString() },
    locked,
    attemptsLeft: Math.max(MAX_ATTEMPTS - fails, 0),
  };
}

export const clearedFields = { fails: 0, lockedUntil: 0 };
