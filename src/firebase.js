/**
 * Firestore access layer.
 *
 * Firestore is now the only backend the browser talks to directly — there is
 * no Google Sheets fallback on the client. The Sheet still exists as a synced
 * mirror, but that sync happens server-side (a Cloudflare Worker + an Apps
 * Script webhook), never from this code. See sync-worker/ and appsscript/.
 *
 * Every record carries a client-generated `depositId` (stable across systems)
 * and ISO timestamps, so the server-side sync can match rows reliably and so
 * sorting/filtering never depends on parsing the Thai display string.
 * Deletes are soft (`deletedAt` set) rather than removing the document, so a
 * row's identity never gets reused and the Sheet sync has something to mark.
 */

import { getApps, initializeApp } from 'firebase/app';
import {
  getFirestore,
  setDoc,
  updateDoc,
  doc,
  collection,
  serverTimestamp,
  query,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';

const COLLECTION = 'deposits';

let db = null;

/** True once initFirebase() has succeeded. */
export function isFirebaseReady() {
  return db !== null;
}

/** Initialise Firebase from a web config object. Returns true on success. */
export function initFirebase(config) {
  try {
    if (!config || !config.projectId) {
      console.error('Firebase config missing or invalid');
      return false;
    }

    const app = getApps().length === 0 ? initializeApp(config) : getApps()[0];
    db = getFirestore(app);
    return true;
  } catch (error) {
    console.error('Firebase initialization error:', error);
    db = null;
    return false;
  }
}

/**
 * Create a deposit record, using the caller-supplied `depositId` as the
 * Firestore document id itself (not an auto-generated one).
 *
 * This is what lets the server-side Sheet sync and the Sheet-edit webhook
 * address a record directly as `deposits/{depositId}` from either direction,
 * instead of having to look documents up by a field value.
 *
 * Resolves to the depositId on success, or false when the write failed.
 */
export async function addDeposit(record) {
  if (!db) {
    console.error('Firestore is not initialized');
    return false;
  }
  if (!record.depositId) {
    console.error('addDeposit requires a depositId');
    return false;
  }

  const nowIso = new Date().toISOString();

  try {
    await setDoc(doc(db, COLLECTION, record.depositId), {
      depositId: record.depositId,
      firstName: record.firstName || '',
      nickname: record.nickname || '',
      phoneNumber: record.phoneNumber || '',
      depositItem: record.depositItem || '',
      depositAmount: Number(record.depositAmount) || 0,
      timestamp: record.timestamp || new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
      // Fulfilment lifecycle: 'pending' (waiting for pickup) → 'received'
      // (customer collected the goods; archived out of the active list).
      status: 'pending',
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
      source: 'web',
      deletedAt: null,
      createdAt: serverTimestamp(),
    });
    return record.depositId;
  } catch (error) {
    console.error('Error adding document to Firestore:', error);
    return false;
  }
}

/**
 * Soft-delete a deposit: marks it deleted instead of removing the document.
 *
 * A hard delete would let the server-side Sheet sync reuse the row for a
 * future record, or leave a dangling depositId if the Sheet update lands
 * after the delete. Marking it keeps the row identity stable both ways.
 */
export async function softDeleteDeposit(id) {
  if (!db) return false;
  if (typeof id !== 'string' || id === '') return false;

  try {
    await updateDoc(doc(db, COLLECTION, id), {
      deletedAt: new Date().toISOString(),
      updatedAtIso: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.error('Error deleting document from Firestore:', error);
    return false;
  }
}

/**
 * Mark a deposit as received (customer collected the goods).
 *
 * Same shape as softDeleteDeposit — a minimal field update the security rules
 * allow — but it flips `status` to 'received' instead of soft-deleting. The
 * record then drops out of the active dashboard and shows in the history view;
 * the sync worker moves its row to the "รับของแล้ว" archive tab.
 */
export async function markReceivedDeposit(id) {
  if (!db) return false;
  if (typeof id !== 'string' || id === '') return false;

  try {
    await updateDoc(doc(db, COLLECTION, id), {
      status: 'received',
      updatedAtIso: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.error('Error marking document received in Firestore:', error);
    return false;
  }
}

/**
 * Subscribe to the deposits collection, newest first.
 *
 * Every record is passed through, soft-deleted ones included — the UI has a
 * "ลบแล้ว" view, and the sheet keeps deleted rows too, so hiding them here
 * would make the two disagree. Callers decide what to show; anything that
 * counts money must exclude records with `deletedAt` set. Fires for empty
 * snapshots too, so deleting the last record clears the UI. Returns the
 * unsubscribe function, or null when Firestore is unavailable.
 */
export function subscribeDeposits(onChange) {
  if (!db) return null;

  try {
    const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const records = [];
        snapshot.forEach((docSnap) => {
          records.push({ id: docSnap.id, ...docSnap.data() });
        });
        onChange(records);
      },
      (error) => {
        console.error('Firestore snapshot listener error:', error);
      },
    );
  } catch (error) {
    console.error('Failed to subscribe to Firestore:', error);
    return null;
  }
}
