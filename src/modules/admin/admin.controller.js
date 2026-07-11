const pool = require('../../config/db');

exports.getAllSellers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, u.username, u.name, u.phone, s.shop_name, s.status, s.created_at
       FROM sellers s
       JOIN users u ON s.user_id = u.id
       ORDER BY s.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAllBuyers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, name, phone, created_at
       FROM users WHERE role = 'buyer'
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.approveSeller = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `UPDATE sellers SET status = 'approved' WHERE id = $1::uuid RETURNING *`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Seller not found' });
    }
    
    res.json({ message: 'Seller approved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.suspendSeller = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `UPDATE sellers SET status = 'suspended' WHERE id = $1::uuid RETURNING *`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Seller not found' });
    }
    
    res.json({ message: 'Seller suspended' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /admin/sellers/:id/sales-last-7-days
exports.getSellerSalesLast7Days = async (req, res) => {
  try {
    const { id } = req.params;

    const sellerCheck = await pool.query('SELECT shop_name FROM sellers WHERE id = $1::uuid', [id]);
    if (!sellerCheck.rows[0]) return res.status(404).json({ error: 'Seller not found' });

    // One row per day for the last 7 days (including today), even if a day had zero orders.
    // Revenue excludes pending/cancelled orders — same rule used in seller.dashboard.js.
    const result = await pool.query(
      `SELECT
         d::date as date,
         COUNT(o.id) FILTER (WHERE o.id IS NOT NULL) as order_count,
         COALESCE(SUM(CASE WHEN o.status NOT IN ('pending', 'cancelled', 'pending_payment', 'payment_verification_pending', 'payment_rejected') THEN o.total_amount ELSE 0 END), 0) as revenue
       FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') d
       LEFT JOIN orders o ON DATE(o.created_at) = d::date AND o.seller_id = $1::uuid
       GROUP BY d
       ORDER BY d`,
      [id]
    );

    const days = result.rows.map(r => ({
      date: r.date,
      order_count: parseInt(r.order_count),
      revenue: parseFloat(r.revenue),
      commission: parseFloat(r.revenue) * 0.10,
    }));

    const total_orders = days.reduce((sum, d) => sum + d.order_count, 0);
    const total_revenue = days.reduce((sum, d) => sum + d.revenue, 0);
    const total_commission = total_revenue * 0.10;

    res.json({
      seller_id: id,
      shop_name: sellerCheck.rows[0].shop_name,
      days,
      total_orders,
      total_revenue,
      total_commission,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.getAllDeliveryBoys = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.name, u.phone, 
              d.id as delivery_id, d.vehicle_type, 
              d.vehicle_number, d.locality, d.status, d.created_at
       FROM delivery_boys d
       JOIN users u ON d.user_id = u.id
       ORDER BY d.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.approveDeliveryBoy = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE delivery_boys SET status = 'approved' 
       WHERE id = $1::uuid RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Delivery boy not found' });
    }
    res.json({ message: 'Delivery boy approved!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.suspendDeliveryBoy = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      `UPDATE delivery_boys SET status = 'suspended' WHERE id = $1::uuid`,
      [id]
    );
    res.json({ message: 'Delivery boy suspended' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};