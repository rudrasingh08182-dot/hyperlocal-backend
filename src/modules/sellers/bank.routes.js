const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth.middleware');
const pool = require('../../config/db');
const { resetFundAccount } = require('../payments/razorpay.payout.service');

// Save bank details
router.post('/bank-details', auth, async (req, res) => {
  try {
    const {
      account_holder_name, account_number,
      ifsc_code, bank_name, account_type, upi_id
    } = req.body;

    if (!account_holder_name || !account_number || !ifsc_code || !bank_name) {
      return res.status(400).json({ error: 'All bank details are required' });
    }

    const seller = await pool.query(
      'SELECT id FROM sellers WHERE user_id = $1', [req.user.id]
    );
    if (!seller.rows[0]) return res.status(403).json({ error: 'Seller profile not found' });

    const sellerId = seller.rows[0].id;

    const result = await pool.query(
      `INSERT INTO seller_bank_details
       (seller_id, account_holder_name, account_number, ifsc_code, bank_name, account_type, upi_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (seller_id) DO UPDATE SET
         account_holder_name = $2,
         account_number = $3,
         ifsc_code = $4,
         bank_name = $5,
         account_type = $6,
         upi_id = $7,
         updated_at = NOW()
       RETURNING *`,
      [sellerId, account_holder_name, account_number,
       ifsc_code, bank_name, account_type || 'savings', upi_id]
    );

    // Reset Razorpay fund account so new bank details are used for next payout
    await resetFundAccount(sellerId);

    res.json({ message: 'Bank details saved!', details: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get bank details
router.get('/bank-details', auth, async (req, res) => {
  try {
    const seller = await pool.query(
      'SELECT id FROM sellers WHERE user_id = $1', [req.user.id]
    );
    if (!seller.rows[0]) return res.status(404).json({ error: 'Seller not found' });

    const result = await pool.query(
      'SELECT * FROM seller_bank_details WHERE seller_id = $1',
      [seller.rows[0].id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;