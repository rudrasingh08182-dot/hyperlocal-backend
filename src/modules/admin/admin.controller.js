const pool = require('../../config/db');
const sellerDashboard = require('../sellers/seller.dashboard');
const variantController = require('../products/variant.controller');

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

// ── Pincode Management Endpoints ─────────────────────────────
exports.getServiceablePincodes = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM serviceable_pincodes ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.addServiceablePincode = async (req, res) => {
  const { pincode, area_name } = req.body;
  if (!pincode) return res.status(400).json({ error: 'Pincode is required' });

  try {
    const cleanPincode = pincode.trim();
    const result = await pool.query(
      `INSERT INTO serviceable_pincodes (pincode, area_name)
       VALUES ($1, $2)
       ON CONFLICT (pincode) DO UPDATE SET area_name = EXCLUDED.area_name
       RETURNING *`,
      [cleanPincode, area_name || '']
    );

    // Automatically update existing users in this pincode to serviceable = true
    await pool.query('UPDATE users SET serviceable = true WHERE pincode = $1', [cleanPincode]);

    res.status(201).json({ message: 'Pincode activated successfully', pincode: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/admin/products — admin creates a product on behalf of a shop.
// This is the SAME logic sellers use (createProduct) — we just "impersonate"
// the target seller's user_id so the existing ownership/validation code
// resolves correctly, with zero duplication and zero risk of drifting out
// of sync with the seller flow.
exports.adminCreateProduct = async (req, res) => {
  try {
    const { seller_id } = req.body;
    if (!seller_id) return res.status(400).json({ error: 'seller_id is required' });

    const sellerRow = await pool.query('SELECT user_id FROM sellers WHERE id = $1::uuid', [seller_id]);
    if (!sellerRow.rows[0]) return res.status(404).json({ error: 'Shop not found' });

    req.user = { ...req.user, id: sellerRow.rows[0].user_id };
    return sellerDashboard.createProduct(req, res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/admin/products/:id/variants — admin attaches V2 variants to a
// product, on behalf of whichever seller owns it. Same impersonation trick.
exports.adminCreateProductVariants = async (req, res) => {
  try {
    const productRow = await pool.query(
      `SELECT s.user_id FROM products p JOIN sellers s ON p.seller_id = s.id WHERE p.id = $1::uuid`,
      [req.params.id]
    );
    if (!productRow.rows[0]) return res.status(404).json({ error: 'Product not found' });

    req.user = { ...req.user, id: productRow.rows[0].user_id };
    return variantController.createVariants(req, res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.removeServiceablePincode = async (req, res) => {
  const { pincode } = req.params;
  try {
    await pool.query('DELETE FROM serviceable_pincodes WHERE pincode = $1', [pincode]);
    await pool.query('UPDATE users SET serviceable = false WHERE pincode = $1', [pincode]);
    res.json({ message: 'Pincode deactivated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getWaitingPincodes = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM waiting_pincodes ORDER BY request_count DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};