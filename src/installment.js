/**
 * Installment calculator for the counter.
 *
 * Flat-rate maths, matching how the shop already quotes: interest is charged on
 * the full financed amount for every month of the term, not on a reducing
 * balance. So a 24-month plan costs twice the interest of a 12-month one on the
 * same principal.
 *
 *   financed = price - down payment
 *   interest = financed × RATE × months
 *   monthly  = (financed + interest) ÷ months
 *
 * A reducing-balance (effective) rate would give different — lower — numbers.
 * If the shop ever switches, this file is the only place that has to change.
 */

/** Flat interest per month, as charged by the shop's finance partner. */
export const MONTHLY_RATE = 0.0099;

export const TERMS = [12, 18, 24, 36, 48];
export const DOWN_PERCENTS = [0, 10, 15, 20, 25, 30, 40, 50, 60, 70];

const baht = (n) => '฿' + Math.round(n).toLocaleString('th-TH');

/** One row of the plan table. */
export function quote(price, downPercent, months, rate = MONTHLY_RATE) {
  const down = Math.round((price * downPercent) / 100);
  const financed = Math.max(price - down, 0);
  const interest = financed * rate * months;
  const total = financed + interest;

  return {
    months,
    down,
    financed,
    interest,
    total,
    monthly: months > 0 ? total / months : 0,
    // What the customer ends up paying overall, down payment included.
    grandTotal: total + down,
  };
}

export function renderInstallment(container, { price, downPercent }) {
  const valid = Number.isFinite(price) && price > 0;
  const rows = valid
    ? TERMS.map((months) => quote(price, downPercent, months))
    : [];

  const table = !valid
    ? '<div class="empty-state"><i data-lucide="calculator"></i><p>ใส่ราคาสินค้าเพื่อคำนวณค่างวด</p></div>'
    : `
      <div class="table-responsive">
        <table class="data-table">
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

  const down = valid ? Math.round((price * downPercent) / 100) : 0;

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
                 placeholder="เช่น 25900" value="${valid ? price : ''}" />
        </div>
        <div class="inst-field">
          <label for="inst-down">เงินดาวน์</label>
          <select id="inst-down" class="mini-select">
            ${DOWN_PERCENTS.map((p) =>
              `<option value="${p}"${p === downPercent ? ' selected' : ''}>${p}%</option>`).join('')}
          </select>
        </div>
        <div class="inst-down-out">
          <span class="kpi-label">ดาวน์</span>
          <span class="kpi-value mono">${baht(down)}</span>
        </div>
      </div>

      ${table}
    </div>
    <p class="sales-note"><i data-lucide="info"></i>
      ตัวเลขนี้เป็นการประมาณจากสูตรดอกเบี้ยคงที่ ${(MONTHLY_RATE * 100).toFixed(2)}%/เดือน
      ยอดจริงยึดตามที่บริษัทสินเชื่ออนุมัติ</p>`;
}
