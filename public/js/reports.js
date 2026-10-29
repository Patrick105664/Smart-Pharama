// public/js/reports.js – Reports page UI logic (Finance, Returns, Marketing)

let financeChartInstance = null;
let currentRange = 'month';
let currentReturnStatus = '';

// ── 1. Page Initialization ──────────────────────────────────────────────
async function initReportsPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'owner') {
    toast('Access denied. Reports are owner-only.', 'error');
    window.location.href = '/dashboard.html';
    return;
  }

  // Bind finance range buttons
  document.querySelectorAll('.finance-range-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.finance-range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = btn.dataset.range;
      loadFinanceReport(currentRange);
    });
  });

  // Bind returns status filter buttons
  document.querySelectorAll('.returns-filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.returns-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentReturnStatus = btn.dataset.status;
      loadDistributorReturns(currentReturnStatus);
    });
  });

  // Bind Marketing List generation button
  const genMktBtn = document.getElementById('btnGenerateMarketing');
  if (genMktBtn) {
    genMktBtn.addEventListener('click', () => loadMarketingList());
  }

  // Bind PDF Download buttons (step 6.4)
  const btnFinPdf = document.getElementById('btnFinancePdf');
  if (btnFinPdf) {
    btnFinPdf.addEventListener('click', () => {
      window.open(`/api/reports/finance/pdf?range=${encodeURIComponent(currentRange)}`, '_blank');
    });
  }

  const btnRetPdf = document.getElementById('btnReturnsPdf');
  if (btnRetPdf) {
    btnRetPdf.addEventListener('click', () => {
      const q = currentReturnStatus ? `?status=${encodeURIComponent(currentReturnStatus)}` : '';
      window.open(`/api/reports/returns/pdf${q}`, '_blank');
    });
  }

  const btnMktPdf = document.getElementById('btnMarketingPdf');
  if (btnMktPdf) {
    btnMktPdf.addEventListener('click', () => {
      window.open('/api/reports/marketing/pdf', '_blank');
    });
  }

  // Load initial data
  await loadFinanceReport(currentRange);
  await loadDistributorReturns(currentReturnStatus);
}

// ── 2. Finance Report ───────────────────────────────────────────────────
async function loadFinanceReport(range = 'month') {
  const cardsWrap = document.getElementById('financeCards');
  if (cardsWrap) cardsWrap.style.opacity = '0.6';

  try {
    const data = await api(`/api/reports/finance?range=${range}`);
    if (!data) return;

    // Summary numbers
    document.getElementById('finTotalSales').textContent = formatMoney(data.total_sales || data.totalSales || 0);
    document.getElementById('finBillCount').textContent = `${data.number_of_bills || data.numberOfBills || 0} bills`;
    document.getElementById('finGstTotal').textContent = formatMoney(data.gst_collected || data.gstCollected || 0);
    document.getElementById('finMoneySaved').textContent = formatMoney(data.money_saved || data.moneySaved || 0);
    document.getElementById('finMoneyLost').textContent = formatMoney(data.money_lost || data.moneyLost || 0);

    const expiredPart = formatMoney(data.expired_batch_loss || 0);
    const returnedPart = formatMoney(data.returned_loss || 0);
    document.getElementById('finLostBreakdown').textContent = `Expired stock: ${expiredPart} · Unrecovered returns: ${returnedPart}`;

    renderFinanceBarChart(Number(data.money_lost || 0), Number(data.money_saved || 0));
  } catch (err) {
    console.error('Failed to load finance report:', err);
    toast('Failed to load financial data: ' + err.message, 'error');
  } finally {
    if (cardsWrap) cardsWrap.style.opacity = '1';
  }
}

function renderFinanceBarChart(moneyLost, moneySaved) {
  const canvas = document.getElementById('financeBarChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (financeChartInstance) {
    financeChartInstance.destroy();
  }

  financeChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Money Lost to Expiry', 'Money Saved by Flash Sales'],
      datasets: [{
        label: 'Amount (₹)',
        data: [moneyLost, moneySaved],
        backgroundColor: [
          'rgba(239, 68, 68, 0.85)',   // Red
          'rgba(22, 163, 74, 0.85)'    // Green
        ],
        borderColor: [
          '#dc2626',
          '#16a34a'
        ],
        borderWidth: 1.5,
        borderRadius: 6,
        barThickness: 48
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return ' ' + formatMoney(context.parsed.y);
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return '₹' + value.toLocaleString('en-IN');
            },
            font: { size: 11 }
          },
          grid: { color: 'rgba(0,0,0,0.06)' }
        },
        x: {
          grid: { display: false },
          ticks: { font: { size: 12, weight: '600' } }
        }
      }
    }
  });
}

// ── 3. Distributor Returns ──────────────────────────────────────────────
async function loadDistributorReturns(status = '') {
  const container = document.getElementById('returnsTableContainer');
  if (!container) return;

  container.innerHTML = '<div class="table-empty">Loading returns…</div>';

  try {
    const url = status ? `/api/returns?status=${status}` : '/api/returns';
    const data = await api(url);
    const groups = Array.isArray(data) ? data : (data && data.grouped ? data.grouped : []);

    renderReturnsGroupedTable(groups);
  } catch (err) {
    console.error('Failed to load returns:', err);
    container.innerHTML = `<div class="table-empty" style="color:var(--red);">Failed to load returns: ${escapeHtml(err.message)}</div>`;
  }
}

function renderReturnsGroupedTable(groups) {
  const container = document.getElementById('returnsTableContainer');
  if (!container) return;

  if (!groups || groups.length === 0) {
    container.innerHTML = `
      <div class="table-empty">
        <div style="font-size:2rem; margin-bottom:8px;">📦</div>
        <p style="font-weight:600; color:var(--gray-700);">No returns found</p>
        <small style="color:var(--gray-500);">No distributor return records match the selected status filter.</small>
      </div>
    `;
    return;
  }

  let html = '';

  for (const group of groups) {
    const totalQty = group.total_qty || (group.items || []).reduce((acc, i) => acc + Number(i.qty || 0), 0);
    const totalCost = group.total_cost || (group.items || []).reduce((acc, i) => acc + Number(i.cost_value || 0), 0);

    html += `
      <div class="vendor-return-group">
        <div class="vendor-group-header">
          <div class="vendor-title-wrap">
            <span class="vendor-icon">🏢</span>
            <span class="vendor-name">${escapeHtml(group.vendor_name || 'Unknown Vendor')}</span>
            <span class="badge" style="background:var(--gray-200); color:var(--gray-700);">${(group.items || []).length} items</span>
          </div>
          <div class="vendor-totals">
            <span>Total Qty: <b>${totalQty}</b></span>
            <span>Cost Value: <b>${formatMoney(totalCost)}</b></span>
          </div>
        </div>
        <table class="returns-table">
          <thead>
            <tr>
              <th>Medicine</th>
              <th>Batch No</th>
              <th>Expiry Date</th>
              <th>Qty</th>
              <th>Cost Value</th>
              <th>Status</th>
              <th>Refund Amount</th>
              <th style="text-align:right;">Action</th>
            </tr>
          </thead>
          <tbody>
    `;

    for (const item of (group.items || [])) {
      let statusBadge = '';
      let actionBtn = '';

      if (item.status === 'to_return') {
        statusBadge = '<span class="badge badge-yellow">To Return</span>';
        actionBtn = `
          <button type="button" class="btn btn-sm btn-outline" onclick="updateReturnStatus(${item.id}, 'shipped')" title="Mark as shipped to distributor">
            Mark Shipped ➔
          </button>
        `;
      } else if (item.status === 'shipped') {
        statusBadge = '<span class="badge badge-blue">Shipped</span>';
        actionBtn = `
          <button type="button" class="btn btn-sm btn-success" onclick="promptRefundAndReturn(${item.id}, ${item.cost_value})" title="Record refund and mark returned">
            Mark Returned ✓
          </button>
        `;
      } else if (item.status === 'returned') {
        statusBadge = '<span class="badge badge-green">Returned</span>';
        actionBtn = '<span style="color:var(--gray-400); font-size:.8rem;">✓ Done</span>';
      }

      const refundDisplay = item.status === 'returned'
        ? (item.refund_amount != null ? formatMoney(item.refund_amount) : '₹0.00')
        : '—';

      html += `
        <tr>
          <td style="font-weight:600; color:var(--gray-800);">${escapeHtml(item.medicine_name || '—')}</td>
          <td class="font-mono">${escapeHtml(item.batch_no || '—')}</td>
          <td>${escapeHtml(item.expiry_date || '—')}</td>
          <td><b>${item.qty}</b></td>
          <td>${formatMoney(item.cost_value)}</td>
          <td>${statusBadge}</td>
          <td>${refundDisplay}</td>
          <td style="text-align:right;">${actionBtn}</td>
        </tr>
      `;
    }

    html += `
          </tbody>
        </table>
      </div>
    `;
  }

  container.innerHTML = html;
}

// ── 4. Status Update Actions ────────────────────────────────────────────
async function updateReturnStatus(returnId, nextStatus, refundAmount = null) {
  try {
    const payload = { status: nextStatus };
    if (refundAmount !== null) {
      payload.refund_amount = Number(refundAmount);
    }

    await api(`/api/returns/${returnId}/status`, {
      method: 'PATCH',
      body: payload
    });

    toast(`Return status updated to ${nextStatus}`, 'success');
    // Refresh tables & finance metrics
    await loadDistributorReturns(currentReturnStatus);
    await loadFinanceReport(currentRange);
  } catch (err) {
    console.error('Failed to update return status:', err);
    toast('Error: ' + err.message, 'error');
  }
}

function promptRefundAndReturn(returnId, costValue) {
  const formattedCost = formatMoney(costValue);
  const input = prompt(
    `Mark return as Completed.\nBatch cost value was: ${formattedCost}\n\nEnter refund amount received from distributor (enter 0 if no refund):`,
    '0'
  );

  if (input === null) return; // User cancelled

  const refund = Number(input.trim());
  if (isNaN(refund) || refund < 0) {
    toast('Refund amount must be a number 0 or greater.', 'error');
    return;
  }

  updateReturnStatus(returnId, 'returned', refund);
}

// ── 5. Marketing List ───────────────────────────────────────────────────
async function loadMarketingList() {
  const container = document.getElementById('marketingContainer');
  const tbody = document.getElementById('marketingTableBody');
  const countBadge = document.getElementById('mktCountBadge');
  const genBtn = document.getElementById('btnGenerateMarketing');

  if (!container || !tbody) return;

  container.style.display = 'block';
  tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Generating marketing list…</td></tr>';
  if (genBtn) genBtn.disabled = true;

  try {
    const batches = await api('/api/reports/marketing');
    if (countBadge) countBadge.textContent = `${batches.length} batches`;

    if (!batches || batches.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No yellow batches eligible for flash sales.</td></tr>';
      return;
    }

    tbody.innerHTML = batches.map(b => {
      let daysBadge = '';
      const dl = Number(b.days_left);
      if (dl <= 7) {
        daysBadge = `<span class="badge badge-red font-bold">${dl} days left</span>`;
      } else if (dl <= 14) {
        daysBadge = `<span class="badge badge-yellow font-bold">${dl} days left</span>`;
      } else {
        daysBadge = `<span class="badge" style="background:#fef3c7; color:#b45309; font-weight:600;">${dl} days left</span>`;
      }

      const flashDiscountText = b.discount_pct > 0 ? `<span class="badge badge-flash">-${b.discount_pct}%</span>` : '';

      return `
        <tr>
          <td style="font-weight:600; color:var(--gray-900);">${escapeHtml(b.name || b.medicine_name || '—')}</td>
          <td class="font-mono">${escapeHtml(b.batch || b.batch_no || '—')}</td>
          <td>${escapeHtml(b.expiry || b.expiry_date || '—')}</td>
          <td>${daysBadge}</td>
          <td><span class="badge-rack">${escapeHtml(b.rack || '—')}</span></td>
          <td><b>${b.qty}</b></td>
          <td>${formatMoney(b.mrp)}</td>
          <td style="color:#16a34a; font-weight:700;">
            ${formatMoney(b.today_flash_price || b.flash_price)}
            ${flashDiscountText}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load marketing list:', err);
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty" style="color:var(--red);">Failed to generate list: ${escapeHtml(err.message)}</td></tr>`;
  } finally {
    if (genBtn) genBtn.disabled = false;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
