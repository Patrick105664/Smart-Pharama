// routes/calendar.js – Visual Calendar API
const router = require('express').Router();
const db = require('../config/db');
const { requireLogin } = require('../middleware/auth');
const rules = require('../config/rules');

// All calendar endpoints require login
router.use(requireLogin);

// GET /api/calendar/day?date=YYYY-MM-DD
// Returns batch details for a given day (expiring or entering 30-day warning)
// Only active batches with qty > 0. Hide purchase_price from cashier.
router.get('/day', async (req, res) => {
  try {
    let date = req.query.date;
    if (!date) {
      const [[cur]] = await db.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today");
      date = cur.today;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format, use YYYY-MM-DD' });
    }

    const isOwner = req.session.user && req.session.user.role === 'owner';
    const warningOffset = Number(rules.warningDaysOffset) || 30;

    const [rows] = await db.query(`
      SELECT
        b.id AS batch_id,
        m.name AS medicine,
        m.name AS medicine_name,
        b.batch_no AS batch,
        b.batch_no,
        b.qty,
        r.code AS rack,
        r.code AS rack_code,
        v.name AS vendor,
        v.name AS vendor_name,
        DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date,
        DATEDIFF(b.expiry_date, CURDATE()) AS days_left,
        b.selling_price,
        b.purchase_price,
        CASE
          WHEN b.expiry_date = ? THEN 'expiring'
          WHEN DATE_SUB(b.expiry_date, INTERVAL ? DAY) = ? THEN 'warning_start'
          ELSE 'other'
        END AS event_type
      FROM batches b
      JOIN medicines m ON m.id = b.medicine_id
      JOIN racks r ON r.id = b.rack_id
      JOIN vendors v ON v.id = b.vendor_id
      WHERE b.is_active = 1
        AND b.qty > 0
        AND (b.expiry_date = ? OR DATE_SUB(b.expiry_date, INTERVAL ? DAY) = ?)
      ORDER BY (CASE WHEN b.expiry_date = ? THEN 0 ELSE 1 END), m.name ASC, b.batch_no ASC
    `, [date, warningOffset, date, date, warningOffset, date, date]);

    const batches = rows.map(row => {
      const item = { ...row };
      if (!isOwner) {
        delete item.purchase_price;
      }
      return item;
    });

    res.json({
      date,
      batches
    });
  } catch (err) {
    console.error('Calendar day error:', err);
    res.status(500).json({ error: 'Failed to load calendar day batches' });
  }
});

// GET /api/calendar?month=YYYY-MM
// Returns per-day counts for a given month:
// red = batches expiring that day
// yellow = batches whose 30-day warning starts that day (expiry minus 30 days)
// Only active batches with qty > 0.
router.get('/', async (req, res) => {
  // If browser navigated directly without month query, redirect to calendar.html
  if (req.headers.accept && req.headers.accept.includes('text/html') && !req.xhr && !req.query.month) {
    return res.redirect('/calendar.html');
  }

  try {
    let month = req.query.month;
    if (!month) {
      const [[cur]] = await db.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m') AS cur_month");
      month = cur.cur_month;
    } else if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format, use YYYY-MM' });
    }

    const warningOffset = Number(rules.warningDaysOffset) || 30;

    const [redRows] = await db.query(`
      SELECT DATE_FORMAT(expiry_date, '%Y-%m-%d') AS date, COUNT(*) AS count
      FROM batches
      WHERE is_active = 1 AND qty > 0 AND DATE_FORMAT(expiry_date, '%Y-%m') = ?
      GROUP BY expiry_date
    `, [month]);

    const [yellowRows] = await db.query(`
      SELECT DATE_FORMAT(DATE_SUB(expiry_date, INTERVAL ? DAY), '%Y-%m-%d') AS date, COUNT(*) AS count
      FROM batches
      WHERE is_active = 1 AND qty > 0 AND DATE_FORMAT(DATE_SUB(expiry_date, INTERVAL ? DAY), '%Y-%m') = ?
      GROUP BY date
    `, [warningOffset, warningOffset, month]);

    const days = {};
    for (const row of redRows) {
      if (!days[row.date]) days[row.date] = { red: 0, yellow: 0 };
      days[row.date].red = Number(row.count);
    }
    for (const row of yellowRows) {
      if (!days[row.date]) days[row.date] = { red: 0, yellow: 0 };
      days[row.date].yellow = Number(row.count);
    }

    res.json({
      month,
      days
    });
  } catch (err) {
    console.error('Calendar month error:', err);
    res.status(500).json({ error: 'Failed to load calendar month data' });
  }
});

module.exports = router;
