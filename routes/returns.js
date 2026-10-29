// routes/returns.js – Returns to distributor
const router = require('express').Router();
const db = require('../config/db');
const { requireLogin, requireOwner } = require('../middleware/auth');

// POST /api/returns – create a return record (owner only, RED batches, no duplicates)
router.post('/', requireOwner, async (req, res) => {
  const { batch_id } = req.body;
  if (!batch_id) return res.status(400).json({ error: 'batch_id required' });

  try {
    // Verify batch exists, is active, qty > 0, and is RED (expired)
    const [[batch]] = await db.query(
      'SELECT id, qty, purchase_price, vendor_id, DATEDIFF(expiry_date, CURDATE()) AS days_left FROM batches WHERE id = ? AND is_active = 1',
      [batch_id]
    );
    if (!batch) return res.status(404).json({ error: 'Batch not found or inactive' });
    if (batch.qty <= 0) return res.status(400).json({ error: 'Batch has no stock' });
    if (batch.days_left >= 0) return res.status(400).json({ error: 'Only expired (RED) batches can be added to the return list' });

    // Check for existing active return record
    const [[existing]] = await db.query(
      "SELECT id FROM returns WHERE batch_id = ? AND status != 'returned'",
      [batch_id]
    );
    if (existing) return res.status(409).json({ error: 'A return record already exists for this batch' });

    const cost_value = batch.qty * Number(batch.purchase_price);
    const [result] = await db.query(
      "INSERT INTO returns (batch_id, vendor_id, qty, cost_value, status) VALUES (?, ?, ?, ?, 'to_return')",
      [batch_id, batch.vendor_id, batch.qty, cost_value]
    );
    res.status(201).json({ id: result.insertId, message: 'Added to return list' });
  } catch (err) {
    console.error('POST /returns error:', err);
    res.status(500).json({ error: 'Failed to create return record' });
  }
});

// GET /api/returns – list returns grouped by vendor (owner only)
router.get('/', requireOwner, async (req, res) => {
  const { status, flat } = req.query;
  try {
    let sql = `
      SELECT r.id, r.batch_id, r.vendor_id, r.qty, r.cost_value, r.status, r.refund_amount,
        r.created_at, r.updated_at,
        m.name AS medicine_name, b.batch_no,
        DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date,
        v.name AS vendor_name
      FROM returns r
      JOIN batches b ON b.id = r.batch_id
      JOIN medicines m ON m.id = b.medicine_id
      JOIN vendors v ON v.id = r.vendor_id
    `;
    const params = [];
    if (status) { sql += ' WHERE r.status = ?'; params.push(status); }
    sql += ' ORDER BY v.name ASC, r.created_at DESC';
    const [rows] = await db.query(sql, params);

    if (flat === 'true' || flat === '1') {
      return res.json(rows);
    }

    // Group returns by vendor
    const vendorMap = {};
    for (const r of rows) {
      if (!vendorMap[r.vendor_id]) {
        vendorMap[r.vendor_id] = {
          vendor_id: r.vendor_id,
          vendor_name: r.vendor_name,
          items: [],
          total_qty: 0,
          total_cost: 0
        };
      }
      vendorMap[r.vendor_id].items.push(r);
      vendorMap[r.vendor_id].total_qty += Number(r.qty);
      vendorMap[r.vendor_id].total_cost += Number(r.cost_value);
    }
    const grouped = Object.values(vendorMap);

    res.json(grouped);
  } catch (err) {
    console.error('GET /returns error:', err);
    res.status(500).json({ error: 'Failed to load returns' });
  }
});

// PATCH /api/returns/:id/status – advance status (owner only)
router.patch('/:id/status', requireOwner, async (req, res) => {
  const { id } = req.params;
  const { status, refund_amount } = req.body;
  const valid = ['shipped', 'returned'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  try {
    const [[ret]] = await db.query('SELECT * FROM returns WHERE id = ?', [id]);
    if (!ret) return res.status(404).json({ error: 'Return not found' });

    // Forward-only: to_return -> shipped -> returned
    const order = ['to_return', 'shipped', 'returned'];
    if (order.indexOf(status) <= order.indexOf(ret.status)) {
      return res.status(400).json({ error: 'Status can only move forward' });
    }

    if (status === 'returned') {
      if (refund_amount == null || isNaN(Number(refund_amount)) || Number(refund_amount) < 0) {
        return res.status(400).json({ error: 'refund_amount (>= 0) required when marking returned' });
      }
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(
          "UPDATE returns SET status = 'returned', refund_amount = ?, updated_at = NOW() WHERE id = ?",
          [Number(refund_amount), id]
        );
        await conn.query('UPDATE batches SET qty = 0 WHERE id = ?', [ret.batch_id]);
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    } else {
      await db.query(
        'UPDATE returns SET status = ?, updated_at = NOW() WHERE id = ?',
        [status, id]
      );
    }
    res.json({ message: 'Status updated' });
  } catch (err) {
    console.error('PATCH /returns/:id/status error:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

module.exports = router;
