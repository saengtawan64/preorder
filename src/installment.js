/**
 * Installment calculator for the counter.
 *
 * Flat-rate maths, matching how the shop already quotes: interest is charged on
 * the full financed amount for every month of the term, not on a reducing
 * balance. So a 24-month plan costs twice the interest of a 12-month one on the
 * same principal.
 *
 *   financed = price - down
 *   interest = financed × RATE × months
 *   monthly  = (financed + interest) ÷ months
 *
 * A reducing-balance (effective) rate would give different — lower — numbers.
 * If the shop ever switches, this file is the only place that has to change.
 *
 * Rendering is split into a shell (the price/down inputs, built once) and a
 * results table (rebuilt on every keystroke). That split exists specifically
 * so typing never recreates the input elements — see main.js's
 * showInstallment() for the bug that split fixes.
 */

/** Flat interest per month, as charged by the shop's finance partner. */
export const MONTHLY_RATE = 0.0099;

export const TERMS = [12, 18, 24, 36, 48];

const baht = (n) => '฿' + Math.round(n).toLocaleString('th-TH');

/** One row of the plan table. `down` is a baht amount, not a percentage. */
export function quote(price, down, months, rate = MONTHLY_RATE) {
  const safeDown = Math.max(down, 0);
  const financed = Math.max(price - safeDown, 0);
  const interest = financed * rate * months;
  const total = financed + interest;

  return {
    months,
    down: safeDown,
    financed,
    interest,
    total,
    monthly: months > 0 ? total / months : 0,
    // What the customer ends up paying overall, down payment included.
    grandTotal: total + safeDown,
  };
}

/**
 * The static part: the price and down-payment inputs, plus an empty slot for
 * the results. Rendered once per visit to the tab — renderInstallmentResults()
 * is what runs on every keystroke afterward, and it never touches this
 * markup, so the inputs are never recreated while someone is typing into them.
 */
export function renderInstallmentShell(container) {
  container.innerHTML = `
    <div class="date-group-block">
      <div class="date-group-header">
        <div class="date-title"><i data-lucide="calculator"></i> คำนวณค่างวดผ่อน</div>
        <span class="kpi-sub">ดอกเบี้ยคงที่ ${(MONTHLY_RATE * 100).toFixed(2)}% ต่อเดือน</span>
      </div>

      <div class="inst-controls">
        <div class="inst-field">
          <label for="inst-price">ราคาสินค้า (บาท)</label>
          <input type="number" id="inst-price" inputmode="numeric" min="0" step="100"
                 placeholder="เช่น 25900" />
        </div>
        <div class="inst-field">
          <label for="inst-down">เงินดาวน์ (บาท)</label>
          <input type="number" id="inst-down" inputmode="numeric" min="0" step="100" value="0" />
        </div>
      </div>

      <div id="inst-results"></div>
    </div>
    <p class="sales-note"><i data-lucide="info"></i>
      ตัวเลขนี้เป็นการประมาณจากสูตรดอกเบี้ยคงที่ ${(MONTHLY_RATE * 100).toFixed(2)}%/เดือน
      ยอดจริงยึดตามที่บริษัทสินเชื่ออนุมัติ</p>`;
}

/**
 * The part that changes on every keystroke: the plan table (or the empty
 * state before a price is entered). Safe to call as often as needed — it
 * only ever touches #inst-results, never the inputs above it.
 */
export function renderInstallmentResults(resultsEl, { price, down }) {
  const valid = Number.isFinite(price) && price > 0;
  const rows = valid ? TERMS.map((months) => quote(price, down, months)) : [];

  resultsEl.innerHTML = !valid
    ? '<div class="empty-state"><i data-lucide="calculator"></i><p>ใส่ราคาสินค้าเพื่อคำนวณค่างวด</p></div>'
    : `
      <div class="table-responsive">
        <table class="data-table inst-table">
          <thead>
            <tr>
              <th>ระยะเวลา</th>
              <th style="text-align:right">ผ่อนเดือนละ</th>
              <th style="text-align:right">ยอดจัด</th>
              <th style="text-align:right">ดอกเบี้ยรวม</th>
              <th style="text-align:right">จ่ายทั้งหมด</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td data-label="ระยะเวลา"><strong>${r.months} เดือน</strong></td>
                <td class="amount-cell mono inst-monthly" data-label="ผ่อนเดือนละ">${baht(r.monthly)}</td>
                <td class="amount-cell mono" data-label="ยอดจัด">${baht(r.financed)}</td>
                <td class="amount-cell mono" data-label="ดอกเบี้ยรวม">${baht(r.interest)}</td>
                <td class="amount-cell mono" data-label="จ่ายทั้งหมด">${baht(r.grandTotal)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
}
