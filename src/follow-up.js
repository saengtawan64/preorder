/**
 * Contacting a customer about a deposit that is ready.
 *
 * Two halves: the message the staff member sends, and the note that it was
 * sent. The note is what stops the same customer being called three times in
 * a week by three different people, or not at all because everyone assumed
 * someone else had.
 */

import { formatBaht } from './utils.js';

/**
 * The message to send. Addressed by nickname when there is one — that is how
 * the shop actually talks to customers — falling back to the full name.
 *
 * Plain text on purpose: it gets pasted into LINE or SMS, neither of which
 * renders anything, and a stray emoji or bullet would arrive as tofu on some
 * phones.
 */
export function buildMessage(record) {
  const name = (record.nickname || record.firstName || '').trim();
  const item = (record.depositItem || 'สินค้า').trim();
  const amount = formatBaht(record.depositAmount);

  return [
    `สวัสดีครับ${name ? ' คุณ' + name : ''}`,
    `${item} ที่มัดจำไว้ ${amount} เข้าแล้วนะครับ`,
    'รบกวนแวะมารับที่ร้านได้เลยครับ',
    'ร้าน Banana',
  ].join('\n');
}

/**
 * Record that the customer was contacted. Goes through the server for the same
 * reason editing does — firestore.rules refuses to let the browser write a
 * record's fields, and this is a field on the record.
 *
 * Returns the new follow-up state, or throws with a message worth showing.
 */
export async function markFollowedUp(idToken, depositId) {
  const response = await fetch('/api/follow-up', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ depositId }),
  });

  if (!response.ok) {
    const detail = response.status < 500 ? (await response.text()).trim() : '';
    throw new Error(detail || 'บันทึกการติดตามไม่สำเร็จ');
  }
  return response.json();
}
