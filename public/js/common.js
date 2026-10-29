// public/js/common.js – Shared utilities used by every page

// ── Fetch wrapper (redirects to login on 401) ──────────
async function api(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  let body = opts.body;
  if (body !== undefined && typeof body === 'object' && !(body instanceof FormData)) {
    body = JSON.stringify(body);
  }

  const res = await fetch(url, {
    credentials: 'same-origin',
    ...opts,
    headers,
    body
  });

  if (res.status === 401) {
    window.location.href = '/login.html';
    return null;
  }

  let data = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else {
    const text = await res.text().catch(() => '');
    try {
      data = JSON.parse(text);
    } catch {
      data = text ? { error: text } : null;
    }
  }

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

// ── Toast notifications ────────────────────────────────
let toastContainer;
function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
}

function toast(message, type = 'info', duration = 3500) {
  ensureToastContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(100%)';
    el.style.transition = 'all .3s';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ── Date formatters ────────────────────────────────────
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Format ISO date string to "dd-MMM-yyyy" e.g. "25-Oct-2026"
function formatDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  const day = String(d.getDate()).padStart(2, '0');
  const mon = MONTHS_SHORT[d.getMonth()];
  const year = d.getFullYear();
  return `${day}-${mon}-${year}`;
}

// Format datetime to "dd-MMM-yyyy hh:mm AM/PM"
function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  const day = String(d.getDate()).padStart(2, '0');
  const mon = MONTHS_SHORT[d.getMonth()];
  const year = d.getFullYear();
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${day}-${mon}-${year} ${h}:${min} ${ampm}`;
}

// ── Money formatter (Indian ₹) ────────────────────────
function formatMoney(num) {
  if (num == null || isNaN(num)) return '₹0.00';
  const n = parseFloat(num);
  // Indian numbering system: last 3 digits, then groups of 2
  const [intPart, decPart] = n.toFixed(2).split('.');
  const sign = intPart.startsWith('-') ? '-' : '';
  const absInt = intPart.replace('-', '');
  let formatted;
  if (absInt.length <= 3) {
    formatted = absInt;
  } else {
    const last3 = absInt.slice(-3);
    const rest = absInt.slice(0, -3);
    formatted = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }
  return `₹${sign}${formatted}.${decPart}`;
}

// ── Get current user from session ──────────────────────
let _currentUser = null;
async function getCurrentUser() {
  if (_currentUser) return _currentUser;
  try {
    const data = await api('/api/auth/me');
    if (data && data.user) {
      _currentUser = data.user;
      return _currentUser;
    }
  } catch (e) {
    // Will redirect to login via the api() wrapper
  }
  return null;
}

// ── Build sidebar + header (call on DOMContentLoaded) ──
async function initLayout(activePage) {
  const user = await getCurrentUser();
  if (!user) return;

  const isOwner = user.role === 'owner';

  // Sidebar
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.innerHTML = `
      <div class="sidebar-brand">
        <h2>💊 CityCare</h2>
        <small>Smart Pharma Management</small>
      </div>
      <nav>
        <ul class="sidebar-nav">
          <li><a href="/dashboard.html" class="${activePage === 'dashboard' ? 'active' : ''}">
            <span class="nav-icon">📊</span> Dashboard</a></li>
          <li><a href="/billing.html" class="${activePage === 'billing' ? 'active' : ''}" style="font-weight:700;">
            <span class="nav-icon">🧾</span> Billing / POS</a></li>
          <li><a href="/inventory.html" class="${activePage === 'inventory' ? 'active' : ''}">
            <span class="nav-icon">📦</span> Inventory</a></li>
          ${isOwner ? `<li><a href="/reports.html" class="${activePage === 'reports' ? 'active' : ''}">
            <span class="nav-icon">📈</span> Reports</a></li>` : ''}
          <li><a href="/calendar.html" class="${activePage === 'calendar' ? 'active' : ''}">
            <span class="nav-icon">📅</span> Visual Calendar</a></li>
        </ul>
      </nav>
      <div class="sidebar-footer">
        <div class="user-info">
          <div class="user-name">${user.fullName || user.username}</div>
          <div class="user-role">${user.role}</div>
        </div>
        <button class="logout-btn" onclick="logout()">⏻ Logout</button>
      </div>
    `;
  }

  // Header
  const header = document.getElementById('header');
  if (header) {
    header.innerHTML = `
      <div class="header-search">
        <span class="search-icon">🔍</span>
        <input type="text" id="globalSearch" placeholder="Search medicines by name or barcode…"
               autocomplete="off" />
        <div class="search-results" id="globalSearchResults"></div>
      </div>
      <div class="header-bell" id="bellBtn" onclick="toggleBellDropdown()">
        🔔
        <span class="bell-dot" id="bellDot"></span>
        <div class="bell-dropdown" id="bellDropdown">
          <h4>Notifications</h4>
          <div id="bellAlerts"><div class="no-alerts">Loading…</div></div>
        </div>
      </div>
    `;
    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
      const bell = document.getElementById('bellBtn');
      const dd = document.getElementById('bellDropdown');
      if (bell && dd && !bell.contains(e.target)) {
        dd.classList.remove('show');
      }
      const sr = document.getElementById('globalSearchResults');
      const si = document.getElementById('globalSearch');
      if (sr && si && !sr.contains(e.target) && e.target !== si) {
        sr.classList.remove('show');
      }
    });

    // ── Wire global search ───────────────────────────────────────
    let _searchTimer = null;
    const searchInput = document.getElementById('globalSearch');
    const searchResults = document.getElementById('globalSearchResults');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(_searchTimer);
        const q = searchInput.value.trim();
        if (!q) { searchResults.classList.remove('show'); searchResults.innerHTML = ''; return; }
        _searchTimer = setTimeout(() => runGlobalSearch(q), 260);
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { searchResults.classList.remove('show'); searchInput.value = ''; }
      });
    }

    // ── Load bell alerts ─────────────────────────────────────────
    loadBellAlerts();
  }
}

async function runGlobalSearch(q) {
  const searchResults = document.getElementById('globalSearchResults');
  if (!searchResults) return;
  try {
    const results = await api('/api/search?q=' + encodeURIComponent(q));
    if (!results || results.length === 0) {
      searchResults.innerHTML = '<div class="sr-none">No medicines found</div>';
      searchResults.classList.add('show');
      return;
    }
    searchResults.innerHTML = results.map(r => {
      const fefo = r.fefo_batch_no ? `Batch ${r.fefo_batch_no} · Rack ${r.fefo_rack_code}` : 'No sellable stock';
      const rx = r.prescription_required ? '<span class="sr-rx">Rx</span>' : '';
      return `<div class="sr-item" onclick="window.location.href='/inventory.html'">
        <div class="sr-name">${escapeHtml(r.name)} ${rx}</div>
        <div class="sr-meta">${escapeHtml(r.category || '')} · Stock: ${r.total_sellable_qty} · ${escapeHtml(fefo)}</div>
      </div>`;
    }).join('');
    searchResults.classList.add('show');
  } catch (e) {
    searchResults.innerHTML = '<div class="sr-none">Search error</div>';
    searchResults.classList.add('show');
  }
}

async function loadBellAlerts() {
  try {
    const data = await api('/api/dashboard');
    const bellDot = document.getElementById('bellDot');
    const bellAlerts = document.getElementById('bellAlerts');
    if (!data) return;
    const alerts = data.alerts || [];
    if (bellDot) bellDot.style.display = alerts.length > 0 ? 'block' : 'none';
    if (bellAlerts) {
      if (alerts.length === 0) {
        bellAlerts.innerHTML = '<div class="no-alerts">No alerts right now ✅</div>';
      } else {
        const icons = { expired: '🔴', today: '🟠', warning: '🟡', lowstock: '🔵' };
        bellAlerts.innerHTML = alerts.map(a =>
          `<div class="bell-alert-item bell-${a.type}">${icons[a.type] || '•'} ${escapeHtml(a.message)}</div>`
        ).join('');
      }
    }
  } catch (e) {
    const bellAlerts = document.getElementById('bellAlerts');
    if (bellAlerts) bellAlerts.innerHTML = '<div class="no-alerts">—</div>';
  }
}

// Toggle bell dropdown
function toggleBellDropdown() {
  const dd = document.getElementById('bellDropdown');
  if (dd) dd.classList.toggle('show');
}

// ── Logout ─────────────────────────────────────────────
async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (e) { /* ignore */ }
  window.location.href = '/login.html';
}

// ── Escape HTML for safe rendering ─────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
