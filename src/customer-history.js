/**
 * Recognising a returning customer from the phone number already on every
 * deposit — no new field, no new collection. Staff type the phone number
 * first regardless, so this is the one signal available before anything else
 * about the customer has been entered.
 *
 * A phone number is a household, not a person: a match here means "this
 * number has mattered before", not "this is definitely the same customer".
 * Wording downstream must respect that — never claim identity, only history.
 */

import { phoneDigits } from './utils.js';

/**
 * Prior deposits under the same phone number, oldest first.
 *
 * `excludeId` drops the record currently open in the drawer, so editing a
 * deposit does not count it as its own history.
 */
export function findByPhone(records, phone, excludeId = null) {
  const digits = phoneDigits(phone);
  if (digits.length !== 10) return [];

  return records
    .filter((r) => r.id !== excludeId && phoneDigits(r.phoneNumber) === digits)
    .sort((a, b) => (a.createdAtIso || '').localeCompare(b.createdAtIso || ''));
}

/**
 * A summary of what a phone number's history means for the deposit about to
 * be taken. Returns null for a first-time number — the drawer shows nothing
 * rather than an empty "no history" note, which would be noise on every
 * first-time customer, the common case.
 */
export function summarizeHistory(records, phone, excludeId = null) {
  const prior = findByPhone(records, phone, excludeId);
  if (prior.length === 0) return null;

  let received = 0;
  let abandoned = 0;
  let pending = 0;
  for (const r of prior) {
    if (r.deletedAt) abandoned += 1;
    else if (r.status === 'received') received += 1;
    else pending += 1;
  }

  return {
    priorCount: prior.length,
    visitNumber: prior.length + 1,
    received,
    abandoned,
    pending,
    // The most recent prior item's own item/name — useful context when staff
    // want to confirm out loud that they have the right person.
    lastItem: prior[prior.length - 1]?.depositItem || '',
    lastName: prior[prior.length - 1]?.firstName || '',
  };
}

/**
 * The one-line note shown in the drawer. Abandoned history outranks a clean
 * record in what gets said first — a customer who has walked away from a
 * deposit before is the thing staff most need to know before taking another.
 */
export function historyMessage(summary) {
  if (!summary) return null;
  const { visitNumber, received, abandoned, pending } = summary;

  if (abandoned > 0) {
    return {
      tone: 'warn',
      text: `ลูกค้าเก่า · มัดจำครั้งที่ ${visitNumber} · เคยทิ้งมัดจำ ${abandoned} ครั้ง`,
    };
  }
  if (pending > 0) {
    return {
      tone: 'warn',
      text: `ลูกค้าเก่า · มัดจำครั้งที่ ${visitNumber} · มีรายการรออยู่แล้ว ${pending} รายการ`,
    };
  }
  return {
    tone: 'ok',
    text: `ลูกค้าเก่า · มัดจำครั้งที่ ${visitNumber} · มารับครบทุกครั้ง (${received})`,
  };
}
