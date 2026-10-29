// scratch/test_report_pdfs.js
const express = require('express');
const session = require('express-session');
const db = require('../config/db');

async function testReportPdfs() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));

  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/reports', require('../routes/reports'));
  app.use('/reports', require('../routes/reports'));

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

    // 2. Login as cashier to test 403
    const cashierLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cashier', password: 'cashier123' })
    });
    const cashierCookie = cashierLoginRes.headers.get('set-cookie');

    // Check Cashier Blocked
    const cashierCheck = await fetch(`${baseUrl}/api/reports/finance/pdf?range=month`, {
      headers: { cookie: cashierCookie }
    });
    console.log('Cashier blocked status:', cashierCheck.status);

    // Test Finance PDF
    const finRes = await fetch(`${baseUrl}/api/reports/finance/pdf?range=month`, {
      headers: { cookie: ownerCookie }
    });
    const finBuf = await finRes.arrayBuffer();
    const isPdf1 = Buffer.from(finBuf).slice(0, 4).toString() === '%PDF';
    console.log(`Finance PDF: status=${finRes.status}, size=${finBuf.byteLength} bytes, is_pdf=${isPdf1}`);

    // Test Returns PDF
    const retRes = await fetch(`${baseUrl}/api/reports/returns/pdf?status=`, {
      headers: { cookie: ownerCookie }
    });
    const retBuf = await retRes.arrayBuffer();
    const isPdf2 = Buffer.from(retBuf).slice(0, 4).toString() === '%PDF';
    console.log(`Returns PDF: status=${retRes.status}, size=${retBuf.byteLength} bytes, is_pdf=${isPdf2}`);

    // Test Marketing PDF
    const mktRes = await fetch(`${baseUrl}/api/reports/marketing/pdf`, {
      headers: { cookie: ownerCookie }
    });
    const mktBuf = await mktRes.arrayBuffer();
    const isPdf3 = Buffer.from(mktBuf).slice(0, 4).toString() === '%PDF';
    console.log(`Marketing PDF: status=${mktRes.status}, size=${mktBuf.byteLength} bytes, is_pdf=${isPdf3}`);

    if (finRes.status === 200 && finBuf.byteLength > 1000 &&
        retRes.status === 200 && retBuf.byteLength > 1000 &&
        mktRes.status === 200 && mktBuf.byteLength > 1000 &&
        cashierCheck.status === 403) {
      console.log('ALL PDF ROUTES PASSED');
    } else {
      console.error('TESTS FAILED');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Error during test:', err);
    process.exitCode = 1;
  } finally {
    server.close();
    await db.end();
  }
}

testReportPdfs();
