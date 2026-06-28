const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth.middleware');
const role = require('../../middleware/role.middleware');
const { getSeller, registerShop, searchShops, getShopProducts, updateSeller } = require('./seller.controller');
const { getDashboardStats, createProduct } = require('./seller.dashboard');
const { saveBankDetails, getBankDetails } = require('./bank.controller'); // 

router.get('/search', searchShops);
router.get('/:shopId/products', getShopProducts);
router.get('/me', auth, getSeller);
router.patch('/me', auth, updateSeller);
router.post('/register', auth, registerShop);
router.get('/dashboard', auth, role('seller'), getDashboardStats);

// ── Bank Details ─────────────────────────────────────────────
router.post('/bank-details', auth, saveBankDetails);  // 👈 ADD THIS
router.get('/bank-details', auth, getBankDetails);    // 👈 ADD THIS

// Confirm order
router.patch('/orders/:id/confirm', auth, role('seller'), async (req, res) => {
  try {
    const pool = require('../../config/db');
    const result = await pool.query(
      `UPDATE orders SET status = 'confirmed' WHERE id = $1::uuid RETURNING *`,
      [req.params.id]
    );
    res.json({ message: 'Order confirmed!', order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel order
router.patch('/orders/:id/cancel', auth, role('seller'), async (req, res) => {
  try {
    const pool = require('../../config/db');
    const result = await pool.query(
      `UPDATE orders SET status = 'cancelled' WHERE id = $1::uuid RETURNING *`,
      [req.params.id]
    );
    res.json({ message: 'Order cancelled', order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;