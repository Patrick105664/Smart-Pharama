// public/js/inventory.js – Inventory page logic (filters, batches, modals, flash sale, vendors)

let currentUser = null;
let debounceTimer = null;
let barcodeLookupTimer = null;

let cachedCategories = [];
let cachedVendors = [];
let cachedRacks = [];
let currentVendorsList = [];

document.addEventListener('DOMContentLoaded', async () => {
  await initLayout('inventory');
  currentUser = await getCurrentUser();
  if (!currentUser) return;

  setupRoleView();
  await loadDropdownData();
  setupEventListeners();
  await loadBatches();
  setupModalBackdrops();
});

// Configure UI elements based on owner vs cashier
function setupRoleView() {
  const isOwner = currentUser && currentUser.role === 'owner';
  const ownerActions = document.getElementById('ownerHeaderActions');
  if (ownerActions) {
    ownerActions.style.display = isOwner ? 'flex' : 'none';
  }

  const vendorOwnerActions = document.getElementById('vendorOwnerActions');
  if (vendorOwnerActions) {
    vendorOwnerActions.style.display = isOwner ? 'block' : 'none';
  }

  const vendorActionsHeader = document.getElementById('vendorActionsHeader');
  if (vendorActionsHeader) {
    vendorActionsHeader.style.display = isOwner ? 'table-cell' : 'none';
  }

  // Set batch table headers based on role
  const tableHeader = document.getElementById('batchesTableHead');
  if (tableHeader) {
    if (isOwner) {
      tableHeader.innerHTML = `
        <tr>
          <th>Medicine Name</th>
          <th>Batch</th>
          <th>Expiry Date</th>
          <th>Rack</th>
          <th style="text-align:right;">Stock Qty</th>
          <th>Vendor</th>
          <th style="text-align:right;">Purchase Price</th>
          <th style="text-align:right;">MRP</th>
          <th style="text-align:center;">Flash Sale</th>
          <th style="text-align:center;">Actions</th>
        </tr>
      `;
    } else {
      tableHeader.innerHTML = `
        <tr>
          <th>Medicine Name</th>
          <th>Batch</th>
          <th>Expiry Date</th>
          <th>Rack</th>
          <th style="text-align:right;">Stock Qty</th>
          <th>Vendor</th>
          <th style="text-align:right;">MRP</th>
        </tr>
      `;
    }
  }
}

// Sub-tabs navigation: Batches Stock vs Vendors
function switchInventoryTab(tabName) {
  const tabBatches = document.getElementById('tabBatches');
  const tabVendors = document.getElementById('tabVendors');
  const batchesSec = document.getElementById('batchesSection');
  const vendorsSec = document.getElementById('vendorsSection');
  const inventoryCount = document.getElementById('inventoryCount');

  if (tabName === 'vendors') {
    tabVendors?.classList.add('active');
    tabBatches?.classList.remove('active');
    if (batchesSec) batchesSec.style.display = 'none';
    if (vendorsSec) vendorsSec.style.display = 'block';
    if (inventoryCount) inventoryCount.style.display = 'none';
    loadVendors();
  } else {
    tabBatches?.classList.add('active');
    tabVendors?.classList.remove('active');
    if (vendorsSec) vendorsSec.style.display = 'none';
    if (batchesSec) batchesSec.style.display = 'block';
    if (inventoryCount) inventoryCount.style.display = 'inline-flex';
    loadBatches();
  }
}

// Modal show/hide helpers
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('show');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('show');
    const err = modal.querySelector('.modal-error');
    if (err) {
      err.textContent = '';
      err.style.display = 'none';
    }
  }
}

function setupModalBackdrops() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ['modalAddMedicine', 'modalEditBatch', 'modalVendor', 'modalImportCsv'].forEach(closeModal);
    }
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal(overlay.id);
      }
    });
  });
}

// Load dropdown datasets (categories, active vendors, racks)
async function loadDropdownData() {
  try {
    const [categories, vendors, racks] = await Promise.all([
      api('/api/categories'),
      api('/api/vendors?all=true'),
      api('/api/racks')
    ]);

    cachedCategories = categories || [];
    cachedVendors = vendors || [];
    cachedRacks = racks || [];

    // Filter bar category dropdown
    const catSelect = document.getElementById('filterCategory');
    if (catSelect) {
      catSelect.innerHTML = '<option value="">All Categories</option>';
      cachedCategories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        catSelect.appendChild(opt);
      });
    }

    // Filter bar vendor dropdown (active only)
    const vendorSelect = document.getElementById('filterVendor');
    if (vendorSelect) {
      vendorSelect.innerHTML = '<option value="">All Vendors</option>';
      cachedVendors.filter(v => v.is_active).forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name;
        vendorSelect.appendChild(opt);
      });
    }

    // Add Medicine category dropdown
    const addCat = document.getElementById('addMedCategory');
    if (addCat) {
      addCat.innerHTML = '<option value="">Select Category</option>';
      cachedCategories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        addCat.appendChild(opt);
      });
    }

    // Add Medicine vendor dropdown
    const addVendor = document.getElementById('addBatchVendor');
    if (addVendor) {
      addVendor.innerHTML = '<option value="">Select Vendor</option>';
      cachedVendors.filter(v => v.is_active).forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name;
        addVendor.appendChild(opt);
      });
    }

    // Add Medicine rack dropdown
    const addRack = document.getElementById('addBatchRack');
    if (addRack) {
      addRack.innerHTML = '';
      cachedRacks.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = `Rack ${r.code}`;
        addRack.appendChild(opt);
      });
      // Default to last used rack or A1
      const lastRack = localStorage.getItem('spm_last_rack');
      if (lastRack && cachedRacks.some(r => String(r.id) === String(lastRack))) {
        addRack.value = lastRack;
      } else {
        const a1 = cachedRacks.find(r => r.code === 'A1');
        if (a1) addRack.value = a1.id;
      }
    }

    // Update vendor badge count if element exists
    const vendorsBadge = document.getElementById('vendorsTabBadge');
    if (vendorsBadge) {
      vendorsBadge.textContent = cachedVendors.length;
    }
  } catch (err) {
    console.error('Error loading dropdown options:', err);
  }
}

// Attach filter change and search events
function setupEventListeners() {
  const catSelect = document.getElementById('filterCategory');
  const vendorSelect = document.getElementById('filterVendor');
  const sortSelect = document.getElementById('filterSort');
  const searchInput = document.getElementById('filterSearch');
  const inactiveCheck = document.getElementById('filterShowInactive');
  const resetBtn = document.getElementById('btnResetFilters');

  if (catSelect) catSelect.addEventListener('change', () => loadBatches());
  if (vendorSelect) vendorSelect.addEventListener('change', () => loadBatches());
  if (sortSelect) sortSelect.addEventListener('change', () => loadBatches());
  if (inactiveCheck) inactiveCheck.addEventListener('change', () => loadBatches());

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadBatches();
      }, 300);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (catSelect) catSelect.value = '';
      if (vendorSelect) vendorSelect.value = '';
      if (sortSelect) sortSelect.value = 'expiry_asc';
      if (searchInput) searchInput.value = '';
      if (inactiveCheck) inactiveCheck.checked = false;
      loadBatches();
    });
  }

  // Vendors search & filter
  const vendorSearchInput = document.getElementById('vendorSearch');
  const vendorInactiveCheck = document.getElementById('vendorShowInactive');

  if (vendorSearchInput) {
    vendorSearchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        renderVendorsTable();
      }, 250);
    });
  }

  if (vendorInactiveCheck) {
    vendorInactiveCheck.addEventListener('change', () => loadVendors());
  }

  // Barcode lookup listener in Add Medicine modal
  const barcodeInput = document.getElementById('addMedBarcode');
  if (barcodeInput) {
    barcodeInput.addEventListener('input', () => {
      clearTimeout(barcodeLookupTimer);
      barcodeLookupTimer = setTimeout(() => {
        handleBarcodeLookup(barcodeInput.value);
      }, 350);
    });

    barcodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(barcodeLookupTimer);
        handleBarcodeLookup(barcodeInput.value);
      }
    });

    barcodeInput.addEventListener('blur', () => {
      clearTimeout(barcodeLookupTimer);
      handleBarcodeLookup(barcodeInput.value);
    });
  }
}

// Fetch and render batches according to current filter controls
async function loadBatches() {
  const tbody = document.getElementById('batchesTableBody');
  const countBadge = document.getElementById('inventoryCount');
  if (!tbody) return;

  const catVal = document.getElementById('filterCategory')?.value || '';
  const vendorVal = document.getElementById('filterVendor')?.value || '';
  const sortVal = document.getElementById('filterSort')?.value || 'expiry_asc';
  const searchVal = document.getElementById('filterSearch')?.value.trim() || '';
  const showInactive = document.getElementById('filterShowInactive')?.checked || false;

  const params = new URLSearchParams();
  if (catVal) params.set('category', catVal);
  if (vendorVal) params.set('vendor', vendorVal);
  if (sortVal) params.set('sort', sortVal);
  if (searchVal) params.set('q', searchVal);
  if (showInactive) params.set('showInactive', 'true');

  tbody.innerHTML = `<tr><td colspan="10" class="table-empty">Loading inventory…</td></tr>`;

  try {
    const batches = await api(`/api/batches?${params.toString()}`);
    if (!batches || !batches.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="table-empty">No batches found matching the filters.</td></tr>`;
      if (countBadge) countBadge.textContent = '0 batches';
      return;
    }

    if (countBadge) {
      countBadge.textContent = `${batches.length} batch${batches.length === 1 ? '' : 'es'}`;
    }

    const isOwner = currentUser && currentUser.role === 'owner';
    const rowsHtml = batches.map(b => renderBatchRow(b, isOwner)).join('');
    tbody.innerHTML = rowsHtml;
  } catch (err) {
    console.error('Error loading batches:', err);
    tbody.innerHTML = `<tr><td colspan="10" class="table-empty" style="color:var(--red);">Failed to load inventory: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// Render a single batch row
function renderBatchRow(b, isOwner) {
  const isInactive = !b.is_active || !b.medicine_is_active;
  const rowClass = isInactive ? 'row-inactive' : '';

  // Expiry cell styling and content
  let expiryClass = 'expiry-cell-green';
  let expiryBadge = `<span class="badge badge-green">Safe</span>`;
  let expirySub = `${b.days_left}d left`;

  if (b.expiry_status === 'red') {
    expiryClass = 'expiry-cell-red';
    expiryBadge = `<span class="badge badge-red">Expired</span>`;
    expirySub = `${Math.abs(b.days_left)}d ago`;
  } else if (b.expiry_status === 'yellow') {
    expiryClass = 'expiry-cell-yellow';
    expiryBadge = `<span class="badge badge-yellow">Expiring Soon</span>`;
    expirySub = `${b.days_left}d left`;
  }

  const expiryCellHtml = `
    <td class="expiry-cell ${expiryClass}">
      <div style="display:flex; align-items:center; gap:8px;">
        ${expiryBadge}
        <div>
          <div class="expiry-date">${formatDate(b.expiry_date)}</div>
          <div class="expiry-sub" style="color:var(--gray-500);">${expirySub}</div>
        </div>
      </div>
    </td>
  `;

  // Prescription badge
  const rxBadge = b.prescription_required
    ? `<span class="badge badge-rx" title="Prescription Required">Rx</span> `
    : '';

  // Inactive badge
  const inactiveBadge = isInactive
    ? ` <span class="badge" style="background:var(--gray-200); color:var(--gray-600); font-size:.7rem;">Inactive</span>`
    : '';

  // Stock formatting (warning if 0)
  const stockHtml = b.qty === 0
    ? `<span style="color:var(--red); font-weight:700;">0</span>`
    : `<span style="font-weight:600;">${b.qty}</span>`;

  if (isOwner) {
    const flashBadge = b.is_flash_sale
      ? `<span class="badge badge-flash">⚡ On Sale</span>`
      : `<span style="color:var(--gray-400);">—</span>`;

    // Action buttons: Edit, Deactivate/Activate, Flash Sale when eligible
    const isEligibleForFlash = b.expiry_status === 'yellow' && b.is_active && b.qty > 0;
    let flashButtonHtml = '';
    if (isEligibleForFlash) {
      if (b.is_flash_sale) {
        flashButtonHtml = `<button type="button" class="btn btn-outline btn-sm" onclick="onToggleFlashSale(${b.id}, false)" title="Stop flash sale discount">Stop Flash Sale</button>`;
      } else {
        flashButtonHtml = `<button type="button" class="btn btn-warning btn-sm" onclick="onToggleFlashSale(${b.id}, true)" title="Start flash sale discount">⚡ Start Flash Sale</button>`;
      }
    }

    const deactivateBtnHtml = b.is_active
      ? `<button type="button" class="btn btn-outline btn-sm text-red" onclick="onToggleBatchActive(${b.id}, false)" title="Deactivate batch">Deactivate</button>`
      : `<button type="button" class="btn btn-outline btn-sm text-green" onclick="onToggleBatchActive(${b.id}, true)" title="Activate batch">Activate</button>`;

    const actionsHtml = `
      <div style="display:inline-flex; gap:6px; align-items:center; flex-wrap:wrap; justify-content:center;">
        <button type="button" class="btn btn-outline btn-sm" onclick="openEditBatchModal(${b.id})" title="Edit batch details">Edit</button>
        ${deactivateBtnHtml}
        ${flashButtonHtml}
      </div>
    `;

    return `
      <tr class="${rowClass}">
        <td>
          <div style="font-weight:600; color:var(--gray-900);">${escapeHtml(b.medicine_name)}</div>
          <div style="font-size:.75rem; color:var(--gray-500); display:flex; gap:6px; align-items:center; margin-top:2px;">
            ${rxBadge}
            <span>${escapeHtml(b.category_name || '')}</span>
            <span>•</span>
            <span style="font-family:monospace;">${escapeHtml(b.barcode || '')}</span>
          </div>
        </td>
        <td>
          <code style="font-weight:600; font-size:.85rem;">${escapeHtml(b.batch_no)}</code>${inactiveBadge}
        </td>
        ${expiryCellHtml}
        <td><span class="badge badge-blue">${escapeHtml(b.rack_code || '—')}</span></td>
        <td style="text-align:right;">${stockHtml}</td>
        <td>${escapeHtml(b.vendor_name || '—')}</td>
        <td style="text-align:right; font-family:monospace; color:var(--gray-600);">${formatMoney(b.purchase_price)}</td>
        <td style="text-align:right; font-weight:600; font-family:monospace;">${formatMoney(b.selling_price)}</td>
        <td style="text-align:center;">${flashBadge}</td>
        <td style="text-align:center;">${actionsHtml}</td>
      </tr>
    `;
  } else {
    // Cashier view - strictly no purchase price, flash sale, or action buttons
    return `
      <tr class="${rowClass}">
        <td>
          <div style="font-weight:600; color:var(--gray-900);">${escapeHtml(b.medicine_name)}</div>
          <div style="font-size:.75rem; color:var(--gray-500); display:flex; gap:6px; align-items:center; margin-top:2px;">
            ${rxBadge}
            <span>${escapeHtml(b.category_name || '')}</span>
            <span>•</span>
            <span style="font-family:monospace;">${escapeHtml(b.barcode || '')}</span>
          </div>
        </td>
        <td>
          <code style="font-weight:600; font-size:.85rem;">${escapeHtml(b.batch_no)}</code>${inactiveBadge}
        </td>
        ${expiryCellHtml}
        <td><span class="badge badge-blue">${escapeHtml(b.rack_code || '—')}</span></td>
        <td style="text-align:right;">${stockHtml}</td>
        <td>${escapeHtml(b.vendor_name || '—')}</td>
        <td style="text-align:right; font-weight:600; font-family:monospace;">${formatMoney(b.selling_price)}</td>
      </tr>
    `;
  }
}

// ── BARCODE LOOKUP LOGIC ─────────────────────────────────
let lastLookedUpBarcode = '';
async function handleBarcodeLookup(rawCode) {
  const code = (rawCode || '').trim();
  const statusEl = document.getElementById('addMedBarcodeStatus');
  const lockBadge = document.getElementById('medLockBadge');
  const medIdInput = document.getElementById('addMedMedicineId');
  const nameInput = document.getElementById('addMedName');
  const catInput = document.getElementById('addMedCategory');
  const mfgInput = document.getElementById('addMedMfg');
  const gstInput = document.getElementById('addMedGst');
  const rxInput = document.getElementById('addMedRx');

  if (!code) {
    lastLookedUpBarcode = '';
    if (statusEl) statusEl.innerHTML = '';
    if (lockBadge) lockBadge.style.display = 'none';
    if (medIdInput) medIdInput.value = '';
    if (nameInput) nameInput.disabled = false;
    if (catInput) catInput.disabled = false;
    if (mfgInput) mfgInput.disabled = false;
    if (gstInput) gstInput.disabled = false;
    if (rxInput) rxInput.disabled = false;
    return;
  }

  if (code === lastLookedUpBarcode) return;
  lastLookedUpBarcode = code;

  if (statusEl) {
    statusEl.innerHTML = `<span style="color:var(--gray-500);">🔍 Checking barcode…</span>`;
  }

  try {
    const res = await api(`/api/medicines/by-barcode/${encodeURIComponent(code)}`);
    if (res && res.found) {
      // Existing medicine found: fill and lock
      if (medIdInput) medIdInput.value = res.id;
      if (nameInput) {
        nameInput.value = res.name || '';
        nameInput.disabled = true;
      }
      if (catInput) {
        catInput.value = res.category_id || '';
        catInput.disabled = true;
      }
      if (mfgInput) {
        mfgInput.value = res.manufacturer || '';
        mfgInput.disabled = true;
      }
      if (gstInput) {
        gstInput.value = String(res.gst_percent);
        gstInput.disabled = true;
      }
      if (rxInput) {
        rxInput.checked = Boolean(res.prescription_required);
        rxInput.disabled = true;
      }

      if (lockBadge) lockBadge.style.display = 'inline-flex';
      if (statusEl) {
        statusEl.innerHTML = `<span class="text-green" style="font-weight:600;">✓ Found: ${escapeHtml(res.name)} (${escapeHtml(res.category_name || '')})</span>`;
      }

      // Automatically move focus to batch number
      document.getElementById('addBatchNo')?.focus();
    }
  } catch (err) {
    // Medicine does not exist with this barcode: unlock fields so owner enters them
    if (medIdInput) medIdInput.value = '';
    if (nameInput) nameInput.disabled = false;
    if (catInput) catInput.disabled = false;
    if (mfgInput) mfgInput.disabled = false;
    if (gstInput) gstInput.disabled = false;
    if (rxInput) rxInput.disabled = false;

    if (lockBadge) lockBadge.style.display = 'none';
    if (statusEl) {
      statusEl.innerHTML = `<span style="color:var(--primary); font-weight:500;">ℹ️ New medicine – fill in medicine details</span>`;
    }
  }
}

// ── ADD MEDICINE & BATCH MODAL ───────────────────────────
function openAddMedicineModal() {
  const form = document.getElementById('formAddMedicine');
  if (form) form.reset();

  lastLookedUpBarcode = '';
  const statusEl = document.getElementById('addMedBarcodeStatus');
  if (statusEl) statusEl.innerHTML = '';

  const lockBadge = document.getElementById('medLockBadge');
  if (lockBadge) lockBadge.style.display = 'none';

  const medIdInput = document.getElementById('addMedMedicineId');
  if (medIdInput) medIdInput.value = '';

  const nameInput = document.getElementById('addMedName');
  if (nameInput) nameInput.disabled = false;

  const catInput = document.getElementById('addMedCategory');
  if (catInput) catInput.disabled = false;

  const mfgInput = document.getElementById('addMedMfg');
  if (mfgInput) mfgInput.disabled = false;

  const gstInput = document.getElementById('addMedGst');
  if (gstInput) {
    gstInput.value = '5';
    gstInput.disabled = false;
  }

  const rxInput = document.getElementById('addMedRx');
  if (rxInput) rxInput.disabled = false;

  // Restore last used rack
  const addRack = document.getElementById('addBatchRack');
  if (addRack) {
    const lastRack = localStorage.getItem('spm_last_rack');
    if (lastRack && cachedRacks.some(r => String(r.id) === String(lastRack))) {
      addRack.value = lastRack;
    } else {
      const a1 = cachedRacks.find(r => r.code === 'A1');
      if (a1) addRack.value = a1.id;
    }
  }

  // Clear modal error
  const errBox = document.getElementById('addMedError');
  if (errBox) {
    errBox.textContent = '';
    errBox.style.display = 'none';
  }

  openModal('modalAddMedicine');
  setTimeout(() => document.getElementById('addMedBarcode')?.focus(), 100);
}

async function onAddMedicineSubmit(e) {
  e.preventDefault();
  const errBox = document.getElementById('addMedError');
  if (errBox) {
    errBox.textContent = '';
    errBox.style.display = 'none';
  }

  const barcode = document.getElementById('addMedBarcode')?.value.trim();
  const medId = document.getElementById('addMedMedicineId')?.value;
  const name = document.getElementById('addMedName')?.value.trim();
  const categoryId = document.getElementById('addMedCategory')?.value;
  const manufacturer = document.getElementById('addMedMfg')?.value.trim();
  const gstPercent = document.getElementById('addMedGst')?.value;
  const prescriptionRequired = document.getElementById('addMedRx')?.checked ? 1 : 0;

  const batchNo = document.getElementById('addBatchNo')?.value.trim();
  const expiryDate = document.getElementById('addBatchExpiry')?.value;
  const qty = document.getElementById('addBatchQty')?.value;
  const purchasePrice = document.getElementById('addBatchPurchase')?.value;
  const sellingPrice = document.getElementById('addBatchSelling')?.value;
  const vendorId = document.getElementById('addBatchVendor')?.value;
  const rackId = document.getElementById('addBatchRack')?.value;

  // Client validation
  if (!barcode) {
    showInlineError(errBox, 'Barcode is required');
    return;
  }

  if (!medId && !name) {
    showInlineError(errBox, 'Medicine name is required for new medicine');
    return;
  }

  if (!medId && !categoryId) {
    showInlineError(errBox, 'Category is required for new medicine');
    return;
  }

  if (!batchNo) {
    showInlineError(errBox, 'Batch number is required');
    return;
  }

  if (!expiryDate) {
    showInlineError(errBox, 'Expiry date is required');
    return;
  }

  // Expiry must not be in past
  const expD = new Date(expiryDate);
  const today = new Date();
  today.setHours(0,0,0,0);
  if (expD < today) {
    showInlineError(errBox, 'Expiry date cannot be in the past');
    return;
  }

  const numQty = parseInt(qty, 10);
  if (isNaN(numQty) || numQty < 0) {
    showInlineError(errBox, 'Quantity must be a positive number (0 or more)');
    return;
  }

  const numPurchase = parseFloat(purchasePrice);
  if (isNaN(numPurchase) || numPurchase <= 0) {
    showInlineError(errBox, 'Purchase price must be greater than 0');
    return;
  }

  const numSelling = parseFloat(sellingPrice);
  if (isNaN(numSelling) || numSelling <= 0) {
    showInlineError(errBox, 'MRP / Selling price must be greater than 0');
    return;
  }

  if (numSelling < numPurchase) {
    showInlineError(errBox, 'Selling price (MRP) cannot be less than purchase price');
    return;
  }

  if (!vendorId) {
    showInlineError(errBox, 'Vendor is required');
    return;
  }

  if (!rackId) {
    showInlineError(errBox, 'Rack is required');
    return;
  }

  const payload = {
    barcode,
    medicine_id: medId ? parseInt(medId, 10) : undefined,
    name,
    category_id: categoryId ? parseInt(categoryId, 10) : undefined,
    manufacturer: manufacturer || null,
    gst_percent: gstPercent,
    prescription_required: prescriptionRequired,
    batch_no: batchNo,
    expiry_date: expiryDate,
    qty: numQty,
    purchase_price: numPurchase,
    selling_price: numSelling,
    vendor_id: parseInt(vendorId, 10),
    rack_id: parseInt(rackId, 10)
  };

  const saveBtn = document.getElementById('btnSaveMedicine');
  if (saveBtn) saveBtn.disabled = true;

  try {
    const res = await api('/api/batches', {
      method: 'POST',
      body: payload
    });

    // Remember last used rack
    localStorage.setItem('spm_last_rack', rackId);

    closeModal('modalAddMedicine');
    toast(res.message || 'Batch created successfully', 'success');
    await loadBatches();
  } catch (err) {
    showInlineError(errBox, err.message);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ── EDIT BATCH MODAL ─────────────────────────────────────
async function openEditBatchModal(batchId) {
  const errBox = document.getElementById('editBatchError');
  if (errBox) {
    errBox.textContent = '';
    errBox.style.display = 'none';
  }

  try {
    const batch = await api(`/api/batches/${batchId}`);
    if (!batch) return;

    document.getElementById('editBatchId').value = batch.id;
    document.getElementById('editBatchMedicineName').textContent = batch.medicine_name;
    document.getElementById('editBatchBarcode').textContent = batch.barcode;
    document.getElementById('editBatchNo').value = batch.batch_no;
    document.getElementById('editBatchExpiry').value = batch.expiry_date;
    document.getElementById('editBatchQty').value = batch.qty;
    document.getElementById('editBatchPurchase').value = batch.purchase_price;
    document.getElementById('editBatchSelling').value = batch.selling_price;

    // Populate vendors in edit modal
    const editVendor = document.getElementById('editBatchVendor');
    if (editVendor) {
      editVendor.innerHTML = '';
      cachedVendors.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name + (v.is_active ? '' : ' (Inactive)');
        editVendor.appendChild(opt);
      });
      editVendor.value = batch.vendor_id;
    }

    // Populate racks in edit modal
    const editRack = document.getElementById('editBatchRack');
    if (editRack) {
      editRack.innerHTML = '';
      cachedRacks.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = `Rack ${r.code}`;
        editRack.appendChild(opt);
      });
      editRack.value = batch.rack_id;
    }

    openModal('modalEditBatch');
  } catch (err) {
    toast(`Failed to load batch: ${err.message}`, 'error');
  }
}

async function onEditBatchSubmit(e) {
  e.preventDefault();
  const errBox = document.getElementById('editBatchError');
  if (errBox) {
    errBox.textContent = '';
    errBox.style.display = 'none';
  }

  const batchId = document.getElementById('editBatchId')?.value;
  const batchNo = document.getElementById('editBatchNo')?.value.trim();
  const expiryDate = document.getElementById('editBatchExpiry')?.value;
  const qty = document.getElementById('editBatchQty')?.value;
  const purchasePrice = document.getElementById('editBatchPurchase')?.value;
  const sellingPrice = document.getElementById('editBatchSelling')?.value;
  const vendorId = document.getElementById('editBatchVendor')?.value;
  const rackId = document.getElementById('editBatchRack')?.value;

  if (!batchNo) {
    showInlineError(errBox, 'Batch number is required');
    return;
  }

  if (!expiryDate) {
    showInlineError(errBox, 'Expiry date is required');
    return;
  }

  const numQty = parseInt(qty, 10);
  if (isNaN(numQty) || numQty < 0) {
    showInlineError(errBox, 'Quantity must be a positive integer (0 or more)');
    return;
  }

  const numPurchase = parseFloat(purchasePrice);
  if (isNaN(numPurchase) || numPurchase <= 0) {
    showInlineError(errBox, 'Purchase price must be greater than 0');
    return;
  }

  const numSelling = parseFloat(sellingPrice);
  if (isNaN(numSelling) || numSelling <= 0) {
    showInlineError(errBox, 'Selling price must be greater than 0');
    return;
  }

  if (numSelling < numPurchase) {
    showInlineError(errBox, 'Selling price (MRP) cannot be less than purchase price');
    return;
  }

  const payload = {
    batch_no: batchNo,
    expiry_date: expiryDate,
    qty: numQty,
    purchase_price: numPurchase,
    selling_price: numSelling,
    vendor_id: parseInt(vendorId, 10),
    rack_id: parseInt(rackId, 10)
  };

  try {
    const res = await api(`/api/batches/${batchId}`, {
      method: 'PUT',
      body: payload
    });

    closeModal('modalEditBatch');
    toast(res.message || 'Batch updated successfully', 'success');
    await loadBatches();
  } catch (err) {
    showInlineError(errBox, err.message);
  }
}

// ── TOGGLE BATCH ACTIVE / DEACTIVATE ──────────────────────
async function onToggleBatchActive(id, newActive) {
  try {
    const res = await api(`/api/batches/${id}/active`, {
      method: 'PATCH',
      body: { is_active: newActive ? 1 : 0 }
    });
    toast(res.message || (newActive ? 'Batch activated' : 'Batch deactivated'), 'success');
    await loadBatches();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── FLASH SALE TOGGLE ─────────────────────────────────────
async function onToggleFlashSale(batchId, turnOn) {
  try {
    const res = await api(`/api/batches/${batchId}/flash-sale`, {
      method: 'POST',
      body: { on: turnOn }
    });
    toast(res.message || (turnOn ? 'Flash sale started' : 'Flash sale stopped'), 'success');
    await loadBatches();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── VENDORS SECTION LOGIC ────────────────────────────────
async function loadVendors() {
  const tbody = document.getElementById('vendorsTableBody');
  if (!tbody) return;

  const showInactive = document.getElementById('vendorShowInactive')?.checked || false;
  tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Loading vendors…</td></tr>`;

  try {
    const vendors = await api(`/api/vendors?showInactive=${showInactive}`);
    currentVendorsList = vendors || [];
    renderVendorsTable();
  } catch (err) {
    console.error('Error loading vendors:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty" style="color:var(--red);">Failed to load vendors: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderVendorsTable() {
  const tbody = document.getElementById('vendorsTableBody');
  const badge = document.getElementById('vendorsTabBadge');
  if (!tbody) return;

  const searchVal = document.getElementById('vendorSearch')?.value.trim().toLowerCase() || '';

  const filtered = currentVendorsList.filter(v => {
    if (!searchVal) return true;
    const n = (v.name || '').toLowerCase();
    const p = (v.phone || '').toLowerCase();
    const a = (v.address || '').toLowerCase();
    return n.includes(searchVal) || p.includes(searchVal) || a.includes(searchVal);
  });

  if (badge) {
    badge.textContent = currentVendorsList.length;
  }

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No vendors found.</td></tr>`;
    return;
  }

  const isOwner = currentUser && currentUser.role === 'owner';

  const rows = filtered.map(v => {
    const statusBadge = v.is_active
      ? `<span class="badge badge-green">Active</span>`
      : `<span class="badge" style="background:var(--gray-200); color:var(--gray-600);">Inactive</span>`;

    let actionsCell = '';
    if (isOwner) {
      const toggleBtn = v.is_active
        ? `<button type="button" class="btn btn-outline btn-sm text-red" onclick="onToggleVendorActive(${v.id}, false)">Deactivate</button>`
        : `<button type="button" class="btn btn-outline btn-sm text-green" onclick="onToggleVendorActive(${v.id}, true)">Activate</button>`;

      actionsCell = `
        <td style="text-align:center;">
          <div style="display:inline-flex; gap:6px;">
            <button type="button" class="btn btn-outline btn-sm" onclick="openEditVendorModal(${v.id})">Edit</button>
            ${toggleBtn}
          </div>
        </td>
      `;
    }

    return `
      <tr class="${v.is_active ? '' : 'row-inactive'}">
        <td style="font-weight:600; color:var(--gray-900);">${escapeHtml(v.name)}</td>
        <td>${escapeHtml(v.phone || '—')}</td>
        <td>${escapeHtml(v.email || '—')}</td>
        <td>${escapeHtml(v.address || '—')}</td>
        <td style="text-align:center;">${statusBadge}</td>
        ${actionsCell}
      </tr>
    `;
  }).join('');

  tbody.innerHTML = rows;
}

function openAddVendorModal() {
  const form = document.getElementById('formVendor');
  if (form) form.reset();

  document.getElementById('vendorModalTitle').textContent = 'Add Vendor';
  document.getElementById('vendorModalId').value = '';

  const errBox = document.getElementById('vendorModalError');
  if (errBox) {
    errBox.textContent = '';
    errBox.style.display = 'none';
  }

  openModal('modalVendor');
  setTimeout(() => document.getElementById('vendorName')?.focus(), 100);
}

function openEditVendorModal(vendorId) {
  const vendor = currentVendorsList.find(v => v.id === vendorId);
  if (!vendor) return;

  document.getElementById('vendorModalTitle').textContent = 'Edit Vendor';
  document.getElementById('vendorModalId').value = vendor.id;
  document.getElementById('vendorName').value = vendor.name || '';
  document.getElementById('vendorPhone').value = vendor.phone || '';
  document.getElementById('vendorEmail').value = vendor.email || '';
  document.getElementById('vendorAddress').value = vendor.address || '';

  const errBox = document.getElementById('vendorModalError');
  if (errBox) {
    errBox.textContent = '';
    errBox.style.display = 'none';
  }

  openModal('modalVendor');
}

async function onVendorSubmit(e) {
  e.preventDefault();
  const errBox = document.getElementById('vendorModalError');
  if (errBox) {
    errBox.textContent = '';
    errBox.style.display = 'none';
  }

  const vendorId = document.getElementById('vendorModalId')?.value;
  const name = document.getElementById('vendorName')?.value.trim();
  const phone = document.getElementById('vendorPhone')?.value.trim();
  const email = document.getElementById('vendorEmail')?.value.trim();
  const address = document.getElementById('vendorAddress')?.value.trim();

  if (!name) {
    showInlineError(errBox, 'Vendor name is required');
    return;
  }

  const payload = {
    name,
    phone: phone || null,
    email: email || null,
    address: address || null
  };

  const saveBtn = document.getElementById('btnSaveVendor');
  if (saveBtn) saveBtn.disabled = true;

  try {
    let res;
    if (vendorId) {
      res = await api(`/api/vendors/${vendorId}`, {
        method: 'PUT',
        body: payload
      });
    } else {
      res = await api('/api/vendors', {
        method: 'POST',
        body: payload
      });
    }

    closeModal('modalVendor');
    toast(res.message || 'Vendor saved successfully', 'success');
    await loadDropdownData(); // keep dropdowns in sync
    await loadVendors();
  } catch (err) {
    showInlineError(errBox, err.message);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function onToggleVendorActive(id, newActive) {
  try {
    const res = await api(`/api/vendors/${id}/active`, {
      method: 'PATCH',
      body: { is_active: newActive ? 1 : 0 }
    });
    toast(res.message || (newActive ? 'Vendor activated' : 'Vendor deactivated'), 'success');
    await loadDropdownData();
    await loadVendors();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Helper to show inline error in modals
function showInlineError(box, msg) {
  if (box) {
    box.textContent = msg;
    box.style.display = 'block';
  } else {
    toast(msg, 'error');
  }
}

// ── CSV IMPORT MODAL LOGIC ──────────────────────────────
let selectedCsvFile = null;

function openImportCsvModal() {
  selectedCsvFile = null;
  const fileInput = document.getElementById('csvFileInput');
  if (fileInput) fileInput.value = '';

  const fileNameEl = document.getElementById('csvSelectedFileName');
  if (fileNameEl) fileNameEl.textContent = '';

  const errBox = document.getElementById('csvModalError');
  if (errBox) {
    errBox.textContent = '';
    errBox.style.display = 'none';
  }

  const resultBox = document.getElementById('csvResultSummary');
  if (resultBox) resultBox.style.display = 'none';

  const errorsBox = document.getElementById('csvErrorsBox');
  if (errorsBox) errorsBox.style.display = 'none';

  const uploadBtn = document.getElementById('btnUploadCsv');
  if (uploadBtn) {
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Upload & Import';
  }

  setupCsvDropZone();
  openModal('modalImportCsv');
}

function onCsvFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  handleCsvFile(file);
}

function handleCsvFile(file) {
  if (!file) return;

  const fileName = file.name || '';
  if (!fileName.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
    const errBox = document.getElementById('csvModalError');
    showInlineError(errBox, 'Please select a valid .csv file');
    return;
  }

  selectedCsvFile = file;
  const fileNameEl = document.getElementById('csvSelectedFileName');
  if (fileNameEl) {
    fileNameEl.textContent = `✓ Selected: ${fileName} (${(file.size / 1024).toFixed(1)} KB)`;
  }

  const errBox = document.getElementById('csvModalError');
  if (errBox) errBox.style.display = 'none';

  const uploadBtn = document.getElementById('btnUploadCsv');
  if (uploadBtn) uploadBtn.disabled = false;
}

function setupCsvDropZone() {
  const dropZone = document.getElementById('csvDropZone');
  if (!dropZone || dropZone.dataset.setupDone) return;
  dropZone.dataset.setupDone = 'true';

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dragover');
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const file = dt.files && dt.files[0];
    handleCsvFile(file);
  }, false);
}

async function onImportCsvSubmit(event) {
  event.preventDefault();
  const errBox = document.getElementById('csvModalError');
  if (errBox) errBox.style.display = 'none';

  if (!selectedCsvFile) {
    showInlineError(errBox, 'Please choose a CSV file first');
    return;
  }

  const uploadBtn = document.getElementById('btnUploadCsv');
  if (uploadBtn) {
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Validating & Importing…';
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const textContent = e.target.result;
    try {
      const res = await api('/api/inventory/import', {
        method: 'POST',
        body: { csv: textContent }
      });

      // Render summary
      const resultBox = document.getElementById('csvResultSummary');
      const addedEl = document.getElementById('csvResultAdded');
      const skippedEl = document.getElementById('csvResultSkipped');
      const errorsBox = document.getElementById('csvErrorsBox');
      const errorsList = document.getElementById('csvErrorsList');

      if (resultBox) resultBox.style.display = 'block';
      if (addedEl) addedEl.textContent = `${res.added} Added`;
      if (skippedEl) skippedEl.textContent = `${res.skipped} Skipped`;

      if (res.errors && res.errors.length) {
        if (errorsBox) errorsBox.style.display = 'block';
        if (errorsList) {
          errorsList.innerHTML = res.errors.map(err => 
            `<li><strong>Row ${err.row}:</strong> ${escapeHtml(err.message)}</li>`
          ).join('');
        }
      } else {
        if (errorsBox) errorsBox.style.display = 'none';
      }

      if (res.added > 0) {
        toast(`Imported ${res.added} batch${res.added === 1 ? '' : 'es'} successfully`, 'success');
        await loadBatches();
        await loadDropdownData();
      } else {
        toast(`Import completed: 0 added, ${res.skipped} skipped`, 'warning');
      }
    } catch (err) {
      showInlineError(errBox, err.message);
    } finally {
      if (uploadBtn) {
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload & Import';
      }
    }
  };

  reader.onerror = () => {
    showInlineError(errBox, 'Failed to read selected file');
    if (uploadBtn) {
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload & Import';
    }
  };

  reader.readAsText(selectedCsvFile);
}
