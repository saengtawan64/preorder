import './style.css';

import { createIcons } from 'lucide';

import { appIcons } from './icons.js';
import { getFirebaseConfig } from './config.js';
import { onAuthChange, signInWithPin, signOutUser, getIdToken, verifyAdminPin } from './auth.js';
import {
  initFirebase,
  subscribeDeposits,
  addDeposit,
} from './firebase.js';
import { markReceived } from './received.js';
import { deleteDeposit } from './deposit-admin.js';
import { persistTheme, resetOnSignOut, state } from './state.js';
import { fetchSales, fetchTargets, saveTargets, DEFAULT_TARGETS, BRANDS } from './sales.js';
import { renderSalesDashboard } from './sales-view.js';
import { renderInstallmentShell, renderInstallmentResults } from './installment.js';
import { fetchPins, addPin, removePin, renamePin, setPinRole } from './pins.js';
import { renderPins } from './pins-view.js';
import { agingSummary, agingTone, daysHeld } from './aging.js';
import { timelineModel } from './timeline.js';
import { renderTimeline, renderTimelineSkeleton } from './timeline-view.js';
import { summarizeHistory, historyMessage } from './customer-history.js';
import { buildMessage, markFollowedUp } from './follow-up.js';
import {
  animateNumber,
  bangkokTimestamp,
  csvCell,
  dateSortKey,
  datePart,
  escapeHtml,
  formatBaht,
  formatPhone,
  isValidPhone,
  phoneDigits,
  prefersReducedMotion,
  thaiDateShort,
  todayDatePart,
} from './utils.js';

const el = {
  authGate: document.getElementById('auth-gate'),
  authGateError: document.getElementById('auth-gate-error'),
  pinDots: document.getElementById('pin-dots'),
  pinPad: document.getElementById('pin-pad'),
  appContent: document.getElementById('app-content'),

  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  sidebarOverlay: document.getElementById('sidebar-overlay'),
  navPending: document.getElementById('nav-pending'),
  navReceived: document.getElementById('nav-received'),
  navDeleted: document.getElementById('nav-deleted'),
  navSummary: document.getElementById('nav-summary'),
  navSales: document.getElementById('nav-sales'),
  navInstallment: document.getElementById('nav-installment'),
  installmentContainer: document.getElementById('installment-container'),
  navPins: document.getElementById('nav-pins'),
  pinsContainer: document.getElementById('pins-container'),
  countPending: document.getElementById('count-pending'),
  countReceived: document.getElementById('count-received'),
  countDeleted: document.getElementById('count-deleted'),

  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  themeIcon: document.getElementById('theme-icon'),
  themeLabel: document.getElementById('theme-label'),
  logoutBtn: document.getElementById('logout-btn'),
  exportCsvBtn: document.getElementById('export-csv-btn'),

  addOpenBtn: document.getElementById('add-open-btn'),
  addPanel: document.getElementById('add-panel'),
  addOverlay: document.getElementById('add-overlay'),
  addCloseBtn: document.getElementById('add-close-btn'),
  drawerTitle: document.getElementById('drawer-title'),
  drawerIcon: document.getElementById('drawer-icon'),
  contactForm: document.getElementById('contact-form'),
  firstNameInput: document.getElementById('first-name'),
  nicknameInput: document.getElementById('nickname'),
  phoneNumberInput: document.getElementById('phone-number'),
  customerHistoryNote: document.getElementById('customer-history-note'),
  depositItemInput: document.getElementById('deposit-item'),
  depositAmountInput: document.getElementById('deposit-amount'),
  submitBtn: document.getElementById('submit-btn'),

  searchInput: document.getElementById('search-input'),
  searchClearBtn: document.getElementById('search-clear-btn'),
  connectionStatus: document.getElementById('connection-status'),
  groupedDatesContainer: document.getElementById('grouped-dates-container'),
  summaryContainer: document.getElementById('summary-container'),
  salesContainer: document.getElementById('sales-container'),
  depositKpis: document.getElementById('deposit-kpis'),
  contentTop: document.querySelector('.content-top'),
  tableEmptyState: document.getElementById('table-empty-state'),

  metricTotalAmount: document.getElementById('metric-total-amount'),
  metricTotalCount: document.getElementById('metric-total-count'),
  metricTodayAmount: document.getElementById('metric-today-amount'),
  tabbar: document.getElementById('tabbar'),
  tabCountPending: document.getElementById('tab-count-pending'),
  metricAgingCard: document.getElementById('metric-aging-card'),
  metricAgingAmount: document.getElementById('metric-aging-amount'),
  metricAgingSub: document.getElementById('metric-aging-sub'),

  toastContainer: document.getElementById('toast-container'),

  adminGateOverlay: document.getElementById('admin-gate-overlay'),
  adminGate: document.getElementById('admin-gate'),
  adminGateReason: document.getElementById('admin-gate-reason'),
  adminGatePin: document.getElementById('admin-gate-pin'),
  adminGateError: document.getElementById('admin-gate-error'),
  adminGateSubmit: document.getElementById('admin-gate-submit'),
  adminGateCancel: document.getElementById('admin-gate-cancel'),
};

function refreshIcons() {
  createIcons({ icons: appIcons });
}

/**
 * Ask the server to push Firestore into the Sheet right now, instead of waiting
 * for the 5-minute cron. Best-effort: if the token is missing or the call
 * fails, the cron still catches up, so we never block the UI on it.
 */
async function requestSheetSync() {
  try {
    const token = await getIdToken();
    if (!token) return;
    await fetch('/api/sync-now', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  } catch (error) {
    console.warn('Instant sheet sync failed (cron will catch up):', error);
  }
}

/* ---------------------------------------------------------------- theme --- */

function applyTheme() {
  const dark = state.theme === 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  if (el.themeIcon) el.themeIcon.setAttribute('data-lucide', dark ? 'sun' : 'moon');
  if (el.themeLabel) el.themeLabel.textContent = dark ? 'ธีมสว่าง' : 'ธีมมืด';
  refreshIcons();
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  persistTheme();
  applyTheme();
}

/* --------------------------------------------------------------- toasts --- */

const TOAST_ICONS = {
  info: 'info',
  success: 'check-circle',
  danger: 'alert-circle',
  warning: 'alert-triangle',
};

function toast(message, variant = 'info') {
  const node = document.createElement('div');
  node.className = `toast toast-${variant}`;
  node.innerHTML = `
    <i data-lucide="${TOAST_ICONS[variant] || 'info'}"></i>
    <span>${escapeHtml(message)}</span>
  `;

  el.toastContainer.appendChild(node);
  refreshIcons();

  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateX(50px)';
    node.style.transition = 'all 0.3s ease-out';
    setTimeout(() => node.remove(), 300);
  }, 3500);
}

/* ---------------------------------------------------------------- auth ---- */

let unsubscribeDeposits = null;

function setConnectionStatus(text, variant = 'ok') {
  if (!el.connectionStatus) return;
  el.connectionStatus.className = variant === 'error' ? 'conn-pill is-error' : 'conn-pill';
  el.connectionStatus.innerHTML = `<i data-lucide="${variant === 'error' ? 'alert-triangle' : 'refresh-cw'}"></i><span>${escapeHtml(text)}</span>`;
  refreshIcons();
}

/* False until the first Firestore snapshot lands. Until then an empty list is
   "not known yet", not "nothing here" — showing the empty state in that gap
   tells staff their deposits are gone. */
let depositsLoaded = false;

function startDepositsFeed() {
  if (unsubscribeDeposits) return;
  renderTimelineSkeleton(el.groupedDatesContainer);
  unsubscribeDeposits = subscribeDeposits((records) => {
    state.deposits = records;
    depositsLoaded = true;
    setConnectionStatus('เชื่อมต่อสด', 'ok');
    renderList();
  });
}

function stopDepositsFeed() {
  if (unsubscribeDeposits) {
    unsubscribeDeposits();
    unsubscribeDeposits = null;
  }
  depositsLoaded = false;
  resetOnSignOut();
}

/* ------------------------------------------------------- inactivity lock -- */

// A staff tablet left unattended on the counter is the exact scenario the
// admin step-up exists for too — this closes the wider gap of the *whole
// session* staying open indefinitely. 15 minutes balances that against staff
// who are on this app all day and would find a shorter timer a nuisance.
const IDLE_LIMIT_MS = 15 * 60 * 1000;
let idleTimer = null;

function resetIdleTimer() {
  if (!state.isSignedIn) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    await signOutUser();
    clearAdminElevation();
    toast('ออกจากระบบอัตโนมัติ — ไม่มีการใช้งานนาน 15 นาที', 'info');
  }, IDLE_LIMIT_MS);
}

function stopIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = null;
}

// Passive, so this never competes with scroll/touch handling — any real
// interaction resets the clock, whether or not it's a signed-in session yet
// (resetIdleTimer() itself is a no-op until state.isSignedIn is true).
for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel']) {
  document.addEventListener(type, resetIdleTimer, { passive: true });
}

function showApp() {
  el.authGate.classList.add('hidden');
  el.appContent.classList.remove('hidden');
  startDepositsFeed();
  resetIdleTimer();
}

function showGate() {
  closeAddDrawer();
  closeSidebar();
  el.appContent.classList.add('hidden');
  el.authGate.classList.remove('hidden');
  el.authGateError.classList.add('hidden');
  resetPin();
  stopDepositsFeed();
  stopIdleTimer();
  clearAdminElevation();
}

// Firebase must be initialised before anything touches auth or Firestore.
// onAuthChange (just below) calls getAuth(getApp()), which throws
// "No Firebase App '[DEFAULT]'" if no app has been created yet — that error
// would abort the rest of this module (the login handler never binds, init
// never runs). Keep this above every auth/Firestore call site.
const firebaseConfig = getFirebaseConfig();
if (!firebaseConfig) {
  console.error('VITE_FIREBASE_PROJECT_ID is not set — the app cannot start without Firebase.');
  setConnectionStatus('ยังไม่ได้ตั้งค่า Firebase', 'error');
} else {
  initFirebase(firebaseConfig);
}

onAuthChange((signedIn) => {
  state.isSignedIn = signedIn;
  if (signedIn) showApp();
  else showGate();
});

/* ------------------------------------------------------------- PIN pad --- */

const PIN_LENGTH = 5;
let pinBuffer = '';
let pinBusy = false;

function paintPin() {
  [...el.pinDots.children].forEach((dot, i) => {
    dot.classList.toggle('filled', i < pinBuffer.length);
  });
}

function resetPin({ shake = false } = {}) {
  pinBuffer = '';
  paintPin();
  if (!shake) return;
  el.pinDots.classList.remove('shake');
  void el.pinDots.offsetWidth; // restart the animation
  el.pinDots.classList.add('shake');
}

async function submitPin() {
  pinBusy = true;
  el.pinPad.classList.add('busy');
  el.authGateError.classList.add('hidden');

  const result = await signInWithPin(pinBuffer);

  pinBusy = false;
  el.pinPad.classList.remove('busy');

  if (result.ok) return; // onAuthChange shows the app

  const message = {
    throttled: 'ใส่รหัสผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่',
    offline: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่',
  }[result.reason] || (
    typeof result.attemptsLeft === 'number' && result.attemptsLeft <= 3
      ? `รหัสไม่ถูกต้อง (เหลือ ${result.attemptsLeft} ครั้ง)`
      : 'รหัสไม่ถูกต้อง'
  );

  el.authGateError.textContent = message;
  el.authGateError.classList.remove('hidden');
  resetPin({ shake: true });
}

function pushPin(key) {
  if (pinBusy) return;

  if (key === 'del') {
    pinBuffer = pinBuffer.slice(0, -1);
    paintPin();
    return;
  }
  if (!/^\d$/.test(key) || pinBuffer.length >= PIN_LENGTH) return;

  pinBuffer += key;
  paintPin();
  el.authGateError.classList.add('hidden');
  if (pinBuffer.length === PIN_LENGTH) submitPin();
}

el.pinPad.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-key]');
  if (button) pushPin(button.getAttribute('data-key'));
});

document.addEventListener('keydown', (event) => {
  if (el.authGate.classList.contains('hidden')) return;
  if (/^\d$/.test(event.key)) pushPin(event.key);
  else if (event.key === 'Backspace') pushPin('del');
});

el.logoutBtn.addEventListener('click', async () => {
  await signOutUser();
  clearAdminElevation();
  toast('ออกจากระบบเรียบร้อยแล้ว', 'info');
});

/* ------------------------------------------------------- admin step-up --- */

/**
 * Proof of a recent admin-PIN entry, cached in memory only — never
 * localStorage/sessionStorage, so it can't survive a reload and dies the
 * moment the tab closes, same as the session itself (see src/auth.js). Reused
 * across admin actions for ADMIN_GRACE so opening PIN management, then
 * editing sales targets a minute later, doesn't ask twice — but it always
 * expires with the server-issued token, never past it.
 */
let adminElevation = null; // { token, expiresAtMs }

function clearAdminElevation() {
  adminElevation = null;
}

function adminGateError(message) {
  el.adminGateError.textContent = message || '';
  el.adminGateError.classList.toggle('hidden', !message);
}

/**
 * Resolve the current admin-elevation token, prompting for an admin PIN
 * first if there is no cached one or it has expired. This is the "isolated
 * admin portal" gate: it runs before PIN management, saving sales targets,
 * exporting CSV, or deleting a deposit — every time, even on a session that
 * was itself opened with an admin PIN, because the shop's login is one
 * shared account and the session alone can't say who's at the till right
 * now (see functions/api/verify-admin-pin.js).
 *
 * Resolves the elevation token string on success, or null if the user
 * cancelled or failed to verify.
 */
function requireAdminStepUp(reason) {
  if (adminElevation && Date.now() < adminElevation.expiresAtMs) {
    return Promise.resolve(adminElevation.token);
  }

  return new Promise((resolve) => {
    el.adminGateReason.textContent = reason;
    adminGateError('');
    el.adminGatePin.value = '';
    el.adminGateOverlay.classList.remove('hidden');
    el.adminGate.classList.remove('hidden');
    el.adminGatePin.focus();

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      el.adminGateOverlay.classList.add('hidden');
      el.adminGate.classList.add('hidden');
      el.adminGateSubmit.removeEventListener('click', onSubmit);
      el.adminGateCancel.removeEventListener('click', onCancel);
      el.adminGateOverlay.removeEventListener('click', onCancel);
      el.adminGatePin.removeEventListener('keydown', onKeydown);
      resolve(result);
    };

    const onCancel = () => finish(null);

    const onSubmit = async () => {
      const pin = el.adminGatePin.value.trim();
      if (!/^\d{4,8}$/.test(pin)) {
        adminGateError('กรอกรหัสให้ครบ');
        return;
      }
      el.adminGateSubmit.disabled = true;
      const result = await verifyAdminPin(pin);
      el.adminGateSubmit.disabled = false;

      if (result.ok) {
        adminElevation = { token: result.elevation, expiresAtMs: result.expiresAtMs };
        finish(result.elevation);
        return;
      }
      adminGateError({
        throttled: 'ลองผิดหลายครั้งเกินไป กรุณารอ 15 นาที',
        offline: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้',
      }[result.reason] || 'รหัสไม่ถูกต้อง หรือไม่ใช่รหัสระดับแอดมิน');
      el.adminGatePin.value = '';
      el.adminGatePin.focus();
    };

    const onKeydown = (event) => {
      if (event.key === 'Enter') onSubmit();
      else if (event.key === 'Escape') onCancel();
    };

    el.adminGateSubmit.addEventListener('click', onSubmit);
    el.adminGateCancel.addEventListener('click', onCancel);
    el.adminGateOverlay.addEventListener('click', onCancel);
    el.adminGatePin.addEventListener('keydown', onKeydown);
  });
}

/* ------------------------------------------------------------ list state -- */

/**
 * Which slice of the deposits list is on screen. These mirror the sheet's three
 * status values exactly, so the rail, the status chips and the sheet's dropdown
 * always agree on what a record is.
 */
let listMode = 'pending';

function isDeleted(record) {
  return Boolean(record.deletedAt);
}

function isReceived(record) {
  return record.status === 'received';
}

function bucketOf(record) {
  if (isDeleted(record)) return 'deleted';
  return isReceived(record) ? 'received' : 'pending';
}

function matchesQuery(record, needle, needleDigits) {
  const first = (record.firstName || '').toLowerCase();
  const nick = (record.nickname || '').toLowerCase();
  const item = (record.depositItem || '').toLowerCase();
  const phone = (record.phoneNumber || '').replace(/\D/g, '');

  return (
    first.includes(needle) ||
    nick.includes(needle) ||
    item.includes(needle) ||
    (needleDigits ? phone.includes(needleDigits) : false)
  );
}

function sumAmounts(records) {
  return records.reduce((total, record) => total + (Number(record.depositAmount) || 0), 0);
}

function groupByDate(records) {
  const groups = new Map();

  for (const record of records) {
    const key = datePart(record.timestamp) || 'ไม่ระบุวันที่';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  return [...groups.entries()].sort(([a], [b]) => {
    const keyA = dateSortKey(a);
    const keyB = dateSortKey(b);
    if (keyA === null && keyB === null) return 0;
    if (keyA === null) return 1;
    if (keyB === null) return -1;
    return keyB - keyA;
  });
}

/* ------------------------------------------------------------- rendering -- */

const CHIP = {
  pending: '<span class="status-chip chip-pending">รอรับของ</span>',
  received: '<span class="status-chip chip-received">รับแล้ว</span>',
  deleted: '<span class="status-chip chip-deleted">ลบแล้ว</span>',
};

function renderCounts() {
  const counts = { pending: 0, received: 0, deleted: 0 };
  for (const record of state.deposits) counts[bucketOf(record)] += 1;

  el.countPending.textContent = counts.pending;
  el.countReceived.textContent = counts.received;
  el.countDeleted.textContent = counts.deleted;
}

function renderMetrics() {
  // Metrics describe money currently held: pending only, never deleted.
  const active = state.deposits.filter((record) => bucketOf(record) === 'pending');

  animateNumber(el.metricTotalAmount, sumAmounts(active), formatBaht);
  animateNumber(el.metricTotalCount, active.length, (n) => String(n));

  const today = todayDatePart();
  const todayRecords = active.filter((record) => datePart(record.timestamp) === today);
  animateNumber(el.metricTodayAmount, sumAmounts(todayRecords), formatBaht);

  // Money tied up in deposits nobody has collected. The card only goes red
  // when there is actually something to chase — a permanently red tile stops
  // being read after a week.
  const aging = agingSummary(active);
  animateNumber(el.metricAgingAmount, aging.amount, formatBaht);
  el.metricAgingSub.innerText = aging.count
    ? `${aging.count} ราย · เก่าสุด ${aging.oldest} วัน`
    : 'ไม่มีรายการค้าง';
  el.metricAgingCard.classList.toggle('is-alert', aging.count > 0);
}

function renderDateGroup(date, records) {
  const dayTotal = sumAmounts(records);

  const rows = records
    .map((record) => {
      const bucket = bucketOf(record);
      const phone = formatPhone(record.phoneNumber);
      const digits = phoneDigits(record.phoneNumber);

      // Age and follow-up only mean anything while the shop is still holding
      // the goods — a collected or cancelled deposit is settled.
      const days = bucket === 'pending' ? daysHeld(record) : null;
      const ageTag = days === null ? ''
        : `<span class="age-tag age-${agingTone(days) || 'ok'}">ค้าง ${days} วัน</span>`;
      const followed = bucket === 'pending' ? thaiDateShort(record.followedUpAtIso) : '';
      const followTag = followed
        ? `<small class="row-sub">แจ้งแล้ว ${followed}${record.followUpCount > 1 ? ` · ${record.followUpCount} ครั้ง` : ''}</small>`
        : '';

      // data-label feeds the stacked card layout on narrow screens, where the
      // table header is hidden and each cell has to name itself.
      return `
      <tr class="row-${bucket}">
        <td class="name-cell" data-label="ชื่อจริง"><strong>${escapeHtml(record.firstName)}</strong>${followTag}</td>
        <td data-label="ชื่อเล่น">${escapeHtml(record.nickname)}</td>
        <td data-label="เบอร์โทร">${
          digits
            ? `<a class="phone-tag" href="tel:${escapeHtml(digits)}" title="กดเพื่อโทร">${escapeHtml(phone)}</a>`
            : `<span class="phone-tag">${escapeHtml(phone)}</span>`
        }</td>
        <td class="product-cell" data-label="สินค้า">${escapeHtml(record.depositItem)}</td>
        <td class="amount-cell mono" data-label="ยอดมัดจำ">${formatBaht(record.depositAmount)}</td>
        <td class="text-center no-strike" data-label="สถานะ">
          <span class="cell-stack">${CHIP[bucket]}${ageTag}</span>
        </td>
        <td class="no-strike actions-cell" data-label="จัดการ">
          <div class="action-btns">
            ${
              bucket === 'pending'
                ? `<button class="btn btn-xs btn-outline notify-btn"
                    data-id="${escapeHtml(record.id)}" title="คัดลอกข้อความแจ้งลูกค้า + บันทึกว่าติดตามแล้ว">
              <i data-lucide="send"></i>
            </button>`
                : ''
            }
            ${
              bucket === 'pending'
                ? `<button class="btn btn-xs btn-success mark-received-btn"
                    data-id="${escapeHtml(record.id)}" title="ลูกค้ารับสินค้าแล้ว">
              <i data-lucide="check-check"></i>
            </button>`
                : ''
            }
            ${
              bucket === 'deleted'
                ? ''
                : `<button class="btn btn-xs btn-outline edit-deposit-btn"
                    data-id="${escapeHtml(record.id)}" title="แก้ไขรายการ">
              <i data-lucide="pencil"></i>
            </button>`
            }
            <button class="btn btn-xs btn-outline copy-info-btn"
                    data-info="${escapeHtml(`${record.firstName} - ${record.depositItem} (${formatBaht(record.depositAmount)})`)}"
                    title="คัดลอกข้อมูล">
              <i data-lucide="copy"></i>
            </button>
            ${
              bucket === 'deleted'
                ? ''
                : `<button class="btn btn-xs btn-danger btn-outline delete-deposit-btn"
                    data-id="${escapeHtml(record.id)}" title="ลบรายการ">
              <i data-lucide="trash-2"></i>
            </button>`
            }
          </div>
        </td>
      </tr>
    `;
    })
    .join('');

  return `
    <div class="date-group-block">
      <div class="date-group-header">
        <div class="date-title">
          <i data-lucide="calendar"></i> ${escapeHtml(date)} · ${records.length} รายการ
        </div>
        <div class="date-summary-tag">รวม ${formatBaht(dayTotal)}</div>
      </div>

      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>ชื่อจริง</th>
              <th>ชื่อเล่น</th>
              <th>เบอร์โทร</th>
              <th>สินค้าที่มัดจำ</th>
              <th style="text-align:right">ยอดมัดจำ</th>
              <th class="text-center">สถานะ</th>
              <th style="text-align:right">จัดการ</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** Month bucket for a record, from the same "d/M/yyyy HH:mm" string the sheet shows. */
function monthOf(record) {
  const parts = datePart(record.timestamp).split('/');
  if (parts.length !== 3) return null;
  const month = Number(parts[1]);
  const year = Number(parts[2]);
  if (!month || !year) return null;
  return { key: year * 100 + month, label: `${THAI_MONTHS[month - 1] || month} ${year}` };
}

/**
 * Month-by-month totals. Deleted records are left out entirely — they are
 * cancelled deposits, so counting them would overstate what the shop holds.
 */
function renderSummary() {
  const months = new Map();

  for (const record of state.deposits) {
    if (bucketOf(record) === 'deleted') continue;
    const month = monthOf(record);
    if (!month) continue;

    if (!months.has(month.key)) {
      months.set(month.key, { label: month.label, pending: [], received: [] });
    }
    months.get(month.key)[bucketOf(record)].push(record);
  }

  if (months.size === 0) {
    el.summaryContainer.innerHTML =
      '<div class="empty-state"><i data-lucide="inbox"></i><p>ยังไม่มีข้อมูลให้สรุป</p></div>';
    return;
  }

  const ordered = [...months.entries()].sort(([a], [b]) => b - a);
  let grandCount = 0;
  let grandTotal = 0;
  let grandPending = 0;

  const rows = ordered
    .map(([, m]) => {
      const count = m.pending.length + m.received.length;
      const total = sumAmounts(m.pending) + sumAmounts(m.received);
      const pendingTotal = sumAmounts(m.pending);
      grandCount += count;
      grandTotal += total;
      grandPending += pendingTotal;

      return `
      <tr>
        <td data-label="เดือน"><strong>${escapeHtml(m.label)}</strong></td>
        <td class="text-center" data-label="จำนวน">${count}</td>
        <td class="amount-cell mono" data-label="ยอดรวม">${formatBaht(total)}</td>
        <td class="text-center" data-label="รอรับ">${m.pending.length}</td>
        <td class="amount-cell mono" data-label="ยอดค้างรับ">${formatBaht(pendingTotal)}</td>
        <td class="text-center" data-label="รับแล้ว">${m.received.length}</td>
      </tr>`;
    })
    .join('');

  el.summaryContainer.innerHTML = `
    <div class="date-group-block">
      <div class="date-group-header">
        <div class="date-title"><i data-lucide="coins"></i> สรุปยอดมัดจำรายเดือน</div>
        <div class="date-summary-tag">รวมทั้งหมด ${formatBaht(grandTotal)} · ${grandCount} รายการ</div>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>เดือน</th>
              <th class="text-center">จำนวน</th>
              <th style="text-align:right">ยอดรวม</th>
              <th class="text-center">รอรับ</th>
              <th style="text-align:right">ยอดค้างรับ</th>
              <th class="text-center">รับแล้ว</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr class="summary-total">
              <td data-label="รวม"><strong>รวมทุกเดือน</strong></td>
              <td class="text-center" data-label="จำนวน"><strong>${grandCount}</strong></td>
              <td class="amount-cell mono" data-label="ยอดรวม"><strong>${formatBaht(grandTotal)}</strong></td>
              <td colspan="2" class="amount-cell mono" data-label="ยอดค้างรับ"><strong>${formatBaht(grandPending)}</strong></td>
              <td data-label=""></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

/* ------------------------------------------------------ sales dashboard --- */

// Fetched once per session and reused when switching back; "รีเฟรช" forces a
// re-read. The sheet is a hand-maintained document, not a live feed.
const sales = {
  months: null, index: 0, mode: 'amount', group: 'all', updatedAt: '', loading: false,
  targets: { ...DEFAULT_TARGETS }, editingTargets: false,
};

async function showSales({ force = false } = {}) {
  el.salesContainer.classList.remove('hidden');

  if (!sales.months || force) {
    if (sales.loading) return;
    sales.loading = true;
    el.salesContainer.innerHTML =
      '<div class="empty-state"><i data-lucide="refresh-cw"></i><p>กำลังโหลดยอดขายจากชีต...</p></div>';
    refreshIcons();

    try {
      // Targets are a small read and shouldn't block the sheet; if they fail we
      // fall back to the defaults rather than showing no dashboard at all.
      const [months, targets] = await Promise.all([
        fetchSales(),
        getIdToken().then((t) => (t ? fetchTargets(t) : null)).catch(() => null),
      ]);
      sales.months = months;
      if (targets) sales.targets = targets;
      sales.index = sales.months.length - 1; // เปิดมาที่เดือนล่าสุดที่มีข้อมูล
      sales.updatedAt = bangkokTimestamp();
    } catch (error) {
      console.error('โหลดยอดขายไม่สำเร็จ:', error);
      el.salesContainer.innerHTML = `
        <div class="empty-state">
          <i data-lucide="alert-triangle"></i>
          <p>${escapeHtml(error.message || 'โหลดยอดขายไม่สำเร็จ')}</p>
          <button id="sales-retry" class="btn btn-outline btn-sm margin-top">ลองใหม่</button>
        </div>`;
      refreshIcons();
      return;
    } finally {
      sales.loading = false;
    }
  }

  renderSalesDashboard(el.salesContainer, {
    months: sales.months,
    monthIndex: sales.index,
    mode: sales.mode,
    groupKey: sales.group,
    updatedAt: sales.updatedAt,
    targets: sales.targets,
    editingTargets: sales.editingTargets,
  });
  refreshIcons();
}

/** Read the target editor's inputs back out. */
function readTargetInputs() {
  const values = {};
  for (const { key } of BRANDS) {
    const input = document.getElementById(`target-${key}`);
    values[key] = Math.max(0, Math.round(Number(input?.value) || 0));
  }
  return values;
}

async function commitTargets() {
  const values = readTargetInputs();
  const msg = document.getElementById('targets-msg');
  const button = document.getElementById('targets-save');
  button.disabled = true;
  button.querySelector('span')?.remove();

  try {
    const idToken = await getIdToken();
    if (!idToken) throw new Error('เซสชันหมดอายุ กรุณาเข้าระบบใหม่');
    // Re-checked here too, not just when entering edit mode — the grace
    // window may have lapsed while the form was open.
    const elevation = await requireAdminStepUp('บันทึกเป้ายอดขาย');
    if (!elevation) {
      button.disabled = false;
      return;
    }
    sales.targets = await saveTargets(idToken, elevation, values);
    sales.editingTargets = false;
    showSales();
    toast('บันทึกเป้ายอดขายเรียบร้อย', 'success');
  } catch (error) {
    button.disabled = false;
    if (msg) {
      msg.textContent = error.message || 'บันทึกไม่สำเร็จ';
      msg.classList.remove('hidden');
    }
  }
}

/* Delegated so the controls survive every dashboard re-render. */
el.salesContainer.addEventListener('click', async (event) => {
  if (event.target.closest('#sales-retry') || event.target.closest('#sales-refresh')) {
    showSales({ force: true });
    return;
  }
  if (event.target.closest('#targets-edit')) {
    // Setting targets is a financial decision — gated the same way PIN
    // management is, even though viewing progress against them (above) is
    // normal staff work.
    const elevation = await requireAdminStepUp('แก้ไขเป้ายอดขาย');
    if (!elevation) return;
    sales.editingTargets = true;
    showSales();
    return;
  }
  if (event.target.closest('#targets-cancel')) {
    sales.editingTargets = false;
    showSales();
    return;
  }
  if (event.target.closest('#targets-save')) {
    commitTargets();
    return;
  }
  const modeBtn = event.target.closest('.mode-btn[data-mode]');
  if (modeBtn) {
    sales.mode = modeBtn.getAttribute('data-mode');
    showSales();
  }
});

el.salesContainer.addEventListener('change', (event) => {
  if (event.target.id === 'sales-month') {
    sales.index = Number(event.target.value);
    showSales();
  } else if (event.target.id === 'sales-group') {
    sales.group = event.target.value;
    showSales();
  }
});

/* Live total while editing targets, so the effect of a change is visible. */
el.salesContainer.addEventListener('input', (event) => {
  if (!event.target.matches('[data-brand]')) return;
  const total = Object.values(readTargetInputs()).reduce((a, b) => a + b, 0);
  const out = document.getElementById('target-edit-total');
  if (out) out.textContent = '฿' + total.toLocaleString('th-TH');
});

/* ------------------------------------------------- installment calculator - */

const installment = { price: null, down: 0 };
// Populated the first time showInstallment() builds the shell — these don't
// exist in index.html, unlike the rest of `el`, since installment.js renders
// them dynamically.
let instResults = null;

/**
 * showInstallment() used to call a single render function that rebuilt the
 * whole container — inputs included — on every keystroke. The very first
 * digit typed into an empty price field would flip the results from the
 * empty-state message to a real table, which this codebase's own
 * "re-render only the numbers" shortcut couldn't handle (there were no
 * `.inst-monthly` cells yet to patch), so it fell back to the full rebuild —
 * destroying the `<input>` the browser had focused and dismissing the
 * on-screen keyboard mid-word. The shell/results split below removes the
 * failure mode entirely rather than patching around it: the shell (the
 * inputs) is built once per visit to the tab, and every keystroke after that
 * only ever touches #inst-results, which holds no input the browser could be
 * focused on.
 */
function showInstallment() {
  el.installmentContainer.classList.remove('hidden');
  if (!el.installmentContainer.querySelector('#inst-price')) {
    renderInstallmentShell(el.installmentContainer);
    instResults = el.installmentContainer.querySelector('#inst-results');
    el.installmentContainer.querySelector('#inst-price').value = installment.price ?? '';
    el.installmentContainer.querySelector('#inst-down').value = installment.down;
  }
  renderInstallmentResults(instResults, installment);
  refreshIcons();
}

el.installmentContainer.addEventListener('input', (event) => {
  if (event.target.id === 'inst-price') {
    const raw = Number(event.target.value);
    installment.price = Number.isFinite(raw) && raw > 0 ? raw : null;
  } else if (event.target.id === 'inst-down') {
    const raw = Number(event.target.value);
    installment.down = Number.isFinite(raw) && raw >= 0 ? raw : 0;
  } else {
    return;
  }
  // Only #inst-results is touched here — never the inputs above it, so
  // whichever field is focused stays focused (and the keyboard stays up).
  renderInstallmentResults(instResults, installment);
});

/* ------------------------------------------------------- PIN management --- */

const pinsState = { pins: [], loading: false, loaded: false };

function drawPins() {
  renderPins(el.pinsContainer, pinsState);
  refreshIcons();
}

function pinError(message) {
  const box = el.pinsContainer.querySelector('#pin-error');
  if (!box) return;
  box.textContent = message;
  box.classList.toggle('hidden', !message);
}

/**
 * Every PIN action ends the same way: prove a fresh admin step-up, apply the
 * fresh list, or show why not. PIN management is admin-only end to end — see
 * requireAdminStepUp() and functions/api/pins.js.
 */
async function pinAction(run) {
  pinError('');
  try {
    const idToken = await getIdToken();
    if (!idToken) throw new Error('เซสชันหมดอายุ กรุณาเข้าระบบใหม่');
    const elevation = await requireAdminStepUp('จัดการรหัสปลดล็อก');
    if (!elevation) return false; // cancelled — not an error, say nothing
    const result = await run(idToken, elevation);
    pinsState.pins = result.pins || [];
    pinsState.loaded = true;
    return true;
  } catch (error) {
    pinError(error.message || 'ทำรายการไม่สำเร็จ');
    return false;
  } finally {
    pinsState.loading = false;
  }
}

async function showPins() {
  el.pinsContainer.classList.remove('hidden');

  // Re-checked on every visit, not just the first: pinsState.loaded staying
  // true across a whole tab session would let anyone who picks up an
  // already-open device skip straight to cached PIN data once the step-up
  // grace window has lapsed. requireAdminStepUp() only re-prompts once that
  // window is actually gone, so this doesn't nag on a quick tab switch.
  const elevation = await requireAdminStepUp('เข้าหน้าจัดการรหัส');
  if (!elevation) {
    setListMode('pending');
    return;
  }

  if (!pinsState.loaded) {
    pinsState.loading = true;
    drawPins();
    await pinAction((token, elev) => fetchPins(token, elev));
  }
  drawPins();
}

el.pinsContainer.addEventListener('click', async (event) => {
  const row = event.target.closest('.pin-row');

  if (event.target.closest('.pin-remove-btn')) {
    const label = row.querySelector('.pin-row-label').textContent;
    if (!confirm(`ลบรหัส "${label}" ใช่หรือไม่?\nคนที่ใช้รหัสนี้จะเข้าระบบไม่ได้ทันที`)) return;
    const index = Number(row.getAttribute('data-index'));
    const hint = row.getAttribute('data-hint');
    if (await pinAction((token, elevation) => removePin(token, elevation, index, hint))) {
      toast('ลบรหัสแล้ว', 'success');
    }
    drawPins();
    return;
  }

  if (event.target.closest('.pin-rename-btn')) {
    const index = Number(row.getAttribute('data-index'));
    const current = row.querySelector('.pin-row-label').textContent;
    const next = prompt('ตั้งชื่อรหัสนี้ (เช่น เจ้าของร้าน, พนักงานหน้าร้าน)', current);
    if (next === null) return;
    if (await pinAction((token, elevation) => renamePin(token, elevation, index, next.trim()))) {
      toast('เปลี่ยนชื่อแล้ว', 'success');
    }
    drawPins();
    return;
  }

  if (event.target.closest('.pin-role-btn')) {
    const index = Number(row.getAttribute('data-index'));
    const current = row.getAttribute('data-role');
    const next = current === 'admin' ? 'staff' : 'admin';
    const label = row.querySelector('.pin-row-label').textContent;
    const question = next === 'admin'
      ? `ตั้งรหัส "${label}" เป็นระดับแอดมินใช่หรือไม่?\nจะเข้าจัดการรหัส/เป้ายอดขาย/CSV/ลบรายการได้`
      : `ลดรหัส "${label}" เป็นระดับพนักงานใช่หรือไม่?\nจะเข้าเมนูแอดมินไม่ได้อีก`;
    if (!confirm(question)) return;
    if (await pinAction((token, elevation) => setPinRole(token, elevation, index, next))) {
      toast(next === 'admin' ? 'ตั้งเป็นแอดมินแล้ว' : 'ลดเป็นพนักงานแล้ว', 'success');
    }
    drawPins();
    return;
  }

  if (!event.target.closest('#pin-add-btn')) return;

  const pinInput = el.pinsContainer.querySelector('#pin-new');
  const labelInput = el.pinsContainer.querySelector('#pin-new-label');
  const roleSelect = el.pinsContainer.querySelector('#pin-new-role');
  const pin = pinInput.value.trim();
  if (!/^\d{5}$/.test(pin)) {
    pinError('รหัสต้องเป็นตัวเลข 5 หลัก');
    pinInput.focus();
    return;
  }
  if (await pinAction((token, elevation) => addPin(token, elevation, pin, labelInput.value.trim(), roleSelect.value))) {
    toast('เพิ่มรหัสแล้ว ใช้ปลดล็อกได้ทันที', 'success');
  }
  drawPins();
});

/* A PIN is digits only — strip anything else as it is typed rather than
   rejecting the whole field afterwards. */
el.pinsContainer.addEventListener('input', (event) => {
  if (event.target.id !== 'pin-new') return;
  event.target.value = event.target.value.replace(/\D/g, '').slice(0, 5);
});

function renderList() {
  renderCounts();
  renderMetrics();
  syncNavButtons();

  if (listMode === 'pins') {
    el.groupedDatesContainer.classList.add('hidden');
    el.summaryContainer.classList.add('hidden');
    el.salesContainer.classList.add('hidden');
    el.installmentContainer.classList.add('hidden');
    el.tableEmptyState.classList.add('hidden');
    showPins();
    return;
  }
  el.pinsContainer.classList.add('hidden');

  if (listMode === 'installment') {
    el.groupedDatesContainer.classList.add('hidden');
    el.summaryContainer.classList.add('hidden');
    el.salesContainer.classList.add('hidden');
    el.tableEmptyState.classList.add('hidden');
    showInstallment();
    return;
  }
  el.installmentContainer.classList.add('hidden');

  if (listMode === 'sales') {
    el.groupedDatesContainer.classList.add('hidden');
    el.summaryContainer.classList.add('hidden');
    el.tableEmptyState.classList.add('hidden');
    showSales();
    return;
  }
  el.salesContainer.classList.add('hidden');

  if (listMode === 'summary') {
    el.groupedDatesContainer.classList.add('hidden');
    el.tableEmptyState.classList.add('hidden');
    el.summaryContainer.classList.remove('hidden');
    renderSummary();
    refreshIcons();
    return;
  }

  el.summaryContainer.classList.add('hidden');
  el.groupedDatesContainer.classList.remove('hidden');

  const base = state.deposits.filter((record) => bucketOf(record) === listMode);
  const needle = el.searchInput.value.toLowerCase().trim();
  const needleDigits = needle.replace(/\D/g, '');
  const visible = needle ? base.filter((r) => matchesQuery(r, needle, needleDigits)) : base;

  if (visible.length === 0) {
    // Nothing to show yet is not the same as nothing to show.
    if (!depositsLoaded && !needle) {
      renderTimelineSkeleton(el.groupedDatesContainer);
      el.tableEmptyState.classList.add('hidden');
      return;
    }
    el.groupedDatesContainer.innerHTML = '';
    el.tableEmptyState.classList.remove('hidden');
    return;
  }

  el.tableEmptyState.classList.add('hidden');

  // "รอรับของ" is the timeline: the question there is how long the shop has
  // been holding each deposit. The settled views stay a date-grouped table,
  // where age means nothing and "what happened lately" is what you want.
  if (listMode === 'pending') {
    renderTimeline(el.groupedDatesContainer, timelineModel(visible));
  } else {
    el.groupedDatesContainer.innerHTML = groupByDate(visible)
      .map(([date, records]) => renderDateGroup(date, records))
      .join('');
  }

  refreshIcons();
}

/* Delegated so the handlers survive every list re-render. */
el.groupedDatesContainer.addEventListener('click', async (event) => {
  const copyBtn = event.target.closest('.copy-info-btn');
  if (copyBtn) {
    const info = copyBtn.getAttribute('data-info') || '';
    try {
      await navigator.clipboard.writeText(info);
      toast(`คัดลอก "${info}" แล้ว!`, 'success');
    } catch {
      toast('คัดลอกไม่สำเร็จ (เบราว์เซอร์ไม่อนุญาต)', 'warning');
    }
    return;
  }

  const notifyBtn = event.target.closest('.notify-btn');
  if (notifyBtn) {
    const record = state.deposits.find((r) => r.id === notifyBtn.getAttribute('data-id'));
    if (!record) return;

    // Copy first. If the clipboard is blocked there is nothing to send, so
    // stamping "แจ้งแล้ว" would be a lie.
    try {
      await navigator.clipboard.writeText(buildMessage(record));
    } catch {
      toast('คัดลอกไม่สำเร็จ (เบราว์เซอร์ไม่อนุญาต)', 'warning');
      return;
    }

    toast('คัดลอกข้อความแล้ว — วางใน LINE หรือ SMS ได้เลย', 'success');
    try {
      const idToken = await getIdToken();
      if (!idToken) throw new Error('เซสชันหมดอายุ');
      await markFollowedUp(idToken, record.id);
      // The snapshot listener redraws the row with the new "แจ้งแล้ว" stamp.
    } catch (error) {
      // The message is already on the clipboard, so this is a bookkeeping
      // failure, not a failed action — say so without undoing anything.
      toast(`ข้อความคัดลอกแล้ว แต่บันทึกการติดตามไม่สำเร็จ: ${error.message}`, 'warning');
    }
    return;
  }

  const editBtn = event.target.closest('.edit-deposit-btn');
  if (editBtn) {
    const id = editBtn.getAttribute('data-id');
    const record = state.deposits.find((r) => r.id === id);
    if (record) openDrawer(record);
    return;
  }

  const receivedBtn = event.target.closest('.mark-received-btn');
  if (receivedBtn) {
    const id = receivedBtn.getAttribute('data-id');
    if (!confirm('ยืนยันว่าลูกค้ารับสินค้าแล้ว?')) return;
    try {
      const idToken = await getIdToken();
      if (!idToken) throw new Error('เซสชันหมดอายุ กรุณาเข้าระบบใหม่');
      await markReceived(idToken, id);
    } catch (error) {
      toast(error.message || 'บันทึกไม่สำเร็จ', 'danger');
      return;
    }
    toast('บันทึก "รับสินค้าแล้ว" เรียบร้อย', 'success');
    requestSheetSync();
    return;
  }

  const deleteBtn = event.target.closest('.delete-deposit-btn');
  if (!deleteBtn) return;

  const id = deleteBtn.getAttribute('data-id');
  if (!confirm('คุณต้องการลบรายการมัดจำนี้ใช่หรือไม่?\nรายการจะย้ายไปเมนู "ลบแล้ว" ไม่ได้หายไปจากชีต')) return;

  const elevation = await requireAdminStepUp('ลบรายการมัดจำ');
  if (!elevation) return;

  try {
    const idToken = await getIdToken();
    if (!idToken) throw new Error('เซสชันหมดอายุ กรุณาเข้าระบบใหม่');
    await deleteDeposit(idToken, elevation, id);
  } catch (error) {
    toast(error.message || 'ลบรายการไม่สำเร็จ', 'danger');
    return;
  }
  // The snapshot listener re-renders with the record moved to "ลบแล้ว".
  toast('ย้ายไปรายการที่ลบแล้ว', 'info');
  requestSheetSync();
});

/* ------------------------------------------------------------ rail nav ---- */

function syncNavButtons() {
  el.navPending.classList.toggle('is-active', listMode === 'pending');
  el.navReceived.classList.toggle('is-active', listMode === 'received');
  el.navDeleted.classList.toggle('is-active', listMode === 'deleted');
  el.navSummary.classList.toggle('is-active', listMode === 'summary');
  el.navSales.classList.toggle('is-active', listMode === 'sales');
  el.navInstallment.classList.toggle('is-active', listMode === 'installment');
  el.navPins.classList.toggle('is-active', listMode === 'pins');
  syncTabbar();

  // The deposit search box and KPI tiles belong to the deposit views only.
  const onSales = listMode === 'sales' || listMode === 'installment' || listMode === 'pins';
  el.depositKpis.classList.toggle('hidden', onSales);
  el.contentTop.classList.toggle('sales-mode', onSales);
  // Searching a month-by-month roll-up doesn't mean anything.
  el.searchInput.disabled = listMode === 'summary';
}

/**
 * Cross-fade into a fresh renderList() using the View Transitions API where
 * the browser has it, falling back to a plain instant call everywhere else —
 * a progressive enhancement, not a requirement, so there is nothing to break
 * on a browser without it.
 *
 * Deliberately only wrapped around a deliberate mode switch (below), not
 * around the snapshot listener's own renderList() call: that one fires on
 * every Firestore update, and cross-fading the whole screen every time a
 * deposit changes would read as the page flickering, not as motion.
 */
function withViewTransition(update) {
  if (typeof document.startViewTransition !== 'function' || prefersReducedMotion()) {
    update();
    return;
  }
  document.startViewTransition(update);
}

/* Mobile-only drawer. The overlay's own hidden class always tracks the
   sidebar's open class, so there is exactly one place that can get the two
   out of sync: here. */
function closeSidebar() {
  el.sidebar.classList.remove('open');
  el.sidebarOverlay.classList.add('hidden');
}
function toggleSidebar() {
  const opening = !el.sidebar.classList.contains('open');
  el.sidebar.classList.toggle('open', opening);
  el.sidebarOverlay.classList.toggle('hidden', !opening);
}

function setListMode(mode) {
  closeSidebar(); // closes the mobile drawer after a pick
  if (listMode === mode) return;
  listMode = mode;
  withViewTransition(renderList);
}

el.navPending.addEventListener('click', () => setListMode('pending'));
el.navReceived.addEventListener('click', () => setListMode('received'));
el.navDeleted.addEventListener('click', () => setListMode('deleted'));
el.navSummary.addEventListener('click', () => setListMode('summary'));
el.navSales.addEventListener('click', () => setListMode('sales'));
el.navInstallment.addEventListener('click', () => setListMode('installment'));
el.navPins.addEventListener('click', () => setListMode('pins'));

/* ------------------------------------------------------- mobile tab bar --- */
/* Two of the five tabs are not views: "เพิ่ม" opens the add drawer and "อื่นๆ"
   opens the rail, so everything the sidebar offers is still one tap away. */
el.tabbar.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-tab]');
  if (!button) return;

  const tab = button.getAttribute('data-tab');
  if (tab === 'add') return openDrawer();
  if (tab === 'more') return toggleSidebar();
  setListMode(tab);
});

function syncTabbar() {
  for (const button of el.tabbar.querySelectorAll('button[data-tab]')) {
    const tab = button.getAttribute('data-tab');
    button.classList.toggle('is-active', tab === listMode);
  }
  // The badge is the only number on the bar, so it only earns its place when
  // there is something overdue to act on.
  const overdue = agingSummary(state.deposits.filter((r) => bucketOf(r) === 'pending')).count;
  el.tabCountPending.textContent = String(overdue);
  el.tabCountPending.classList.toggle('hidden', overdue === 0);
}
el.sidebarToggle.addEventListener('click', toggleSidebar);
el.sidebarOverlay.addEventListener('click', closeSidebar);

/* --------------------------------------------------- add-deposit drawer --- */

// null = the drawer is adding a new deposit; a document id = editing that one.
let editingId = null;

/**
 * Look up the phone field's current number against every deposit already
 * loaded and show or hide the returning-customer note accordingly.
 *
 * `state.deposits` is the whole collection, not just pending — history has to
 * include received and abandoned deposits or it would miss the one thing
 * worth flagging (a customer who has walked away from a deposit before).
 */
function refreshCustomerHistoryNote() {
  const summary = summarizeHistory(state.deposits, el.phoneNumberInput.value, editingId);
  const message = historyMessage(summary);

  if (!message) {
    el.customerHistoryNote.classList.add('hidden');
    el.customerHistoryNote.textContent = '';
    return;
  }

  el.customerHistoryNote.className = `customer-note tone-${message.tone}`;
  el.customerHistoryNote.innerHTML = `<i data-lucide="${message.tone === 'warn' ? 'alert-triangle' : 'check-circle'}"></i>${escapeHtml(message.text)}`;
  refreshIcons();
}

function openDrawer(record = null) {
  editingId = record ? record.id : null;

  if (record) {
    el.firstNameInput.value = record.firstName || '';
    el.nicknameInput.value = record.nickname || '';
    el.phoneNumberInput.value = formatPhone(record.phoneNumber || '');
    el.depositItemInput.value = record.depositItem || '';
    el.depositAmountInput.value = record.depositAmount ?? '';
  } else {
    el.contactForm.reset();
  }

  el.drawerTitle.textContent = record ? 'แก้ไขรายการมัดจำ' : 'เพิ่มรายการมัดจำ';
  el.drawerIcon.setAttribute('data-lucide', record ? 'pencil' : 'plus-circle');
  el.submitBtn.querySelector('span').innerText = record ? 'บันทึกการแก้ไข' : 'บันทึกรายการมัดจำ';
  refreshIcons();
  refreshCustomerHistoryNote();

  el.addPanel.classList.add('open');
  el.addPanel.setAttribute('aria-hidden', 'false');
  el.addOverlay.classList.remove('hidden');
  el.firstNameInput.focus();
}

function openAddDrawer() {
  openDrawer(null);
}

function closeAddDrawer() {
  editingId = null;
  el.addPanel.classList.remove('open');
  el.addPanel.setAttribute('aria-hidden', 'true');
  el.addOverlay.classList.add('hidden');
  el.customerHistoryNote.classList.add('hidden');
}

el.addOpenBtn.addEventListener('click', openAddDrawer);
el.addCloseBtn.addEventListener('click', closeAddDrawer);
el.addOverlay.addEventListener('click', closeAddDrawer);

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeAddDrawer();
  closeSidebar();
});

/* ----------------------------------------------------------------- form --- */

el.phoneNumberInput.addEventListener('input', (event) => {
  event.target.value = formatPhone(event.target.value);
  refreshCustomerHistoryNote();
});

/**
 * Save an edit through the server rather than writing Firestore from here:
 * firestore.rules deliberately won't let a client rewrite a record's business
 * fields (see functions/api/update-deposit.js).
 */
async function saveEdit(depositId, fields) {
  const idToken = await getIdToken();
  if (!idToken) return false;

  const res = await fetch('/api/update-deposit', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ depositId, ...fields }),
  });
  return res.ok;
}

el.contactForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!isValidPhone(el.phoneNumberInput.value)) {
    toast('กรุณากรอกเบอร์โทรศัพท์ 10 หลัก ให้ถูกต้อง', 'danger');
    return;
  }

  const fields = {
    firstName: el.firstNameInput.value.trim().split(/\s+/)[0],
    nickname: el.nicknameInput.value.trim(),
    phoneNumber: formatPhone(el.phoneNumberInput.value.trim()),
    depositItem: el.depositItemInput.value.trim(),
    depositAmount: parseFloat(el.depositAmountInput.value) || 0,
  };

  const isEdit = editingId !== null;
  const submitLabel = el.submitBtn.querySelector('span');
  const originalLabel = submitLabel.innerText;
  el.submitBtn.disabled = true;
  submitLabel.innerText = 'กำลังบันทึก...';

  const ok = isEdit
    ? await saveEdit(editingId, fields)
    : Boolean(await addDeposit({ depositId: crypto.randomUUID(), ...fields, timestamp: bangkokTimestamp() }));

  el.submitBtn.disabled = false;
  submitLabel.innerText = originalLabel;

  if (!ok) {
    toast(isEdit ? 'แก้ไขไม่สำเร็จ กรุณาลองอีกครั้ง' : 'บันทึกข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง', 'danger');
    return;
  }

  el.contactForm.reset();
  closeAddDrawer();
  toast(isEdit ? `แก้ไข "${fields.firstName}" เรียบร้อย` : `บันทึกมัดจำ "${fields.firstName}" เรียบร้อย`, 'success');

  requestSheetSync();
  // The real-time listener re-renders too; this makes the change show instantly.
  renderList();
});

/* --------------------------------------------------------------- search --- */

el.searchInput.addEventListener('input', (event) => {
  el.searchClearBtn.classList.toggle('hidden', !event.target.value);
  renderList();
});

el.searchClearBtn.addEventListener('click', () => {
  el.searchInput.value = '';
  el.searchClearBtn.classList.add('hidden');
  renderList();
});

/* ----------------------------------------------------------- CSV export --- */

const CSV_STATUS = { pending: 'รอการจัดส่งสินค้า', received: 'รับสินค้าแล้ว', deleted: 'ลบแล้ว' };

el.exportCsvBtn.addEventListener('click', async () => {
  if (state.deposits.length === 0) {
    toast('ไม่มีข้อมูลสำหรับส่งออก', 'warning');
    return;
  }

  // Exporting customer names and phone numbers to a file is admin-only by
  // policy — the same step-up as PIN management and sales targets. Worth
  // being upfront about the limit here: this data is already loaded in the
  // browser for the list screen every signed-in staff member uses, so this
  // gate stops the *export button*, not a determined person opening
  // DevTools and reading `state.deposits` directly. Real data-access control
  // would mean staff never receiving this data in the first place, which
  // isn't compatible with the deposit list being core staff work.
  const elevation = await requireAdminStepUp('ส่งออกไฟล์ CSV');
  if (!elevation) return;

  const header = 'ลำดับ,วันที่และเวลา,ชื่อจริง,ชื่อเล่น,เบอร์โทร,สินค้าที่มัดจำ,ยอดมัดจำ (บาท),สถานะ';
  const lines = state.deposits.map((record, index) =>
    [
      index + 1,
      record.timestamp,
      record.firstName,
      record.nickname,
      record.phoneNumber,
      record.depositItem,
      record.depositAmount,
      CSV_STATUS[bucketOf(record)],
    ]
      .map(csvCell)
      .join(','),
  );

  const csv = '﻿' + [header, ...lines].join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');

  link.setAttribute('href', url);
  link.setAttribute('download', `Deposit_Records_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  toast('ส่งออกไฟล์ CSV เรียบร้อยแล้ว', 'success');
});

/* ------------------------------------------------------------------ init --- */

el.themeToggleBtn.addEventListener('click', toggleTheme);

applyTheme();
refreshIcons();
