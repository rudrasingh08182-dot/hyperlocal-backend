// modules/tracking/tracking.controller.js

const pool = require('../../config/db');

// ── GET /tracking/:orderId ───────────────────────────────────
const getOrderTracking = async (req, res) => {
  try {
    const { orderId } = req.params;

    const { rows } = await pool.query(
       `SELECT o.*,
        u.name as delivery_boy_name,
        u.phone as delivery_boy_phone,
        s.shop_name,
        s.address as shop_address,
        s.contact_phone as shop_phone
       FROM orders o
       LEFT JOIN users u ON o.delivery_boy_id = u.id
       LEFT JOIN sellers s ON o.seller_id = s.id
       WHERE o.id = $1::uuid AND o.buyer_id = $2::uuid`,
      [orderId, req.user.id]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });

    const { rows: log } = await pool.query(
      `SELECT * FROM order_tracking_log
       WHERE order_id = $1::uuid
       ORDER BY created_at ASC`,
      [orderId]
    );

    res.json({ order: rows[0], tracking_log: log });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PATCH /tracking/:orderId/status ─────────────────────────
const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, note } = req.body;

    const validStatuses = ['pending', 'confirmed', 'preparing', 'picked_up', 'out_for_delivery', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Update tracking_status (varchar) always
    await pool.query(
      `UPDATE orders SET tracking_status = $1 WHERE id = $2::uuid`,
      [status, orderId]
    );

    // Update status (enum) only for valid enum values
    const enumStatuses = ['pending', 'confirmed', 'picked_up', 'delivered', 'cancelled'];
    if (enumStatuses.includes(status)) {
      await pool.query(
        `UPDATE orders SET status = $1::order_status WHERE id = $2::uuid`,
        [status, orderId]
      );
    }

    // Log status change
    await pool.query(
      `INSERT INTO order_tracking_log (order_id, status, note)
       VALUES ($1::uuid, $2, $3)`,
      [orderId, status, note || null]
    );

    res.json({ success: true, status });
  } catch (err) {
    console.error('STATUS UPDATE ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// ── PATCH /tracking/:orderId/location ───────────────────────
const updateDeliveryLocation = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { lat, lng } = req.body;

    if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

    await pool.query(
      `UPDATE orders SET
        delivery_lat = $1,
        delivery_lng = $2,
        location_updated_at = NOW()
       WHERE id = $3::uuid`,
      [lat, lng, orderId]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /tracking/:orderId/location ─────────────────────────
const getDeliveryLocation = async (req, res) => {
  try {
    const { orderId } = req.params;

    const { rows } = await pool.query(
      `SELECT delivery_lat, delivery_lng, location_updated_at, tracking_status
       FROM orders WHERE id = $1::uuid AND buyer_id = $2::uuid`,
      [orderId, req.user.id]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

function uploadBufferToCloudinary(buffer, folder = 'zaplo_delivery_payment_proofs') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result.secure_url))
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// ── GET /tracking/:orderId/seller-qr ────────────────────────
// Delivery boy fetches seller's UPI QR so buyer can scan & pay at doorstep
const getSellerQr = async (req, res) => {
  try {
    const { orderId } = req.params;

    const { rows } = await pool.query(
      `SELECT o.delivery_boy_id, s.shop_name, bd.upi_id, bd.qr_code_url
       FROM orders o
       JOIN sellers s ON o.seller_id = s.id
       LEFT JOIN seller_bank_details bd ON bd.seller_id = s.id
       WHERE o.id = $1::uuid`,
      [orderId]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    if (rows[0].delivery_boy_id !== req.user.id) {
      return res.status(403).json({ error: 'You are not assigned to this order' });
    }
    if (!rows[0].upi_id && !rows[0].qr_code_url) {
      return res.status(400).json({ error: 'Seller has not set up UPI/QR details yet' });
    }

    res.json({
      shop_name: rows[0].shop_name,
      upi_id: rows[0].upi_id,
      qr_code_url: rows[0].qr_code_url,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /tracking/:orderId/delivery-payment-proof ──────────
// Delivery boy uploads a screenshot after buyer pays via seller's QR
const submitDeliveryPaymentProof = async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!req.file) return res.status(400).json({ error: 'Payment screenshot is required' });

    const orderCheck = await pool.query(
      `SELECT delivery_boy_id, seller_id, total_amount FROM orders WHERE id = $1::uuid`,
      [orderId]
    );
    if (!orderCheck.rows[0]) return res.status(404).json({ error: 'Order not found' });
    if (orderCheck.rows[0].delivery_boy_id !== req.user.id) {
      return res.status(403).json({ error: 'You are not assigned to this order' });
    }

    const screenshotUrl = await uploadBufferToCloudinary(req.file.buffer);

    await pool.query(
      `UPDATE orders SET
        delivery_payment_confirmed = TRUE,
        delivery_payment_method = 'QR',
        delivery_payment_proof_url = $1
       WHERE id = $2::uuid`,
      [screenshotUrl, orderId]
    );

    // Notify seller — best-effort
    try {
      const { sendNotification } = require('../../config/firebase');
      const seller = await pool.query(
        `SELECT u.fcm_token FROM sellers s JOIN users u ON s.user_id = u.id WHERE s.id = $1`,
        [orderCheck.rows[0].seller_id]
      );
      if (seller.rows[0]?.fcm_token) {
        await sendNotification(
          seller.rows[0].fcm_token,
          '💳 Delivery Payment Received',
          `Delivery partner confirmed QR payment of ₹${orderCheck.rows[0].total_amount} for order #${orderId.slice(-6).toUpperCase()}`
        );
      }
    } catch (fcmErr) {
      console.error('FCM ERROR (delivery payment proof):', fcmErr.message);
    }

    res.json({ success: true, message: 'Payment proof submitted', screenshot_url: screenshotUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PATCH /tracking/:orderId/cash-received ──────────────────
// Delivery boy confirms cash was collected from buyer
const markCashReceived = async (req, res) => {
  try {
    const { orderId } = req.params;

    const orderCheck = await pool.query(
      `SELECT delivery_boy_id, seller_id, total_amount FROM orders WHERE id = $1::uuid`,
      [orderId]
    );
    if (!orderCheck.rows[0]) return res.status(404).json({ error: 'Order not found' });
    if (orderCheck.rows[0].delivery_boy_id !== req.user.id) {
      return res.status(403).json({ error: 'You are not assigned to this order' });
    }

    await pool.query(
      `UPDATE orders SET
        delivery_payment_confirmed = TRUE,
        delivery_payment_method = 'CASH'
       WHERE id = $1::uuid`,
      [orderId]
    );

    try {
      const { sendNotification } = require('../../config/firebase');
      const seller = await pool.query(
        `SELECT u.fcm_token FROM sellers s JOIN users u ON s.user_id = u.id WHERE s.id = $1`,
        [orderCheck.rows[0].seller_id]
      );
      if (seller.rows[0]?.fcm_token) {
        await sendNotification(
          seller.rows[0].fcm_token,
          '💵 Cash Payment Received',
          `Delivery partner collected ₹${orderCheck.rows[0].total_amount} cash for order #${orderId.slice(-6).toUpperCase()}`
        );
      }
    } catch (fcmErr) {
      console.error('FCM ERROR (cash received):', fcmErr.message);
    }

    res.json({ success: true, message: 'Cash payment marked as received' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getOrderTracking, updateOrderStatus, updateDeliveryLocation, getDeliveryLocation, getSellerQr, submitDeliveryPaymentProof, markCashReceived };