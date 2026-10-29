// server.js – Express app entry point
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();

// Body parsing
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'spm-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 8  // 8 hours
  }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/batches', require('./routes/batches'));
app.use('/api/medicines', require('./routes/medicines'));
app.use('/api/vendors', require('./routes/vendors'));
app.use('/api/racks', require('./routes/racks'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/search', require('./routes/search'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/bills', require('./routes/billing'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/returns', require('./routes/returns'));
app.use('/returns', require('./routes/returns'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/calendar', require('./routes/calendar'));
app.use('/api/reports', require('./routes/reports'));
app.use('/reports', require('./routes/reports'));

// Redirect root to login (or dashboard if already logged in)
app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard.html');
  }
  res.redirect('/login.html');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SPM server running at http://localhost:${PORT}`);
});
