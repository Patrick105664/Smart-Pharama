// public/js/calendar.js – Visual Calendar UI logic

let currentYear = null;
let currentMonth = null; // 0-indexed: 0 = Jan, 11 = Dec
let todayStr = null;     // 'YYYY-MM-DD'
let calendarMonthData = {}; // { 'YYYY-MM-DD': { red, yellow } }
let selectedDateStr = null;
let currentUser = null;

// Floating tooltip element
let floatingTooltip = null;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateStr(year, monthIndex, day) {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

function getMonthName(monthIndex) {
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return names[monthIndex];
}

function getReadableDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = daysOfWeek[d.getDay()];
  const monName = getMonthName(d.getMonth()).slice(0, 3);
  return `${dayName}, ${parts[2]} ${monName} ${parts[0]}`;
}

// ── Tooltip Helpers ─────────────────────────────────────
function initFloatingTooltip() {
  floatingTooltip = document.createElement('div');
  floatingTooltip.className = 'cal-floating-tooltip';
  floatingTooltip.style.display = 'none';
  document.body.appendChild(floatingTooltip);
}

function showTooltip(e, text) {
  if (!floatingTooltip || !text) return;
  floatingTooltip.innerHTML = text.replace(/\n/g, '<br/>');
  floatingTooltip.style.display = 'block';
  moveTooltip(e);
}

function moveTooltip(e) {
  if (!floatingTooltip || floatingTooltip.style.display === 'none') return;
  const offset = 12;
  let x = e.clientX + offset;
  let y = e.clientY + offset;
  const rect = floatingTooltip.getBoundingClientRect();
  if (x + rect.width > window.innerWidth - 10) {
    x = e.clientX - rect.width - offset;
  }
  if (y + rect.height > window.innerHeight - 10) {
    y = e.clientY - rect.height - offset;
  }
  floatingTooltip.style.left = `${Math.max(10, x)}px`;
  floatingTooltip.style.top = `${Math.max(10, y)}px`;
}

function hideTooltip() {
  if (floatingTooltip) {
    floatingTooltip.style.display = 'none';
  }
}

// ── Load Month Data from API ────────────────────────────
async function fetchMonthData(year, monthIndex) {
  const monthParam = `${year}-${pad2(monthIndex + 1)}`;
  try {
    const data = await api(`/api/calendar?month=${monthParam}`);
    return (data && data.days) ? data.days : {};
  } catch (err) {
    console.error('Failed to load month counts:', err);
    toast('Failed to load calendar month data: ' + err.message, 'error');
    return {};
  }
}

// ── Render Calendar Grid ────────────────────────────────
async function renderCalendar() {
  const gridEl = document.getElementById('calGrid');
  const monthTitleEl = document.getElementById('calMonthTitle');
  if (!gridEl) return;

  monthTitleEl.textContent = `${getMonthName(currentMonth)} ${currentYear}`;
  gridEl.innerHTML = '<div class="cal-loading">Loading calendar data…</div>';

  calendarMonthData = await fetchMonthData(currentYear, currentMonth);

  gridEl.innerHTML = '';

  const firstDayOfWeek = new Date(currentYear, currentMonth, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();

  // Prev month padding cells
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const dayNum = prevMonthDays - i;
    const cell = document.createElement('div');
    cell.className = 'cal-day other-month';
    cell.innerHTML = `<div class="cal-day-num">${dayNum}</div>`;
    gridEl.appendChild(cell);
  }

  // Current month cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = formatDateStr(currentYear, currentMonth, d);
    const dayData = calendarMonthData[dateStr] || { red: 0, yellow: 0 };
    const isToday = (dateStr === todayStr);
    const isSelected = (dateStr === selectedDateStr);

    const cell = document.createElement('div');
    cell.className = `cal-day ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}`;
    cell.dataset.date = dateStr;

    // Tooltip message construction
    const tooltipParts = [];
    if (dayData.red > 0) {
      if (isToday) {
        tooltipParts.push(`${dayData.red} ${dayData.red === 1 ? 'batch' : 'batches'} expiring today`);
      } else {
        tooltipParts.push(`${dayData.red} ${dayData.red === 1 ? 'batch' : 'batches'} expiring on this day`);
      }
    }
    if (dayData.yellow > 0) {
      if (isToday) {
        tooltipParts.push(`${dayData.yellow} ${dayData.yellow === 1 ? 'batch' : 'batches'} entering warning period today`);
      } else {
        tooltipParts.push(`${dayData.yellow} ${dayData.yellow === 1 ? 'batch' : 'batches'} entering warning period`);
      }
    }

    const tooltipText = tooltipParts.join('\n');
    if (tooltipText) {
      cell.setAttribute('title', tooltipText);
      cell.addEventListener('mouseenter', (e) => showTooltip(e, tooltipText));
      cell.addEventListener('mousemove', moveTooltip);
      cell.addEventListener('mouseleave', hideTooltip);
    }

    // Header inside cell
    let dotsHtml = '';
    if (dayData.red > 0) {
      dotsHtml += `
        <span class="cal-dot-pill dot-red" title="${dayData.red} expiring">
          <span class="cal-dot"></span>
          <span class="dot-count">${dayData.red}</span>
          <span class="dot-text">expiring</span>
        </span>
      `;
    }
    if (dayData.yellow > 0) {
      dotsHtml += `
        <span class="cal-dot-pill dot-yellow" title="${dayData.yellow} entering warning">
          <span class="cal-dot"></span>
          <span class="dot-count">${dayData.yellow}</span>
          <span class="dot-text">warning</span>
        </span>
      `;
    }

    cell.innerHTML = `
      <div class="cal-day-top">
        <span class="cal-day-num">${d}</span>
        ${isToday ? '<span class="today-tag">Today</span>' : ''}
      </div>
      <div class="cal-day-dots">${dotsHtml}</div>
    `;

    cell.addEventListener('click', () => {
      hideTooltip();
      selectDay(dateStr);
    });

    gridEl.appendChild(cell);
  }

  // Next month padding cells to complete standard 7xN grid
  const totalCells = firstDayOfWeek + daysInMonth;
  const remainingCells = (7 - (totalCells % 7)) % 7;
  for (let d = 1; d <= remainingCells; d++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day other-month';
    cell.innerHTML = `<div class="cal-day-num">${d}</div>`;
    gridEl.appendChild(cell);
  }
}

// ── Select Day and Open Side Panel ──────────────────────
async function selectDay(dateStr) {
  selectedDateStr = dateStr;

  // Highlight selected cell
  document.querySelectorAll('.cal-day').forEach(el => {
    if (el.dataset.date === dateStr) {
      el.classList.add('is-selected');
    } else {
      el.classList.remove('is-selected');
    }
  });

  const sidePanel = document.getElementById('calSidePanel');
  const panelDateEl = document.getElementById('panelDateTitle');
  const panelListEl = document.getElementById('calDayBatches');
  const panelCountBadge = document.getElementById('panelCountBadge');

  if (!sidePanel || !panelDateEl || !panelListEl) return;

  sidePanel.classList.add('open');
  panelDateEl.textContent = getReadableDate(dateStr);
  panelCountBadge.textContent = 'Loading…';
  panelListEl.innerHTML = '<div class="panel-loading">Fetching batch details…</div>';

  try {
    const res = await api(`/api/calendar/day?date=${dateStr}`);
    const batches = Array.isArray(res) ? res : (res && res.batches ? res.batches : []);
    renderDayBatches(dateStr, batches);
  } catch (err) {
    console.error('Failed to load day batches:', err);
    panelCountBadge.textContent = 'Error';
    panelListEl.innerHTML = `<div class="panel-empty" style="color:var(--red);">Failed to load batches: ${err.message}</div>`;
  }
}

function closeSidePanel() {
  const sidePanel = document.getElementById('calSidePanel');
  if (sidePanel) sidePanel.classList.remove('open');
  selectedDateStr = null;
  document.querySelectorAll('.cal-day.is-selected').forEach(el => el.classList.remove('is-selected'));
}

function renderDayBatches(dateStr, batches) {
  const panelListEl = document.getElementById('calDayBatches');
  const panelCountBadge = document.getElementById('panelCountBadge');
  if (!panelListEl) return;

  panelCountBadge.textContent = `${batches.length} ${batches.length === 1 ? 'batch' : 'batches'}`;

  if (!batches || batches.length === 0) {
    panelListEl.innerHTML = `
      <div class="panel-empty">
        <div style="font-size:2rem; margin-bottom:8px;">📦</div>
        <p style="font-weight:600; color:var(--gray-700);">No batches on this day</p>
        <small style="color:var(--gray-500);">No batches are expiring or entering 30-day warning on ${dateStr}.</small>
      </div>
    `;
    return;
  }

  const isOwner = currentUser && currentUser.role === 'owner';

  panelListEl.innerHTML = batches.map(b => {
    const isExpiring = (b.event_type === 'expiring' || b.expiry_date === dateStr);
    const badgeHtml = isExpiring
      ? '<span class="batch-badge badge-red">● Expiring that day</span>'
      : '<span class="batch-badge badge-yellow">● 30-day warning starts</span>';

    let daysLeftText = '';
    const dl = Number(b.days_left);
    if (dl < 0) {
      daysLeftText = `<span style="color:var(--red); font-weight:600;">Expired ${Math.abs(dl)} days ago</span>`;
    } else if (dl === 0) {
      daysLeftText = '<span style="color:var(--red); font-weight:600;">Expires today (0 days)</span>';
    } else {
      daysLeftText = `<span style="color:${dl <= 30 ? 'var(--yellow)' : 'var(--green)'}; font-weight:600;">${dl} days left</span>`;
    }

    const purchasePriceHtml = (isOwner && b.purchase_price != null)
      ? `<div class="batch-detail-item"><span class="lbl">Cost:</span> <span class="val">${formatMoney(b.purchase_price)}</span></div>`
      : '';

    return `
      <div class="batch-card ${isExpiring ? 'border-red' : 'border-yellow'}">
        <div class="batch-card-head">
          <div class="batch-med-name">${escapeHtml(b.medicine || b.medicine_name || '—')}</div>
          ${badgeHtml}
        </div>
        <div class="batch-details-grid">
          <div class="batch-detail-item"><span class="lbl">Batch:</span> <span class="val font-mono">${escapeHtml(b.batch || b.batch_no || '—')}</span></div>
          <div class="batch-detail-item"><span class="lbl">Qty:</span> <span class="val font-bold">${b.qty}</span></div>
          <div class="batch-detail-item"><span class="lbl">Rack:</span> <span class="val badge-rack">${escapeHtml(b.rack || b.rack_code || '—')}</span></div>
          <div class="batch-detail-item"><span class="lbl">Vendor:</span> <span class="val">${escapeHtml(b.vendor || b.vendor_name || '—')}</span></div>
          <div class="batch-detail-item"><span class="lbl">Status:</span> <span class="val">${daysLeftText}</span></div>
          <div class="batch-detail-item"><span class="lbl">Expiry Date:</span> <span class="val">${escapeHtml(b.expiry_date || '—')}</span></div>
          <div class="batch-detail-item"><span class="lbl">MRP:</span> <span class="val">${formatMoney(b.selling_price || b.mrp)}</span></div>
          ${purchasePriceHtml}
        </div>
      </div>
    `;
  }).join('');
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

// ── Navigation Buttons ──────────────────────────────────
function prevMonth() {
  currentMonth--;
  if (currentMonth < 0) {
    currentMonth = 11;
    currentYear--;
  }
  renderCalendar();
}

function nextMonth() {
  currentMonth++;
  if (currentMonth > 11) {
    currentMonth = 0;
    currentYear++;
  }
  renderCalendar();
}

function goToToday() {
  const d = new Date();
  currentYear = d.getFullYear();
  currentMonth = d.getMonth();
  renderCalendar().then(() => {
    if (todayStr) {
      selectDay(todayStr);
    }
  });
}

// ── Initialize Calendar Page ────────────────────────────
async function initCalendarPage() {
  initFloatingTooltip();

  currentUser = await getCurrentUser();

  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();
  todayStr = formatDateStr(now.getFullYear(), now.getMonth(), now.getDate());

  document.getElementById('calPrevBtn').addEventListener('click', prevMonth);
  document.getElementById('calNextBtn').addEventListener('click', nextMonth);
  document.getElementById('calTodayBtn').addEventListener('click', goToToday);
  document.getElementById('closeSidePanelBtn').addEventListener('click', closeSidePanel);

  // Keyboard navigation for month
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') prevMonth();
    if (e.key === 'ArrowRight') nextMonth();
    if (e.key === 'Escape') closeSidePanel();
  });

  await renderCalendar();

  // Auto-select today on initial load so details are visible immediately
  if (todayStr) {
    selectDay(todayStr);
  }
}
