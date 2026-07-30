import './style.css';

import { createIcons } from 'lucide';

import { appIcons } from './icons.js';
import {
  getFirebaseConfig,
  getSheetCsvUrl,
  isUsingDefaultPin,
  saveFirebaseConfig,
  saveSheetCsvUrl,
} from './config.js';
import { fetchDepositsFromSheet, postDepositToSheet } from './sheets.js';
import { markSynced, persistDeposits, persistLoginState, persistTheme, state } from './state.js';
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
  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  themeIcon: document.getElementById('theme-icon'),

  publicView: document.getElementById('public-view'),
  adminView: document.getElementById('admin-view'),

  publicSearchInput: document.getElementById('public-search-input'),
  publicSearchClear: document.getElementById('public-search-clear'),
  searchResultsSection: document.getElementById('search-results-section'),
  resultsCountBadge: document.getElementById('results-count-badge'),
  resultsCardsGrid: document.getElementById('results-cards-grid'),

  authStatusContainer: document.getElementById('auth-status-container'),
  loginModal: document.getElementById('login-modal'),
  closeLoginModalBtn: document.getElementById('close-login-modal-btn'),
  cancelLoginBtn: document.getElementById('cancel-login-btn'),
  loginForm: document.getElementById('login-form'),
  adminPinInput: document.getElementById('admin-pin'),
  togglePinVisBtn: document.getElementById('toggle-pin-vis'),
  loginErrorMsg: document.getElementById('login-error-msg'),
  logoutBtn: document.getElementById('logout-btn'),

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

  groupedDatesContainer: document.getElementById('grouped-dates-container'),
  adminSearchInput: document.getElementById('admin-search-input'),
  adminClearSearchBtn: document.getElementById('admin-clear-search-btn'),
  tableEmptyState: document.getElementById('table-empty-state'),
  syncNowBtn: document.getElementById('sync-now-btn'),
  syncSpinIcon: document.getElementById('sync-spin-icon'),
  exportCsvBtn: document.getElementById('export-csv-btn'),

  metricTotalAmount: document.getElementById('metric-total-amount'),
  metricTotalCount: document.getElementById('metric-total-count'),
  metricTodayAmount: document.getElementById('metric-today-amount'),
  metricLastSync: document.getElementById('metric-last-sync'),

  guideModalBtn: document.getElementById('guide-modal-btn'),
  guideModal: document.getElementById('guide-modal'),
  closeGuideModalBtn: document.getElementById('close-guide-modal-btn'),
  closeGuideBtnFooter: document.getElementById('close-guide-btn-footer'),
  sheetUrlInput: document.getElementById('sheet-url-input'),
  saveSheetUrlBtn: document.getElementById('save-sheet-url-btn'),
  urlSaveStatus: document.getElementById('url-save-status'),

  firebaseModalBtn: document.getElementById('firebase-modal-btn'),
  firebaseModal: document.getElementById('firebase-modal'),
  closeFirebaseModalBtn: document.getElementById('close-firebase-modal-btn'),
  closeFirebaseBtnFooter: document.getElementById('close-firebase-btn-footer'),
  firebaseConfigInput: document.getElementById('firebase-config-input'),
  saveFirebaseBtn: document.getElementById('save-firebase-btn'),
  firebaseSaveStatus: document.getElementById('firebase-save-status'),

  sheetStatusBanner: document.getElementById('sheet-status-banner'),
  sheetStatusText: document.getElementById('sheet-status-text'),
  configSheetBtnInline: document.getElementById('config-sheet-btn-inline'),

  toastContainer: document.getElementById('toast-container'),
};

/* ---------------------------------------------------------------- icons --- */

/**
 * Replace every `data-lucide` placeholder with its SVG. Called after any render
 * that injects new markup, since Lucide only walks the DOM on demand.
 */
function refreshIcons() {
  createIcons({ icons: appIcons });
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

/* ------------------------------------------------------------- firebase --- */

/**
 * The Firestore module, loaded on demand.
 *
 * The Firebase SDK is by far the largest dependency here, and a deployment that
 * only uses Google Sheets never needs it — so it is pulled in as a separate
 * chunk the first time a config is actually present.
 */
let fb = null;
let unsubscribeDeposits = null;

async function loadFirebaseModule() {
  if (!fb) fb = await import('./firebase.js');
  return fb;
}

async function connectFirebase() {
  const config = getFirebaseConfig();
  if (!config) return;

  let mod;
  try {
    mod = await loadFirebaseModule();
  } catch (error) {
    console.error('Could not load the Firebase module:', error);
    toast('โหลดโมดูล Firebase ไม่สำเร็จ', 'danger');
    return;
  }

  if (!mod.initFirebase(config)) return;
  state.isFirebaseActive = true;

  if (unsubscribeDeposits) unsubscribeDeposits();

  unsubscribeDeposits = mod.subscribeDeposits((records) => {
    // Fires for empty snapshots too, so deleting the last record clears the UI.
    state.deposits = records;
    persistDeposits();
    markSynced();
    renderDashboard();
    renderPublicSearch();
  });

  renderStatusBanner();
}

/* --------------------------------------------------------- sheet syncing --- */

async function syncFromSheet({ notify = false } = {}) {
  if (!getSheetCsvUrl()) {
    if (notify) toast('ยังไม่ได้ตั้งค่า URL ของ Google Sheet', 'warning');
    return;
  }

  state.isSyncing = true;
  el.syncSpinIcon?.classList.add('spin');

  try {
    const records = await fetchDepositsFromSheet();

    // Firestore is authoritative when it is connected; the sheet is only a
    // fallback source for deployments without Firebase.
    if (!state.isFirebaseActive) {
      state.deposits = records.slice().reverse();
      persistDeposits();
    }

    markSynced();
    if (notify) toast(`ดึงข้อมูลล่าสุดเรียบร้อย (${records.length} รายการ)`, 'success');
  } catch (error) {
    console.warn('Sync fetch error:', error);
    if (notify) toast('ดึงข้อมูลจาก Google Sheet ไม่สำเร็จ กรุณาตรวจสอบ URL', 'danger');
  } finally {
    state.isSyncing = false;
    el.syncSpinIcon?.classList.remove('spin');
    renderDashboard();
    renderPublicSearch();
  }
}

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

function renderMetrics() {
  const today = todayDatePart();

  el.metricTotalAmount.innerText = formatBaht(sumAmounts(state.deposits));
  el.metricTotalCount.innerText = `${state.deposits.length} รายการ`;

  // Compare the whole date portion. Matching on a substring of the date would
  // also catch 11/7 and 21/7 when today is 1/7.
  const todayRecords = state.deposits.filter((record) => datePart(record.timestamp) === today);
  el.metricTodayAmount.innerText = formatBaht(sumAmounts(todayRecords));

  el.metricLastSync.innerText = state.lastSyncTime || 'ยังไม่อัปเดต';
}

function groupByDate(records) {
  const groups = new Map();

  for (const record of records) {
    const key = datePart(record.timestamp) || 'ไม่ระบุวันที่';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  // Newest day first; unparseable dates sink to the bottom.
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

  const needle = el.adminSearchInput.value.toLowerCase().trim();
  const needleDigits = needle.replace(/\D/g, '');
  const visible = needle
    ? state.deposits.filter((record) => matchesQuery(record, needle, needleDigits))
    : state.deposits;

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

  const deleteBtn = event.target.closest('.delete-deposit-btn');
  if (!deleteBtn) return;

  const id = deleteBtn.getAttribute('data-id');
  if (!confirm('คุณต้องการลบรายการมัดจำนี้ใช่หรือไม่?')) return;

  // Firestore ids are strings; sheet and local-only rows are not deletable
  // upstream, so those are only dropped from the local cache.
  if (state.isFirebaseActive && typeof id === 'string' && !id.startsWith('sheet-')) {
    const deleted = await fb.deleteDeposit(id);
    if (!deleted) {
      toast('ลบรายการบน Firebase ไม่สำเร็จ', 'danger');
      return;
    }
    // The snapshot listener re-renders with the record gone.
    toast('ลบรายการมัดจำเรียบร้อยแล้ว', 'info');
    return;
  }

  state.deposits = state.deposits.filter((record) => String(record.id) !== String(id));
  persistDeposits();
  renderDashboard();
  renderPublicSearch();
  toast('ลบรายการออกจากเครื่องนี้แล้ว (ข้อมูลต้นทางไม่ถูกแก้)', 'info');
});

/* ------------------------------------------------------------ auth view --- */

function renderAuthUi() {
  if (state.isAdminLoggedIn) {
    el.authStatusContainer.innerHTML = `
      <button id="switch-view-btn" class="btn btn-secondary">
        <i data-lucide="refresh-cw"></i>
        <span id="view-toggle-text">ไปที่หน้าค้นหา / บันทึกมัดจำ</span>
      </button>
    `;
    el.publicView.classList.add('hidden');
    el.adminView.classList.remove('hidden');
    document.getElementById('switch-view-btn')?.addEventListener('click', toggleView);
  } else {
    el.authStatusContainer.innerHTML = `
      <button id="open-login-btn" class="btn btn-primary">
        <i data-lucide="lock"></i>
        <span>เข้าสู่ระบบ Admin</span>
      </button>
    `;
    el.publicView.classList.remove('hidden');
    el.adminView.classList.add('hidden');
    document.getElementById('open-login-btn')?.addEventListener('click', openLoginModal);
  }

  refreshIcons();
}

function toggleView() {
  const showingPublic = !el.publicView.classList.contains('hidden');
  const label = document.getElementById('view-toggle-text');

  if (showingPublic) {
    el.publicView.classList.add('hidden');
    el.adminView.classList.remove('hidden');
    if (label) label.innerText = 'ไปที่หน้าค้นหา / บันทึกมัดจำ';
  } else {
    el.adminView.classList.add('hidden');
    el.publicView.classList.remove('hidden');
    if (label) label.innerText = 'ไปที่หน้าแดชบอร์ด Admin';
  }

  refreshIcons();
}

function openLoginModal() {
  el.loginModal.classList.remove('hidden');
  el.adminPinInput.value = '';
  el.loginErrorMsg.classList.add('hidden');
  el.adminPinInput.focus();
}

function closeLoginModal() {
  el.loginModal.classList.add('hidden');
}

el.loginForm.addEventListener('submit', (event) => {
  event.preventDefault();

  if (el.adminPinInput.value.trim() !== state.adminPin) {
    el.loginErrorMsg.classList.remove('hidden');
    toast('รหัส PIN ไม่ถูกต้อง', 'danger');
    return;
  }

  state.isAdminLoggedIn = true;
  persistLoginState();
  closeLoginModal();
  renderAuthUi();
  renderDashboard();
  toast('เข้าสู่ระบบ Admin สำเร็จ!', 'success');

  if (isUsingDefaultPin()) {
    toast('ยังใช้ PIN เริ่มต้น (1234) — ควรตั้งค่า VITE_ADMIN_PIN ก่อนใช้งานจริง', 'warning');
  }
});

el.logoutBtn.addEventListener('click', () => {
  state.isAdminLoggedIn = false;
  persistLoginState();
  renderAuthUi();
  toast('ออกจากระบบเรียบร้อยแล้ว', 'info');
});

el.togglePinVisBtn.addEventListener('click', () => {
  const next = el.adminPinInput.getAttribute('type') === 'password' ? 'text' : 'password';
  el.adminPinInput.setAttribute('type', next);
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
    id: Date.now(),
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
  submitLabel.innerText = 'กำลังบันทึกลง Firebase & Sheets...';

  let firestoreId = false;
  if (state.isFirebaseActive) {
    firestoreId = await fb.addDeposit(record);
  }
  const sheetOk = await postDepositToSheet(record);

  el.submitBtn.disabled = false;
  submitLabel.innerText = originalLabel;

  // A configured Firestore that rejects the write is a real failure — the
  // record would exist only on this device. Say so instead of showing success.
  if (state.isFirebaseActive && !firestoreId) {
    toast('บันทึกลง Firebase ไม่สำเร็จ กรุณาลองอีกครั้ง', 'danger');
    return;
  }

  if (firestoreId) {
    record.id = firestoreId;
  } else {
    // No Firestore: keep the record locally so it is at least visible here.
    state.deposits.unshift(record);
    persistDeposits();
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

  toast(
    sheetOk ? 'บันทึกข้อมูลสำเร็จ (ส่งลง Firebase และ Google Sheet เรียบร้อย)' : 'บันทึกข้อมูลสำเร็จ',
    'success',
  );

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

  // BOM so Excel opens the Thai text as UTF-8.
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

/* --------------------------------------------------------------- status --- */

function renderStatusBanner() {
  if (state.isFirebaseActive) {
    el.sheetStatusBanner.className = 'status-banner banner-success';
    el.sheetStatusText.innerText =
      'เชื่อมต่อ Firebase Firestore แบบ Real-time เรียบร้อยแล้ว';
    return;
  }

  if (getSheetCsvUrl()) {
    el.sheetStatusBanner.className = 'status-banner banner-success';
    el.sheetStatusText.innerText =
      'เชื่อมต่อกับ Google Sheet เรียบร้อยแล้ว (ตั้งค่า Firebase เพิ่มเพื่อใช้งาน Real-time)';
    return;
  }

  el.sheetStatusBanner.className = 'status-banner banner-warning';
  el.sheetStatusText.innerText =
    'ยังไม่ได้ตั้งค่าแหล่งข้อมูล — กรุณาตั้งค่า Firebase หรือ Google Sheet CSV URL';
}

/* --------------------------------------------------------------- modals --- */

function openModal(modal) {
  modal.classList.remove('hidden');
}

function closeModal(modal) {
  modal.classList.add('hidden');
}

el.guideModalBtn.addEventListener('click', () => {
  el.sheetUrlInput.value = getSheetCsvUrl();
  openModal(el.guideModal);
});
el.configSheetBtnInline.addEventListener('click', () => {
  el.sheetUrlInput.value = getSheetCsvUrl();
  openModal(el.guideModal);
});
el.closeGuideModalBtn.addEventListener('click', () => closeModal(el.guideModal));
el.closeGuideBtnFooter.addEventListener('click', () => closeModal(el.guideModal));

el.saveSheetUrlBtn.addEventListener('click', () => {
  saveSheetCsvUrl(el.sheetUrlInput.value.trim());

  el.urlSaveStatus.classList.remove('hidden');
  setTimeout(() => el.urlSaveStatus.classList.add('hidden'), 3000);

  renderStatusBanner();
  syncFromSheet({ notify: true });
  toast('บันทึกการตั้งค่า URL ชีตเรียบร้อยแล้ว!', 'success');
});

el.firebaseModalBtn?.addEventListener('click', () => {
  const config = getFirebaseConfig();
  if (config) el.firebaseConfigInput.value = JSON.stringify(config, null, 2);
  openModal(el.firebaseModal);
});
el.closeFirebaseModalBtn?.addEventListener('click', () => closeModal(el.firebaseModal));
el.closeFirebaseBtnFooter?.addEventListener('click', () => closeModal(el.firebaseModal));

/**
 * Accept either a JSON object or a pasted `const firebaseConfig = {...};`
 * snippet copied straight out of the Firebase console.
 */
function parseFirebaseConfigInput(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) return JSON.parse(trimmed);

  const body = trimmed
    .replace(/^\s*(const|let|var)\s+\w+\s*=\s*/, '')
    .replace(/;\s*$/, '')
    .trim();

  const jsonish = body
    .replace(/'/g, '"')
    .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
    .replace(/,(\s*})/g, '$1');

  return JSON.parse(jsonish);
}

el.saveFirebaseBtn?.addEventListener('click', () => {
  let config;
  try {
    config = parseFirebaseConfigInput(el.firebaseConfigInput.value);
  } catch (error) {
    console.error(error);
    toast('กรุณาตรวจสอบรูปแบบ Firebase Config ที่วาง', 'danger');
    return;
  }

  if (!config || !config.projectId) {
    toast('รูปแบบ Firebase Config ไม่ถูกต้อง (ไม่พบ projectId)', 'danger');
    return;
  }

  saveFirebaseConfig(config);

  el.firebaseSaveStatus.classList.remove('hidden');
  setTimeout(() => el.firebaseSaveStatus.classList.add('hidden'), 3000);

  connectFirebase();
  renderStatusBanner();
  toast('บันทึกการตั้งค่า Firebase เรียบร้อยแล้ว!', 'success');
});

/* Close a modal by clicking its backdrop or pressing Escape. */
for (const modal of [el.loginModal, el.guideModal, el.firebaseModal]) {
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal(modal);
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  for (const modal of [el.loginModal, el.guideModal, el.firebaseModal]) {
    closeModal(modal);
  }
});

el.closeLoginModalBtn.addEventListener('click', closeLoginModal);
el.cancelLoginBtn.addEventListener('click', closeLoginModal);
el.themeToggleBtn.addEventListener('click', toggleTheme);
el.syncNowBtn.addEventListener('click', () => syncFromSheet({ notify: true }));

/* ------------------------------------------------------------------ init --- */

applyTheme();
renderAuthUi();
connectFirebase();
renderStatusBanner();
renderDashboard();
renderPublicSearch();
refreshIcons();
syncFromSheet();
