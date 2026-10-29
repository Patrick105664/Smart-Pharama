// routes/vendors.js – Vendor management CRUD
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireLogin, requireOwner } = require('../middleware/auth');

// GET /api/vendors - list vendors (reads for both owner and cashier)
// Supports ?showInactive=true or ?all=true
router.get('/', requireLogin, async (req, res) => {
  try {
    const showInactive = req.query.showInactive === 'true' || req.query.all === 'true' || req.query.showInactive === '1';
    let query = 'SELECT id, name, phone, email, address, is_active FROM vendors';
    if (!showInactive) {
      query += ' WHERE is_active = 1';
    }
    query += ' ORDER BY name ASC';

    const [rows] = await pool.query(query);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching vendors:', err);
    res.status(500).json({ error: 'Failed to fetch vendors' });
  }
});

// POST /api/vendors - create a new vendor (owner only)
router.post('/', requireOwner, async (req, res) => {
  try {
    const { name, phone, email, address } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Vendor name is required' });
    }

    const [result] = await pool.query(
      'INSERT INTO vendors (name, phone, email, address, is_active) VALUES (?, ?, ?, ?, 1)',
      [name.trim(), phone ? phone.trim() : null, email ? email.trim() : null, address ? address.trim() : null]
    );

    res.status(201).json({
      success: true,
      id: result.insertId,
      message: 'Vendor created successfully'
    });
  } catch (err) {
    console.error('Error creating vendor:', err);
    res.status(500).json({ error: 'Failed to create vendor' });
  }
});

// PUT /api/vendors/:id (or PUT /api/vendors with body.id) - update vendor (owner only)
router.put('/:id?', requireOwner, async (req, res) => {
  try {
    const vendorId = parseInt(req.params.id || req.body.id, 10);
    if (!vendorId || isNaN(vendorId)) {
      return res.status(400).json({ error: 'Valid vendor ID is required' });
    }

    const { name, phone, email, address } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Vendor name is required' });
    }

    const [existing] = await pool.query('SELECT id FROM vendors WHERE id = ?', [vendorId]);
    if (!existing.length) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    await pool.query(
      'UPDATE vendors SET name = ?, phone = ?, email = ?, address = ? WHERE id = ?',
      [name.trim(), phone ? phone.trim() : null, email ? email.trim() : null, address ? address.trim() : null, vendorId]
    );

    res.json({ success: true, message: 'Vendor updated successfully' });
  } catch (err) {
    console.error('Error updating vendor:', err);
    res.status(500).json({ error: 'Failed to update vendor' });
  }
});

// PATCH /api/vendors/:id/active - toggle or set vendor active state (owner only)
router.patch('/:id/active', requireOwner, async (req, res) => {
  try {
    const vendorId = parseInt(req.params.id, 10);
    if (!vendorId || isNaN(vendorId)) {
      return res.status(400).json({ error: 'Valid vendor ID is required' });
    }

    const [existing] = await pool.query('SELECT id, is_active FROM vendors WHERE id = ?', [vendorId]);
    if (!existing.length) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    let newActive;
    if (req.body.is_active !== undefined) {
      newActive = req.body.is_active ? 1 : 0;
    } else if (req.body.active !== undefined) {
      newActive = req.body.active ? 1 : 0;
    } else {
      newActive = existing[0].is_active ? 0 : 1;
    }

    await pool.query('UPDATE vendors SET is_active = ? WHERE id = ?', [newActive, vendorId]);

    res.json({
      success: true,
      id: vendorId,
      is_active: newActive,
      message: `Vendor ${newActive ? 'activated' : 'deactivated'} successfully`
    });
  } catch (err) {
    console.error('Error updating vendor active status:', err);
    res.status(500).json({ error: 'Failed to update vendor active status' });
  }
});

module.exports = router;
