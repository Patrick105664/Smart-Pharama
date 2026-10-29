// routes/inventory.js – CSV import & template download
const express = require('express');
const router = express.Router();
const path = require('path');
const { spawn } = require('child_process');
const pool = require('../config/db');
const { requireOwner } = require('../middleware/auth');

// GET /api/inventory/import/template - sample CSV download
router.get('/import/template', requireOwner, (req, res) => {
  const csvTemplate = 
`barcode,name,category,manufacturer,gst_percent,prescription_required,batch_no,expiry_date,qty,purchase_price,selling_price,rack,vendor_name
8901234567890,Paracetamol 500mg,Tablets,Cipla,5,no,BATCH-001,2027-12-31,100,15.00,25.00,A1,Apex Pharmaceuticals
8901234567891,Amoxicillin 250mg,Capsules,Sun Pharma,12,yes,BATCH-002,2027-06-30,50,30.00,45.00,B2,Carewell Distributors
`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="inventory_template.csv"');
  res.send(csvTemplate);
});

// POST /api/inventory/import - validate and import batches/medicines (owner only)
router.post('/import', requireOwner, async (req, res) => {
  try {
    const csvContent = req.body.csv;
    if (!csvContent || typeof csvContent !== 'string' || !csvContent.trim()) {
      return res.status(400).json({ error: 'CSV content is required' });
    }

    const pythonBin = process.env.PYTHON_BIN || 'python';
    const scriptPath = path.join(__dirname, '../python/csv_validate.py');

    // Run python validator with child_process
    const pyProcess = spawn(pythonBin, [scriptPath]);
    let stdoutData = '';
    let stderrData = '';

    pyProcess.stdout.on('data', chunk => {
      stdoutData += chunk.toString();
    });
    pyProcess.stderr.on('data', chunk => {
      stderrData += chunk.toString();
    });

    const pyResult = await new Promise((resolve, reject) => {
      pyProcess.on('error', err => reject(err));
      pyProcess.on('close', code => {
        if (code !== 0) {
          return reject(new Error(`Python validator exited with code ${code}: ${stderrData}`));
        }
        try {
          const parsed = JSON.parse(stdoutData.trim());
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Invalid JSON from validator: ${stdoutData}`));
        }
      });

      pyProcess.stdin.write(csvContent);
      pyProcess.stdin.end();
    });

    const { valid_rows = [], errors: formatErrors = [] } = pyResult;
    const allErrors = [...formatErrors];
    let addedCount = 0;

    // Preload vendors, categories, and racks for efficiency
    const [vendors] = await pool.query('SELECT id, name FROM vendors');
    const [categories] = await pool.query('SELECT id, name FROM categories');
    const [racks] = await pool.query('SELECT id, code FROM racks');

    const vendorMap = new Map();
    vendors.forEach(v => vendorMap.set(v.name.toLowerCase().trim(), v.id));

    const categoryMap = new Map();
    categories.forEach(c => categoryMap.set(c.name.toLowerCase().trim(), c.id));

    const rackMap = new Map();
    racks.forEach(r => rackMap.set(r.code.toUpperCase().trim(), r.id));

    // Process valid rows
    for (const row of valid_rows) {
      const rowNum = row.row_num;
      const vNameKey = row.vendor_name.toLowerCase().trim();
      const vendorId = vendorMap.get(vNameKey);

      if (!vendorId) {
        allErrors.push({ row: rowNum, message: `Vendor "${row.vendor_name}" does not exist in database` });
        continue;
      }

      const cNameKey = row.category.toLowerCase().trim();
      const categoryId = categoryMap.get(cNameKey);
      if (!categoryId) {
        allErrors.push({ row: rowNum, message: `Category "${row.category}" does not exist in database` });
        continue;
      }

      const rackKey = row.rack.toUpperCase().trim();
      const rackId = rackMap.get(rackKey);
      if (!rackId) {
        allErrors.push({ row: rowNum, message: `Rack "${row.rack}" does not exist in database` });
        continue;
      }

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // Check medicine by barcode
        const [medRows] = await connection.query(
          'SELECT id, name FROM medicines WHERE barcode = ?',
          [row.barcode]
        );

        let medicineId = null;
        if (medRows.length > 0) {
          const existingMed = medRows[0];
          if (existingMed.name.trim().toLowerCase() !== row.name.trim().toLowerCase()) {
            await connection.rollback();
            allErrors.push({
              row: rowNum,
              message: `Barcode "${row.barcode}" is already registered to "${existingMed.name}"`
            });
            continue;
          }
          medicineId = existingMed.id;
        } else {
          // Create new medicine
          const [newMedResult] = await connection.query(
            'INSERT INTO medicines (barcode, name, category_id, manufacturer, gst_percent, prescription_required, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
            [row.barcode, row.name, categoryId, row.manufacturer || null, String(row.gst_percent), row.prescription_required]
          );
          medicineId = newMedResult.insertId;
        }

        // Check duplicate batch (medicine_id + batch_no)
        const [dupBatch] = await connection.query(
          'SELECT id FROM batches WHERE medicine_id = ? AND batch_no = ?',
          [medicineId, row.batch_no]
        );

        if (dupBatch.length > 0) {
          await connection.rollback();
          allErrors.push({
            row: rowNum,
            message: `Batch "${row.batch_no}" already exists for "${row.name}"`
          });
          continue;
        }

        // Insert batch
        await connection.query(
          'INSERT INTO batches (medicine_id, batch_no, expiry_date, qty, purchase_price, selling_price, rack_id, vendor_id, is_flash_sale, is_active, received_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, CURDATE())',
          [medicineId, row.batch_no, row.expiry_date, row.qty, row.purchase_price, row.selling_price, rackId, vendorId]
        );

        await connection.commit();
        addedCount++;
      } catch (err) {
        await connection.rollback();
        allErrors.push({
          row: rowNum,
          message: `Database error inserting row: ${err.message}`
        });
      } finally {
        connection.release();
      }
    }

    allErrors.sort((a, b) => a.row - b.row);

    res.json({
      success: true,
      added: addedCount,
      skipped: allErrors.length,
      errors: allErrors
    });
  } catch (err) {
    console.error('CSV import error:', err);
    res.status(500).json({ error: `Import failed: ${err.message}` });
  }
});

module.exports = router;
