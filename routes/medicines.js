// routes/medicines.js – Medicines CRUD & barcode lookup
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const rules = require('../config/rules');
const { requireLogin, requireOwner } = require('../middleware/auth');

// GET /api/medicines - list medicines
// Reads for both owner and cashier
router.get('/', requireLogin, async (req, res) => {
  try {
    const { q, category, showInactive } = req.query;
    const whereClauses = [];
    const params = [];

    const allowInactive = showInactive === 'true' || showInactive === '1';
    if (!allowInactive) {
      whereClauses.push('m.is_active = 1');
    }

    if (category) {
      if (/^\d+$/.test(category)) {
        whereClauses.push('m.category_id = ?');
        params.push(parseInt(category, 10));
      } else {
        whereClauses.push('c.name = ?');
        params.push(category);
      }
    }

    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      whereClauses.push('(m.name LIKE ? OR m.barcode LIKE ?)');
      params.push(term, term);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const sql = `
      SELECT 
        m.id,
        m.barcode,
        m.name,
        m.category_id,
        c.name AS category_name,
        m.manufacturer,
        m.gst_percent,
        m.prescription_required,
        m.is_active,
        DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
      FROM medicines m
      JOIN categories c ON m.category_id = c.id
      ${whereSql}
      ORDER BY m.name ASC
    `;

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching medicines:', err);
    res.status(500).json({ error: 'Failed to fetch medicines' });
  }
});

// GET /api/medicines/by-barcode/:code - lookup medicine by barcode
// Reads for both owner and cashier
router.get('/by-barcode/:code', requireLogin, async (req, res) => {
  try {
    const barcode = req.params.code ? req.params.code.trim() : '';
    if (!barcode) {
      return res.status(400).json({ error: 'Barcode parameter is required' });
    }

    const sql = `
      SELECT 
        m.id,
        m.barcode,
        m.name,
        m.category_id,
        c.name AS category_name,
        m.manufacturer,
        m.gst_percent,
        m.prescription_required,
        m.is_active,
        DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
      FROM medicines m
      JOIN categories c ON m.category_id = c.id
      WHERE m.barcode = ?
    `;

    const [rows] = await pool.query(sql, [barcode]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Medicine not found with this barcode', found: false });
    }

    const med = rows[0];
    res.json({
      found: true,
      id: med.id,
      barcode: med.barcode,
      name: med.name,
      category_id: med.category_id,
      category_name: med.category_name,
      manufacturer: med.manufacturer,
      gst_percent: Number(med.gst_percent),
      prescription_required: Boolean(med.prescription_required),
      is_active: Boolean(med.is_active),
      created_at: med.created_at
    });
  } catch (err) {
    console.error('Error fetching medicine by barcode:', err);
    res.status(500).json({ error: 'Failed to lookup medicine by barcode' });
  }
});

// POST /api/medicines - create a medicine directly (owner only)
router.post('/', requireOwner, async (req, res) => {
  try {
    const { barcode, name, category_id, manufacturer, gst_percent, prescription_required } = req.body;

    if (!barcode || typeof barcode !== 'string' || !barcode.trim()) {
      return res.status(400).json({ error: 'Barcode is required' });
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Medicine name is required' });
    }
    const catId = parseInt(category_id, 10);
    if (!catId || isNaN(catId)) {
      return res.status(400).json({ error: 'Valid category_id is required' });
    }

    // Check category exists
    const [catRows] = await pool.query('SELECT id FROM categories WHERE id = ?', [catId]);
    if (!catRows.length) {
      return res.status(400).json({ error: 'Category does not exist' });
    }

    // Validate GST percent against rules
    const gstVal = gst_percent !== undefined ? String(gst_percent) : '5';
    if (!rules.validGst.map(String).includes(gstVal)) {
      return res.status(400).json({ error: `Invalid GST percent. Allowed: ${rules.validGst.join(', ')}` });
    }

    // Check duplicate barcode
    const [existing] = await pool.query('SELECT id FROM medicines WHERE barcode = ?', [barcode.trim()]);
    if (existing.length) {
      return res.status(400).json({ error: 'A medicine with this barcode already exists' });
    }

    const rxRequired = prescription_required ? 1 : 0;
    const cleanManufacturer = manufacturer && typeof manufacturer === 'string' ? manufacturer.trim() : null;

    const [result] = await pool.query(
      'INSERT INTO medicines (barcode, name, category_id, manufacturer, gst_percent, prescription_required, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
      [barcode.trim(), name.trim(), catId, cleanManufacturer, gstVal, rxRequired]
    );

    res.status(201).json({
      success: true,
      id: result.insertId,
      message: 'Medicine created successfully'
    });
  } catch (err) {
    console.error('Error creating medicine:', err);
    res.status(500).json({ error: 'Failed to create medicine' });
  }
});

// PUT /api/medicines/:id - update a medicine (owner only)
router.put('/:id', requireOwner, async (req, res) => {
  try {
    const medId = parseInt(req.params.id, 10);
    if (!medId || isNaN(medId)) {
      return res.status(400).json({ error: 'Valid medicine ID is required' });
    }

    const [existingMed] = await pool.query('SELECT * FROM medicines WHERE id = ?', [medId]);
    if (!existingMed.length) {
      return res.status(404).json({ error: 'Medicine not found' });
    }

    const { barcode, name, category_id, manufacturer, gst_percent, prescription_required } = req.body;

    const newBarcode = barcode !== undefined ? String(barcode).trim() : existingMed[0].barcode;
    const newName = name !== undefined ? String(name).trim() : existingMed[0].name;
    const newCatId = category_id !== undefined ? parseInt(category_id, 10) : existingMed[0].category_id;
    const newManufacturer = manufacturer !== undefined ? (manufacturer ? String(manufacturer).trim() : null) : existingMed[0].manufacturer;
    const newGst = gst_percent !== undefined ? String(gst_percent) : existingMed[0].gst_percent;
    const newRx = prescription_required !== undefined ? (prescription_required ? 1 : 0) : existingMed[0].prescription_required;

    if (!newBarcode) {
      return res.status(400).json({ error: 'Barcode cannot be empty' });
    }
    if (!newName) {
      return res.status(400).json({ error: 'Medicine name cannot be empty' });
    }
    if (!rules.validGst.map(String).includes(newGst)) {
      return res.status(400).json({ error: `Invalid GST percent. Allowed: ${rules.validGst.join(', ')}` });
    }

    // Check category exists
    const [catRows] = await pool.query('SELECT id FROM categories WHERE id = ?', [newCatId]);
    if (!catRows.length) {
      return res.status(400).json({ error: 'Category does not exist' });
    }

    // Check duplicate barcode
    const [barcodeConflict] = await pool.query('SELECT id FROM medicines WHERE barcode = ? AND id != ?', [newBarcode, medId]);
    if (barcodeConflict.length) {
      return res.status(400).json({ error: 'A medicine with this barcode already exists' });
    }

    await pool.query(
      'UPDATE medicines SET barcode = ?, name = ?, category_id = ?, manufacturer = ?, gst_percent = ?, prescription_required = ? WHERE id = ?',
      [newBarcode, newName, newCatId, newManufacturer, newGst, newRx, medId]
    );

    res.json({ success: true, message: 'Medicine updated successfully' });
  } catch (err) {
    console.error('Error updating medicine:', err);
    res.status(500).json({ error: 'Failed to update medicine' });
  }
});

// PATCH /api/medicines/:id/active - toggle/set medicine active state (owner only)
router.patch('/:id/active', requireOwner, async (req, res) => {
  try {
    const medId = parseInt(req.params.id, 10);
    if (!medId || isNaN(medId)) {
      return res.status(400).json({ error: 'Valid medicine ID is required' });
    }

    const [existing] = await pool.query('SELECT id, is_active FROM medicines WHERE id = ?', [medId]);
    if (!existing.length) {
      return res.status(404).json({ error: 'Medicine not found' });
    }

    let newActive;
    if (req.body.is_active !== undefined) {
      newActive = req.body.is_active ? 1 : 0;
    } else if (req.body.active !== undefined) {
      newActive = req.body.active ? 1 : 0;
    } else {
      newActive = existing[0].is_active ? 0 : 1;
    }

    await pool.query('UPDATE medicines SET is_active = ? WHERE id = ?', [newActive, medId]);

    res.json({
      success: true,
      id: medId,
      is_active: newActive,
      message: `Medicine ${newActive ? 'activated' : 'deactivated'} successfully`
    });
  } catch (err) {
    console.error('Error updating medicine active status:', err);
    res.status(500).json({ error: 'Failed to update medicine active status' });
  }
});

module.exports = router;
