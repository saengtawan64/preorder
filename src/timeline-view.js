/**
 * The deposit timeline — the "รอรับของ" screen.
 *
 * Renders into the same container the old date-grouped table used, and emits
 * the same button classes and `data-id`s, so every existing delegated handler
 * in main.js (notify, received, edit, delete, copy) keeps working untouched.
 * The change here is what the screen *says*, not how it is wired.
 */

import { escapeHtml, formatBaht, formatPhone, phoneDigits, thaiDateShort } from './utils.js';
import { SCALE_MAX, agePercent } from './timeline.js';

/** Labels closer together than this on the rail would overprint each other. */
const LABEL_GAP = 4.2;

const TICKS = [0, 30, 60, SCALE_MAX];

/** One decimal is finer than any screen can place — the rest is noise in the DOM. */
const pct = (n) => `${Math.round(n * 10) / 10}%`;

function railTicks() {
  return TICKS.map((day, i) => {
    const label = i === TICKS.length - 1 ? `${day}+ วัน` : `${day} วัน`;
    return `<span class="tl-tick" style="top:${pct((day / SCALE_MAX) * 100)}">${label}</span>`;
  }).join('');
}

/**
 * Dots down the rail. Labels are dropped — not the dots — where they would
 * collide, so a busy stretch still shows every deposit but only names the ones
 * there is room for.
 *
 * The spacing pass walks *down* the rail, which is not the order `nodes` is in
 * (that is oldest-first, i.e. bottom-up). Reusing that order would compare each
 * node against a position below it and drop every label after the first.
 */
function railNodes(nodes) {
  const placed = nodes.filter((n) => n.days !== null);

  const labelled = new Set();
  let lastTop = -Infinity;
  for (const n of [...placed].sort((a, b) => a.percent - b.percent)) {
    if (n.percent - lastTop < LABEL_GAP) continue;
    lastTop = n.percent;
    labelled.add(n);
  }

  return placed
    .map((n) => {
      const name = n.record.nickname || n.record.firstName || '';
      return `
        <span class="tl-node tone-${n.tone || 'ok'}" style="top:${pct(n.percent)}">
          <i></i>${labelled.has(n) ? `<b>${escapeHtml(name)} · ${n.days} ว.</b>` : ''}
        </span>`;
    })
    .join('');
}

/** The same scale as a horizontal strip, for phone widths. */
function railStrip(nodes) {
  const pins = nodes
    .filter((n) => n.days !== null)
    .map((n) => `<i class="tone-${n.tone || 'ok'}" style="left:${pct(n.percent)}"></i>`)
    .join('');
  return `
    <div class="tl-strip">
      <div class="tl-strip-bar">${pins}</div>
      <div class="tl-strip-ticks">${TICKS.map((d, i) => `<span>${i === TICKS.length - 1 ? d + '+' : d}</span>`).join('')}</div>
    </div>`;
}

function summary(model) {
  // With only a handful of deposits a "cluster" is noise, so the third card
  // falls back to the plain fact instead of inventing a pattern. An age of 0
  // is an answer ("everything came in today"), not a missing one — only an
  // empty list has nothing to report.
  const oldestValue = model.nodes.length === 0 ? '—' : model.oldest === 0 ? 'วันนี้' : `${model.oldest} วัน`;
  const third = model.cluster
    ? { label: 'ค้างกระจุกที่', value: `${model.cluster.from}–${model.cluster.to} ว.` }
    : { label: 'ค้างนานสุด', value: oldestValue };

  return `
    <div class="tl-summary">
      <div class="tl-stat">
        <span class="kpi-label">ถือครองทั้งหมด</span>
        <span class="kpi-value">${formatBaht(model.total)}</span>
      </div>
      <div class="tl-stat ${model.overdueCount ? 'is-alert' : ''}">
        <span class="kpi-label">ต้องตามด่วน</span>
        <span class="kpi-value">${formatBaht(model.overdueAmount)}</span>
        <span class="kpi-sub">${model.overdueCount ? `${model.overdueCount} รายการเกิน 30 วัน` : 'ไม่มีรายการค้าง'}</span>
      </div>
      <div class="tl-stat">
        <span class="kpi-label">${third.label}</span>
        <span class="kpi-value">${third.value}</span>
      </div>
    </div>`;
}

function row(node) {
  const r = node.record;
  const tone = node.tone || 'ok';
  const phone = formatPhone(r.phoneNumber);
  const digits = phoneDigits(r.phoneNumber);
  const followed = thaiDateShort(r.followedUpAtIso);
  const id = escapeHtml(r.id);

  return `
    <div class="tl-row tone-${tone}">
      <div class="tl-who">
        <div class="tl-name">${escapeHtml(r.firstName)}${r.nickname ? ` <small>· ${escapeHtml(r.nickname)}</small>` : ''}</div>
        <div class="tl-item">${escapeHtml(r.depositItem)}</div>
        ${followed ? `<div class="tl-followed">แจ้งแล้ว ${followed}${r.followUpCount > 1 ? ` · ${r.followUpCount} ครั้ง` : ''}</div>` : ''}
      </div>

      <div class="tl-track" role="img" aria-label="ค้าง ${node.days ?? 0} วัน">
        <span style="width:${pct(agePercent(node.days))}"></span>
      </div>
      <div class="tl-age">${node.days === null ? '—' : `${node.days} วัน`}</div>
      <div class="tl-amount mono">${formatBaht(r.depositAmount)}</div>

      <div class="tl-contact">
        ${digits
          ? `<a class="phone-tag" href="tel:${escapeHtml(digits)}" title="กดเพื่อโทร">${escapeHtml(phone)}</a>`
          : `<span class="phone-tag">${escapeHtml(phone)}</span>`}
      </div>

      <div class="tl-actions">
        <button class="btn btn-xs ${tone === 'ok' ? 'btn-outline' : 'btn-urgent'} notify-btn"
                data-id="${id}" title="คัดลอกข้อความแจ้งลูกค้า + บันทึกว่าติดตามแล้ว">
          <i data-lucide="send"></i>
        </button>
        <button class="btn btn-xs btn-success mark-received-btn" data-id="${id}" title="ลูกค้ารับสินค้าแล้ว">
          <i data-lucide="check-check"></i>
        </button>
        <button class="btn btn-xs btn-outline edit-deposit-btn" data-id="${id}" title="แก้ไขรายการ">
          <i data-lucide="pencil"></i>
        </button>
        <button class="btn btn-xs btn-danger btn-outline delete-deposit-btn" data-id="${id}" title="ลบรายการ">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </div>`;
}

export function renderTimeline(container, model) {
  container.innerHTML = `
    <div class="tl">
      <aside class="tl-rail">
        <div class="tl-rail-head">
          <h3>แถบเวลามัดจำ</h3>
          <p>อายุของทุกรายการที่ยังไม่มารับ</p>
        </div>
        <div class="tl-scale">
          <span class="tl-gradient"></span>
          <span class="tl-scan"></span>
          ${railTicks()}
          ${railNodes(model.nodes)}
        </div>
      </aside>

      <div class="tl-main">
        ${summary(model)}
        ${railStrip(model.nodes)}
        <div class="tl-rows">${model.nodes.map(row).join('')}</div>
      </div>
    </div>`;
}

/** Placeholder shown while the first Firestore snapshot is still in flight. */
export function renderTimelineSkeleton(container) {
  const rows = Array.from({ length: 4 }, () => '<div class="sk sk-row"></div>').join('');
  return (container.innerHTML = `
    <div class="tl">
      <aside class="tl-rail">
        <div class="tl-rail-head"><div class="sk sk-line" style="width:70%"></div><div class="sk sk-line sk-sm" style="width:90%"></div></div>
        <div class="sk sk-scale"></div>
      </aside>
      <div class="tl-main">
        <div class="tl-summary">
          <div class="sk sk-stat"></div><div class="sk sk-stat"></div><div class="sk sk-stat"></div>
        </div>
        <div class="tl-strip"><div class="sk sk-line" style="height:12px;border-radius:7px"></div></div>
        <div class="tl-rows">${rows}</div>
      </div>
    </div>`);
}
