/**
 * How long a deposit has been sitting unclaimed.
 *
 * The shop already held this information — every record has `createdAtIso` —
 * but nothing ever looked at it, so a deposit taken in March and one taken
 * yesterday looked identical in the list. That matters because a pending
 * deposit is the shop holding the customer's money against an order: the
 * longer it sits, the more likely the customer has changed their mind, lost
 * the receipt, or changed their number.
 *
 * Counted in elapsed days rather than calendar days in Bangkok — "45 วัน" is
 * an age, not a date, so the timezone the record was created in doesn't
 * change the answer.
 */

export const WARN_DAYS = 30;
export const DANGER_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days since the deposit was taken, or null when the record predates
 * `createdAtIso` (a few early rows) — callers show nothing rather than "0 วัน",
 * which would wrongly read as "came in today".
 */
export function daysHeld(record, now = new Date()) {
  const created = record?.createdAtIso ? new Date(record.createdAtIso) : null;
  if (!created || Number.isNaN(created.getTime())) return null;

  const days = Math.floor((now.getTime() - created.getTime()) / DAY_MS);
  return days < 0 ? 0 : days;
}

/** '' | 'warn' | 'danger' — drives the badge colour and nothing else. */
export function agingTone(days) {
  if (days === null) return '';
  if (days >= DANGER_DAYS) return 'danger';
  if (days >= WARN_DAYS) return 'warn';
  return '';
}

/**
 * The headline figure: how much money is tied up in deposits older than
 * WARN_DAYS. Expects the pending records only — received and deleted ones are
 * settled and are not the shop's problem.
 */
export function agingSummary(pendingRecords, now = new Date()) {
  let count = 0;
  let amount = 0;
  let oldest = 0;

  for (const record of pendingRecords) {
    const days = daysHeld(record, now);
    if (days === null) continue;
    if (days > oldest) oldest = days;
    if (days < WARN_DAYS) continue;
    count += 1;
    amount += Number(record.depositAmount) || 0;
  }

  return { count, amount, oldest };
}
