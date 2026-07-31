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
  switchViewBtn: document.getElementById('switch-view-btn'),
  viewToggleText: document.getElementById('view-toggle-text'),
  logoutBtn: document.getElementById('logout-btn'),

  lookupView: document.getElementById('lookup-view'),
  dashboardView: document.getElementById('dashboard-view'),

  publicSearchInput: document.getElementById('public-search-input'),
  publicSearchClear: document.getElementById('public-search-clear'),
  searchResultsSection: document.getElementById('search-results-section'),
  resultsCountBadge: document.getElementById('results-count-badge'),
  resultsCardsGrid: document.getElementById('results-cards-grid'),

  contactForm: document.getElementById('contact-form'),
  firstNameInput: document.getElementById('first-name'),
  nicknameInput: document.getElementById('nickname'),
  phoneNumberInput: document.getElementById('phone-number'),
  depositItemInput: document.getElementById('deposit-item'),
  depositAmountInput: document.getElementById('deposit-amount'),
  submitBtn: document.getElementById('submit-btn'),
  submissionSuccessCard: document.getElementById('submission-success-card'),
  submittedDetailsBox: document.getElementById('submitted-details-box'),
  resetFormBtn: document.getElementById('reset-form-btn'),

  connectionStatus: document.getElementById('connection-status'),
  groupedDatesContainer: document.getElementById('grouped-dates-container'),
  adminSearchInput: document.getElementById('admin-search-input'),
  adminClearSearchBtn: document.getElementById('admin-clear-search-btn'),
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
  el.connectionStatus.className = `status-pill status-pill-${variant}`;
  el.connectionStatus.innerHTML = `<i data-lucide="${variant === 'error' ? 'alert-triangle' : 'refresh-cw'}"></i><span>${escapeHtml(text)}</span>`;
  refreshIcons();
}

function startDepositsFeed() {
  if (unsubscribeDeposits) return;
  unsubscribeDeposits = subscribeDeposits((records) => {
    state.deposits = records;
    setConnectionStatus('เชื่อมต่อสด (real-time)', 'ok');
    renderDashboard();
    renderPublicSearch();
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

/* -------------------------------------------------------- public search --- */

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

function renderPublicSearch() {
  const raw = el.publicSearchInput.value.trim();
  const needle = raw.toLowerCase();

  if (!needle) {
    el.searchResultsSection.classList.add('hidden');
    el.publicSearchClear.classList.add('hidden');
    return;
  }

  el.publicSearchClear.classList.remove('hidden');

  const needleDigits = needle.replace(/\D/g, '');
  const matches = state.deposits.filter((record) => matchesQuery(record, needle, needleDigits));

  el.searchResultsSection.classList.remove('hidden');
  el.resultsCountBadge.innerText = `พบ ${matches.length} รายการ`;

  if (matches.length === 0) {
    el.resultsCardsGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <i data-lucide="search-x"></i>
        <p>ไม่พบรายการมัดจำสำหรับ "${escapeHtml(raw)}"</p>
      </div>
    `;
    refreshIcons();
    return;
  }

  el.resultsCardsGrid.innerHTML = matches
    .map(
      (record) => `
    <div class="deposit-card">
      <div class="deposit-card-header">
        <div class="item-title">
          <i data-lucide="package"></i> ${escapeHtml(record.depositItem)}
        </div>
        <span class="date-badge"><i data-lucide="calendar"></i> ${escapeHtml(record.timestamp)}</span>
      </div>

      <div class="deposit-amount-box">
        <span class="amount-label">ยอดเงินมัดจำ</span>
        <span class="amount-value">${formatBaht(record.depositAmount)}</span>
      </div>

      <div class="customer-info-box">
        <div class="info-row">
          <i data-lucide="user"></i>
          <span>ชื่อ: <strong>${escapeHtml(record.firstName)} (ชื่อเล่น: ${escapeHtml(record.nickname)})</strong></span>
        </div>
        <div class="info-row">
          <i data-lucide="phone"></i>
          <span>เบอร์โทร: <strong class="phone-tag">${escapeHtml(formatPhone(record.phoneNumber))}</strong></span>
        </div>
      </div>
    </div>
  `,
    )
    .join('');

  refreshIcons();
}

/* ------------------------------------------------------------ dashboard --- */

function sumAmounts(records) {
  return records.reduce((total, record) => total + (Number(record.depositAmount) || 0), 0);
}

// The dashboard shows one of two lists: deposits still waiting to be collected
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

function renderDateGroup(date, records) {
  const dayTotal = sumAmounts(records);

  const rows = records
    .map(
      (record, index) => `
      <tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(record.firstName)}</strong></td>
        <td>${escapeHtml(record.nickname)}</td>
        <td><span class="phone-tag">${escapeHtml(formatPhone(record.phoneNumber))}</span></td>
        <td><strong><i data-lucide="package" style="width: 14px; height: 14px; display: inline;"></i> ${escapeHtml(record.depositItem)}</strong></td>
        <td class="amount-cell">${formatBaht(record.depositAmount)}</td>
        <td class="text-muted text-sm">${escapeHtml(record.timestamp)}</td>
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
          <i data-lucide="calendar"></i> วันที่ ${escapeHtml(date)} (${records.length} รายการ)
        </div>
        <div class="date-summary-tag">
          รวมมัดจำประจำวัน: ${formatBaht(dayTotal)}
        </div>
      </div>

      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th width="50">#</th>
              <th>ชื่อจริง</th>
              <th>ชื่อเล่น</th>
              <th>เบอร์โทร</th>
              <th>สินค้าที่มัดจำ</th>
              <th>ยอดมัดจำ (บาท)</th>
              <th>เวลาบันทึก</th>
              <th width="100" class="text-center">จัดการ</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderDashboard() {
  renderMetrics();
  syncModeButtons();

  const base = depositsForMode();
  const needle = el.adminSearchInput.value.toLowerCase().trim();
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

/* Delegated so the handlers survive every dashboard re-render. */
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

/* ------------------------------------------------------ dashboard mode --- */

function syncModeButtons() {
  el.modePendingBtn.classList.toggle('is-active', dashboardMode === 'pending');
  el.modeReceivedBtn.classList.toggle('is-active', dashboardMode === 'received');
}

function setDashboardMode(mode) {
  if (dashboardMode === mode) return;
  dashboardMode = mode;
  renderDashboard();
}

el.modePendingBtn.addEventListener('click', () => setDashboardMode('pending'));
el.modeReceivedBtn.addEventListener('click', () => setDashboardMode('received'));

/* ------------------------------------------------------------ view toggle --- */

function toggleView() {
  const showingLookup = !el.lookupView.classList.contains('hidden');

  if (showingLookup) {
    el.lookupView.classList.add('hidden');
    el.dashboardView.classList.remove('hidden');
    el.viewToggleText.innerText = 'ไปที่หน้าค้นหา / บันทึกมัดจำ';
  } else {
    el.dashboardView.classList.add('hidden');
    el.lookupView.classList.remove('hidden');
    el.viewToggleText.innerText = 'ไปที่หน้าแดชบอร์ด';
  }

  refreshIcons();
}

el.switchViewBtn.addEventListener('click', toggleView);

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

  el.submittedDetailsBox.innerHTML = `
    <div class="detail-item">
      <span>ชื่อ - ชื่อเล่น</span>
      <strong>${escapeHtml(record.firstName)} (${escapeHtml(record.nickname)})</strong>
    </div>
    <div class="detail-item">
      <span>เบอร์โทร</span>
      <strong>${escapeHtml(record.phoneNumber)}</strong>
    </div>
    <div class="detail-item">
      <span>สินค้ามัดจำ</span>
      <strong>${escapeHtml(record.depositItem)}</strong>
    </div>
    <div class="detail-item">
      <span>ยอดเงินมัดจำ</span>
      <strong class="text-success">${formatBaht(record.depositAmount)}</strong>
    </div>
  `;

  el.contactForm.parentElement.classList.add('hidden');
  el.submissionSuccessCard.classList.remove('hidden');
  toast('บันทึกข้อมูลสำเร็จ', 'success');

  requestSheetSync();
  renderDashboard();
  renderPublicSearch();
});

el.resetFormBtn.addEventListener('click', () => {
  el.contactForm.reset();
  el.submissionSuccessCard.classList.add('hidden');
  el.contactForm.parentElement.classList.remove('hidden');
  el.firstNameInput.focus();
});

/* --------------------------------------------------------------- search --- */

el.publicSearchInput.addEventListener('input', renderPublicSearch);
el.publicSearchClear.addEventListener('click', () => {
  el.publicSearchInput.value = '';
  renderPublicSearch();
});

el.adminSearchInput.addEventListener('input', (event) => {
  el.adminClearSearchBtn.classList.toggle('hidden', !event.target.value);
  renderDashboard();
});

el.adminClearSearchBtn.addEventListener('click', () => {
  el.adminSearchInput.value = '';
  el.adminClearSearchBtn.classList.add('hidden');
  renderDashboard();
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

/* --------------------------------------------------------------- modals --- */

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  // No modals left to close, but kept as a hook for future ones.
});

el.themeToggleBtn.addEventListener('click', toggleTheme);

/* ------------------------------------------------------------------ init --- */

applyTheme();
refreshIcons();
