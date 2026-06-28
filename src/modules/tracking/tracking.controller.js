// modules/tracking/tracking.controller.js

const pool = require('../../config/db');

// ── GET /tracking/:orderId ───────────────────────────────────
// Buyer fetches full tracking info for their order
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
       LEFT JOIN users u ON o.assigned_delivery_id = u.id
       LEFT JOIN sellers s ON o.seller_id = s.id
       WHERE o.id = $1::uuid AND o.customer_id = $2::uuid`,
      [orderId, req.user.id]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });

    // Get tracking history log
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
// Delivery boy or seller updates order status
const updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, note } = req.body;

    const validStatuses = ['pending', 'confirmed', 'preparing', 'picked_up', 'out_for_delivery', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await pool.query(
      `UPDATE orders SET tracking_status = $1, status = $2 WHERE id = $3::uuid`,
      [status, status === 'delivered' ? 'delivered' : status === 'cancelled' ? 'cancelled' : 'confirmed', orderId]
    );

    // Log status change
    await pool.query(
      `INSERT INTO order_tracking_log (order_id, status, note)
       VALUES ($1::uuid, $2, $3)`,
      [orderId, status, note || null]
    );

    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── PATCH /tracking/:orderId/location ───────────────────────
// Delivery boy updates their live GPS location
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
// Buyer polls for delivery boy's latest location
const getDeliveryLocation = async (req, res) => {
  try {
    const { orderId } = req.params;

    const { rows } = await pool.query(
      `SELECT delivery_lat, delivery_lng, location_updated_at, tracking_status
       FROM orders WHERE id = $1::uuid AND customer_id = $2::uuid`,
      [orderId, req.user.id]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getOrderTracking, updateOrderStatus, updateDeliveryLocation, getDeliveryLocation };