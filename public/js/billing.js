// public/js/billing.js – High-speed Point-of-Sale (POS) & Billing UI
let cart = []; // Array of { medicine_id: number, qty: number, name: string }
let previewData = null; // Server preview response
let currentSearchResults = [];
let highlightedIndex = -1;
let lastScannedMedicine = null;
let searchDebounceTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  await initLayout('billing');
  setupEventListeners();
  focusSearchInput();
  await loadRecentBills();
});

// Always maintain focus on the main search input
function focusSearchInput() {
  const input = document.getElementById('posSearchInput');
  if (!input) return;

  const active = document.activeElement;
  const isTypingCustomerField = active && (active.id === 'posCustName' || active.id === 'posCustPhone' || active.id === 'posPayMode');
  const isModalOpen = document.getElementById('modalCheckoutSuccess')?.classList.contains('show');

  if (!isTypingCustomerField && !isModalOpen && active !== input) {
    input.focus();
  }
}

function setupEventListeners() {
  const searchInput = document.getElementById('posSearchInput');
  const dropdown = document.getElementById('posSearchDropdown');

  // Input typing listener with debounce
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      clearTimeout(searchDebounceTimer);

      if (!q) {
        closeDropdown();
        if (lastScannedMedicine) {
          showFefoForMedicine(lastScannedMedicine);
        } else {
          updateFefoTag('Ready for scanning or medicine search', 'default');
        }
        return;
      }

      searchDebounceTimer = setTimeout(() => {
        performSearch(q);
      }, 120);
    });

    // Scanner and keyboard navigation listener
    searchInput.addEventListener('keydown', async (e) => {
      const isDropdownOpen = dropdown && dropdown.classList.contains('show');

      if (e.key === 'ArrowDown') {
        if (isDropdownOpen && currentSearchResults.length > 0) {
          e.preventDefault();
          highlightedIndex = (highlightedIndex + 1) % currentSearchResults.length;
          updateDropdownHighlight();
          showFefoForMedicine(currentSearchResults[highlightedIndex]);
        }
      } else if (e.key === 'ArrowUp') {
        if (isDropdownOpen && currentSearchResults.length > 0) {
          e.preventDefault();
          highlightedIndex = (highlightedIndex - 1 + currentSearchResults.length) % currentSearchResults.length;
          updateDropdownHighlight();
          showFefoForMedicine(currentSearchResults[highlightedIndex]);
        }
      } else if (e.key === 'Escape') {
        closeDropdown();
        searchInput.value = '';
        if (lastScannedMedicine) {
          showFefoForMedicine(lastScannedMedicine);
        } else {
          updateFefoTag('Ready for scanning or medicine search', 'default');
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const text = searchInput.value.trim();
        if (!text) return;

        // If user navigated with arrows in dropdown
        if (isDropdownOpen && highlightedIndex >= 0 && currentSearchResults[highlightedIndex]) {
          addMedicineToCart(currentSearchResults[highlightedIndex]);
          return;
        }

        // Fast scanner behavior: barcode match or fast Enter
        // First check if currentSearchResults has an exact barcode match
        const exactMatch = currentSearchResults.find(m => m.barcode === text);
        if (exactMatch) {
          addMedicineToCart(exactMatch);
          return;
        }

        // If only 1 search result is currently visible
        if (isDropdownOpen && currentSearchResults.length === 1) {
          addMedicineToCart(currentSearchResults[0]);
          return;
        }

        // Scanner types faster than debounce: query immediately
        try {
          const results = await api(`/api/search?q=${encodeURIComponent(text)}`);
          if (results && results.length > 0) {
            const barcodeFound = results.find(m => m.barcode === text);
            if (barcodeFound) {
              addMedicineToCart(barcodeFound);
            } else {
              addMedicineToCart(results[0]);
            }
          } else {
            toast(`No medicine found for "${text}"`, 'error');
            updateFefoTag(`No medicine found for "${text}"`, 'empty-stock');
          }
        } catch (err) {
          toast('Lookup failed: ' + err.message, 'error');
        }
      }
    });
  }

  // Close dropdown on outside click and refocus input
  document.addEventListener('click', (e) => {
    const searchWrapper = document.querySelector('.pos-search-wrapper');
    if (searchWrapper && !searchWrapper.contains(e.target)) {
      closeDropdown();
    }
    focusSearchInput();
  });
}

// Perform medicine search
async function performSearch(query) {
  try {
    const results = await api(`/api/search?q=${encodeURIComponent(query)}`);
    currentSearchResults = results || [];
    renderDropdownResults(query);
  } catch (err) {
    console.error('Search error:', err);
  }
}

// Render dropdown results
function renderDropdownResults(query) {
  const dropdown = document.getElementById('posSearchDropdown');
  if (!dropdown) return;

  if (currentSearchResults.length === 0) {
    dropdown.innerHTML = `<div style="padding:14px; text-align:center; color:var(--gray-500); font-size:.85rem;">No medicines found matching "${escapeHtml(query)}"</div>`;
    dropdown.classList.add('show');
    highlightedIndex = -1;
    updateFefoTag(`No matches for "${query}"`, 'empty-stock');
    return;
  }

  highlightedIndex = 0;
  const itemsHtml = currentSearchResults.map((m, idx) => {
    const rxBadge = m.prescription_required ? `<span class="badge-rx">Rx Required</span>` : '';
    const stockBadge = m.total_sellable_qty > 0 
      ? `<span class="badge badge-green" style="font-size:.75rem;">${m.total_sellable_qty} in stock</span>`
      : `<span class="badge badge-red" style="font-size:.75rem;">0 in stock (No sellable stock)</span>`;

    const rackText = m.fefo_rack_code ? `Rack ${m.fefo_rack_code}` : 'No rack';
    const batchText = m.fefo_batch_no ? `Batch ${m.fefo_batch_no}` : '';

    return `
      <div class="pos-dropdown-item ${idx === 0 ? 'active' : ''}" data-index="${idx}" onclick="onDropdownItemClick(${idx})">
        <div class="pos-dropdown-item-left">
          <div class="pos-item-name">
            <span>${escapeHtml(m.name)}</span>
            ${rxBadge}
          </div>
          <div class="pos-item-meta">
            <span>${escapeHtml(m.category_name || m.category || '')}</span>
            <span>•</span>
            <span style="font-family:monospace;">${escapeHtml(m.barcode)}</span>
            ${batchText ? `<span>•</span><span>${batchText} (${rackText})</span>` : ''}
          </div>
        </div>
        <div class="pos-dropdown-item-right">
          ${stockBadge}
          ${m.selling_price ? `<span style="font-size:.8rem; font-weight:600; color:var(--gray-700);">${formatMoney(m.selling_price)}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  dropdown.innerHTML = itemsHtml;
  dropdown.classList.add('show');

  // Update FEFO smart tag for the first highlighted result
  showFefoForMedicine(currentSearchResults[0]);
}

function updateDropdownHighlight() {
  const dropdown = document.getElementById('posSearchDropdown');
  if (!dropdown) return;

  const items = dropdown.querySelectorAll('.pos-dropdown-item');
  items.forEach((item, idx) => {
    if (idx === highlightedIndex) {
      item.classList.add('active');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('active');
    }
  });
}

function closeDropdown() {
  const dropdown = document.getElementById('posSearchDropdown');
  if (dropdown) dropdown.classList.remove('show');
  highlightedIndex = -1;
}

function onDropdownItemClick(index) {
  if (currentSearchResults[index]) {
    addMedicineToCart(currentSearchResults[index]);
  }
}

// Update the fixed-height FEFO smart tag
function updateFefoTag(text, state = 'default') {
  const tag = document.getElementById('fefoSmartTag');
  const textEl = document.getElementById('fefoTagText');
  const iconEl = document.getElementById('fefoTagIcon');
  if (!tag || !textEl) return;

  tag.className = 'fefo-smart-tag';
  if (state === 'has-item') {
    tag.classList.add('fefo-has-item');
    if (iconEl) iconEl.textContent = '📦';
  } else if (state === 'empty-stock') {
    tag.classList.add('fefo-empty-stock');
    if (iconEl) iconEl.textContent = '⚠️';
  } else {
    if (iconEl) iconEl.textContent = '🏷️';
  }
  textEl.textContent = text;
}

function showFefoForMedicine(medicine) {
  if (!medicine) return;
  if (!medicine.total_sellable_qty || medicine.total_sellable_qty <= 0) {
    updateFefoTag(`No sellable stock for ${medicine.name}`, 'empty-stock');
    return;
  }

  const batchNo = medicine.fefo_batch_no || 'Earliest batch';
  const rack = medicine.fefo_rack_code ? `Rack ${medicine.fefo_rack_code}` : 'Rack —';
  const expiry = medicine.fefo_expiry_date ? `Expires ${formatDate(medicine.fefo_expiry_date)}` : '';

  updateFefoTag(`Pick Batch ${batchNo} from ${rack} (${expiry})`, 'has-item');
}

// ── CART MANAGEMENT & PREVIEW ───────────────────────────
async function addMedicineToCart(medicine) {
  if (!medicine) return;

  // Rule: If a medicine has only expired stock or no stock, show error toast: "No sellable stock" (do not add it)
  if (!medicine.total_sellable_qty || Number(medicine.total_sellable_qty) <= 0) {
    toast('No sellable stock', 'error');
    updateFefoTag(`No sellable stock for ${medicine.name}`, 'empty-stock');
    clearSearchInput();
    focusSearchInput();
    return;
  }

  // Rule: Prescription warning badge & warning toast
  if (medicine.prescription_required || medicine.rx_required) {
    toast(`Prescription required for ${medicine.name}`, 'warning');
  }

  // Add or increment in cart
  const existingIndex = cart.findIndex(item => item.medicine_id === medicine.id);
  if (existingIndex >= 0) {
    cart[existingIndex].qty += 1;
  } else {
    cart.push({
      medicine_id: medicine.id,
      name: medicine.name,
      qty: 1
    });
  }

  lastScannedMedicine = medicine;
  showFefoForMedicine(medicine);
  clearSearchInput();
  closeDropdown();

  await updateCartPreview();
  focusSearchInput();
}

function clearSearchInput() {
  const searchInput = document.getElementById('posSearchInput');
  if (searchInput) searchInput.value = '';
}

// Update cart preview from server (/api/billing/preview)
async function updateCartPreview() {
  const cartItemsList = document.getElementById('cartItemsList');
  const cartEmptyState = document.getElementById('cartEmptyState');
  const cartCountBadge = document.getElementById('cartCountBadge');
  const clearBtn = document.getElementById('btnClearCart');
  const checkoutBtn = document.getElementById('btnCheckout');

  const taxableEl = document.getElementById('posTaxableTotal');
  const gstEl = document.getElementById('posGstTotal');
  const grandEl = document.getElementById('posGrandTotal');

  if (cart.length === 0) {
    previewData = null;
    if (cartEmptyState) cartEmptyState.style.display = 'block';
    if (cartItemsList) cartItemsList.innerHTML = '';
    if (cartCountBadge) cartCountBadge.textContent = '0';
    if (clearBtn) clearBtn.style.display = 'none';
    if (checkoutBtn) checkoutBtn.disabled = true;

    if (taxableEl) taxableEl.textContent = '₹0.00';
    if (gstEl) gstEl.textContent = '₹0.00';
    if (grandEl) grandEl.textContent = '₹0.00';
    return;
  }

  try {
    const payload = {
      items: cart.map(item => ({
        medicine_id: item.medicine_id,
        qty: item.qty
      }))
    };

    const res = await api('/api/billing/preview', {
      method: 'POST',
      body: payload
    });

    previewData = res;

    // Render cart items
    if (cartEmptyState) cartEmptyState.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'block';

    const totalUnits = cart.reduce((sum, item) => sum + item.qty, 0);
    if (cartCountBadge) cartCountBadge.textContent = String(totalUnits);

    renderCartItems(res.items);

    // Update totals
    if (taxableEl) taxableEl.textContent = formatMoney(res.taxable_total);
    if (gstEl) gstEl.textContent = formatMoney(res.gst_total);
    if (grandEl) grandEl.textContent = formatMoney(res.grand_total);

    // Check if any items are blocked
    const hasBlocked = res.items && res.items.some(i => i.blocked);
    if (checkoutBtn) {
      checkoutBtn.disabled = hasBlocked || (res.lines && res.lines.length === 0);
    }

    // Surface server warnings as toasts
    if (res.warnings && res.warnings.length > 0) {
      for (const w of res.warnings) {
        if (w.type === 'insufficient_stock' || w.type === 'no_stock') {
          toast(w.message, 'error');
        }
      }
    }
  } catch (err) {
    console.error('Preview error:', err);
    toast(err.message || 'Failed to update billing preview', 'error');
  }
}

// Render cart items with FEFO-split lines grouped under their medicine
function renderCartItems(itemsSummary) {
  const container = document.getElementById('cartItemsList');
  if (!container) return;

  if (!itemsSummary || itemsSummary.length === 0) {
    container.innerHTML = '';
    return;
  }

  const html = itemsSummary.map(item => {
    const isBlocked = Boolean(item.blocked);
    const rxBadge = item.prescription_required ? `<span class="badge-rx">Rx</span>` : '';

    // Render split lines
    let splitsHtml = '';
    if (item.lines && item.lines.length > 0) {
      splitsHtml = `
        <div class="cart-batch-splits">
          ${item.lines.map(line => {
            const flashTag = line.flash_sale_applied
              ? `<span class="badge-flash">Flash Sale Discount Applied (-${line.discount_pct}%)</span>`
              : '';
            const floorTag = line.is_floor_applied
              ? `<span style="font-size:.7rem; color:var(--yellow); font-weight:600;">(Cost floor used)</span>`
              : '';

            return `
              <div class="cart-split-line">
                <div class="cart-split-info">
                  <div class="cart-split-meta">
                    <span style="font-weight:600; color:var(--gray-900);">Batch: ${escapeHtml(line.batch_no)}</span>
                    <span>•</span>
                    <span class="badge badge-blue" style="font-size:.7rem; padding:1px 4px;">Rack ${escapeHtml(line.rack_code || '—')}</span>
                    <span>•</span>
                    <span style="color:var(--gray-500);">Exp: ${formatDate(line.expiry_date)}</span>
                  </div>
                  <div>
                    ${flashTag} ${floorTag}
                  </div>
                </div>
                <div class="cart-split-pricing">
                  <span class="cart-split-total">${formatMoney(line.line_total)}</span>
                  <span style="font-size:.72rem; color:var(--gray-500);">${line.qty} × ${formatMoney(line.unit_price)}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    const errorHtml = isBlocked
      ? `<div class="cart-item-error">⚠️ ${escapeHtml(item.error || 'Cannot be sold (insufficient stock)')}</div>`
      : '';

    return `
      <div class="cart-medicine-card ${isBlocked ? 'card-blocked' : ''}">
        <div class="cart-med-header">
          <div class="cart-med-title-group">
            <div class="cart-med-title">
              ${escapeHtml(item.medicine_name)} ${rxBadge}
            </div>
            ${item.barcode ? `<div style="font-size:.75rem; color:var(--gray-400); font-family:monospace;">${escapeHtml(item.barcode)}</div>` : ''}
          </div>
          <div class="cart-med-controls">
            <button type="button" class="cart-qty-btn" onclick="onChangeCartQty(${item.medicine_id}, -1)">−</button>
            <span class="cart-qty-display">${item.requested_qty}</span>
            <button type="button" class="cart-qty-btn" onclick="onChangeCartQty(${item.medicine_id}, 1)">+</button>
            <button type="button" class="cart-btn-remove" title="Remove item" onclick="onRemoveCartItem(${item.medicine_id})">✕</button>
          </div>
        </div>
        ${splitsHtml}
        ${errorHtml}
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

// Modify quantity for item in cart
async function onChangeCartQty(medicineId, delta) {
  const item = cart.find(i => i.medicine_id === medicineId);
  if (!item) return;

  item.qty += delta;
  if (item.qty <= 0) {
    cart = cart.filter(i => i.medicine_id !== medicineId);
  }

  await updateCartPreview();
  focusSearchInput();
}

// Remove item from cart
async function onRemoveCartItem(medicineId) {
  cart = cart.filter(i => i.medicine_id !== medicineId);
  await updateCartPreview();
  focusSearchInput();
}

// Clear entire cart
async function onClearCartClick() {
  cart = [];
  lastScannedMedicine = null;
  updateFefoTag('Ready for scanning or medicine search', 'default');
  await updateCartPreview();
  focusSearchInput();
}

// ── CHECKOUT & SUCCESS MODAL ───────────────────────────
async function onCheckoutClick() {
  if (cart.length === 0) {
    toast('Cart is empty', 'warning');
    return;
  }

  if (previewData && previewData.items && previewData.items.some(i => i.blocked)) {
    toast('Please remove or adjust items with insufficient stock before checkout', 'error');
    return;
  }

  const checkoutBtn = document.getElementById('btnCheckout');
  const custNameInput = document.getElementById('posCustName');
  const custPhoneInput = document.getElementById('posCustPhone');
  const payModeSelect = document.getElementById('posPayMode');

  const customerName = custNameInput ? custNameInput.value.trim() : '';
  const customerPhone = custPhoneInput ? custPhoneInput.value.trim() : '';
  const paymentMode = payModeSelect ? payModeSelect.value : 'cash';

  if (checkoutBtn) {
    checkoutBtn.disabled = true;
    checkoutBtn.textContent = 'Processing Checkout…';
  }

  try {
    const payload = {
      items: cart.map(i => ({ medicine_id: i.medicine_id, qty: i.qty })),
      customer_name: customerName || null,
      customer_phone: customerPhone || null,
      payment_mode: paymentMode
    };

    const res = await api('/api/billing/checkout', {
      method: 'POST',
      body: payload
    });

    // Populate Success Modal
    const successBillNo = document.getElementById('successBillNo');
    const successGrandTotal = document.getElementById('successGrandTotal');
    const btnDownloadPdf = document.getElementById('btnDownloadPdf');

    if (successBillNo) successBillNo.textContent = res.bill_no;
    if (successGrandTotal) successGrandTotal.textContent = formatMoney(res.grand_total);
    if (btnDownloadPdf) {
      btnDownloadPdf.onclick = () => {
        window.open(`/api/bills/${res.bill_id}/pdf`, '_blank');
      };
    }

    // Reset cart and inputs
    cart = [];
    if (custNameInput) custNameInput.value = '';
    if (custPhoneInput) custPhoneInput.value = '';
    if (payModeSelect) payModeSelect.value = 'cash';
    lastScannedMedicine = null;
    updateFefoTag('Ready for scanning or medicine search', 'default');

    await updateCartPreview();
    await loadRecentBills();

    // Show success modal
    const modal = document.getElementById('modalCheckoutSuccess');
    if (modal) modal.classList.add('show');
  } catch (err) {
    console.error('Checkout error:', err);
    toast(err.message || 'Checkout failed', 'error');
  } finally {
    if (checkoutBtn) {
      checkoutBtn.disabled = false;
      checkoutBtn.innerHTML = '<span>💳 Checkout Bill</span>';
    }
  }
}

// "Start New Bill" from success modal
function onNewBillClick() {
  const modal = document.getElementById('modalCheckoutSuccess');
  if (modal) modal.classList.remove('show');
  clearSearchInput();
  focusSearchInput();
}

// ── RECENT BILLS LIST ──────────────────────────────────
async function loadRecentBills() {
  const tbody = document.getElementById('recentBillsTableBody');
  const countBadge = document.getElementById('recentBillsCount');
  if (!tbody) return;

  try {
    const bills = await api('/api/bills/recent');
    if (!bills || bills.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No recent bills found</td></tr>`;
      if (countBadge) countBadge.textContent = '0 bills';
      return;
    }

    if (countBadge) countBadge.textContent = `${bills.length} bills`;

    tbody.innerHTML = bills.map(b => {
      const modeBadge = b.payment_mode === 'cash' 
        ? `<span class="badge" style="background:var(--gray-200); color:var(--gray-800); text-transform:uppercase; font-size:.7rem;">CASH</span>`
        : b.payment_mode === 'upi'
          ? `<span class="badge badge-blue" style="text-transform:uppercase; font-size:.7rem;">UPI</span>`
          : `<span class="badge badge-green" style="text-transform:uppercase; font-size:.7rem;">CARD</span>`;

      return `
        <tr>
          <td><code style="font-weight:700; color:var(--primary); font-size:.85rem;">${escapeHtml(b.bill_no)}</code></td>
          <td style="color:var(--gray-600);">${formatDateTime(b.created_at)}</td>
          <td>
            <div style="font-weight:600; color:var(--gray-800);">${escapeHtml(b.customer_name)}</div>
            ${b.customer_phone && b.customer_phone !== '—' ? `<div style="font-size:.75rem; color:var(--gray-500); font-family:monospace;">${escapeHtml(b.customer_phone)}</div>` : ''}
          </td>
          <td>${modeBadge}</td>
          <td style="text-align:right; font-weight:700; font-family:monospace;">${formatMoney(b.grand_total)}</td>
          <td style="text-align:center;">
            <a href="/api/bills/${b.id}/pdf" target="_blank" class="btn btn-outline btn-sm" style="padding:2px 8px; font-size:.75rem;" title="Download Invoice PDF">
              📄 PDF
            </a>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading recent bills:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty" style="color:var(--red);">Failed to load recent bills</td></tr>`;
  }
}

