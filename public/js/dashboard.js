// public/js/dashboard.js – Dashboard page logic
let donutChartInstance = null;
let currentUser = null;

async function loadDashboard() {
  currentUser = await getCurrentUser();
  const isOwner = currentUser && currentUser.role === 'owner';
  try {
    const data = await api('/api/dashboard');
    renderCards(data.cards, isOwner);
    renderDonut(data.donut);
    renderActions(data.actions, isOwner);
    renderAlerts(data.alerts);
  } catch (e) {
    toast('Failed to load dashboard: ' + e.message, 'error');
  }
}

// ── Cards ─────────────────────────────────────────────────────────────────
function renderCards(cards, isOwner) {
  const wrap = document.getElementById('dashCards');
  let html = '';

  if (isOwner) {
    html += `<div class="dash-card card-green">
      <div class="dc-label">Today's Revenue</div>
      <div class="dc-value">${formatMoney(cards.todayRevenue)}</div>
      <div class="dc-sub">Bills paid today</div>
    </div>`;
  }

  html += `<div class="dash-card card-yellow">
    <div class="dc-label">Expiring in 30 Days</div>
    <div class="dc-value">${cards.yellowCount}</div>
    <div class="dc-sub">Active batches (qty &gt; 0)</div>
  </div>`;

  if (isOwner) {
    html += `<div class="dash-card card-red">
      <div class="dc-label">Capital at Risk</div>
      <div class="dc-value">${formatMoney(cards.capitalAtRisk)}</div>
      <div class="dc-sub">Red + Yellow batches</div>
    </div>`;
  }

  html += `<div class="dash-card card-blue card-clickable" id="lowStockCard" onclick="openLowStockModal()" title="Click to see list">
    <div class="dc-label">Low Stock</div>
    <div class="dc-value">${cards.lowStockCount}</div>
    <div class="dc-sub">Medicines below minimum</div>
  </div>`;

  if (isOwner) {
    html += `<div class="dash-card card-ticker">
      <div class="dc-label">All-Time Flash vs Loss</div>
      <div class="ticker-row">
        <div class="ticker-item saved">
          <div class="t-label">Money Saved</div>
          <div class="t-val">${formatMoney(cards.moneySaved)}</div>
        </div>
        <div class="ticker-item lost">
          <div class="t-label">Money Lost</div>
          <div class="t-val">${formatMoney(cards.moneyLost)}</div>
        </div>
      </div>
    </div>`;
  }

  wrap.innerHTML = html;
}

// ── Donut chart ───────────────────────────────────────────────────────────
function renderDonut(donut) {
  const ctx = document.getElementById('donutChart').getContext('2d');
  if (donutChartInstance) donutChartInstance.destroy();
  const total = donut.red + donut.yellow + donut.green;
  donutChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Expired', 'Expiring Soon', 'Safe'],
      datasets: [{
        data: [donut.red, donut.yellow, donut.green],
        backgroundColor: ['#ef4444', '#f59e0b', '#22c55e'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: false,
      cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const val = ctx.raw;
              const pct = total > 0 ? Math.round(val / total * 100) : 0;
              return ` ${val} batches (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

// ── Actions list ──────────────────────────────────────────────────────────
function renderActions(actions, isOwner) {
  const el = document.getElementById('actionsList');
  if (!actions || actions.length === 0) {
    el.innerHTML = '<div style="color:var(--gray-400);font-size:.82rem;">No urgent actions needed. ✅</div>';
    return;
  }
  el.innerHTML = actions.map(a => {
    const isExpired = a.daysLeft < 0;
    const absDay = Math.abs(a.daysLeft);
    const statusText = isExpired
      ? `<span class="action-status-red">Expired ${absDay} day${absDay !== 1 ? 's' : ''} ago</span>`
      : `<span class="action-status-yellow">Expires in ${a.daysLeft} day${a.daysLeft !== 1 ? 's' : ''}</span>`;

    let btnHtml = '';
    if (isOwner) {
      if (isExpired) {
        btnHtml = a.inReturnList
          ? '<span class="badge-done">In return list</span>'
          : `<button class="btn-sm-red" onclick="addToReturn(${a.batchId}, this)">Add to Return List</button>`;
      } else {
        btnHtml = a.isFlashSale
          ? '<span class="badge-done">On Flash Sale</span>'
          : `<button class="btn-sm-amber" onclick="startFlashSale(${a.batchId}, this)">Start Flash Sale</button>`;
      }
    }

    return `<div class="action-row">
      <div class="action-info">
        <div class="action-name" title="${escapeHtml(a.medicineName)}">${escapeHtml(a.medicineName)}</div>
        <div class="action-meta">Batch: ${escapeHtml(a.batchNo)} &nbsp;|&nbsp; ${statusText}</div>
      </div>
      ${btnHtml}
    </div>`;
  }).join('');
}

// ── Alert feed ────────────────────────────────────────────────────────────
function renderAlerts(alerts) {
  const el = document.getElementById('alertFeed');
  if (!alerts || alerts.length === 0) {
    el.innerHTML = '<div class="alert-none">No alerts. Everything looks good! ✅</div>';
    return;
  }
  const icons = { expired: '🔴', today: '🟠', warning: '🟡', lowstock: '🔵' };
  el.innerHTML = alerts.map(a =>
    `<div class="alert-item alert-${a.type}">${icons[a.type] || '•'} ${escapeHtml(a.message)}</div>`
  ).join('');
}

// ── Low-stock popup ───────────────────────────────────────────────────────
async function openLowStockModal() {
  document.getElementById('lowStockModal').classList.add('show');
  const body = document.getElementById('lowStockBody');
  body.innerHTML = '<div style="color:var(--gray-400);font-size:.82rem;">Loading…</div>';
  try {
    const data = await api('/api/dashboard/low-stock');
    if (!data.items || data.items.length === 0) {
      body.innerHTML = '<div style="color:var(--gray-400);font-size:.82rem;">No medicines below minimum stock.</div>';
      return;
    }
    body.innerHTML = `<table class="ls-table">
      <thead><tr><th>Medicine</th><th>Category</th><th>Qty</th></tr></thead>
      <tbody>
        ${data.items.map(item => `<tr>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.category || '—')}</td>
          <td class="${item.total_qty == 0 ? 'ls-zero' : 'ls-low'}">${item.total_qty}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <p style="font-size:.72rem;color:var(--gray-400);margin-top:.6rem;">Min stock threshold: ${data.lowStockMin} units</p>`;
  } catch (e) {
    body.innerHTML = `<div style="color:var(--red);">Error: ${escapeHtml(e.message)}</div>`;
  }
}

function closeLowStockModal() {
  document.getElementById('lowStockModal').classList.remove('show');
}

// Close modal on overlay click
document.addEventListener('click', e => {
  const modal = document.getElementById('lowStockModal');
  if (modal && e.target === modal) closeLowStockModal();
});

async function addToReturn(batchId, btn) {
  try {
    await api('/api/returns', { method: 'POST', body: { batch_id: batchId } });
    btn.outerHTML = '<span class="badge-done">In return list</span>';
    toast('Added to return list.', 'success');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

async function startFlashSale(batchId, btn) {
  try {
    await api(`/api/batches/${batchId}/flash-sale`, { method: 'POST', body: { on: true } });
    btn.outerHTML = '<span class="badge-done">On Flash Sale</span>';
    toast('Flash sale started.', 'success');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}
