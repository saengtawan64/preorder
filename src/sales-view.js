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

import { BRANDS, DEFAULT_TARGETS, BRAND_GROUPS, daysLeftIn } from './sales.js';
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

function renderKpis(month, prevMonth, mode) {
  const isAmount = mode === 'amount';
  const total = isAmount ? month.totalAmount : month.totalUnits;
  const prevTotal = prevMonth ? (isAmount ? prevMonth.totalAmount : prevMonth.totalUnits) : 0;

  const mom = momChange(total, prevTotal);
  const momText = mom === null
    ? '<span class="kpi-sub">ไม่มีเดือนก่อนให้เทียบ</span>'
    : `<span class="kpi-sub ${mom >= 0 ? 'up' : 'down'}">${mom >= 0 ? '▲' : '▼'} ${Math.abs(mom).toFixed(1)}% จาก ${escapeHtml(prevMonth.label)}</span>`;

  // Pace is always measured in baht — targets are set in baht, and converting
  // them to a device count would be a guess.
  const target = Object.values(DEFAULT_TARGETS).reduce((a, b) => a + b, 0);
  const remaining = Math.max(target - month.totalAmount, 0);
  const left = daysLeftIn(month.month, month.year);
  const paceValue = remaining === 0
    ? 'บรรลุเป้าแล้ว'
    : left === 0 ? 'จบเดือนแล้ว' : baht(remaining / left);
  const paceSub = remaining === 0
    ? `เป้า ${shortBaht(target)}`
    : left === 0 ? `ขาดอีก ${shortBaht(remaining)}` : `ต่อวัน · เหลือ ${left} วัน`;

  const asp = month.totalUnits > 0 ? month.totalAmount / month.totalUnits : 0;

  return `
    <div class="kpi-grid">
      ${kpiCard('ยอดขายรวม', isAmount ? baht(total) : units(total) + ' เครื่อง', momText, 'kpi-gold')}
      ${kpiCard('ต้องขายให้ถึงเป้า', paceValue, `<span class="kpi-sub">${escapeHtml(paceSub)}</span>`, 'kpi-amber')}
      ${kpiCard('ราคาเฉลี่ยต่อเครื่อง', baht(asp), `<span class="kpi-sub">${units(month.totalUnits)} เครื่อง</span>`, 'kpi-blue')}
      ${kpiCard('วันที่มีการขาย', `${month.activeDays} วัน`, `<span class="kpi-sub">ในเดือน ${escapeHtml(month.label)}</span>`)}
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

function renderTargets(month, groupKey) {
  const group = BRAND_GROUPS[groupKey] || BRAND_GROUPS.all;
  const target = group.brands.reduce((sum, key) => sum + (DEFAULT_TARGETS[key] || 0), 0);
  const actual = group.brands.reduce((sum, key) => sum + month.brands[key].amount, 0);
  const pct = target > 0 ? Math.min((actual / target) * 100, 100) : 0;
  const shortfall = Math.max(target - actual, 0);

  const perBrand = group.brands.map((key) => {
    const brandTarget = DEFAULT_TARGETS[key] || 0;
    const brandActual = month.brands[key].amount;
    const brandPct = brandTarget > 0 ? Math.min((brandActual / brandTarget) * 100, 100) : 0;
    return `
      <div class="target-row">
        <div class="target-name">${escapeHtml(key)}</div>
        <div class="target-track"><div class="target-fill" style="width:${brandPct}%"></div></div>
        <div class="target-pct mono">${brandPct.toFixed(0)}%</div>
        <div class="target-num mono">${shortBaht(brandActual)} / ${shortBaht(brandTarget)}</div>
      </div>`;
  }).join('');

  return `
    <div class="date-group-block">
      <div class="date-group-header">
        <div class="date-title"><i data-lucide="target"></i> ความคืบหน้าเทียบเป้า</div>
        <select id="sales-group" class="mini-select">
          ${Object.entries(BRAND_GROUPS).map(([k, g]) =>
            `<option value="${k}"${k === groupKey ? ' selected' : ''}>${escapeHtml(g.label)}</option>`).join('')}
        </select>
      </div>
      <div class="target-summary">
        <div class="target-big">
          <span class="kpi-label">รวมกลุ่มนี้</span>
          <span class="kpi-value mono">${baht(actual)}</span>
          <span class="kpi-sub">เป้า ${baht(target)}${shortfall > 0 ? ` · ขาดอีก ${shortBaht(shortfall)}` : ' · บรรลุแล้ว'}</span>
        </div>
        <div class="target-ring" style="--pct:${pct}">
          <span class="mono">${pct.toFixed(0)}%</span>
        </div>
      </div>
      <div class="target-list">${perBrand}</div>
    </div>`;
}

/** Render the whole dashboard into `container`. */
export function renderSalesDashboard(container, { months, monthIndex, mode, groupKey, updatedAt }) {
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
    ${renderKpis(month, prevMonth, mode)}
    ${renderBrandBars(month, prevMonth, mode)}
    ${renderTargets(month, groupKey)}
    <p class="sales-note"><i data-lucide="lock"></i> อ่านอย่างเดียว — แดชบอร์ดนี้ไม่เขียนอะไรกลับไปที่ชีต</p>`;
}
