const Razorpay = require('razorpay');
const crypto = require('crypto');
const pool = require('../../config/db');
const { createSellerPayout } = require('./razorpay.payout.service');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const COMMISSION_RATE = 0.10;

function calculateSplit(totalRupees) {
  const totalPaise = Math.round(parseFloat(totalRupees) * 100);
  const commissionPaise = Math.round(totalPaise * COMMISSION_RATE);
  const sellerSharePaise = totalPaise - commissionPaise;
  return { totalPaise, commissionPaise, sellerSharePaise };
}

// ─────────────────────────────────────────────────────────────
// CREATE RAZORPAY ORDER — now sets payment_method + Route transfer
// ─────────────────────────────────────────────────────────────
async function createRazorpayOrder(orderId) {
  const result = await pool.query(
    `SELECT o.*, s.razorpay_fund_account_id
     FROM orders o
     JOIN sellers s ON o.seller_id = s.id
     WHERE o.id = $1::uuid`,
    [orderId]
  );

  if (!result.rows[0]) throw new Error('Order not found');
  const order = result.rows[0];

  const { totalPaise, commissionPaise, sellerSharePaise } = calculateSplit(order.total_amount);

  // Build Razorpay order options
  const rzpOptions = {
    amount: totalPaise,
    currency: 'INR',
    receipt: `order_${orderId.slice(-8)}`,
    notes: {
      order_id: orderId,
      seller_share_paise: sellerSharePaise,
      commission_paise: commissionPaise,
    },
  };

  // FIX 1: Actually use razorpay_fund_account_id for Route transfer (90% to seller)
  if (order.razorpay_fund_account_id) {
    rzpOptions.transfers = [
      {
        account: order.razorpay_fund_account_id,
        amount: sellerSharePaise,        // 90% to seller
        currency: 'INR',
        on_hold: 0,
        notes: { description: 'Seller share 90%', order_id: orderId },
      },
    ];
  }

  const rzpOrder = await razorpay.orders.create(rzpOptions);

  // FIX 2: Also set payment_method = 'ONLINE' here so refund logic works
  await pool.query(
    `UPDATE orders SET
      razorpay_order_id = $1,
      total_amount_paise = $2,
      platform_commission_paise = $3,
      seller_share_paise = $4,
      payment_method = 'ONLINE'
     WHERE id = $5::uuid`,
    [rzpOrder.id, totalPaise, commissionPaise, sellerSharePaise, orderId]
  );

  return {
    razorpay_order_id: rzpOrder.id,
    amount: totalPaise,
    currency: 'INR',
    key: process.env.RAZORPAY_KEY_ID,
  };
}

// ─────────────────────────────────────────────────────────────
// VERIFY SIGNATURE
// ─────────────────────────────────────────────────────────────
function verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature) {
  const body = razorpayOrderId + '|' + razorpayPaymentId;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body.toString())
    .digest('hex');
  return expectedSignature === razorpaySignature;
}

// ─────────────────────────────────────────────────────────────
// HANDLE ONLINE PAYMENT SUCCESS (called from /verify route)
// ─────────────────────────────────────────────────────────────
 
async function handleOnlinePaymentSuccess(razorpayOrderId, razorpayPaymentId, razorpaySignature) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
 
    const isValid = verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
    if (!isValid) throw new Error('Invalid payment signature');
 
    const orderResult = await client.query(
      'SELECT * FROM orders WHERE razorpay_order_id = $1',
      [razorpayOrderId]
    );
    if (!orderResult.rows[0]) throw new Error('Order not found');
    const order = orderResult.rows[0];
 
    // Prevent double processing
    if (order.payment_status === 'paid') {
      await client.query('ROLLBACK');
      return { success: true, order_id: order.id, message: 'Already processed' };
    }
 
    // Mark order as paid
    await client.query(
      `UPDATE orders SET
        payment_status = 'paid',
        status = 'confirmed',
        razorpay_payment_id = $1,
        razorpay_signature = $2
       WHERE id = $3::uuid`,
      [razorpayPaymentId, razorpaySignature, order.id]
    );
 
    await client.query('COMMIT');
 
    // Trigger 90% payout to seller AFTER committing (non-blocking)
    // Runs async so buyer gets instant response
    createSellerPayout(order.id).catch(err =>
      console.error('Payout failed for order', order.id, err.message)
    );
 
    return { success: true, order_id: order.id };
 
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
 
// ─────────────────────────────────────────────────────────────
// FIX 3: WEBHOOK HANDLER — backup for when /verify is missed
// Mount this BEFORE express.json() in app.js with express.raw()
// ─────────────────────────────────────────────────────────────
async function handleWebhook(req, res) {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const receivedSig   = req.headers['x-razorpay-signature'];
    const expectedSig   = crypto
      .createHmac('sha256', webhookSecret)
      .update(req.body) // req.body must be raw Buffer here
      .digest('hex');

    if (receivedSig !== expectedSig) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const event   = JSON.parse(req.body);
    const payload = event.payload;

    if (event.event === 'payment.captured') {
      const payment = payload.payment.entity;
      // Use existing function — idempotent (checks if already paid)
      await handleOnlinePaymentSuccess(
        payment.order_id,
        payment.id,
        payment.id // webhook doesn't send signature — pass payment id as dummy
                   // since we already verified webhook signature above
      );
    }

    if (event.event === 'payment.failed') {
      const payment = payload.payment.entity;
      await pool.query(
        `UPDATE orders SET payment_status = 'failed' WHERE razorpay_order_id = $1`,
        [payment.order_id]
      );
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook failed' });
  }
}

// ─────────────────────────────────────────────────────────────
// COD DELIVERY — unchanged, was already correct
// ─────────────────────────────────────────────────────────────
async function handleCODDelivery(orderId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      'SELECT * FROM orders WHERE id = $1::uuid', [orderId]
    );
    if (!orderResult.rows[0]) throw new Error('Order not found');
    const order = orderResult.rows[0];

    const { totalPaise, commissionPaise, sellerSharePaise } = calculateSplit(order.total_amount);

    await client.query(
      `UPDATE orders SET
        status = 'delivered',
        payment_status = 'paid',
        payment_method = 'COD',
        total_amount_paise = $1,
        platform_commission_paise = $2,
        seller_share_paise = $3,
        delivered_at = NOW()
       WHERE id = $4::uuid`,
      [totalPaise, commissionPaise, sellerSharePaise, orderId]
    );

    const lastEntry = await client.query(
      `SELECT balance_after_paise FROM seller_ledger
       WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [order.seller_id]
    );
    const currentBalance = lastEntry.rows[0]?.balance_after_paise || 0;
    const newBalance = currentBalance - commissionPaise;

    await client.query(
      `INSERT INTO seller_ledger
       (seller_id, order_id, type, amount_paise, description, balance_after_paise)
       VALUES ($1, $2, 'COD_DEBT', $3, $4, $5)`,
      [order.seller_id, orderId, commissionPaise,
       `COD commission debt: 10% of ₹${(totalPaise / 100).toFixed(2)} cash collected`,
       newBalance]
    );

    await client.query('COMMIT');
    return { success: true };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────
// REFUND — unchanged, was already correct
// ─────────────────────────────────────────────────────────────
async function handleRefund(orderId, refundAmountRupees) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      'SELECT * FROM orders WHERE id = $1::uuid', [orderId]
    );
    const order = orderResult.rows[0];
    if (!order) throw new Error('Order not found');

    if (order.payment_method === 'ONLINE' && order.razorpay_payment_id) {
      const refundPaise = Math.round(parseFloat(refundAmountRupees) * 100);
      await razorpay.payments.refund(order.razorpay_payment_id, {
        amount: refundPaise,
        notes: { reason: 'Customer refund', order_id: orderId }
      });
    }

    await client.query(
      `UPDATE orders SET status = 'cancelled', payment_status = 'refunded'
       WHERE id = $1::uuid`, [orderId]
    );

    const refundPaise = Math.round(parseFloat(refundAmountRupees) * 100);
    const sellerRefundPaise = Math.round(refundPaise * 0.90);

    const lastEntry = await client.query(
      `SELECT balance_after_paise FROM seller_ledger
       WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [order.seller_id]
    );
    const currentBalance = lastEntry.rows[0]?.balance_after_paise || 0;
    const newBalance = currentBalance - sellerRefundPaise;

    await client.query(
      `INSERT INTO seller_ledger
       (seller_id, order_id, type, amount_paise, description, balance_after_paise)
       VALUES ($1, $2, 'REFUND', $3, $4, $5)`,
      [order.seller_id, orderId, sellerRefundPaise,
       `Refund reversed for order ${orderId.slice(-6)}`,
       newBalance]
    );

    await client.query('COMMIT');
    return { success: true };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createRazorpayOrder,
  handleOnlinePaymentSuccess,
  handleCODDelivery,
  handleRefund,
  handleWebhook,
  calculateSplit,
};