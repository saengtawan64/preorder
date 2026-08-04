/**
 * The "จัดการรหัส" screen — add, rename and remove unlock PINs.
 *
 * Rendering only: it is handed a list of `{index, label, hint}` and returns
 * markup. It never sees a PIN except the one being typed into the add field,
 * which goes straight to the server and is not kept.
 */

import { escapeHtml } from './utils.js';

/** "2569-08-04" out of an ISO stamp, in Thai years, or '' when unknown. */
function addedOn(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${Number(get('year')) + 543}`;
}

function row(entry, canRemove) {
  const label = entry.label || `รหัสที่ ${entry.index + 1}`;
  const added = addedOn(entry.addedAtIso);
  return `
    <div class="pin-row" data-index="${entry.index}" data-hint="${escapeHtml(entry.hint)}">
      <span class="pin-row-hint">${escapeHtml(entry.hint)}</span>
      <span class="pin-row-label">${escapeHtml(label)}</span>
      <span class="pin-row-added">${added ? 'เพิ่ม ' + added : ''}</span>
      <span class="pin-row-actions">
        <button type="button" class="btn btn-xs btn-outline pin-rename-btn">ตั้งชื่อ</button>
        <button type="button" class="btn btn-xs btn-outline btn-danger pin-remove-btn"
          ${canRemove ? '' : 'disabled title="ต้องเหลือรหัสอย่างน้อย 1 ชุด"'}>ลบ</button>
      </span>
    </div>`;
}

export function renderPins(container, state) {
  const list = state.pins || [];
  const canRemove = list.length > 1;

  container.innerHTML = `
    <div class="date-group-block">
      <div class="date-group-header">
        <div class="date-title"><i data-lucide="key-round"></i> รหัสปลดล็อก</div>
        <span class="date-summary-tag">${list.length} รหัส</span>
      </div>

      <div class="pin-manage">
        ${state.loading ? '<p class="text-muted">กำลังโหลด…</p>' : ''}
        ${!state.loading && list.length === 0 ? '<p class="text-muted">ยังไม่มีรหัส</p>' : ''}
        ${list.map((entry) => row(entry, canRemove)).join('')}

        <div class="pin-add">
          <div class="inst-field">
            <label for="pin-new">รหัสใหม่ (ตัวเลข 5 หลัก)</label>
            <input type="text" id="pin-new" inputmode="numeric" autocomplete="off"
              maxlength="5" placeholder="เช่น 40912" />
          </div>
          <div class="inst-field">
            <label for="pin-new-label">ชื่อเรียก (ไม่ใส่ก็ได้)</label>
            <input type="text" id="pin-new-label" autocomplete="off"
              maxlength="24" placeholder="เช่น พนักงานหน้าร้าน" />
          </div>
          <button type="button" class="btn btn-primary" id="pin-add-btn">
            <i data-lucide="plus-circle"></i><span>เพิ่มรหัส</span>
          </button>
        </div>

        <small id="pin-error" class="error-msg hidden"></small>

        <p class="sales-note">
          <i data-lucide="shield-check"></i>
          รหัสเก็บไว้ที่เซิร์ฟเวอร์ ไม่อยู่ในโค้ดและไม่ส่งกลับมาที่เบราว์เซอร์ —
          หน้านี้จึงเห็นได้แค่ตัวแรกกับตัวสุดท้าย ถ้าลืมรหัสให้ลบทิ้งแล้วตั้งใหม่
        </p>
        <p class="sales-note">
          <i data-lucide="info"></i>
          ไม่แน่ใจว่าแถวไหนคือรหัสอะไร? พิมพ์รหัสนั้นในช่อง "รหัสใหม่" แล้วกดเพิ่ม
          ระบบจะบอกว่ามันคือแถวไหน (ไม่ได้เพิ่มซ้ำ)
        </p>
      </div>
    </div>`;
}
