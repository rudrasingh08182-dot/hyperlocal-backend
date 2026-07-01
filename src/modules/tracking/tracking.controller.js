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
        s.address as shop_address
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

module.exports = { getOrderTracking, updateOrderStatus, updateDeliveryLocation, getDeliveryLocation };