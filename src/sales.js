/**
 * Sales data for the back-office dashboard.
 *
 * Reads the shop's public sales spreadsheet straight from the browser. That is
 * a deliberate choice by the owner: this sheet is link-readable, the dashboard
 * only ever *displays* the numbers (nothing here writes), and going direct
 * avoids standing up a sync path for data that already lives in a sheet the
 * team maintains by hand.
 *
 * Note this is the opposite arrangement from the deposits sheet, which is
 * private and only ever touched server-side. Keep it that way — deposits carry
 * customer names and phone numbers; this one carries totals.
 *
 * Sheet layout (tab "ยอดขายรวม บานาน่าลานสัก"):
 *   row 3            header
 *   col 0            month marker on the first row of each block
 *                    ("เดือน มกราคม 2569" — spacing is inconsistent in the sheet)
 *   col 1            day of month, or "รวม" on the block's total row
 *   cols 2..17       the eight phone brands, each a [ยอดขาย, จำนวนเครื่อง] pair
 *   cols 18+         tablets, accessories, out-of-system sales, loan mix —
 *                    not used by this dashboard
 */

/**
 * The sheet's "publish to web" CSV endpoint.
 *
 * Two things to know before changing this:
 *  - Publishing is separate from link-sharing, so this keeps working even if
 *    the sheet's sharing is tightened later.
 *  - Google answers it with a 307 to a `doc-XX-XX-sheets.googleusercontent.com`
 *    host, and that hostname varies per request. The CSP in public/_headers has
 *    to allow `https://*.googleusercontent.com` in connect-src or the browser
 *    blocks the redirect and the fetch fails with a bare "Failed to fetch"
 *    (the violation is reported against docs.google.com, which is misleading).
 */
const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vScmRS5VCtLON--xd_4FnRvUAV8pASPi8bPOq57jYStFzh0C97JtaisyOLjoGyIecYXhyIDceK4-7Jh/pub?gid=614260076&single=true&output=csv';

/** The eight phone brands, and the column their [amount, units] pair starts at. */
export const BRANDS = [
  { key: 'OPPO', col: 2 },
  { key: 'VIVO', col: 4 },
  { key: 'SS', col: 6 },
  { key: 'REALME', col: 8 },
  { key: 'TECNO', col: 10 },
  { key: 'Honor', col: 12 },
  { key: 'XIAOMI', col: 14 },
  { key: 'IPHONE', col: 16 },
];

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** Parse a CSV blob, honouring quoted fields. */
function parseCsv(text) {
  return text.split(/\r?\n/).map((line) => {
    const cells = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        cells.push(field);
        field = '';
      } else {
        field += ch;
      }
    }
    cells.push(field);
    return cells;
  });
}

/** Sheet cells arrive as "16,999", "-", "" or blank — all of which mean a number or zero. */
function toNumber(value) {
  const cleaned = String(value ?? '').replace(/[^\d.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Read a month marker like "เดือน มกราคม 2569". The sheet is inconsistent about
 * spaces ("เดือนเมษายน 2569", "เดือน ธันวาคม2569"), so match on the month name
 * appearing anywhere in the cell rather than on an exact shape.
 */
function readMonthMarker(cell) {
  const text = String(cell ?? '');
  if (!text.includes('เดือน')) return null;

  const index = THAI_MONTHS.findIndex((name) => text.includes(name));
  if (index === -1) return null;

  const year = Number((text.match(/(\d{4})/) || [])[1]);
  if (!year) return null;

  return { month: index + 1, year, label: `${THAI_MONTHS[index]} ${year}` };
}

/**
 * Turn the sheet into one entry per month, newest last:
 *   { label, month, year, brands: { OPPO: { amount, units }, ... },
 *     totalAmount, totalUnits, activeDays }
 *
 * `activeDays` counts days that actually had a sale, not rows — every block in
 * the sheet has 31 day rows whatever the month's real length.
 *
 * Totals are summed from the daily rows rather than read off the sheet's own
 * "รวม" row, so a stale or hand-edited total can't silently skew the dashboard.
 */
export function parseSalesCsv(csvText) {
  const rows = parseCsv(csvText);
  const months = [];
  let current = null;

  const blank = () => Object.fromEntries(BRANDS.map((b) => [b.key, { amount: 0, units: 0 }]));

  for (const row of rows) {
    const marker = readMonthMarker(row[0]);
    if (marker) {
      current = { ...marker, brands: blank(), totalAmount: 0, totalUnits: 0, activeDays: 0 };
      months.push(current);
    }
    if (!current) continue;

    // Only real day rows count — the block's own "รวม" row is skipped.
    const day = Number(String(row[1] ?? '').trim());
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;

    let dayAmount = 0;
    for (const { key, col } of BRANDS) {
      const amount = toNumber(row[col]);
      const units = toNumber(row[col + 1]);
      current.brands[key].amount += amount;
      current.brands[key].units += units;
      current.totalAmount += amount;
      current.totalUnits += units;
      dayAmount += amount;
    }
    if (dayAmount > 0) current.activeDays += 1;
  }

  // Months the shop hasn't reached yet are all zeros — keep them out so the
  // month picker doesn't offer empty views.
  return months.filter((m) => m.totalAmount > 0 || m.totalUnits > 0);
}

/** Fetch and parse the sheet. Throws with a readable message on failure. */
export async function fetchSales() {
  let response;
  try {
    response = await fetch(SHEET_CSV_URL, { cache: 'no-store' });
  } catch {
    // fetch() rejects with a bare TypeError for both a CSP block and a dead
    // network, so say what to check rather than surfacing "Failed to fetch".
    throw new Error('เชื่อมต่อชีตยอดขายไม่ได้ — ตรวจอินเทอร์เน็ต หรือชีตอาจถูกปิดการเผยแพร่');
  }
  if (!response.ok) {
    throw new Error(`อ่านชีตยอดขายไม่สำเร็จ (HTTP ${response.status})`);
  }
  const months = parseSalesCsv(await response.text());
  if (months.length === 0) throw new Error('ไม่พบข้อมูลยอดขายในชีต');
  return months;
}

/** Fallback monthly targets per brand, in baht — used until someone saves theirs. */
export const DEFAULT_TARGETS = {
  OPPO: 300000, VIVO: 250000, SS: 150000, REALME: 50000,
  TECNO: 30000, Honor: 30000, XIAOMI: 100000, IPHONE: 600000,
};

/**
 * Targets are shared by the whole shop, so they live in Firestore behind
 * /api/sales-targets rather than in each browser — a target set on the office
 * PC has to be the one the counter tablet sees.
 */
export async function fetchTargets(idToken) {
  const response = await fetch('/api/sales-targets', {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!response.ok) throw new Error(`โหลดเป้าไม่สำเร็จ (HTTP ${response.status})`);
  const body = await response.json();
  return body.targets || { ...DEFAULT_TARGETS };
}

/**
 * Save the shop's targets. Admin-only — needs a fresh admin-PIN step-up token
 * alongside the session's ID token (see requireAdminStepUp() in main.js and
 * functions/api/verify-admin-pin.js). Resolves to the stored values.
 */
export async function saveTargets(idToken, elevation, targets) {
  const response = await fetch('/api/sales-targets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
      'X-Admin-Elevation': elevation,
    },
    body: JSON.stringify({ targets }),
  });
  if (!response.ok) throw new Error((await response.text()) || 'บันทึกเป้าไม่สำเร็จ');
  return (await response.json()).targets;
}

/** Brand groups the target card can be scoped to. */
export const BRAND_GROUPS = {
  all: { label: 'ทุกแบรนด์', brands: BRANDS.map((b) => b.key) },
  bbk: { label: 'BBK (OPPO/VIVO/REALME)', brands: ['OPPO', 'VIVO', 'REALME'] },
  premium: { label: 'พรีเมียม (IPHONE/SS)', brands: ['IPHONE', 'SS'] },
};

/**
 * Days remaining in a month, counted against today's real date.
 *
 * The dashboard this replaces hardcoded `daysLeft` to 15 for August and 0 for
 * every other month, so any other month always read as "on pace" no matter what
 * the numbers said.
 */
export function daysLeftIn(month, year, today = new Date()) {
  const gregorianYear = year - 543;
  const daysInMonth = new Date(gregorianYear, month, 0).getDate();

  const isCurrentMonth =
    today.getFullYear() === gregorianYear && today.getMonth() + 1 === month;
  if (!isCurrentMonth) {
    // A past month is finished; a future one hasn't started.
    const started = new Date(gregorianYear, month - 1, 1) <= today;
    return started ? 0 : daysInMonth;
  }
  return daysInMonth - today.getDate();
}
