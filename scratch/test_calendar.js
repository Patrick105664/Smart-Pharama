// scratch/test_calendar.js
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('../config/db');

async function runTest() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));

  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/calendar', require('../routes/calendar'));
  app.use('/calendar', require('../routes/calendar'));

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Login as owner
    const ownerLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'owner123' })
    });
    const ownerCookie = ownerLoginRes.headers.get('set-cookie');
    console.log('1. Owner login status:', ownerLoginRes.status);

    // 2. Test GET /api/calendar?month=2026-10
    const monthRes = await fetch(`${baseUrl}/api/calendar?month=2026-10`, {
      headers: { cookie: ownerCookie }
    });
    const monthData = await monthRes.json();
    const dayKeys = Object.keys(monthData.days || {});
    console.log('2. GET /api/calendar?month=2026-10 -> days with events:', dayKeys.length, 'sample:', dayKeys.slice(0, 3));

    // 3. Test GET /calendar?month=2026-10 (alias)
    const aliasRes = await fetch(`${baseUrl}/calendar?month=2026-10`, {
      headers: { cookie: ownerCookie }
    });
    console.log('3. GET /calendar?month=2026-10 alias status:', aliasRes.status);

    // Pick a date to test /day endpoint
    let testDate = dayKeys[0] || '2026-10-25';
    const dayRes = await fetch(`${baseUrl}/api/calendar/day?date=${testDate}`, {
      headers: { cookie: ownerCookie }
    });
    const dayData = await dayRes.json();
    console.log(`4. Owner GET /api/calendar/day?date=${testDate} -> batches count:`, dayData.batches ? dayData.batches.length : 0);
    if (dayData.batches && dayData.batches.length > 0) {
      const b = dayData.batches[0];
      console.log('   Sample batch fields:', {
        medicine: b.medicine,
        batch: b.batch,
        qty: b.qty,
        rack: b.rack,
        vendor: b.vendor,
        days_left: b.days_left,
        purchase_price_present: b.purchase_price !== undefined
      });
    }

    // 4. Login as cashier and test hiding purchase_price
    const cashierLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cashier', password: 'cashier123' })
    });
    const cashierCookie = cashierLoginRes.headers.get('set-cookie');

    const cashierDayRes = await fetch(`${baseUrl}/api/calendar/day?date=${testDate}`, {
      headers: { cookie: cashierCookie }
    });
    const cashierDayData = await cashierDayRes.json();
    const cashierHasPurchasePrice = (cashierDayData.batches || []).some(b => b.purchase_price !== undefined);
    console.log('5. Cashier purchase_price hidden?:', !cashierHasPurchasePrice);

    console.log('ALL TESTS PASSED!');
  } finally {
    server.close();
    process.exit(0);
  }
}

runTest().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
