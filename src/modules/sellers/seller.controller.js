const pool = require('../../config/db');

exports.getSeller = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sellers WHERE user_id = $1', [req.user.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.registerShop = async (req, res) => {
  try {
    if (req.user.role === 'admin') return res.status(403).json({ error: 'Admins cannot register shops' });
    if (req.user.role !== 'seller') return res.status(403).json({ error: 'Only sellers can register shops' });
    const { shop_name, address, locality, contact_phone } = req.body;
    const result = await pool.query(
      `INSERT INTO sellers (user_id, shop_name, address, locality, contact_phone)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, shop_name, address, locality, contact_phone]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.searchShops = async (req, res) => {
  try {
    const { q } = req.query;
    const result = await pool.query(
      `SELECT s.id, s.shop_name, s.address, s.locality, s.contact_phone, s.status, s.is_online,
              u.name as owner_name,
              COUNT(p.id) as total_products
       FROM sellers s
       JOIN users u ON s.user_id = u.id
       LEFT JOIN products p ON p.seller_id = s.id AND p.is_available = true
       WHERE s.status = 'approved'
       AND (s.shop_name ILIKE $1 OR s.locality ILIKE $1)
       GROUP BY s.id, u.name
       ORDER BY s.shop_name`,
      [`%${q || ''}%`]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.getShopProducts = async (req, res) => {
  try {
    const { shopId } = req.params;
    const result = await pool.query(
      `SELECT p.*, s.shop_name, s.locality, s.is_online as seller_is_online
       FROM products p
       JOIN sellers s ON p.seller_id = s.id
       WHERE p.seller_id = $1 AND p.is_available = true AND p.stock > 0
       ORDER BY p.created_at DESC`,
      [shopId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.updateSeller = async (req, res) => {
  try {
    const { latitude, longitude, shop_name, address, locality, contact_phone } = req.body;
    
    await pool.query(
      `UPDATE sellers SET
        latitude = COALESCE($1, latitude),
        longitude = COALESCE($2, longitude),
        shop_name = COALESCE($3, shop_name),
        address = COALESCE($4, address),
        locality = COALESCE($5, locality),
        contact_phone = COALESCE($6, contact_phone)
       WHERE user_id = $7`,
      [latitude, longitude, shop_name, address, locality, contact_phone, req.user.id]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /sellers/store-status — toggle "Online" / "Temporarily Closed"
exports.toggleStoreStatus = async (req, res) => {
  try {
    const { is_online } = req.body;
    if (typeof is_online !== 'boolean') {
      return res.status(400).json({ error: 'is_online must be true or false' });
    }

    const result = await pool.query(
      `UPDATE sellers SET is_online = $1 WHERE user_id = $2 RETURNING is_online`,
      [is_online, req.user.id]
    );

    if (!result.rows[0]) return res.status(404).json({ error: 'Seller profile not found' });
    res.json({ message: is_online ? 'Store is now Online' : 'Store is now Temporarily Closed', is_online: result.rows[0].is_online });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};