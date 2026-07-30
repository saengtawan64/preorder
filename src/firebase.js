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
  addDoc,
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
 * Append a deposit record. Resolves to the new document id, or false when the
 * write could not be made.
 */
export async function addDeposit(record) {
  if (!db) {
    console.error('Firestore is not initialized');
    return false;
  }

  const nowIso = new Date().toISOString();

  try {
    const ref = await addDoc(collection(db, COLLECTION), {
      depositId: record.depositId,
      firstName: record.firstName || '',
      nickname: record.nickname || '',
      phoneNumber: record.phoneNumber || '',
      depositItem: record.depositItem || '',
      depositAmount: Number(record.depositAmount) || 0,
      timestamp: record.timestamp || new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
      source: 'web',
      deletedAt: null,
      createdAt: serverTimestamp(),
    });
    return ref.id;
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
 * Subscribe to the deposits collection, newest first.
 *
 * Soft-deleted records are filtered out here rather than in the query, since
 * a `where(deletedAt == null)` alongside `orderBy(createdAt)` would need a
 * composite index — not worth it at shop scale. Fires for empty snapshots
 * too, so deleting the last record clears the UI. Returns the unsubscribe
 * function, or null when Firestore is unavailable.
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
          const data = docSnap.data();
          if (data.deletedAt) return;
          records.push({ id: docSnap.id, ...data });
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
