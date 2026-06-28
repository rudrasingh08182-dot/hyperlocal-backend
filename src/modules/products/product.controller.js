const pool = require('../../config/db');

exports.searchProducts = async (req, res) => {
  try {
    const { q } = req.query;
    const result = await pool.query(
      `SELECT p.id, p.name, p.description, p.price, p.stock,
              p.category, p.image_urls, p.is_available,
              p.seller_id as shop_id, p.seller_id,
              s.shop_name, s.locality, s.id as seller_id
       FROM products p
       JOIN sellers s ON p.seller_id = s.id
       WHERE s.status = 'approved'
       AND p.is_available = true
       AND p.stock > 0
       AND (p.name ILIKE $1 OR p.description ILIKE $1 OR p.category ILIKE $1)
       ORDER BY p.price ASC`,
      [`%${q || ''}%`]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getMyProducts = async (req, res) => {
  try {
    const seller = await pool.query('SELECT id FROM sellers WHERE user_id = $1', [req.user.id]);
    if (!seller.rows[0]) return res.status(404).json({ error: 'Seller profile not found' });
    const result = await pool.query(
      'SELECT * FROM products WHERE seller_id = $1 ORDER BY created_at DESC',
      [seller.rows[0].id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.addProduct = async (req, res) => {
  try {
    const seller = await pool.query('SELECT id FROM sellers WHERE user_id = $1', [req.user.id]);
    if (!seller.rows[0]) return res.status(404).json({ error: 'Seller profile not found' });
    const { name, description, price, category, stock, image_url } = req.body;
    const result = await pool.query(
      `INSERT INTO products (seller_id, name, description, price, category, stock, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [seller.rows[0].id, name, description, price, category, stock || 0, image_url]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, category, stock, image_url, is_available } = req.body;
    const result = await pool.query(
      `UPDATE products SET name=$1, description=$2, price=$3, category=$4,
       stock=$5, image_url=$6, is_available=$7 WHERE id=$8::uuid RETURNING *`,
      [name, description, price, category, stock, image_url, is_available, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if product has orders — if yes, just hide it instead of deleting
    const orderCheck = await pool.query(
      'SELECT id FROM order_items WHERE product_id = $1::uuid LIMIT 1',
      [id]
    );

    if (orderCheck.rows.length > 0) {
      // Has orders — just mark as unavailable
      await pool.query(
        'UPDATE products SET is_available = false, stock = 0 WHERE id = $1::uuid',
        [id]
      );
      return res.json({ message: 'Product hidden (has existing orders)' });
    }

    // No orders — safe to delete
    await pool.query('DELETE FROM products WHERE id=$1::uuid', [id]);
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};