// routes/search.js – Global search & billing medicine lookup
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireLogin } = require('../middleware/auth');

// GET /api/search?q=
// Medicines by name or barcode (global search + billing)
// Returns: medicine, category, rx flag, total sellable qty, FEFO batch no + rack code
router.get('/', requireLogin, async (req, res) => {
  try {
    const q = req.query.q ? req.query.q.trim() : '';
    if (!q) {
      return res.json([]);
    }

    const searchTerm = `%${q}%`;

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
        COALESCE(sb.total_sellable_qty, 0) AS total_sellable_qty,
        fb.id AS fefo_batch_id,
        fb.batch_no AS fefo_batch_no,
        fb.rack_code AS fefo_rack_code,
        DATE_FORMAT(fb.expiry_date, '%Y-%m-%d') AS fefo_expiry_date,
        fb.days_left AS fefo_days_left,
        fb.qty AS fefo_qty,
        fb.selling_price AS fefo_selling_price
      FROM medicines m
      JOIN categories c ON m.category_id = c.id
      LEFT JOIN (
        SELECT medicine_id, SUM(qty) AS total_sellable_qty
        FROM batches
        WHERE is_active = 1 AND qty > 0 AND expiry_date >= CURDATE()
        GROUP BY medicine_id
      ) sb ON sb.medicine_id = m.id
      LEFT JOIN (
        SELECT 
          b.id,
          b.medicine_id,
          b.batch_no,
          b.qty,
          b.selling_price,
          r.code AS rack_code,
          b.expiry_date,
          DATEDIFF(b.expiry_date, CURDATE()) AS days_left,
          ROW_NUMBER() OVER (PARTITION BY b.medicine_id ORDER BY b.expiry_date ASC, b.id ASC) AS rn
        FROM batches b
        JOIN racks r ON b.rack_id = r.id
        WHERE b.is_active = 1 AND b.qty > 0 AND b.expiry_date >= CURDATE()
      ) fb ON fb.medicine_id = m.id AND fb.rn = 1
      WHERE m.is_active = 1 AND (m.name LIKE ? OR m.barcode LIKE ?)
      ORDER BY (m.barcode = ?) DESC, m.name ASC
      LIMIT 20
    `;

    const [rows] = await pool.query(sql, [searchTerm, searchTerm, q]);

    const results = rows.map(row => ({
      id: row.id,
      name: row.name,
      barcode: row.barcode,
      category_id: row.category_id,
      category: row.category_name,
      category_name: row.category_name,
      manufacturer: row.manufacturer,
      gst_percent: Number(row.gst_percent),
      prescription_required: Boolean(row.prescription_required),
      rx_required: Boolean(row.prescription_required),
      total_sellable_qty: Number(row.total_sellable_qty),
      fefo_batch_id: row.fefo_batch_id || null,
      fefo_batch_no: row.fefo_batch_no || null,
      fefo_rack_code: row.fefo_rack_code || null,
      fefo_expiry_date: row.fefo_expiry_date || null,
      fefo_days_left: row.fefo_days_left !== null ? Number(row.fefo_days_left) : null,
      selling_price: row.fefo_selling_price !== null ? Number(row.fefo_selling_price) : null
    }));

    res.json(results);
  } catch (err) {
    console.error('Error during medicine search:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
