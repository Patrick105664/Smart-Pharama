// routes/reports.js – Owner-only report APIs
const router = require('express').Router();
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const db = require('../config/db');
const { requireOwner } = require('../middleware/auth');
const rules = require('../config/rules');
const shop = require('../config/shop');

// All reports routes are owner only (cashier blocked with 403)
router.use(requireOwner);

// ── Query Helpers (shared between JSON APIs and PDF generators) ──────────

async function getFinanceData(range = 'month') {
  // Build SQL date conditions based on range
  let billDateCond = '1=1';
  let expiredBatchCond = 'b.expiry_date <= CURDATE()';
  let returnDateCond = '1=1';

  if (range === 'today') {
    billDateCond = 'DATE(b.created_at) = CURDATE()';
    expiredBatchCond = 'b.expiry_date = CURDATE()';
    returnDateCond = 'DATE(r.updated_at) = CURDATE()';
  } else if (range === '7d') {
    billDateCond = 'DATE(b.created_at) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) AND DATE(b.created_at) <= CURDATE()';
    expiredBatchCond = 'b.expiry_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) AND b.expiry_date <= CURDATE()';
    returnDateCond = 'DATE(r.updated_at) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) AND DATE(r.updated_at) <= CURDATE()';
  } else if (range === 'month') {
    billDateCond = "DATE_FORMAT(b.created_at, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')";
    expiredBatchCond = "DATE_FORMAT(b.expiry_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m') AND b.expiry_date <= CURDATE()";
    returnDateCond = "DATE_FORMAT(r.updated_at, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')";
  } else if (range === 'all') {
    billDateCond = '1=1';
    expiredBatchCond = 'b.expiry_date <= CURDATE()';
    returnDateCond = '1=1';
  }

  // 1. Total sales, bill count, GST collected
  const [[billStats]] = await db.query(`
    SELECT
      COALESCE(SUM(b.grand_total), 0) AS total_sales,
      COUNT(*) AS number_of_bills,
      COALESCE(SUM(b.gst_total), 0) AS gst_collected
    FROM bills b
    WHERE ${billDateCond}
  `);

  // 2. Money Saved by Flash Sales = sum(line_total) of bill_items where discount_pct > 0
  const [[savedStats]] = await db.query(`
    SELECT COALESCE(SUM(bi.line_total), 0) AS money_saved
    FROM bill_items bi
    JOIN bills b ON b.id = bi.bill_id
    WHERE bi.discount_pct > 0
      AND ${billDateCond}
  `);

  // 3. Money Lost to Expiry:
  // (a) Expired active batches with qty > 0 filtered by expiry_date in range
  const [[expiredStats]] = await db.query(`
    SELECT COALESCE(SUM(b.qty * b.purchase_price), 0) AS expired_batch_loss
    FROM batches b
    WHERE b.is_active = 1
      AND b.qty > 0
      AND ${expiredBatchCond}
  `);

  // (b) Returned loss = sum(cost_value - refund_amount) over returns with status 'returned' filtered by updated_at in range
  const [[returnStats]] = await db.query(`
    SELECT COALESCE(SUM(r.cost_value - COALESCE(r.refund_amount, 0)), 0) AS returned_loss
    FROM returns r
    WHERE r.status = 'returned'
      AND ${returnDateCond}
  `);

  const totalSales = Number(billStats.total_sales);
  const numberOfBills = Number(billStats.number_of_bills);
  const gstCollected = Number(billStats.gst_collected);
  const moneySaved = Number(savedStats.money_saved);
  const expiredBatchLoss = Number(expiredStats.expired_batch_loss);
  const returnedLoss = Number(returnStats.returned_loss);
  const moneyLost = Number((expiredBatchLoss + returnedLoss).toFixed(2));

  return {
    range,
    total_sales: totalSales,
    totalSales,
    number_of_bills: numberOfBills,
    numberOfBills,
    gst_collected: gstCollected,
    gstCollected,
    money_saved: moneySaved,
    moneySaved,
    money_saved_by_flash_sales: moneySaved,
    money_lost: moneyLost,
    moneyLost,
    money_lost_to_expiry: moneyLost,
    expired_batch_loss: expiredBatchLoss,
    returned_loss: returnedLoss
  };
}

async function getMarketingData() {
  const [rows] = await db.query(`
    SELECT
      b.id AS batch_id,
      b.id,
      m.name,
      m.name AS medicine_name,
      b.batch_no,
      b.batch_no AS batch,
      DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry,
      DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date,
      DATEDIFF(b.expiry_date, CURDATE()) AS days_left,
      b.selling_price AS mrp,
      b.purchase_price,
      b.qty,
      b.is_flash_sale,
      r.code AS rack
    FROM batches b
    JOIN medicines m ON m.id = b.medicine_id
    JOIN racks r ON r.id = b.rack_id
    WHERE b.is_active = 1
      AND b.qty > 0
      AND DATEDIFF(b.expiry_date, CURDATE()) BETWEEN 0 AND 30
    ORDER BY DATEDIFF(b.expiry_date, CURDATE()) ASC, m.name ASC
  `);

  const tiers = rules.flashSaleTiers || [
    { minDays: 15, maxDays: 30, discountPct: 10 },
    { minDays: 8,  maxDays: 14, discountPct: 20 },
    { minDays: 0,  maxDays: 7,  discountPct: 30 }
  ];

  return rows.map(r => {
    const daysLeft = Number(r.days_left);
    let nominalPct = 0;
    for (const t of tiers) {
      if (daysLeft >= t.minDays && daysLeft <= t.maxDays) {
        nominalPct = t.discountPct;
        break;
      }
    }

    const mrp = Number(r.mrp);
    const cost = Number(r.purchase_price);
    let flashPrice = Math.round(mrp * (1 - nominalPct / 100) * 100) / 100;
    // Purchase price floor
    if (flashPrice < cost) {
      flashPrice = cost;
    }

    return {
      id: r.id,
      batch_id: r.batch_id,
      name: r.name,
      medicine_name: r.medicine_name,
      batch: r.batch,
      batch_no: r.batch_no,
      expiry: r.expiry,
      expiry_date: r.expiry_date,
      days_left: daysLeft,
      mrp: mrp,
      selling_price: mrp,
      flash_price: flashPrice,
      today_flash_price: flashPrice,
      discount_pct: nominalPct,
      qty: r.qty,
      rack: r.rack,
      is_flash_sale: r.is_flash_sale
    };
  });
}

async function getReturnsData(status = '') {
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
  if (status) {
    sql += ' WHERE r.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY v.name ASC, r.created_at DESC';
  const [rows] = await db.query(sql, params);
  return rows;
}

// ── Stream PDF helper (follows invoice_pdf.py child_process pattern) ─────

function streamReportPdf(payload, filename, res) {
  const tempFilePath = path.join(os.tmpdir(), `report_${filename}_${Date.now()}.pdf`);
  const pythonBin = process.env.PYTHON_BIN || 'python';
  const scriptPath = path.join(__dirname, '../python/report_pdf.py');

  const pyProcess = spawn(pythonBin, [scriptPath, tempFilePath]);
  let stderrData = '';

  pyProcess.stderr.on('data', chunk => {
    stderrData += chunk.toString();
  });

  pyProcess.on('error', err => {
    console.error('Failed to spawn Python process for report PDF:', err);
    if (fs.existsSync(tempFilePath)) fs.unlink(tempFilePath, () => {});
    return res.status(500).json({ error: 'Failed to start PDF generator process' });
  });

  pyProcess.on('close', code => {
    if (code !== 0) {
      console.error(`Python report generator exited with code ${code}: ${stderrData}`);
      if (fs.existsSync(tempFilePath)) fs.unlink(tempFilePath, () => {});
      return res.status(500).json({ error: 'Failed to generate PDF', details: stderrData });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}.pdf"`);

    res.sendFile(tempFilePath, sendErr => {
      if (sendErr) {
        console.error('Error sending report PDF file:', sendErr);
      }
      if (fs.existsSync(tempFilePath)) {
        fs.unlink(tempFilePath, () => {});
      }
    });
  });

  pyProcess.stdin.write(JSON.stringify(payload));
  pyProcess.stdin.end();
}

// ── Route Handlers ───────────────────────────────────────────────────────

// GET /api/reports/finance?range=today|7d|month|all
router.get('/finance', async (req, res) => {
  try {
    const range = req.query.range || 'month';
    const data = await getFinanceData(range);
    res.json(data);
  } catch (err) {
    console.error('GET /reports/finance error:', err);
    res.status(500).json({ error: 'Failed to generate finance report' });
  }
});

// GET /api/reports/finance/pdf?range=today|7d|month|all
router.get('/finance/pdf', async (req, res) => {
  try {
    const range = req.query.range || 'month';
    const financeData = await getFinanceData(range);
    const payload = {
      type: 'finance',
      shop,
      finance: financeData
    };
    streamReportPdf(payload, `Financial_Report_${range}`, res);
  } catch (err) {
    console.error('GET /reports/finance/pdf error:', err);
    res.status(500).json({ error: 'Failed to generate finance PDF' });
  }
});

// GET /api/reports/returns/pdf?status=to_return|shipped|returned
router.get('/returns/pdf', async (req, res) => {
  try {
    const status = req.query.status || '';
    const returnsData = await getReturnsData(status);
    const payload = {
      type: 'returns',
      shop,
      status: status || 'all',
      returns: returnsData
    };
    streamReportPdf(payload, `Distributor_Returns_${status || 'all'}`, res);
  } catch (err) {
    console.error('GET /reports/returns/pdf error:', err);
    res.status(500).json({ error: 'Failed to generate returns PDF' });
  }
});

// GET /api/reports/marketing -> yellow batches with current tier price
router.get('/marketing', async (req, res) => {
  try {
    const result = await getMarketingData();
    res.json(result);
  } catch (err) {
    console.error('GET /reports/marketing error:', err);
    res.status(500).json({ error: 'Failed to generate marketing list' });
  }
});

// GET /api/reports/marketing/pdf
router.get('/marketing/pdf', async (req, res) => {
  try {
    const marketingData = await getMarketingData();
    const payload = {
      type: 'marketing',
      shop,
      batches: marketingData
    };
    streamReportPdf(payload, 'Marketing_List_Yellow_Batches', res);
  } catch (err) {
    console.error('GET /reports/marketing/pdf error:', err);
    res.status(500).json({ error: 'Failed to generate marketing PDF' });
  }
});

module.exports = router;
