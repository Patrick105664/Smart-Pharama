// routes/batches.js – Batches read and inventory API
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const rules = require('../config/rules');
const { requireLogin, requireOwner } = require('../middleware/auth');

// GET /api/batches?category=&vendor=&sort=expiry_asc&q=&showInactive=
// Inventory table rows; hides purchase_price for cashier
router.get('/', requireLogin, async (req, res) => {
  try {
    const isOwner = req.session && req.session.user && req.session.user.role === 'owner';
    const { category, vendor, sort, q, showInactive } = req.query;

    const whereClauses = [];
    const params = [];

    // Inactive filter: by default only show active batches and active medicines
    const allowInactive = showInactive === 'true' || showInactive === '1';
    if (!allowInactive) {
      whereClauses.push('b.is_active = 1 AND m.is_active = 1');
    }

    // Category filter (by id or by name)
    if (category) {
      if (/^\d+$/.test(category)) {
        whereClauses.push('m.category_id = ?');
        params.push(parseInt(category, 10));
      } else {
        whereClauses.push('c.name = ?');
        params.push(category);
      }
    }

    // Vendor filter (by id or by name)
    if (vendor) {
      if (/^\d+$/.test(vendor)) {
        whereClauses.push('b.vendor_id = ?');
        params.push(parseInt(vendor, 10));
      } else {
        whereClauses.push('v.name = ?');
        params.push(vendor);
      }
    }

    // Search query q (matches medicine name, barcode, or batch number)
    if (q && q.trim()) {
      const searchTerm = `%${q.trim()}%`;
      whereClauses.push('(m.name LIKE ? OR m.barcode LIKE ? OR b.batch_no LIKE ?)');
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Sorting
    let orderBy = 'b.expiry_date ASC, b.id ASC';
    switch (sort) {
      case 'expiry_desc':
        orderBy = 'b.expiry_date DESC, b.id ASC';
        break;
      case 'qty_asc':
        orderBy = 'b.qty ASC, b.expiry_date ASC';
        break;
      case 'qty_desc':
        orderBy = 'b.qty DESC, b.expiry_date ASC';
        break;
      case 'name_asc':
        orderBy = 'm.name ASC, b.expiry_date ASC';
        break;
      case 'name_desc':
        orderBy = 'm.name DESC, b.expiry_date ASC';
        break;
      case 'mrp_asc':
        orderBy = 'b.selling_price ASC, b.expiry_date ASC';
        break;
      case 'mrp_desc':
        orderBy = 'b.selling_price DESC, b.expiry_date ASC';
        break;
      case 'expiry_asc':
      default:
        orderBy = 'b.expiry_date ASC, b.id ASC';
        break;
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const sql = `
      SELECT 
        b.id,
        b.medicine_id,
        m.name AS medicine_name,
        m.barcode,
        m.category_id,
        c.name AS category_name,
        m.manufacturer,
        m.gst_percent,
        m.prescription_required,
        m.is_active AS medicine_is_active,
        b.batch_no,
        DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date,
        DATEDIFF(b.expiry_date, CURDATE()) AS days_left,
        b.qty,
        b.selling_price,
        b.purchase_price,
        b.rack_id,
        r.code AS rack_code,
        b.vendor_id,
        v.name AS vendor_name,
        b.is_flash_sale,
        b.is_active,
        DATE_FORMAT(b.received_date, '%Y-%m-%d') AS received_date
      FROM batches b
      JOIN medicines m ON b.medicine_id = m.id
      JOIN categories c ON m.category_id = c.id
      JOIN racks r ON b.rack_id = r.id
      JOIN vendors v ON b.vendor_id = v.id
      ${whereSql}
      ORDER BY ${orderBy}
    `;

    const [rows] = await pool.query(sql, params);

    const result = rows.map(row => {
      const daysLeft = Number(row.days_left);
      let expiryStatus = 'green';
      if (daysLeft < rules.expiryYellowMin) {
        expiryStatus = 'red';
      } else if (daysLeft <= rules.expiryYellowMax) {
        expiryStatus = 'yellow';
      }

      const item = {
        id: row.id,
        medicine_id: row.medicine_id,
        medicine_name: row.medicine_name,
        barcode: row.barcode,
        category_id: row.category_id,
        category_name: row.category_name,
        manufacturer: row.manufacturer,
        gst_percent: Number(row.gst_percent),
        prescription_required: Boolean(row.prescription_required),
        batch_no: row.batch_no,
        expiry_date: row.expiry_date,
        days_left: daysLeft,
        expiry_status: expiryStatus,
        qty: row.qty,
        selling_price: row.selling_price,
        rack_id: row.rack_id,
        rack_code: row.rack_code,
        vendor_id: row.vendor_id,
        vendor_name: row.vendor_name,
        is_flash_sale: Boolean(row.is_flash_sale),
        is_active: Boolean(row.is_active),
        medicine_is_active: Boolean(row.medicine_is_active),
        received_date: row.received_date
      };

      // Strict role check: cashier must never see purchase_price
      if (isOwner) {
        item.purchase_price = row.purchase_price;
      }

      return item;
    });

    res.json(result);
  } catch (err) {
    console.error('Error fetching batches:', err);
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
});

// GET /api/batches/:id - fetch single batch details (owner only)
router.get('/:id', requireOwner, async (req, res) => {
  try {
    const batchId = parseInt(req.params.id, 10);
    if (!batchId || isNaN(batchId)) {
      return res.status(400).json({ error: 'Valid batch ID is required' });
    }

    const sql = `
      SELECT 
        b.id,
        b.medicine_id,
        m.name AS medicine_name,
        m.barcode,
        m.category_id,
        c.name AS category_name,
        m.manufacturer,
        m.gst_percent,
        m.prescription_required,
        b.batch_no,
        DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date,
        DATEDIFF(b.expiry_date, CURDATE()) AS days_left,
        b.qty,
        b.selling_price,
        b.purchase_price,
        b.rack_id,
        r.code AS rack_code,
        b.vendor_id,
        v.name AS vendor_name,
        b.is_flash_sale,
        b.is_active,
        DATE_FORMAT(b.received_date, '%Y-%m-%d') AS received_date
      FROM batches b
      JOIN medicines m ON b.medicine_id = m.id
      JOIN categories c ON m.category_id = c.id
      JOIN racks r ON b.rack_id = r.id
      JOIN vendors v ON b.vendor_id = v.id
      WHERE b.id = ?
    `;

    const [rows] = await pool.query(sql, [batchId]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const row = rows[0];
    res.json({
      id: row.id,
      medicine_id: row.medicine_id,
      medicine_name: row.medicine_name,
      barcode: row.barcode,
      category_id: row.category_id,
      category_name: row.category_name,
      manufacturer: row.manufacturer,
      gst_percent: Number(row.gst_percent),
      prescription_required: Boolean(row.prescription_required),
      batch_no: row.batch_no,
      expiry_date: row.expiry_date,
      days_left: Number(row.days_left),
      qty: row.qty,
      selling_price: row.selling_price,
      purchase_price: row.purchase_price,
      rack_id: row.rack_id,
      rack_code: row.rack_code,
      vendor_id: row.vendor_id,
      vendor_name: row.vendor_name,
      is_flash_sale: Boolean(row.is_flash_sale),
      is_active: Boolean(row.is_active),
      received_date: row.received_date
    });
  } catch (err) {
    console.error('Error fetching single batch:', err);
    res.status(500).json({ error: 'Failed to fetch batch' });
  }
});

// POST /api/batches - create batch (and medicine if barcode is new; owner only)
router.post('/', requireOwner, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const {
      barcode,
      medicine_id,
      name,
      category_id,
      manufacturer,
      gst_percent,
      prescription_required,
      batch_no,
      expiry_date,
      qty,
      purchase_price,
      selling_price,
      rack_id,
      vendor_id
    } = req.body;

    // 1. Resolve medicine
    let resolvedMedId = medicine_id ? parseInt(medicine_id, 10) : null;

    if (!resolvedMedId && barcode && typeof barcode === 'string' && barcode.trim()) {
      const cleanBarcode = barcode.trim();
      const [existingMed] = await connection.query('SELECT id FROM medicines WHERE barcode = ?', [cleanBarcode]);
      if (existingMed.length) {
        resolvedMedId = existingMed[0].id;
      } else {
        // Create medicine
        if (!name || typeof name !== 'string' || !name.trim()) {
          await connection.rollback();
          return res.status(400).json({ error: 'Medicine name is required for new medicine' });
        }
        const catId = parseInt(category_id, 10);
        if (!catId || isNaN(catId)) {
          await connection.rollback();
          return res.status(400).json({ error: 'Valid category_id is required for new medicine' });
        }
        const [catCheck] = await connection.query('SELECT id FROM categories WHERE id = ?', [catId]);
        if (!catCheck.length) {
          await connection.rollback();
          return res.status(400).json({ error: 'Category does not exist' });
        }

        const gstVal = gst_percent !== undefined ? String(gst_percent) : '5';
        if (!rules.validGst.map(String).includes(gstVal)) {
          await connection.rollback();
          return res.status(400).json({ error: `Invalid GST percent. Allowed: ${rules.validGst.join(', ')}` });
        }

        const rxVal = prescription_required ? 1 : 0;
        const mfgVal = manufacturer && typeof manufacturer === 'string' ? manufacturer.trim() : null;

        const [medResult] = await connection.query(
          'INSERT INTO medicines (barcode, name, category_id, manufacturer, gst_percent, prescription_required, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
          [cleanBarcode, name.trim(), catId, mfgVal, gstVal, rxVal]
        );
        resolvedMedId = medResult.insertId;
      }
    }

    if (!resolvedMedId) {
      await connection.rollback();
      return res.status(400).json({ error: 'Valid medicine_id or barcode is required' });
    }

    // Verify medicine exists
    const [medCheck] = await connection.query('SELECT id FROM medicines WHERE id = ?', [resolvedMedId]);
    if (!medCheck.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Medicine not found' });
    }

    // 2. Validate batch fields
    if (!batch_no || typeof batch_no !== 'string' || !batch_no.trim()) {
      await connection.rollback();
      return res.status(400).json({ error: 'Batch number is required' });
    }
    const cleanBatchNo = batch_no.trim();

    if (!expiry_date || typeof expiry_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expiry_date.trim())) {
      await connection.rollback();
      return res.status(400).json({ error: 'Valid expiry date (YYYY-MM-DD) is required' });
    }
    const cleanExpiry = expiry_date.trim();

    // Check expiry date not in the past
    const [dateDiffRows] = await connection.query('SELECT DATEDIFF(?, CURDATE()) AS days_left', [cleanExpiry]);
    if (dateDiffRows[0].days_left < 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Expiry date cannot be in the past' });
    }

    const numQty = Number(qty);
    if (qty === undefined || isNaN(numQty) || numQty < 0 || !Number.isInteger(numQty)) {
      await connection.rollback();
      return res.status(400).json({ error: 'Quantity must be an integer greater than or equal to 0' });
    }

    const numPurchase = Number(purchase_price);
    if (purchase_price === undefined || isNaN(numPurchase) || numPurchase <= 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Purchase price must be greater than 0' });
    }

    const numSelling = Number(selling_price);
    if (selling_price === undefined || isNaN(numSelling) || numSelling <= 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Selling price must be greater than 0' });
    }

    if (numSelling < numPurchase) {
      await connection.rollback();
      return res.status(400).json({ error: 'Selling price cannot be less than purchase price' });
    }

    const numRack = parseInt(rack_id, 10);
    if (!numRack || isNaN(numRack)) {
      await connection.rollback();
      return res.status(400).json({ error: 'Valid rack_id is required' });
    }
    const [rackCheck] = await connection.query('SELECT id FROM racks WHERE id = ?', [numRack]);
    if (!rackCheck.length) {
      await connection.rollback();
      return res.status(400).json({ error: 'Rack does not exist' });
    }

    const numVendor = parseInt(vendor_id, 10);
    if (!numVendor || isNaN(numVendor)) {
      await connection.rollback();
      return res.status(400).json({ error: 'Valid vendor_id is required' });
    }
    const [vendorCheck] = await connection.query('SELECT id FROM vendors WHERE id = ?', [numVendor]);
    if (!vendorCheck.length) {
      await connection.rollback();
      return res.status(400).json({ error: 'Vendor does not exist' });
    }

    // 3. Duplicate check (medicine_id + batch_no)
    const [dupCheck] = await connection.query(
      'SELECT id FROM batches WHERE medicine_id = ? AND batch_no = ?',
      [resolvedMedId, cleanBatchNo]
    );
    if (dupCheck.length) {
      await connection.rollback();
      return res.status(400).json({ error: 'This batch already exists. Edit the existing batch instead.' });
    }

    // 4. Insert batch
    const [batchResult] = await connection.query(
      'INSERT INTO batches (medicine_id, batch_no, expiry_date, qty, purchase_price, selling_price, rack_id, vendor_id, is_flash_sale, is_active, received_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, CURDATE())',
      [resolvedMedId, cleanBatchNo, cleanExpiry, numQty, numPurchase, numSelling, numRack, numVendor]
    );

    await connection.commit();

    res.status(201).json({
      success: true,
      id: batchResult.insertId,
      medicine_id: resolvedMedId,
      message: 'Batch created successfully'
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error creating batch:', err);
    res.status(500).json({ error: 'Failed to create batch' });
  } finally {
    connection.release();
  }
});

// PUT /api/batches/:id - update an existing batch (owner only)
router.put('/:id', requireOwner, async (req, res) => {
  try {
    const batchId = parseInt(req.params.id, 10);
    if (!batchId || isNaN(batchId)) {
      return res.status(400).json({ error: 'Valid batch ID is required' });
    }

    const [existingRows] = await pool.query('SELECT * FROM batches WHERE id = ?', [batchId]);
    if (!existingRows.length) {
      return res.status(404).json({ error: 'Batch not found' });
    }
    const existing = existingRows[0];

    const {
      batch_no,
      expiry_date,
      qty,
      purchase_price,
      selling_price,
      rack_id,
      vendor_id
    } = req.body;

    const newBatchNo = batch_no !== undefined ? String(batch_no).trim() : existing.batch_no;
    if (!newBatchNo) {
      return res.status(400).json({ error: 'Batch number cannot be empty' });
    }

    // Check duplicate if batch_no changed
    if (newBatchNo !== existing.batch_no) {
      const [dup] = await pool.query(
        'SELECT id FROM batches WHERE medicine_id = ? AND batch_no = ? AND id != ?',
        [existing.medicine_id, newBatchNo, batchId]
      );
      if (dup.length) {
        return res.status(400).json({ error: 'This batch already exists. Edit the existing batch instead.' });
      }
    }

    let newExpiry = existing.expiry_date;
    if (expiry_date !== undefined) {
      const trimmedExp = String(expiry_date).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedExp)) {
        return res.status(400).json({ error: 'Valid expiry date (YYYY-MM-DD) is required' });
      }
      newExpiry = trimmedExp;
    }

    const newQty = qty !== undefined ? Number(qty) : existing.qty;
    if (isNaN(newQty) || newQty < 0 || !Number.isInteger(newQty)) {
      return res.status(400).json({ error: 'Quantity must be an integer greater than or equal to 0' });
    }

    const newPurchase = purchase_price !== undefined ? Number(purchase_price) : Number(existing.purchase_price);
    if (isNaN(newPurchase) || newPurchase <= 0) {
      return res.status(400).json({ error: 'Purchase price must be greater than 0' });
    }

    const newSelling = selling_price !== undefined ? Number(selling_price) : Number(existing.selling_price);
    if (isNaN(newSelling) || newSelling <= 0) {
      return res.status(400).json({ error: 'Selling price must be greater than 0' });
    }

    if (newSelling < newPurchase) {
      return res.status(400).json({ error: 'Selling price cannot be less than purchase price' });
    }

    const newRackId = rack_id !== undefined ? parseInt(rack_id, 10) : existing.rack_id;
    if (rack_id !== undefined) {
      const [rackCheck] = await pool.query('SELECT id FROM racks WHERE id = ?', [newRackId]);
      if (!rackCheck.length) {
        return res.status(400).json({ error: 'Rack does not exist' });
      }
    }

    const newVendorId = vendor_id !== undefined ? parseInt(vendor_id, 10) : existing.vendor_id;
    if (vendor_id !== undefined) {
      const [vendorCheck] = await pool.query('SELECT id FROM vendors WHERE id = ?', [newVendorId]);
      if (!vendorCheck.length) {
        return res.status(400).json({ error: 'Vendor does not exist' });
      }
    }

    await pool.query(
      'UPDATE batches SET batch_no = ?, expiry_date = ?, qty = ?, purchase_price = ?, selling_price = ?, rack_id = ?, vendor_id = ? WHERE id = ?',
      [newBatchNo, newExpiry, newQty, newPurchase, newSelling, newRackId, newVendorId, batchId]
    );

    res.json({ success: true, message: 'Batch updated successfully' });
  } catch (err) {
    console.error('Error updating batch:', err);
    res.status(500).json({ error: 'Failed to update batch' });
  }
});

// PATCH /api/batches/:id/active - toggle/set batch active state (owner only)
router.patch('/:id/active', requireOwner, async (req, res) => {
  try {
    const batchId = parseInt(req.params.id, 10);
    if (!batchId || isNaN(batchId)) {
      return res.status(400).json({ error: 'Valid batch ID is required' });
    }

    const [existing] = await pool.query('SELECT id, is_active FROM batches WHERE id = ?', [batchId]);
    if (!existing.length) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    let newActive;
    if (req.body.is_active !== undefined) {
      newActive = req.body.is_active ? 1 : 0;
    } else if (req.body.active !== undefined) {
      newActive = req.body.active ? 1 : 0;
    } else {
      newActive = existing[0].is_active ? 0 : 1;
    }

    await pool.query('UPDATE batches SET is_active = ? WHERE id = ?', [newActive, batchId]);

    res.json({
      success: true,
      id: batchId,
      is_active: newActive,
      message: `Batch ${newActive ? 'activated' : 'deactivated'} successfully`
    });
  } catch (err) {
    console.error('Error updating batch active status:', err);
    res.status(500).json({ error: 'Failed to update batch active status' });
  }
});

// POST /api/batches/:id/flash-sale - start or stop flash sale (yellow batches only; owner only)
router.post('/:id/flash-sale', requireOwner, async (req, res) => {
  try {
    const batchId = parseInt(req.params.id, 10);
    if (!batchId || isNaN(batchId)) {
      return res.status(400).json({ error: 'Valid batch ID is required' });
    }

    const [existing] = await pool.query(
      'SELECT id, is_active, qty, DATEDIFF(expiry_date, CURDATE()) AS days_left FROM batches WHERE id = ?',
      [batchId]
    );
    if (!existing.length) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const batch = existing[0];
    const turnOn = req.body.on === true || req.body.on === 1 || req.body.on === 'true';

    if (turnOn) {
      const daysLeft = Number(batch.days_left);
      // Flash sale is only allowed for YELLOW batches (0 <= days_left <= 30)
      if (daysLeft < rules.expiryYellowMin || daysLeft > rules.expiryYellowMax) {
        return res.status(400).json({
          error: `Flash sale is only allowed for batches expiring soon (${rules.expiryYellowMin} to ${rules.expiryYellowMax} days left)`
        });
      }

      if (!batch.is_active || batch.qty <= 0) {
        return res.status(400).json({ error: 'Flash sale is only allowed for active batches with stock' });
      }

      await pool.query('UPDATE batches SET is_flash_sale = 1 WHERE id = ?', [batchId]);
      return res.json({ success: true, id: batchId, is_flash_sale: 1, message: 'Flash sale started' });
    } else {
      await pool.query('UPDATE batches SET is_flash_sale = 0 WHERE id = ?', [batchId]);
      return res.json({ success: true, id: batchId, is_flash_sale: 0, message: 'Flash sale stopped' });
    }
  } catch (err) {
    console.error('Error toggling flash sale:', err);
    res.status(500).json({ error: 'Failed to toggle flash sale' });
  }
});

module.exports = router;

