/**
 * The sales dashboard — read-only analysis of the shop's sales sheet.
 *
 * Nothing here writes anywhere. The sheet stays the team's own working
 * document; this just reads it and does the arithmetic.
 *
 * Bars are drawn with plain CSS rather than a charting library on purpose: the
 * app's CSP is `script-src 'self'`, so a CDN chart script would be blocked, and
 * loosening the policy for one bar chart isn't a good trade.
 */

import { BRANDS, BRAND_GROUPS, daysLeftIn } from './sales.js';
import { escapeHtml } from './utils.js';

const baht = (n) => '฿' + Math.round(n).toLocaleString('th-TH');
const units = (n) => Math.round(n).toLocaleString('th-TH');

/** Compact money for tight spaces: ฿1.83M / ฿94.7K */
function shortBaht(n) {
  if (Math.abs(n) >= 1_000_000) return '฿' + (n / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(n) >= 1_000) return '฿' + (n / 1_000).toFixed(1) + 'K';
  return '฿' + Math.round(n);
}

function kpiCard(label, value, sub, tone = '') {
  return `
    <div class="kpi ${tone}">
      <span class="kpi-label">${escapeHtml(label)}</span>
      <span class="kpi-value mono">${value}</span>
      ${sub ? `<span class="kpi-sub">${sub}</span>` : ''}
    </div>`;
}

/**
 * Month-over-month change. Returns null when there's no previous month to
 * compare against, so the card can say so instead of showing a fake 0%.
 */
function momChange(current, previous) {
  if (!previous || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function renderKpis(month, prevMonth, mode, targets) {
  const isAmount = mode === 'amount';
  const total = isAmount ? month.totalAmount : month.totalUnits;
  const prevTotal = prevMonth ? (isAmount ? prevMonth.totalAmount : prevMonth.totalUnits) : 0;

  const mom = momChange(total, prevTotal);
  const momText = mom === null
    ? '<span class="kpi-sub">ไม่มีเดือนก่อนให้เทียบ</span>'
    : `<span class="kpi-sub ${mom >= 0 ? 'up' : 'down'}">${mom >= 0 ? '▲' : '▼'} ${Math.abs(mom).toFixed(1)}% จาก ${escapeHtml(prevMonth.label)}</span>`;

  // Everything target-related stays in baht — targets are set in baht, and
  // converting them to a device count would be a guess.
  const target = Object.values(targets).reduce((a, b) => a + b, 0);
  const remaining = Math.max(target - month.totalAmount, 0);
  const left = daysLeftIn(month.month, month.year);
  const pct = target > 0 ? (month.totalAmount / target) * 100 : 0;

  const remainValue = remaining === 0 ? 'ปิดเป้าแล้ว' : baht(remaining);
  const remainSub = remaining === 0
    ? `เกินเป้า ${shortBaht(month.totalAmount - target)}`
    : `จากเป้า ${shortBaht(target)} · ทำได้ ${pct.toFixed(0)}%`;

  const paceValue = remaining === 0
    ? '—'
    : left === 0 ? 'จบเดือนแล้ว' : baht(remaining / left);
  const paceSub = remaining === 0
    ? 'ไม่ต้องขายเพิ่มแล้ว'
    : left === 0 ? `ปิดไม่ทัน ขาด ${shortBaht(remaining)}` : `ต่อวัน · เหลือ ${left} วัน`;

  const asp = month.totalUnits > 0 ? month.totalAmount / month.totalUnits : 0;

  return `
    <div class="kpi-grid">
      ${kpiCard('ยอดขายรวม', isAmount ? baht(total) : units(total) + ' เครื่อง', momText, 'kpi-gold')}
      ${kpiCard('เหลืออีกเท่าไหร่ถึงปิดเป้า', remainValue, `<span class="kpi-sub">${escapeHtml(remainSub)}</span>`, remaining === 0 ? 'kpi-mint' : 'kpi-amber')}
      ${kpiCard('ต้องขายวันละ', paceValue, `<span class="kpi-sub">${escapeHtml(paceSub)}</span>`, 'kpi-blue')}
      ${kpiCard('ราคาเฉลี่ยต่อเครื่อง', baht(asp), `<span class="kpi-sub">${units(month.totalUnits)} เครื่อง · ขาย ${month.activeDays} วัน</span>`)}
    </div>`;
}

function renderBrandBars(month, prevMonth, mode) {
  const isAmount = mode === 'amount';
  const pick = (m, key) => (m ? (isAmount ? m.brands[key].amount : m.brands[key].units) : 0);

  const rows = BRANDS
    .map(({ key }) => ({ key, now: pick(month, key), before: pick(prevMonth, key) }))
    .filter((r) => r.now > 0 || r.before > 0)
    .sort((a, b) => b.now - a.now);

  if (rows.length === 0) {
    return '<div class="empty-state"><p>ยังไม่มียอดขายในเดือนนี้</p></div>';
  }

  const max = Math.max(...rows.flatMap((r) => [r.now, r.before]), 1);
  const fmt = isAmount ? shortBaht : units;

  const bars = rows.map((r) => {
    const diff = momChange(r.now, r.before);
    return `
      <div class="bar-row">
        <div class="bar-name">${escapeHtml(r.key)}</div>
        <div class="bar-track">
          <div class="bar bar-now" style="width:${(r.now / max) * 100}%"></div>
          <div class="bar bar-prev" style="width:${(r.before / max) * 100}%"></div>
        </div>
        <div class="bar-value mono">${fmt(r.now)}</div>
        <div class="bar-diff ${diff === null ? '' : diff >= 0 ? 'up' : 'down'}">
          ${diff === null ? '—' : `${diff >= 0 ? '▲' : '▼'}${Math.abs(diff).toFixed(0)}%`}
        </div>
      </div>`;
  }).join('');

  return `
    <div class="date-group-block">
      <div class="date-group-header">
        <div class="date-title"><i data-lucide="chart-column"></i> ยอดขายแยกตามแบรนด์</div>
        <div class="bar-legend">
          <span><i class="swatch now"></i>${escapeHtml(month.label)}</span>
          ${prevMonth ? `<span><i class="swatch prev"></i>${escapeHtml(prevMonth.label)}</span>` : ''}
        </div>
      </div>
      <div class="bar-chart">${bars}</div>
    </div>`;
}

function renderTargets(month, groupKey, targets, editing) {
  const group = BRAND_GROUPS[groupKey] || BRAND_GROUPS.all;
  const target = group.brands.reduce((sum, key) => sum + (targets[key] || 0), 0);
  const actual = group.brands.reduce((sum, key) => sum + month.brands[key].amount, 0);
  const pct = target > 0 ? Math.min((actual / target) * 100, 100) : 0;
  const shortfall = Math.max(target - actual, 0);

  // Editing shows every brand, not just the current group — a target belongs to
  // the shop, not to whichever group happens to be on screen.
  if (editing) {
    const inputs = BRANDS.map(({ key }) => `
      <div class="target-edit-row">
        <label for="target-${key}">${escapeHtml(key)}</label>
        <input type="number" id="target-${key}" data-brand="${key}"
               value="${targets[key] ?? 0}" min="0" step="1000" inputmode="numeric" />
      </div>`).join('');

    return `
      <div class="date-group-block">
        <div class="date-group-header">
          <div class="date-title"><i data-lucide="target"></i> แก้ไขเป้ายอดขายรายเดือน</div>
          <span class="kpi-sub">หน่วยเป็นบาท · ใช้ร่วมกันทั้งร้าน</span>
        </div>
        <div class="target-edit">
          ${inputs}
          <div class="target-edit-total">
            รวมทุกแบรนด์ <strong class="mono" id="target-edit-total">${baht(Object.values(targets).reduce((a, b) => a + b, 0))}</strong>
          </div>
          <div class="target-edit-actions">
            <button id="targets-cancel" class="btn btn-outline btn-sm">ยกเลิก</button>
            <button id="targets-save" class="btn btn-primary btn-sm"><i data-lucide="save"></i> บันทึกเป้า</button>
          </div>
          <p id="targets-msg" class="error-msg hidden"></p>
        </div>
      </div>`;
  }

  const perBrand = group.brands.map((key) => {
    const brandTarget = targets[key] || 0;
    const brandActual = month.brands[key].amount;
    const brandPct = brandTarget > 0 ? Math.min((brandActual / brandTarget) * 100, 100) : 0;
    const brandLeft = Math.max(brandTarget - brandActual, 0);
    return `
      <div class="target-row">
        <div class="target-name">${escapeHtml(key)}</div>
        <div class="target-track"><div class="target-fill" style="width:${brandPct}%"></div></div>
        <div class="target-pct mono">${brandPct.toFixed(0)}%</div>
        <div class="target-num mono">${brandLeft > 0 ? `เหลือ ${shortBaht(brandLeft)}` : 'ปิดเป้าแล้ว'}</div>
      </div>`;
  }).join('');

  return `
    <div class="date-group-block">
      <div class="date-group-header">
        <div class="date-title"><i data-lucide="target"></i> ความคืบหน้าเทียบเป้า</div>
        <div class="target-head-actions">
          <select id="sales-group" class="mini-select">
            ${Object.entries(BRAND_GROUPS).map(([k, g]) =>
              `<option value="${k}"${k === groupKey ? ' selected' : ''}>${escapeHtml(g.label)}</option>`).join('')}
          </select>
          <button id="targets-edit" class="btn btn-outline btn-sm"><i data-lucide="pencil"></i> แก้เป้า</button>
        </div>
      </div>
      <div class="target-summary">
        <div class="target-big">
          <span class="kpi-label">${shortfall > 0 ? 'เหลืออีกถึงปิดเป้ากลุ่มนี้' : 'ปิดเป้ากลุ่มนี้แล้ว'}</span>
          <span class="kpi-value mono">${shortfall > 0 ? baht(shortfall) : baht(actual)}</span>
          <span class="kpi-sub">ทำได้ ${baht(actual)} จากเป้า ${baht(target)}</span>
        </div>
        <div class="target-ring" style="--pct:${pct}">
          <span class="mono">${pct.toFixed(0)}%</span>
        </div>
      </div>
      <div class="target-list">${perBrand}</div>
    </div>`;
}

/** Render the whole dashboard into `container`. */
export function renderSalesDashboard(container, { months, monthIndex, mode, groupKey, updatedAt, targets, editingTargets }) {
  const month = months[monthIndex];
  const prevMonth = monthIndex > 0 ? months[monthIndex - 1] : null;

  container.innerHTML = `
    <div class="sales-toolbar">
      <select id="sales-month" class="mini-select">
        ${months.map((m, i) =>
          `<option value="${i}"${i === monthIndex ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
      </select>
      <div class="mode-toggle">
        <button class="btn btn-sm mode-btn${mode === 'amount' ? ' is-active' : ''}" data-mode="amount">บาท</button>
        <button class="btn btn-sm mode-btn${mode === 'units' ? ' is-active' : ''}" data-mode="units">เครื่อง</button>
      </div>
      <button id="sales-refresh" class="btn btn-outline btn-sm"><i data-lucide="refresh-cw"></i> รีเฟรช</button>
      <span class="sales-stamp">อัปเดต ${escapeHtml(updatedAt)}</span>
    </div>
    ${renderKpis(month, prevMonth, mode, targets)}
    ${renderBrandBars(month, prevMonth, mode)}
    ${renderTargets(month, groupKey, targets, editingTargets)}
    <p class="sales-note"><i data-lucide="lock"></i> ยอดขายอ่านอย่างเดียว — แดชบอร์ดนี้ไม่เขียนอะไรกลับไปที่ชีต (เป้าเก็บแยกในระบบ)</p>`;
}
