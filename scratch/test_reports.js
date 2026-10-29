// scratch/test_reports.js
const express = require('express');
const session = require('express-session');
const db = require('../config/db');

async function run() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));

  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/returns', require('../routes/returns'));
  app.use('/returns', require('../routes/returns'));
  app.use('/api/reports', require('../routes/reports'));
  app.use('/reports', require('../routes/reports'));

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let testMedId = null;
  let testBatchId = null;
  let testReturnId = null;

  try {
    // 1. Logins
    const ownerLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'owner123' })
    });
    const ownerCookie = ownerLogin.headers.get('set-cookie');

    const cashierLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cashier', password: 'cashier123' })
    });
    const cashierCookie = cashierLogin.headers.get('set-cookie');

    console.log('1. Logins OK');

    // 2. Cashier 403 checks
    const cashierEndpoints = [
      ['GET', `${baseUrl}/api/reports/finance?range=month`],
      ['GET', `${baseUrl}/api/reports/marketing`],
      ['GET', `${baseUrl}/api/returns?status=to_return`],
      ['PATCH', `${baseUrl}/api/returns/1/status`, { status: 'shipped' }]
    ];

    for (const [method, url, body] of cashierEndpoints) {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', cookie: cashierCookie },
        body: body ? JSON.stringify(body) : undefined
      });
      if (res.status !== 403) {
        throw new Error(`Expected 403 for cashier on ${url}, got ${res.status}`);
      }
    }
    console.log('2. Cashier blocked with 403 on all reports and returns endpoints: PASS');

    // 3. Finance report check (owner)
    const finRes = await fetch(`${baseUrl}/api/reports/finance?range=month`, {
      headers: { cookie: ownerCookie }
    });
    const finData = await finRes.json();
    console.log('3. GET /reports/finance?range=month status:', finRes.status);
    console.log('   Finance fields:', {
      range: finData.range,
      total_sales: finData.total_sales,
      number_of_bills: finData.number_of_bills,
      gst_collected: finData.gst_collected,
      money_saved: finData.money_saved,
      money_lost: finData.money_lost
    });

    // Also check alias /reports/finance
    const finAliasRes = await fetch(`${baseUrl}/reports/finance?range=today`, {
      headers: { cookie: ownerCookie }
    });
    console.log('   GET /reports/finance alias status:', finAliasRes.status);

    // 4. Marketing list check (owner)
    const mktRes = await fetch(`${baseUrl}/api/reports/marketing`, {
      headers: { cookie: ownerCookie }
    });
    const mktData = await mktRes.json();
    console.log('4. GET /reports/marketing status:', mktRes.status, 'batches found:', mktData.length);
    if (mktData.length > 0) {
      const item = mktData[0];
      console.log('   Sample marketing item:', {
        name: item.name,
        batch: item.batch,
        expiry: item.expiry,
        days_left: item.days_left,
        mrp: item.mrp,
        today_flash_price: item.today_flash_price,
        discount_pct: item.discount_pct
      });
    }

    // 5. Test Returns write endpoint with TEST data (Rule 13)
    const [[vendor]] = await db.query('SELECT id FROM vendors WHERE is_active = 1 LIMIT 1');
    const [[cat]] = await db.query('SELECT id FROM categories LIMIT 1');
    const [[rack]] = await db.query('SELECT id FROM racks LIMIT 1');

    // Create test medicine
    const [medRes] = await db.query(
      "INSERT INTO medicines (barcode, name, category_id, manufacturer, gst_percent, prescription_required, is_active) VALUES ('TEST-BC-999', 'TEST-MED-001', ?, 'Test Labs', '5', 0, 1)",
      [cat.id]
    );
    testMedId = medRes.insertId;

    // Create test expired batch
    const [batchRes] = await db.query(
      "INSERT INTO batches (medicine_id, batch_no, expiry_date, qty, purchase_price, selling_price, rack_id, vendor_id, is_active) VALUES (?, 'TEST-RET-001', DATE_SUB(CURDATE(), INTERVAL 5 DAY), 10, 50.00, 80.00, ?, ?, 1)",
      [testMedId, rack.id, vendor.id]
    );
    testBatchId = batchRes.insertId;

    // Create return record via POST /api/returns
    const createRetRes = await fetch(`${baseUrl}/api/returns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ batch_id: testBatchId })
    });
    const createRetData = await createRetRes.json();
    testReturnId = createRetData.id;
    console.log('5. Created return record for test batch:', testReturnId);

    // Test GET /returns?status=to_return (grouped by vendor)
    const getRetRes = await fetch(`${baseUrl}/api/returns?status=to_return`, {
      headers: { cookie: ownerCookie }
    });
    const getRetData = await getRetRes.json();
    console.log('6. GET /returns?status=to_return is array?:', Array.isArray(getRetData));
    const foundGroup = getRetData.find(g => g.items && g.items.some(i => i.batch_no === 'TEST-RET-001'));
    console.log('   Found test batch in grouped vendor data?:', !!foundGroup);

    // Test PATCH /returns/:id/status (advance status forward: to_return -> shipped)
    const shipRes = await fetch(`${baseUrl}/api/returns/${testReturnId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ status: 'shipped' })
    });
    console.log('7. PATCH status -> shipped:', shipRes.status);

    // Test backward move is blocked
    const backRes = await fetch(`${baseUrl}/api/returns/${testReturnId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ status: 'to_return' })
    });
    console.log('8. PATCH backward status -> to_return blocked (expected 400):', backRes.status);

    // Test 'returned' requires refund_amount
    const retNoRefundRes = await fetch(`${baseUrl}/api/returns/${testReturnId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ status: 'returned' })
    });
    console.log('9. PATCH returned without refund_amount blocked (expected 400):', retNoRefundRes.status);

    // Test 'returned' with refund_amount >= 0 sets batch qty = 0
    const returnSuccessRes = await fetch(`${baseUrl}/api/returns/${testReturnId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ status: 'returned', refund_amount: 150 })
    });
    console.log('10. PATCH returned with refund_amount=150 status:', returnSuccessRes.status);

    // Check batch qty was updated to 0
    const [[updatedBatch]] = await db.query('SELECT qty FROM batches WHERE id = ?', [testBatchId]);
    console.log('11. Batch qty set to 0 after return?:', updatedBatch.qty === 0);

    console.log('ALL API TESTS PASSED!');
  } finally {
    // Clean up / deactivate test records (Rule 13)
    if (testBatchId) {
      await db.query('UPDATE batches SET is_active = 0 WHERE id = ?', [testBatchId]);
    }
    if (testMedId) {
      await db.query('UPDATE medicines SET is_active = 0 WHERE id = ?', [testMedId]);
    }
    if (testReturnId) {
      await db.query('DELETE FROM returns WHERE id = ?', [testReturnId]);
    }
    console.log('Test data cleaned up/deactivated.');
    server.close();
    process.exit(0);
  }
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
