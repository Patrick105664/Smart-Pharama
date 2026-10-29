// routes/dashboard.js
const router = require('express').Router();
const db = require('../config/db');
const { requireLogin } = require('../middleware/auth');
const rules = require('../config/rules');

router.use(requireLogin);

// GET /api/dashboard
router.get('/', async (req, res) => {
  const isOwner = req.session.user.role === 'owner';
  try {
    const [donutRows] = await db.query(`
      SELECT
        SUM(CASE WHEN DATEDIFF(expiry_date, CURDATE()) < 0 THEN 1 ELSE 0 END) AS red_count,
        SUM(CASE WHEN DATEDIFF(expiry_date, CURDATE()) BETWEEN 0 AND 30 THEN 1 ELSE 0 END) AS yellow_count,
        SUM(CASE WHEN DATEDIFF(expiry_date, CURDATE()) > 30 THEN 1 ELSE 0 END) AS green_count
      FROM batches WHERE is_active = 1 AND qty > 0
    `);
    const donut = donutRows[0];

    const [[settingRow]] = await db.query("SELECT value FROM settings WHERE `key` = 'low_stock_min'");
    const lowStockMin = settingRow ? Number(settingRow.value) : rules.lowStockMin;

    const [[lowStockCountRow]] = await db.query(`
      SELECT COUNT(*) AS cnt FROM (
        SELECT m.id FROM medicines m
        JOIN batches b ON b.medicine_id = m.id AND b.is_active = 1 AND DATEDIFF(b.expiry_date, CURDATE()) >= 0
        WHERE m.is_active = 1 GROUP BY m.id HAVING COALESCE(SUM(b.qty), 0) < ?
        UNION
        SELECT m.id FROM medicines m WHERE m.is_active = 1
          AND NOT EXISTS (SELECT 1 FROM batches b2 WHERE b2.medicine_id = m.id AND b2.is_active = 1 AND DATEDIFF(b2.expiry_date, CURDATE()) >= 0)
      ) sub
    `, [lowStockMin]);
    const lowStockCount = Number(lowStockCountRow.cnt);

    const [[yellowCountRow]] = await db.query(
      'SELECT COUNT(*) AS cnt FROM batches WHERE is_active = 1 AND qty > 0 AND DATEDIFF(expiry_date, CURDATE()) BETWEEN 0 AND 30'
    );
    const yellowCount = Number(yellowCountRow.cnt);

    let moneyData = {};
    if (isOwner) {
      const [[revRow]] = await db.query('SELECT COALESCE(SUM(grand_total), 0) AS revenue FROM bills WHERE DATE(created_at) = CURDATE()');
      moneyData.todayRevenue = Number(revRow.revenue);
      const [[carRow]] = await db.query('SELECT COALESCE(SUM(qty * purchase_price), 0) AS capital_at_risk FROM batches WHERE is_active = 1 AND qty > 0 AND DATEDIFF(expiry_date, CURDATE()) <= 30');
      moneyData.capitalAtRisk = Number(carRow.capital_at_risk);
      const [[savedRow]] = await db.query('SELECT COALESCE(SUM(line_total), 0) AS saved FROM bill_items WHERE discount_pct > 0');
      moneyData.moneySaved = Number(savedRow.saved);
      const [[lostBatchRow]] = await db.query('SELECT COALESCE(SUM(qty * purchase_price), 0) AS lost_batch FROM batches WHERE is_active = 1 AND qty > 0 AND DATEDIFF(expiry_date, CURDATE()) < 0');
      const [[lostRetRow]] = await db.query("SELECT COALESCE(SUM(cost_value - COALESCE(refund_amount, 0)), 0) AS lost_ret FROM returns WHERE status = 'returned'");
      moneyData.moneyLost = Number(lostBatchRow.lost_batch) + Number(lostRetRow.lost_ret);
    }

    const [actionRows] = await db.query(`
      SELECT b.id AS batch_id, m.name AS medicine_name, b.batch_no, b.expiry_date,
        DATEDIFF(b.expiry_date, CURDATE()) AS days_left, b.is_flash_sale, b.vendor_id,
        (SELECT COUNT(*) FROM returns r WHERE r.batch_id = b.id AND r.status != 'returned') AS in_return_list
      FROM batches b JOIN medicines m ON m.id = b.medicine_id
      WHERE b.is_active = 1 AND b.qty > 0 AND DATEDIFF(b.expiry_date, CURDATE()) <= 30
      ORDER BY days_left ASC, b.id ASC LIMIT 10
    `);

    const [[expiredRow]] = await db.query('SELECT COUNT(*) AS cnt FROM batches WHERE is_active = 1 AND qty > 0 AND DATEDIFF(expiry_date, CURDATE()) < 0');
    const [[todayRow]]   = await db.query('SELECT COUNT(*) AS cnt FROM batches WHERE is_active = 1 AND qty > 0 AND DATEDIFF(expiry_date, CURDATE()) = 0');
    const [[warningRow]] = await db.query('SELECT COUNT(*) AS cnt FROM batches WHERE is_active = 1 AND qty > 0 AND DATEDIFF(expiry_date, CURDATE()) BETWEEN 28 AND 30');

    const alerts = [];
    if (Number(expiredRow.cnt) > 0) alerts.push({ type: 'expired', message: expiredRow.cnt + ' batch' + (expiredRow.cnt > 1 ? 'es' : '') + ' expired' });
    if (Number(todayRow.cnt) > 0)   alerts.push({ type: 'today',   message: todayRow.cnt   + ' batch' + (todayRow.cnt   > 1 ? 'es' : '') + ' expiring today' });
    if (Number(warningRow.cnt) > 0) alerts.push({ type: 'warning', message: warningRow.cnt + ' batch' + (warningRow.cnt > 1 ? 'es' : '') + ' entered the warning period in the last 3 days' });
    if (lowStockCount > 0)          alerts.push({ type: 'lowstock', message: lowStockCount  + ' medicine' + (lowStockCount > 1 ? 's' : '') + ' below minimum stock' });

    const cards = {
      yellowCount,
      lowStockCount,
      ...(isOwner ? {
        todayRevenue:  moneyData.todayRevenue,
        capitalAtRisk: moneyData.capitalAtRisk,
        moneySaved:    moneyData.moneySaved,
        moneyLost:     moneyData.moneyLost
      } : {})
    };

    res.json({
      cards,
      donut: { red: Number(donut.red_count)||0, yellow: Number(donut.yellow_count)||0, green: Number(donut.green_count)||0 },
      actions: actionRows.map(r => ({
        batchId: r.batch_id, medicineName: r.medicine_name, batchNo: r.batch_no,
        expiryDate: r.expiry_date, daysLeft: r.days_left,
        isFlashSale: !!r.is_flash_sale, inReturnList: r.in_return_list > 0, vendorId: r.vendor_id
      })),
      alerts
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// GET /api/dashboard/low-stock
router.get('/low-stock', async (req, res) => {
  try {
    const [[settingRow]] = await db.query("SELECT value FROM settings WHERE `key` = 'low_stock_min'");
    const lowStockMin = settingRow ? Number(settingRow.value) : rules.lowStockMin;
    const [rows] = await db.query(`
      SELECT m.id, m.name, m.barcode, c.name AS category, COALESCE(SUM(b.qty), 0) AS total_qty
      FROM medicines m
      LEFT JOIN categories c ON c.id = m.category_id
      LEFT JOIN batches b ON b.medicine_id = m.id AND b.is_active = 1 AND DATEDIFF(b.expiry_date, CURDATE()) >= 0
      WHERE m.is_active = 1
      GROUP BY m.id, m.name, m.barcode, c.name
      HAVING total_qty < ?
      ORDER BY total_qty ASC, m.name ASC
    `, [lowStockMin]);
    res.json({ lowStockMin, items: rows });
  } catch (err) {
    console.error('Low stock error:', err);
    res.status(500).json({ error: 'Failed to load low stock list' });
  }
});

module.exports = router;
