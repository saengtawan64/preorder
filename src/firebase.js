/**
 * Firestore access layer.
 *
 * The Firebase SDK is bundled from npm rather than pulled off the gstatic CDN,
 * so the page needs no third-party script-src and Vite can tree-shake down to
 * just the Firestore surface used here. Everything degrades quietly: if
 * Firebase is not configured the app still works against Google Sheets alone.
 */

import { getApps, initializeApp } from 'firebase/app';
import {
  getFirestore,
  addDoc,
  deleteDoc,
  doc,
  collection,
  serverTimestamp,
  query,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';

const COLLECTION = 'deposits';

let db = null;
let app = null;

/** True once initFirebase() has succeeded. */
export function isFirebaseReady() {
  return db !== null;
}

/**
 * Initialise Firebase from a web config object.
 * Returns true when Firestore is ready to use.
 */
export function initFirebase(config) {
  try {
    if (!config || !config.projectId) {
      console.warn('Firebase config missing or invalid');
      return false;
    }

    app = getApps().length === 0 ? initializeApp(config) : getApps()[0];
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
    console.warn('Firestore is not initialized');
    return false;
  }

  try {
    const ref = await addDoc(collection(db, COLLECTION), {
      firstName: record.firstName || '',
      nickname: record.nickname || '',
      phoneNumber: record.phoneNumber || '',
      depositItem: record.depositItem || '',
      depositAmount: Number(record.depositAmount) || 0,
      timestamp: record.timestamp || new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
      createdAt: serverTimestamp(),
    });
    return ref.id;
  } catch (error) {
    console.error('Error adding document to Firestore:', error);
    return false;
  }
}

/**
 * Delete a deposit by document id.
 *
 * Ids are Firestore strings; records that came from the CSV sheet or from a
 * local-only submission have numeric ids and are not deletable here, so those
 * are rejected up front rather than issuing a doomed request.
 */
export async function deleteDeposit(id) {
  if (!db) return false;
  if (typeof id !== 'string' || id === '') return false;

  try {
    await deleteDoc(doc(db, COLLECTION, id));
    return true;
  } catch (error) {
    console.error('Error deleting document from Firestore:', error);
    return false;
  }
}

/**
 * Subscribe to the deposits collection, newest first.
 *
 * The callback fires on every snapshot including empty ones, so a deletion that
 * empties the collection is reflected in the UI. Returns the unsubscribe
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
