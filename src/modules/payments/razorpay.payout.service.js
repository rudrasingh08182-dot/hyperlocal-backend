// services/razorpay.payout.service.js
// ─────────────────────────────────────────────────────────────
// Flow:
// 1. Buyer pays full amount → lands in YOUR Razorpay account
// 2. Payment verified → createSellerPayout() called automatically
// 3. 90% sent to seller's bank via Razorpay Payout API
// 4. 10% stays in your account
//
// IMPORTANT: Enable Razorpay Payouts in your dashboard first
// Dashboard → Payouts → Activate
// ─────────────────────────────────────────────────────────────

const axios = require('axios');
const pool  = require('../../config/db');

const RAZORPAY_KEY_ID     = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const COMMISSION_RATE     = 0.10;

// Base64 auth for Razorpay API
const authHeader = () => {
  const token = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
  return { Authorization: `Basic ${token}`, 'Content-Type': 'application/json' };
};

// ─────────────────────────────────────────────────────────────
// STEP 1: Create or fetch Razorpay Contact for a seller
// (Razorpay needs a "contact" before making payouts)
// ─────────────────────────────────────────────────────────────
const getOrCreateContact = async (sellerId) => {
  // Check if contact already exists
  const existing = await pool.query(
    'SELECT razorpay_contact_id FROM sellers WHERE id = $1',
    [sellerId]
  );

  if (existing.rows[0]?.razorpay_contact_id) {
    return existing.rows[0].razorpay_contact_id;
  }

  // Get seller + user details
  const result = await pool.query(
    `SELECT s.*, u.name, u.phone, u.username
     FROM sellers s JOIN users u ON s.user_id = u.id
     WHERE s.id = $1`,
    [sellerId]
  );
  const seller = result.rows[0];

  // Create contact on Razorpay
  const response = await axios.post(
    'https://api.razorpay.com/v1/contacts',
    {
      name:         seller.name,
      contact:      seller.phone,
      type:         'vendor',
      reference_id: sellerId,
      notes:        { seller_id: sellerId, shop: seller.shop_name },
    },
    { headers: authHeader() }
  );

  const contactId = response.data.id;

  // Save contact ID to sellers table
  await pool.query(
    'UPDATE sellers SET razorpay_contact_id = $1 WHERE id = $2',
    [contactId, sellerId]
  );

  return contactId;
};

// ─────────────────────────────────────────────────────────────
// STEP 2: Create or fetch Fund Account (seller's bank account)
// ─────────────────────────────────────────────────────────────
const getOrCreateFundAccount = async (sellerId) => {
  // Check if fund account already exists
  const existing = await pool.query(
    'SELECT razorpay_fund_account_id FROM sellers WHERE id = $1',
    [sellerId]
  );

  if (existing.rows[0]?.razorpay_fund_account_id) {
    return existing.rows[0].razorpay_fund_account_id;
  }

  // Get seller's saved bank details
  const bankResult = await pool.query(
    'SELECT * FROM seller_bank_details WHERE seller_id = $1',
    [sellerId]
  );

  if (!bankResult.rows[0]) {
    throw new Error('Seller has not added bank details yet');
  }

  const bank = bankResult.rows[0];

  // Get or create contact first
  const contactId = await getOrCreateContact(sellerId);

  // Create fund account on Razorpay
  const response = await axios.post(
    'https://api.razorpay.com/v1/fund_accounts',
    {
      contact_id:   contactId,
      account_type: 'bank_account',
      bank_account: {
        name:           bank.account_holder_name,
        ifsc:           bank.ifsc_code,
        account_number: bank.account_number,
      },
    },
    { headers: authHeader() }
  );

  const fundAccountId = response.data.id;

  // Save fund account ID to sellers table
  await pool.query(
    'UPDATE sellers SET razorpay_fund_account_id = $1 WHERE id = $2',
    [fundAccountId, sellerId]
  );

  return fundAccountId;
};

// ─────────────────────────────────────────────────────────────
// STEP 3: Send 90% payout to seller after payment success
// Called automatically from handleOnlinePaymentSuccess()
// ─────────────────────────────────────────────────────────────
const createSellerPayout = async (orderId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get order details
    const orderResult = await client.query(
      'SELECT * FROM orders WHERE id = $1::uuid',
      [orderId]
    );
    const order = orderResult.rows[0];
    if (!order) throw new Error('Order not found');

    // Calculate 90% seller share in paise
    const totalPaise      = Math.round(parseFloat(order.total_amount) * 100);
    const commissionPaise = Math.round(totalPaise * COMMISSION_RATE);
    const sellerPaise     = totalPaise - commissionPaise;

    // Get or create seller's fund account on Razorpay
    const fundAccountId = await getOrCreateFundAccount(order.seller_id);

    // Create payout via Razorpay Payouts API
    const payoutResponse = await axios.post(
      'https://api.razorpay.com/v1/payouts',
      {
        account_number: process.env.RAZORPAY_ACCOUNT_NUMBER, // Your Razorpay account number
        fund_account_id: fundAccountId,
        amount:          sellerPaise,   // 90% in paise
        currency:        'INR',
        mode:            'IMPS',        // instant transfer
        purpose:         'payout',
        queue_if_low_balance: true,     // queue if balance low instead of failing
        reference_id:    orderId,
        narration:       `Order #${orderId.slice(-6)} seller payout`,
        notes: {
          order_id:  orderId,
          seller_id: order.seller_id,
          type:      '90% seller share',
        },
      },
      { headers: authHeader() }
    );

    const payout = payoutResponse.data;

    // Log in seller ledger
    const lastEntry = await client.query(
      `SELECT balance_after_paise FROM seller_ledger
       WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [order.seller_id]
    );
    const currentBalance = lastEntry.rows[0]?.balance_after_paise || 0;

    await client.query(
      `INSERT INTO seller_ledger
       (seller_id, order_id, type, amount_paise, description, balance_after_paise)
       VALUES ($1, $2, 'PAYOUT', $3, $4, $5)`,
      [
        order.seller_id, orderId, sellerPaise,
        `Payout ₹${(sellerPaise / 100).toFixed(2)} via Razorpay (${payout.id}). Platform kept ₹${(commissionPaise / 100).toFixed(2)}`,
        currentBalance + sellerPaise,
      ]
    );

    // Save payout ID to order
    await client.query(
      'UPDATE orders SET razorpay_payout_id = $1 WHERE id = $2::uuid',
      [payout.id, orderId]
    );

    await client.query('COMMIT');
    console.log(`✅ Payout ${payout.id} of ₹${sellerPaise / 100} sent to seller`);
    return payout;

  } catch (err) {
    await client.query('ROLLBACK');
    // Don't throw — log the error but don't fail the payment
    console.error('❌ Seller payout failed:', err.response?.data || err.message);
    // You can notify admin here via email/SMS
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// Re-register fund account when seller updates bank details
// Call this from bank.routes.js after saving bank details
// ─────────────────────────────────────────────────────────────
const resetFundAccount = async (sellerId) => {
  await pool.query(
    'UPDATE sellers SET razorpay_fund_account_id = NULL, razorpay_contact_id = NULL WHERE id = $1',
    [sellerId]
  );
  // Next payout will create a fresh fund account with new bank details
};

module.exports = {
  createSellerPayout,
  getOrCreateFundAccount,
  getOrCreateContact,
  resetFundAccount,
};