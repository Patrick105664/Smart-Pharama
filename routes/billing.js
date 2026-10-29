// routes/billing.js – Billing preview, checkout and invoice PDF API
const express = require('express');
const router = express.Router();
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const pool = require('../config/db');
const rules = require('../config/rules');
const shop = require('../config/shop');
const { requireLogin } = require('../middleware/auth');

// POST /api/billing/preview
// Body: { items: [ { medicine_id, qty } ] }
// Performs FEFO allocation, auto-split across batches, flash discount with price floor,
// GST breakdown, grand totals, and warnings (prescription, stock, price floor).
router.post('/preview', requireLogin, async (req, res) => {
  try {
    const isOwner = req.session && req.session.user && req.session.user.role === 'owner';
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Request body must contain an items array' });
    }

    if (items.length === 0) {
      return res.json({
        lines: [],
        items: [],
        taxable_total: 0,
        gst_total: 0,
        grand_total: 0,
        warnings: []
      });
    }

    // Validate and combine duplicate medicine_id entries
    const combinedRequests = new Map();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const medId = parseInt(item.medicine_id, 10);
      const qty = Number(item.qty);

      if (!medId || isNaN(medId)) {
        return res.status(400).json({ error: `Item at index ${i} has an invalid medicine_id` });
      }

      if (!Number.isInteger(qty) || qty < 1) {
        return res.status(400).json({ error: `Quantity for medicine ID ${medId} must be an integer of at least 1` });
      }

      combinedRequests.set(medId, (combinedRequests.get(medId) || 0) + qty);
    }

    const allLines = [];
    const itemsSummary = [];
    const warnings = [];

    for (const [medId, requestedQty] of combinedRequests.entries()) {
      // 1. Fetch medicine details
      const [medRows] = await pool.query(
        `SELECT m.id, m.name, m.barcode, m.category_id, c.name AS category_name,
                m.manufacturer, m.gst_percent, m.prescription_required, m.is_active
         FROM medicines m
         JOIN categories c ON m.category_id = c.id
         WHERE m.id = ?`,
        [medId]
      );

      if (!medRows.length || !medRows[0].is_active) {
        warnings.push({
          type: 'not_found',
          medicine_id: medId,
          message: `Medicine with ID ${medId} not found or inactive`
        });
        itemsSummary.push({
          medicine_id: medId,
          medicine_name: medRows.length ? medRows[0].name : 'Unknown',
          requested_qty: requestedQty,
          allocated_qty: 0,
          available_qty: 0,
          blocked: true,
          error: 'Medicine not found or inactive',
          lines: []
        });
        continue;
      }

      const medicine = medRows[0];

      // 2. Prescription warning (warning only, do not block)
      if (medicine.prescription_required) {
        warnings.push({
          type: 'prescription_required',
          medicine_id: medicine.id,
          medicine_name: medicine.name,
          message: `Prescription required for ${medicine.name}`
        });
      }

      // 3. Query sellable batches ordered by FEFO (expiry_date ASC, id ASC)
      // Expired batches (expiry_date < CURDATE()) are strictly excluded
      const [batches] = await pool.query(
        `SELECT 
           b.id, b.medicine_id, b.batch_no, b.qty,
           b.purchase_price, b.selling_price, b.rack_id, b.is_flash_sale,
           r.code AS rack_code,
           DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date,
           DATEDIFF(b.expiry_date, CURDATE()) AS days_left
         FROM batches b
         LEFT JOIN racks r ON b.rack_id = r.id
         WHERE b.medicine_id = ?
           AND b.is_active = 1
           AND b.qty > 0
           AND b.expiry_date >= CURDATE()
         ORDER BY b.expiry_date ASC, b.id ASC`,
        [medicine.id]
      );

      const totalSellableQty = batches.reduce((sum, b) => sum + b.qty, 0);

      // 4. Stock validation
      if (totalSellableQty === 0) {
        warnings.push({
          type: 'no_stock',
          medicine_id: medicine.id,
          medicine_name: medicine.name,
          requested_qty: requestedQty,
          available_qty: 0,
          message: `No sellable stock for ${medicine.name}`
        });
        itemsSummary.push({
          medicine_id: medicine.id,
          medicine_name: medicine.name,
          barcode: medicine.barcode,
          requested_qty: requestedQty,
          allocated_qty: 0,
          available_qty: 0,
          prescription_required: Boolean(medicine.prescription_required),
          blocked: true,
          error: 'No sellable stock',
          lines: []
        });
        continue;
      }

      if (totalSellableQty < requestedQty) {
        warnings.push({
          type: 'insufficient_stock',
          medicine_id: medicine.id,
          medicine_name: medicine.name,
          requested_qty: requestedQty,
          available_qty: totalSellableQty,
          message: `Only ${totalSellableQty} available for ${medicine.name} (requested: ${requestedQty})`
        });
        itemsSummary.push({
          medicine_id: medicine.id,
          medicine_name: medicine.name,
          barcode: medicine.barcode,
          requested_qty: requestedQty,
          allocated_qty: 0,
          available_qty: totalSellableQty,
          prescription_required: Boolean(medicine.prescription_required),
          blocked: true,
          error: `Only ${totalSellableQty} available`,
          lines: []
        });
        continue;
      }

      // 5. FEFO allocation and auto-split across batches
      let needed = requestedQty;
      const itemLines = [];

      for (const batch of batches) {
        if (needed <= 0) break;
        const take = Math.min(batch.qty, needed);
        needed -= take;

        const discountInfo = rules.calculateFlashDiscount(
          batch.days_left,
          batch.selling_price,
          batch.purchase_price,
          batch.is_flash_sale === 1
        );

        const lineTotal = Math.round(discountInfo.unitPrice * take * 100) / 100;
        const gstInfo = rules.calculateGst(lineTotal, medicine.gst_percent);

        const line = {
          medicine_id: medicine.id,
          medicine_name: medicine.name,
          barcode: medicine.barcode,
          category_name: medicine.category_name,
          batch_id: batch.id,
          batch_no: batch.batch_no,
          rack_code: batch.rack_code,
          expiry_date: batch.expiry_date,
          days_left: Number(batch.days_left),
          qty: take,
          mrp: Number(batch.selling_price),
          discount_pct: discountInfo.discountPct,
          unit_price: discountInfo.unitPrice,
          gst_percent: Number(medicine.gst_percent),
          line_total: lineTotal,
          taxable_value: gstInfo.taxableValue,
          gst_amount: gstInfo.gstAmount,
          is_flash_sale: batch.is_flash_sale === 1,
          flash_sale_applied: discountInfo.flashSaleApplied,
          is_floor_applied: discountInfo.isFloorApplied,
          discount_tag: discountInfo.flashSaleApplied ? 'Flash Sale Discount Applied' : null,
          prescription_required: Boolean(medicine.prescription_required)
        };

        // Strict role permission: omit purchase_price for cashier
        if (isOwner) {
          line.purchase_price = Number(batch.purchase_price);
        }

        if (discountInfo.isFloorApplied) {
          warnings.push({
            type: 'price_floor',
            medicine_id: medicine.id,
            medicine_name: medicine.name,
            batch_no: batch.batch_no,
            message: `Price floor reached for ${medicine.name} (Batch ${batch.batch_no}). Sold at cost price.`
          });
        }

        itemLines.push(line);
        allLines.push(line);
      }

      itemsSummary.push({
        medicine_id: medicine.id,
        medicine_name: medicine.name,
        barcode: medicine.barcode,
        requested_qty: requestedQty,
        allocated_qty: requestedQty,
        available_qty: totalSellableQty,
        prescription_required: Boolean(medicine.prescription_required),
        blocked: false,
        lines: itemLines
      });
    }

    // 6. Aggregate totals
    const grandTotal = Math.round(allLines.reduce((acc, l) => acc + l.line_total, 0) * 100) / 100;
    const taxableTotal = Math.round(allLines.reduce((acc, l) => acc + l.taxable_value, 0) * 100) / 100;
    const gstTotal = Math.round(allLines.reduce((acc, l) => acc + l.gst_amount, 0) * 100) / 100;

    res.json({
      lines: allLines,
      items: itemsSummary,
      taxable_total: taxableTotal,
      gst_total: gstTotal,
      grand_total: grandTotal,
      warnings
    });
  } catch (err) {
    console.error('Error during billing preview:', err);
    res.status(500).json({ error: 'Billing preview failed' });
  }
});

// POST /api/billing/checkout
// Body: { items: [ { medicine_id, qty } ], customer_name, customer_phone, payment_mode }
// Returns: { bill_id, bill_no }
// Runs in ONE transaction: locks batches with SELECT ... FOR UPDATE, re-runs FEFO,
// verifies stock, inserts bill + bill_items, deducts batch qty, and commits or rolls back on any error.
router.post('/checkout', requireLogin, async (req, res) => {
  const { items, customer_name, customer_phone, payment_mode } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cart items cannot be empty' });
  }

  // Validate quantities and aggregate by medicine_id
  const combinedRequests = new Map();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const medId = parseInt(item.medicine_id, 10);
    const qty = Number(item.qty);

    if (!medId || isNaN(medId)) {
      return res.status(400).json({ error: `Item at index ${i} has an invalid medicine_id` });
    }

    if (!Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({ error: `Quantity for medicine ID ${medId} must be an integer >= 1` });
    }

    combinedRequests.set(medId, (combinedRequests.get(medId) || 0) + qty);
  }

  const validModes = ['cash', 'upi', 'card'];
  const finalPaymentMode = validModes.includes(payment_mode) ? payment_mode : 'cash';
  const customerName = customer_name ? String(customer_name).trim().slice(0, 100) : null;
  const customerPhone = customer_phone ? String(customer_phone).trim().slice(0, 20) : null;
  const userId = req.session.user.id;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const allBillItems = [];
    const stockUpdates = [];

    for (const [medId, requestedQty] of combinedRequests.entries()) {
      // 1. Lock medicine row
      const [medRows] = await conn.query(
        `SELECT m.id, m.name, m.barcode, m.category_id, m.gst_percent, m.prescription_required, m.is_active
         FROM medicines m
         WHERE m.id = ?
         FOR UPDATE`,
        [medId]
      );

      if (!medRows.length || !medRows[0].is_active) {
        throw new Error(`Medicine ${medId} is not available or inactive`);
      }

      const medicine = medRows[0];

      // 2. Lock sellable batches in FEFO order (expiry_date ASC, id ASC)
      const [batches] = await conn.query(
        `SELECT 
           b.id, b.medicine_id, b.batch_no, b.qty,
           b.purchase_price, b.selling_price, b.rack_id, b.is_flash_sale,
           DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date,
           DATEDIFF(b.expiry_date, CURDATE()) AS days_left
         FROM batches b
         WHERE b.medicine_id = ?
           AND b.is_active = 1
           AND b.qty > 0
           AND b.expiry_date >= CURDATE()
         ORDER BY b.expiry_date ASC, b.id ASC
         FOR UPDATE`,
        [medicine.id]
      );

      const totalSellable = batches.reduce((sum, b) => sum + b.qty, 0);
      if (totalSellable < requestedQty) {
        throw new Error(`Insufficient stock for ${medicine.name}. Requested: ${requestedQty}, Available: ${totalSellable}`);
      }

      // 3. Re-run FEFO allocation
      let needed = requestedQty;
      for (const batch of batches) {
        if (needed <= 0) break;
        const take = Math.min(batch.qty, needed);
        needed -= take;

        const discountInfo = rules.calculateFlashDiscount(
          batch.days_left,
          batch.selling_price,
          batch.purchase_price,
          batch.is_flash_sale === 1
        );

        const lineTotal = Math.round(discountInfo.unitPrice * take * 100) / 100;
        const gstInfo = rules.calculateGst(lineTotal, medicine.gst_percent);

        allBillItems.push({
          batch_id: batch.id,
          medicine_id: medicine.id,
          medicine_name: medicine.name,
          batch_no: batch.batch_no,
          qty: take,
          mrp: Number(batch.selling_price),
          discount_pct: discountInfo.discountPct,
          unit_price: discountInfo.unitPrice,
          gst_percent: Number(medicine.gst_percent),
          line_total: lineTotal,
          taxable_value: gstInfo.taxableValue,
          gst_amount: gstInfo.gstAmount
        });

        stockUpdates.push({ batch_id: batch.id, take });
      }
    }

    if (allBillItems.length === 0) {
      throw new Error('No items allocated for billing');
    }

    // 4. Calculate bill totals
    const grandTotal = Math.round(allBillItems.reduce((acc, l) => acc + l.line_total, 0) * 100) / 100;
    const taxableTotal = Math.round(allBillItems.reduce((acc, l) => acc + l.taxable_value, 0) * 100) / 100;
    const gstTotal = Math.round(allBillItems.reduce((acc, l) => acc + l.gst_amount, 0) * 100) / 100;

    // 5. Generate bill_no (like INV-0001)
    const [lastBill] = await conn.query(
      `SELECT id, bill_no FROM bills ORDER BY id DESC LIMIT 1 FOR UPDATE`
    );

    let nextNum = 1;
    if (lastBill.length > 0) {
      const match = lastBill[0].bill_no.match(/(\d+)$/);
      nextNum = match ? parseInt(match[1], 10) + 1 : lastBill[0].id + 1;
    }

    let billNo = `${rules.billPrefix}${String(nextNum).padStart(4, '0')}`;
    let [existingBill] = await conn.query(`SELECT id FROM bills WHERE bill_no = ?`, [billNo]);
    while (existingBill.length > 0) {
      nextNum++;
      billNo = `${rules.billPrefix}${String(nextNum).padStart(4, '0')}`;
      [existingBill] = await conn.query(`SELECT id FROM bills WHERE bill_no = ?`, [billNo]);
    }

    // 6. Insert bill
    const [billResult] = await conn.query(
      `INSERT INTO bills (bill_no, customer_name, customer_phone, payment_mode, taxable_total, gst_total, grand_total, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [billNo, customerName, customerPhone, finalPaymentMode, taxableTotal, gstTotal, grandTotal, userId]
    );
    const billId = billResult.insertId;

    // 7. Insert bill items (snapshots of medicine name and batch_no)
    for (const item of allBillItems) {
      await conn.query(
        `INSERT INTO bill_items (bill_id, batch_id, medicine_id, medicine_name, batch_no, qty, mrp, discount_pct, unit_price, gst_percent, line_total, taxable_value, gst_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          billId,
          item.batch_id,
          item.medicine_id,
          item.medicine_name,
          item.batch_no,
          item.qty,
          item.mrp,
          item.discount_pct,
          item.unit_price,
          item.gst_percent,
          item.line_total,
          item.taxable_value,
          item.gst_amount
        ]
      );
    }

    // 8. Deduct stock from batches
    for (const update of stockUpdates) {
      await conn.query(
        `UPDATE batches SET qty = qty - ? WHERE id = ?`,
        [update.take, update.batch_id]
      );
    }

    // 9. Commit transaction
    await conn.commit();

    res.status(201).json({
      success: true,
      bill_id: billId,
      bill_no: billNo,
      grand_total: grandTotal
    });
  } catch (err) {
    await conn.rollback();
    console.error('Checkout transaction rolled back:', err.message);
    res.status(400).json({ error: err.message || 'Checkout failed' });
  } finally {
    conn.release();
  }
});

// GET /api/bills/recent (or /api/billing/recent)
// Returns last 10 bills with summary metadata & PDF links
router.get('/recent', requireLogin, async (req, res) => {
  try {
    const sql = `
      SELECT 
        b.id,
        b.bill_no,
        b.customer_name,
        b.customer_phone,
        b.payment_mode,
        b.taxable_total,
        b.gst_total,
        b.grand_total,
        DATE_FORMAT(b.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
        u.full_name AS cashier_name,
        COUNT(bi.id) AS item_count
      FROM bills b
      JOIN users u ON b.created_by = u.id
      LEFT JOIN bill_items bi ON bi.bill_id = b.id
      GROUP BY b.id, u.full_name
      ORDER BY b.id DESC
      LIMIT 10
    `;

    const [rows] = await pool.query(sql);

    const bills = rows.map(b => ({
      id: b.id,
      bill_no: b.bill_no,
      customer_name: b.customer_name || 'Walk-in',
      customer_phone: b.customer_phone || '—',
      payment_mode: b.payment_mode,
      taxable_total: Number(b.taxable_total),
      gst_total: Number(b.gst_total),
      grand_total: Number(b.grand_total),
      item_count: Number(b.item_count),
      cashier_name: b.cashier_name,
      created_at: b.created_at
    }));

    res.json(bills);
  } catch (err) {
    console.error('Error fetching recent bills:', err);
    res.status(500).json({ error: 'Failed to fetch recent bills' });
  }
});

// GET /api/bills/:id/pdf (or /api/billing/:id/pdf)
// Generates and downloads the A4 Tax Invoice PDF using python/invoice_pdf.py (reportlab)
router.get('/:id/pdf', requireLogin, async (req, res) => {
  try {
    const billId = parseInt(req.params.id, 10);
    if (!billId || isNaN(billId)) {
      return res.status(400).json({ error: 'Valid bill ID is required' });
    }

    // 1. Fetch bill details
    const [billRows] = await pool.query(
      `SELECT b.id, b.bill_no, 
              DATE_FORMAT(b.created_at, '%d %b %Y, %h:%i %p') AS created_at,
              b.customer_name, b.customer_phone, b.payment_mode,
              b.taxable_total, b.gst_total, b.grand_total,
              b.created_by, u.full_name AS cashier_name, u.username AS cashier_username
       FROM bills b
       JOIN users u ON b.created_by = u.id
       WHERE b.id = ?`,
      [billId]
    );

    if (billRows.length === 0) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    const bill = billRows[0];

    // 2. Fetch bill items
    const [itemRows] = await pool.query(
      `SELECT id, bill_id, batch_id, medicine_id, medicine_name, batch_no,
              qty, mrp, discount_pct, unit_price, gst_percent,
              line_total, taxable_value, gst_amount
       FROM bill_items
       WHERE bill_id = ?
       ORDER BY id ASC`,
      [billId]
    );

    // 3. Assemble JSON payload
    const payload = {
      shop,
      bill: {
        id: bill.id,
        bill_no: bill.bill_no,
        created_at: bill.created_at,
        customer_name: bill.customer_name,
        customer_phone: bill.customer_phone,
        payment_mode: bill.payment_mode,
        cashier_name: bill.cashier_name || bill.cashier_username,
        taxable_total: Number(bill.taxable_total),
        gst_total: Number(bill.gst_total),
        grand_total: Number(bill.grand_total)
      },
      items: itemRows.map(item => ({
        medicine_name: item.medicine_name,
        batch_no: item.batch_no,
        qty: item.qty,
        mrp: Number(item.mrp),
        discount_pct: Number(item.discount_pct),
        unit_price: Number(item.unit_price),
        gst_percent: Number(item.gst_percent),
        line_total: Number(item.line_total),
        taxable_value: Number(item.taxable_value),
        gst_amount: Number(item.gst_amount)
      }))
    };

    // 4. Temporary PDF file path
    const tempFilePath = path.join(os.tmpdir(), `invoice_${bill.bill_no}_${Date.now()}.pdf`);
    const pythonBin = process.env.PYTHON_BIN || 'python';
    const scriptPath = path.join(__dirname, '../python/invoice_pdf.py');

    // 5. Spawn Python reportlab script
    const pyProcess = spawn(pythonBin, [scriptPath, tempFilePath]);
    let stderrData = '';

    pyProcess.stderr.on('data', chunk => {
      stderrData += chunk.toString();
    });

    pyProcess.on('error', err => {
      console.error('Failed to spawn Python process for invoice PDF:', err);
      if (fs.existsSync(tempFilePath)) fs.unlink(tempFilePath, () => {});
      return res.status(500).json({ error: 'Failed to start PDF generator process' });
    });

    pyProcess.on('close', code => {
      if (code !== 0) {
        console.error(`Python invoice generator exited with code ${code}: ${stderrData}`);
        if (fs.existsSync(tempFilePath)) fs.unlink(tempFilePath, () => {});
        return res.status(500).json({ error: 'Failed to generate PDF', details: stderrData });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="Invoice-${bill.bill_no}.pdf"`);

      res.sendFile(tempFilePath, sendErr => {
        if (sendErr) {
          console.error('Error sending PDF file:', sendErr);
        }
        if (fs.existsSync(tempFilePath)) {
          fs.unlink(tempFilePath, () => {});
        }
      });
    });

    pyProcess.stdin.write(JSON.stringify(payload));
    pyProcess.stdin.end();
  } catch (err) {
    console.error('Error serving invoice PDF:', err);
    res.status(500).json({ error: 'Failed to retrieve invoice PDF' });
  }
});

module.exports = router;

