// routes/racks.js – Racks list (read-only)
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { requireLogin } = require('../middleware/auth');

// GET /api/racks - list all racks (A1..E5)
router.get('/', requireLogin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, code FROM racks ORDER BY code ASC');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching racks:', err);
    res.status(500).json({ error: 'Failed to fetch racks' });
  }
});

module.exports = router;
