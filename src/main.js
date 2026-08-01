import './style.css';

import { createIcons } from 'lucide';

import { appIcons } from './icons.js';
import { getFirebaseConfig } from './config.js';
import { onAuthChange, signIn, signOutUser, getIdToken } from './auth.js';
import {
  initFirebase,
  softDeleteDeposit,
  markReceivedDeposit,
  subscribeDeposits,
  addDeposit,
} from './firebase.js';
import { persistTheme, resetOnSignOut, state } from './state.js';
import {
  bangkokTimestamp,
  csvCell,
  dateSortKey,
  datePart,
  escapeHtml,
  formatBaht,
  formatPhone,
  isValidPhone,
  todayDatePart,
} from './utils.js';

const el = {
  authGate: document.getElementById('auth-gate'),
  authGateForm: document.getElementById('auth-gate-form'),
  authGatePassword: document.getElementById('auth-gate-password'),
  authGateToggleVis: document.getElementById('auth-gate-toggle-vis'),
  authGateError: document.getElementById('auth-gate-error'),
  authGateSubmit: document.getElementById('auth-gate-submit'),
  appContent: document.getElementById('app-content'),

  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  themeIcon: document.getElementById('theme-icon'),
  logoutBtn: document.getElementById('logout-btn'),

  // Add-deposit slide-over
  addOpenBtn: document.getElementById('add-open-btn'),
  addPanel: document.getElementById('add-panel'),
  addOverlay: document.getElementById('add-overlay'),
  addCloseBtn: document.getElementById('add-close-btn'),
  contactForm: document.getElementById('contact-form'),
  firstNameInput: document.getElementById('first-name'),
  nicknameInput: document.getElementById('nickname'),
  phoneNumberInput: document.getElementById('phone-number'),
  depositItemInput: document.getElementById('deposit-item'),
  depositAmountInput: document.getElementById('deposit-amount'),
  submitBtn: document.getElementById('submit-btn'),

  // Single search + list
  searchInput: document.getElementById('search-input'),
  searchClearBtn: document.getElementById('search-clear-btn'),
  connectionStatus: document.getElementById('connection-status'),
  groupedDatesContainer: document.getElementById('grouped-dates-container'),
  tableEmptyState: document.getElementById('table-empty-state'),
  exportCsvBtn: document.getElementById('export-csv-btn'),
  modePendingBtn: document.getElementById('mode-pending-btn'),
  modeReceivedBtn: document.getElementById('mode-received-btn'),

  metricTotalAmount: document.getElementById('metric-total-amount'),
  metricTotalCount: document.getElementById('metric-total-count'),
  metricTodayAmount: document.getElementById('metric-today-amount'),

  toastContainer: document.getElementById('toast-container'),
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
    await fetch('/api/sync-now', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    console.warn('Instant sheet sync failed (cron will catch up):', error);
  }
}

/* ---------------------------------------------------------------- theme --- */

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  if (el.themeIcon) {
    el.themeIcon.setAttribute('data-lucide', state.theme === 'dark' ? 'sun' : 'moon');
    refreshIcons();
  }
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
  el.connectionStatus.className = `status-pill status-pill-${variant} conn-pill`;
  el.connectionStatus.innerHTML = `<i data-lucide="${variant === 'error' ? 'alert-triangle' : 'refresh-cw'}"></i><span>${escapeHtml(text)}</span>`;
  refreshIcons();
}

function startDepositsFeed() {
  if (unsubscribeDeposits) return;
  unsubscribeDeposits = subscribeDeposits((records) => {
    state.deposits = records;
    setConnectionStatus('เชื่อมต่อสด', 'ok');
    renderList();
  });
}

function stopDepositsFeed() {
  if (unsubscribeDeposits) {
    unsubscribeDeposits();
    unsubscribeDeposits = null;
  }
  resetOnSignOut();
}

function showApp() {
  el.authGate.classList.add('hidden');
  el.appContent.classList.remove('hidden');
  startDepositsFeed();
}

function showGate() {
  closeAddDrawer();
  el.appContent.classList.add('hidden');
  el.authGate.classList.remove('hidden');
  el.authGatePassword.value = '';
  el.authGateError.classList.add('hidden');
  stopDepositsFeed();
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

el.authGateForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const password = el.authGatePassword.value;
  el.authGateSubmit.disabled = true;
  el.authGateError.classList.add('hidden');

  const result = await signIn(password);

  el.authGateSubmit.disabled = false;

  if (!result.ok) {
    const message =
      result.reason === 'throttled'
        ? 'พยายามเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่'
        : 'รหัสผ่านไม่ถูกต้อง';
    el.authGateError.textContent = message;
    el.authGateError.classList.remove('hidden');
    el.authGatePassword.value = '';
    el.authGatePassword.focus();
  }
  // On success, onAuthChange fires and shows the app — nothing else to do here.
});

el.authGateToggleVis.addEventListener('click', () => {
  const next = el.authGatePassword.getAttribute('type') === 'password' ? 'text' : 'password';
  el.authGatePassword.setAttribute('type', next);
});

el.logoutBtn.addEventListener('click', async () => {
  await signOutUser();
  toast('ออกจากระบบเรียบร้อยแล้ว', 'info');
});

/* --------------------------------------------------------- list + search -- */

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

// The list shows one of two sets: deposits still waiting to be collected
// ('pending', the default working view), or the archive of collected ones
// ('received'). Records with no status are treated as pending (older data).
let dashboardMode = 'pending';

function isReceived(record) {
  return record.status === 'received';
}

function depositsForMode() {
  return state.deposits.filter((record) =>
    dashboardMode === 'received' ? isReceived(record) : !isReceived(record),
  );
}

function renderMetrics() {
  const today = todayDatePart();
  // Metrics describe money currently held — i.e. deposits not yet collected.
  const active = state.deposits.filter((record) => !isReceived(record));

  el.metricTotalAmount.innerText = formatBaht(sumAmounts(active));
  el.metricTotalCount.innerText = `${active.length} รายการ`;

  const todayRecords = active.filter((record) => datePart(record.timestamp) === today);
  el.metricTodayAmount.innerText = formatBaht(sumAmounts(todayRecords));
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

function statusChip(record) {
  return isReceived(record)
    ? '<span class="status-chip chip-received">รับแล้ว</span>'
    : '<span class="status-chip chip-pending">รอรับของ</span>';
}

function renderDateGroup(date, records) {
  const dayTotal = sumAmounts(records);

  const rows = records
    .map(
      (record, index) => `
      <tr>
        <td class="text-muted text-sm">${index + 1}</td>
        <td><strong>${escapeHtml(record.firstName)}</strong></td>
        <td>${escapeHtml(record.nickname)}</td>
        <td><span class="phone-tag">${escapeHtml(formatPhone(record.phoneNumber))}</span></td>
        <td class="product-cell">${escapeHtml(record.depositItem)}</td>
        <td class="amount-cell">${formatBaht(record.depositAmount)}</td>
        <td class="text-center">${statusChip(record)}</td>
        <td class="text-center">
          <div class="action-btns">
            ${
              dashboardMode === 'pending'
                ? `<button class="btn btn-xs btn-success mark-received-btn"
                    data-id="${escapeHtml(record.id)}" title="ลูกค้ารับสินค้าแล้ว">
              <i data-lucide="check-check"></i>
            </button>`
                : ''
            }
            <button class="btn btn-xs btn-outline copy-info-btn"
                    data-info="${escapeHtml(`${record.firstName} - ${record.depositItem} (${formatBaht(record.depositAmount)})`)}"
                    title="คัดลอกข้อมูล">
              <i data-lucide="copy"></i>
            </button>
            <button class="btn btn-xs btn-danger btn-outline delete-deposit-btn"
                    data-id="${escapeHtml(record.id)}" title="ลบรายการ">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </td>
      </tr>
    `,
    )
    .join('');

  return `
    <div class="date-group-block">
      <div class="date-group-header">
        <div class="date-title">
          <i data-lucide="calendar"></i> ${escapeHtml(date)} · ${records.length} รายการ
        </div>
        <div class="date-summary-tag">
          รวมมัดจำ ${formatBaht(dayTotal)}
        </div>
      </div>

      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th width="40">#</th>
              <th>ชื่อจริง</th>
              <th>ชื่อเล่น</th>
              <th>เบอร์โทร</th>
              <th>สินค้าที่มัดจำ</th>
              <th>ยอดมัดจำ</th>
              <th class="text-center">สถานะ</th>
              <th width="110" class="text-center">จัดการ</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderList() {
  renderMetrics();
  syncModeButtons();

  const base = depositsForMode();
  const needle = el.searchInput.value.toLowerCase().trim();
  const needleDigits = needle.replace(/\D/g, '');
  const visible = needle
    ? base.filter((record) => matchesQuery(record, needle, needleDigits))
    : base;

  if (visible.length === 0) {
    el.groupedDatesContainer.innerHTML = '';
    el.tableEmptyState.classList.remove('hidden');
    return;
  }

  el.tableEmptyState.classList.add('hidden');
  el.groupedDatesContainer.innerHTML = groupByDate(visible)
    .map(([date, records]) => renderDateGroup(date, records))
    .join('');

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

  const receivedBtn = event.target.closest('.mark-received-btn');
  if (receivedBtn) {
    const id = receivedBtn.getAttribute('data-id');
    if (!confirm('ยืนยันว่าลูกค้ารับสินค้าแล้ว?\nรายการจะย้ายไปหน้า "รับของแล้ว"')) return;
    const ok = await markReceivedDeposit(id);
    if (!ok) {
      toast('บันทึกไม่สำเร็จ', 'danger');
      return;
    }
    toast('บันทึก "รับสินค้าแล้ว" เรียบร้อย', 'success');
    requestSheetSync();
    return;
  }

  const deleteBtn = event.target.closest('.delete-deposit-btn');
  if (!deleteBtn) return;

  const id = deleteBtn.getAttribute('data-id');
  if (!confirm('คุณต้องการลบรายการมัดจำนี้ใช่หรือไม่?')) return;

  const deleted = await softDeleteDeposit(id);
  if (!deleted) {
    toast('ลบรายการไม่สำเร็จ', 'danger');
    return;
  }
  // The snapshot listener re-renders with the record gone.
  toast('ลบรายการมัดจำเรียบร้อยแล้ว', 'info');
  requestSheetSync();
});

/* ------------------------------------------------------------ list mode --- */

function syncModeButtons() {
  el.modePendingBtn.classList.toggle('is-active', dashboardMode === 'pending');
  el.modeReceivedBtn.classList.toggle('is-active', dashboardMode === 'received');
}

function setDashboardMode(mode) {
  if (dashboardMode === mode) return;
  dashboardMode = mode;
  renderList();
}

el.modePendingBtn.addEventListener('click', () => setDashboardMode('pending'));
el.modeReceivedBtn.addEventListener('click', () => setDashboardMode('received'));

/* --------------------------------------------------- add-deposit drawer --- */

function openAddDrawer() {
  el.addPanel.classList.add('open');
  el.addPanel.setAttribute('aria-hidden', 'false');
  el.addOverlay.classList.remove('hidden');
  el.firstNameInput.focus();
}

function closeAddDrawer() {
  el.addPanel.classList.remove('open');
  el.addPanel.setAttribute('aria-hidden', 'true');
  el.addOverlay.classList.add('hidden');
}

el.addOpenBtn.addEventListener('click', openAddDrawer);
el.addCloseBtn.addEventListener('click', closeAddDrawer);
el.addOverlay.addEventListener('click', closeAddDrawer);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeAddDrawer();
});

/* ----------------------------------------------------------------- form --- */

el.phoneNumberInput.addEventListener('input', (event) => {
  event.target.value = formatPhone(event.target.value);
});

el.contactForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!isValidPhone(el.phoneNumberInput.value)) {
    toast('กรุณากรอกเบอร์โทรศัพท์ 10 หลัก ให้ถูกต้อง', 'danger');
    return;
  }

  const record = {
    depositId: crypto.randomUUID(),
    firstName: el.firstNameInput.value.trim().split(/\s+/)[0],
    nickname: el.nicknameInput.value.trim(),
    phoneNumber: formatPhone(el.phoneNumberInput.value.trim()),
    depositItem: el.depositItemInput.value.trim(),
    depositAmount: parseFloat(el.depositAmountInput.value) || 0,
    timestamp: bangkokTimestamp(),
  };

  const submitLabel = el.submitBtn.querySelector('span');
  const originalLabel = submitLabel.innerText;
  el.submitBtn.disabled = true;
  submitLabel.innerText = 'กำลังบันทึก...';

  const firestoreId = await addDeposit(record);

  el.submitBtn.disabled = false;
  submitLabel.innerText = originalLabel;

  if (!firestoreId) {
    toast('บันทึกข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง', 'danger');
    return;
  }

  el.contactForm.reset();
  closeAddDrawer();
  toast(`บันทึกมัดจำ "${record.firstName}" เรียบร้อย`, 'success');

  requestSheetSync();
  // The real-time listener re-renders the list; call once for instant feedback.
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

el.exportCsvBtn.addEventListener('click', () => {
  if (state.deposits.length === 0) {
    toast('ไม่มีข้อมูลสำหรับส่งออก', 'warning');
    return;
  }

  const header = 'ลำดับ,วันที่และเวลา,ชื่อจริง,ชื่อเล่น,เบอร์โทร,สินค้าที่มัดจำ,ยอดมัดจำ (บาท)';
  const lines = state.deposits.map((record, index) =>
    [
      index + 1,
      record.timestamp,
      record.firstName,
      record.nickname,
      record.phoneNumber,
      record.depositItem,
      record.depositAmount,
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
