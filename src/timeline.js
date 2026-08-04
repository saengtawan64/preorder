/**
 * The model behind the deposit timeline.
 *
 * The pending list used to be grouped by the day a deposit was taken, which
 * answers "what came in when" — a question nobody asks. What the shop actually
 * needs to see is how long its money has been sitting in someone else's order,
 * and whether that time is piling up anywhere. So the view is an age scale, and
 * this file works out where each record sits on it.
 *
 * Kept free of DOM so the arithmetic can be tested on its own — the positions
 * are the whole feature, and a rail that puts a 90-day deposit halfway up is
 * worse than no rail at all.
 */

import { daysHeld, agingTone, WARN_DAYS, DANGER_DAYS } from './aging.js';

/** The bottom of the scale. Anything older pins to the end rather than running off. */
export const SCALE_MAX = 90;

/** Width of the window used to find where deposits pile up. */
const CLUSTER_WINDOW = 20;
/** Below this, "a cluster" is just noise — three points are not a pattern. */
const CLUSTER_MIN = 3;

/** Where a deposit sits on the rail, 0 (today) to 100 (SCALE_MAX or older). */
export function railPercent(days) {
  if (days === null || days === undefined) return 0;
  return Math.max(0, Math.min(100, (days / SCALE_MAX) * 100));
}

/**
 * How full a row's age bar is. Same scale as the rail, so a row and its dot
 * always agree — a bar that filled on a different scale would quietly
 * contradict the rail beside it.
 */
export const agePercent = railPercent;

/**
 * The densest CLUSTER_WINDOW-day stretch, or null when there isn't enough data
 * to claim one. Returned as the window actually occupied by records, not the
 * nominal window, so "40–60 วัน" means deposits really do sit between 40 and 60.
 */
export function densestWindow(dayList) {
  const days = dayList.filter((d) => Number.isFinite(d)).sort((a, b) => a - b);
  if (days.length < CLUSTER_MIN) return null;

  let best = null;
  for (let i = 0; i < days.length; i++) {
    // Every window that starts at a real data point; one of them is always the
    // densest, so there is no need to slide a window a day at a time.
    const end = days[i] + CLUSTER_WINDOW;
    let j = i;
    while (j + 1 < days.length && days[j + 1] <= end) j++;
    const count = j - i + 1;
    if (!best || count > best.count) best = { count, from: days[i], to: days[j] };
  }

  return best && best.count >= CLUSTER_MIN ? best : null;
}

/**
 * Everything the timeline view needs, in one pass.
 *
 * `records` must already be the pending ones: age is meaningless for a deposit
 * the customer has collected or cancelled.
 */
export function timelineModel(records, now = new Date()) {
  const nodes = records
    .map((record) => {
      const days = daysHeld(record, now);
      return {
        record,
        days,
        tone: agingTone(days),
        percent: railPercent(days),
      };
    })
    // Oldest first: this is a list of what needs chasing, and the oldest
    // deposit is both the most at risk and the least likely to be remembered.
    .sort((a, b) => (b.days ?? -1) - (a.days ?? -1));

  const overdue = nodes.filter((n) => n.days !== null && n.days >= WARN_DAYS);
  const cluster = densestWindow(nodes.map((n) => n.days).filter((d) => d !== null));

  return {
    nodes,
    total: nodes.reduce((sum, n) => sum + (Number(n.record.depositAmount) || 0), 0),
    overdueCount: overdue.length,
    overdueAmount: overdue.reduce((sum, n) => sum + (Number(n.record.depositAmount) || 0), 0),
    oldest: nodes.length ? (nodes[0].days ?? 0) : 0,
    cluster,
  };
}

export { WARN_DAYS, DANGER_DAYS, daysHeld, agingTone };
