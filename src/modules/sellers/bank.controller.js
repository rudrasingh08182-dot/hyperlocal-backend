// bank.controller.js
// Add these functions to your seller.controller.js OR keep separate

const pool = require('../../config/db');

// POST /sellers/bank-details
const saveBankDetails = async (req, res) => {
  try {
    const { account_holder_name, bank_name, account_number, ifsc_code, upi_id, account_type } = req.body;

    // Validate required fields
    if (!account_holder_name || !bank_name || !account_number || !ifsc_code) {
      return res.status(400).json({ error: 'Account holder name, bank name, account number and IFSC are required' });
    }

    // Get seller_id from the sellers table using user id from JWT
    const sellerResult = await pool.query(
      'SELECT id FROM sellers WHERE user_id = $1::uuid',
      [req.user.id]
    );

    if (!sellerResult.rows[0]) {
      return res.status(403).json({ error: 'Only sellers can save bank details' });
    }

    const seller_id = sellerResult.rows[0].id;

    // Upsert — insert or update if already exists
    const result = await pool.query(
      `INSERT INTO seller_bank_details
        (seller_id, account_holder_name, bank_name, account_number, ifsc_code, upi_id, account_type, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (seller_id) DO UPDATE SET
        account_holder_name = EXCLUDED.account_holder_name,
        bank_name           = EXCLUDED.bank_name,
        account_number      = EXCLUDED.account_number,
        ifsc_code           = EXCLUDED.ifsc_code,
        upi_id              = EXCLUDED.upi_id,
        account_type        = EXCLUDED.account_type,
        updated_at          = NOW()
       RETURNING *`,
      [seller_id, account_holder_name, bank_name, account_number, ifsc_code, upi_id || null, account_type || 'savings']
    );

    res.json({ success: true, bank_details: result.rows[0] });

  } catch (err) {
    console.error('saveBankDetails error:', err);
    res.status(500).json({ error: 'Failed to save bank details' });
  }
};

// GET /sellers/bank-details
const getBankDetails = async (req, res) => {
  try {
    const sellerResult = await pool.query(
      'SELECT id FROM sellers WHERE user_id = $1::uuid',
      [req.user.id]
    );

    if (!sellerResult.rows[0]) {
      return res.status(403).json({ error: 'Only sellers can view bank details' });
    }

    const seller_id = sellerResult.rows[0].id;

    const result = await pool.query(
      'SELECT * FROM seller_bank_details WHERE seller_id = $1',
      [seller_id]
    );

    res.json({ bank_details: result.rows[0] || null });

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bank details' });
  }
};

module.exports = { saveBankDetails, getBankDetails };