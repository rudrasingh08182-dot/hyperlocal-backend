// paymentVerification.controller.js
// ── Temporary QR-based payment verification system ──────────────────────
// This module is intentionally kept separate from Razorpay logic
// (modules/payments/razorpay.payout.service.js etc). It owns exactly one
// job: verifying that a buyer actually paid via UPI QR before an order
// is allowed to move to 'confirmed'. When Razorpay is ready, this file
// can be retired without touching order creation or seller payout logic.

const pool = require('../../config/db');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

function uploadBufferToCloudinary(buffer, folder = 'zaplo_payment_screenshots') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result.secure_url))
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// ─────────────────────────────────────────────
// GET /payments/qr/order/:orderId
// Buyer fetches the seller's UPI/QR details + amount for an order they just placed.
// ─────────────────────────────────────────────
exports.getPaymentDetailsForOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const result = await pool.query(
      `SELECT o.id as order_id, o.grand_total, o.total_amount, o.status,
              s.shop_name, s.id as seller_id,
              bd.upi_id, bd.qr_code_url
       FROM orders o
       JOIN sellers s ON o.seller_id = s.id
       LEFT JOIN seller_bank_details bd ON bd.seller_id = s.id
       WHERE o.id = $1::uuid AND o.buyer_id = $2`,
      [orderId, req.user.id]
    );

    if (!result.rows[0]) return res.status(404).json({ error: 'Order not found' });
    const row = result.rows[0];

    if (!row.upi_id && !row.qr_code_url) {
      return res.status(400).json({ error: 'This seller has not set up UPI payment details yet. Please choose Cash on Delivery.' });
    }

    res.json({
      order_id: row.order_id,
      status: row.status,
      amount: row.grand_total || row.total_amount,
      shop_name: row.shop_name,
      upi_id: row.upi_id,
      qr_code_url: row.qr_code_url,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// POST /payments/qr/verify/:orderId  (multipart, field name: "screenshot")
// Buyer submits proof of payment. This NEVER confirms the order by itself —
// it only moves the order into 'payment_verification_pending' and waits
// for the seller to approve/reject.
// ─────────────────────────────────────────────
exports.submitPaymentVerification = async (req, res) => {
  const client = await pool.connect();
  try {
    const { orderId } = req.params;
    const { transaction_id } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'Payment screenshot is required' });
    }

    await client.query('BEGIN');

    const orderResult = await client.query(
      `SELECT id, seller_id, status FROM orders WHERE id = $1::uuid AND buyer_id = $2 FOR UPDATE`,
      [orderId, req.user.id]
    );
    const order = orderResult.rows[0];
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }

    // Only allow submitting proof while payment is actually outstanding —
    // covers first submission ('pending_payment') and retry after a
    // seller rejection ('payment_rejected'). Never allow re-submission
    // once already confirmed etc.
    if (!['pending_payment', 'payment_rejected'].includes(order.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `This order is not awaiting payment (current status: ${order.status})` });
    }

    const screenshotUrl = await uploadBufferToCloudinary(req.file.buffer);

    const verification = await client.query(
      `INSERT INTO payment_verifications (order_id, buyer_id, seller_id, screenshot_url, transaction_id, status)
       VALUES ($1::uuid, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [orderId, req.user.id, order.seller_id, screenshotUrl, transaction_id || null]
    );

    await client.query(
      `UPDATE orders SET status = 'payment_verification_pending' WHERE id = $1::uuid`,
      [orderId]
    );

    await client.query('COMMIT');

    // Notify seller — best-effort, never block the response on this
    try {
      const { sendNotification } = require('../../config/firebase');
      const sellerFcm = await pool.query('SELECT fcm_token FROM sellers WHERE id = $1::uuid', [order.seller_id]);
      if (sellerFcm.rows[0]?.fcm_token) {
        await sendNotification(
          sellerFcm.rows[0].fcm_token,
          '💳 New Payment Verification Request',
          `A buyer has submitted payment proof for order #${orderId.slice(-6).toUpperCase()}`
        );
      }
    } catch (fcmErr) {
      console.error('FCM ERROR (payment verification):', fcmErr.message);
    }

    res.json({ message: 'Payment proof submitted. Waiting for seller to verify.', verification: verification.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────
// GET /payments/qr/pending
// Seller views all payment verification requests awaiting their decision.
// ─────────────────────────────────────────────
exports.getPendingVerifications = async (req, res) => {
  try {
    const seller = await pool.query('SELECT id FROM sellers WHERE user_id = $1', [req.user.id]);
    if (!seller.rows[0]) return res.status(404).json({ error: 'Seller profile not found' });

    const result = await pool.query(
      `SELECT pv.id, pv.order_id, pv.screenshot_url, pv.transaction_id, pv.submitted_at,
              o.grand_total, o.total_amount, o.created_at as order_time,
              u.name as buyer_name, u.phone as buyer_phone
       FROM payment_verifications pv
       JOIN orders o ON pv.order_id = o.id
       JOIN users u ON pv.buyer_id = u.id
       WHERE pv.seller_id = $1 AND pv.status = 'pending'
       ORDER BY pv.submitted_at DESC`,
      [seller.rows[0].id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// PATCH /payments/qr/:verificationId/approve
// ─────────────────────────────────────────────
exports.approvePayment = async (req, res) => {
  const client = await pool.connect();
  try {
    const { verificationId } = req.params;

    const seller = await pool.query('SELECT id FROM sellers WHERE user_id = $1', [req.user.id]);
    if (!seller.rows[0]) return res.status(404).json({ error: 'Seller profile not found' });

    await client.query('BEGIN');

    const verification = await client.query(
      `SELECT * FROM payment_verifications WHERE id = $1::uuid AND seller_id = $2 AND status = 'pending' FOR UPDATE`,
      [verificationId, seller.rows[0].id]
    );
    if (!verification.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Verification request not found or already resolved' });
    }
    const v = verification.rows[0];

    await client.query(
      `UPDATE payment_verifications SET status = 'approved', approved_at = NOW() WHERE id = $1::uuid`,
      [verificationId]
    );
    await client.query(
      `UPDATE orders SET status = 'confirmed' WHERE id = $1::uuid`,
      [v.order_id]
    );

    await client.query('COMMIT');

    // Notify buyer — best-effort
    try {
      const { sendNotification } = require('../../config/firebase');
      const buyer = await pool.query('SELECT fcm_token FROM users WHERE id = $1', [v.buyer_id]);
      if (buyer.rows[0]?.fcm_token) {
        await sendNotification(
          buyer.rows[0].fcm_token,
          '✅ Payment Approved',
          `Your payment for order #${v.order_id.slice(-6).toUpperCase()} has been verified. Your order is confirmed!`
        );
      }
    } catch (fcmErr) {
      console.error('FCM ERROR (approve payment):', fcmErr.message);
    }

    res.json({ message: 'Payment approved, order confirmed!' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────
// PATCH /payments/qr/:verificationId/reject
// ─────────────────────────────────────────────
exports.rejectPayment = async (req, res) => {
  const client = await pool.connect();
  try {
    const { verificationId } = req.params;

    const seller = await pool.query('SELECT id FROM sellers WHERE user_id = $1', [req.user.id]);
    if (!seller.rows[0]) return res.status(404).json({ error: 'Seller profile not found' });

    await client.query('BEGIN');

    const verification = await client.query(
      `SELECT * FROM payment_verifications WHERE id = $1::uuid AND seller_id = $2 AND status = 'pending' FOR UPDATE`,
      [verificationId, seller.rows[0].id]
    );
    if (!verification.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Verification request not found or already resolved' });
    }
    const v = verification.rows[0];

    await client.query(
      `UPDATE payment_verifications SET status = 'rejected', rejected_at = NOW() WHERE id = $1::uuid`,
      [verificationId]
    );
    await client.query(
      `UPDATE orders SET status = 'payment_rejected' WHERE id = $1::uuid`,
      [v.order_id]
    );

    await client.query('COMMIT');

    // Notify buyer — best-effort
    try {
      const { sendNotification } = require('../../config/firebase');
      const buyer = await pool.query('SELECT fcm_token FROM users WHERE id = $1', [v.buyer_id]);
      if (buyer.rows[0]?.fcm_token) {
        await sendNotification(
          buyer.rows[0].fcm_token,
          '❌ Payment Rejected',
          `Your payment for order #${v.order_id.slice(-6).toUpperCase()} could not be verified. Please retry the payment.`
        );
      }
    } catch (fcmErr) {
      console.error('FCM ERROR (reject payment):', fcmErr.message);
    }

    res.json({ message: 'Payment rejected. Buyer can retry.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};