const pool = require('../../config/db');
exports.searchProducts = async (req, res) => {
  try {
    const { q, pincode: queryPincode } = req.query;
    const buyerPincode = req.user?.pincode || queryPincode || null;

    let baseQuery = `
      SELECT p.id, p.name, p.description, p.price, p.stock,
              p.category, p.image_urls, p.is_available,
              p.unit_type, p.unit_weight, p.price_per_kg, p.return_policy,
              p.has_variants, p.seller_pincode,
              p.seller_id as shop_id, p.seller_id,
              s.shop_name, s.locality, s.id as seller_id, s.is_online as seller_is_online,
                           COALESCE(
                (SELECT json_agg(pc_agg) FROM (
                   SELECT pc.id, pc.color_name, pc.color_code, pc.images, pc.display_order,
                          COALESCE((SELECT json_agg(json_build_object(
                             'id', pcs.id, 'size', pcs.size, 'stock', pcs.stock, 'price', pcs.price
                           ) ORDER BY pcs.size) FROM product_color_sizes pcs WHERE pcs.color_id = pc.id), '[]'::json) as sizes
                   FROM product_colors pc WHERE pc.product_id = p.id ORDER BY pc.display_order
                 ) pc_agg), '[]'::json
              ) as colors,
              p.has_color_variants,
       JOIN sellers s ON p.seller_id = s.id
       WHERE s.status = 'approved'
       AND p.is_available = true
       AND (p.has_variants = true OR p.stock > 0)
       AND (p.name ILIKE $1 OR p.description ILIKE $1 OR p.category ILIKE $1)
    `;

    if (buyerPincode) {
      baseQuery += ` ORDER BY CASE WHEN p.seller_pincode = $2 THEN 1 ELSE 2 END ASC, p.created_at DESC`;
      const result = await pool.query(baseQuery, [`%${q || ''}%`, buyerPincode]);
      return res.json(result.rows);
    } else {
      baseQuery += ` ORDER BY p.created_at DESC`;
      const result = await pool.query(baseQuery, [`%${q || ''}%`]);
      return res.json(result.rows);
    }
  } catch (err) {
    console.error('Search products error:', err.message);
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
    const seller = await pool.query('SELECT id, pincode FROM sellers WHERE user_id = $1', [req.user.id]);
    if (!seller.rows[0]) return res.status(404).json({ error: 'Seller profile not found' });
    const sellerPincode = seller.rows[0].pincode || req.user?.pincode || null;

    const { name, description, price, category, stock, image_url, image_urls, return_policy, unit_type, unit_weight, price_per_kg, sku } = req.body;
    const result = await pool.query(
      `INSERT INTO products (seller_id, seller_pincode, name, description, price, category, stock, image_url, image_urls, return_policy, unit_type, unit_weight, price_per_kg, sku)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [seller.rows[0].id, sellerPincode, name, description, price, category, stock || 0, image_url || null, image_urls || null, return_policy || null, unit_type || 'piece', unit_weight || null, price_per_kg || null, sku || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;

    // Ownership check — a seller can only edit their own products
    const ownerCheck = await pool.query(
      `SELECT p.id FROM products p JOIN sellers s ON p.seller_id = s.id WHERE p.id = $1::uuid AND s.user_id = $2`,
      [id, req.user.id]
    );
    if (!ownerCheck.rows[0]) return res.status(403).json({ error: 'You do not have permission to edit this product' });

    const {
      name, description, price, category, stock, image_urls,
      return_policy, unit_type, unit_weight, price_per_kg, sku,
    } = req.body;

    // COALESCE pattern — any field NOT sent in the request keeps its existing
    // value, instead of accidentally being wiped to null.
    const result = await pool.query(
      `UPDATE products SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        price = COALESCE($3, price),
        category = COALESCE($4, category),
        stock = COALESCE($5, stock),
        image_urls = COALESCE($6, image_urls),
        return_policy = COALESCE($7, return_policy),
        unit_type = COALESCE($8, unit_type),
        unit_weight = COALESCE($9, unit_weight),
        price_per_kg = COALESCE($10, price_per_kg),
        sku = COALESCE($11, sku),
        is_available = CASE WHEN $5::int IS NOT NULL THEN $5::int > 0 ELSE is_available END
       WHERE id = $12::uuid
       RETURNING *`,
      [
        name || null, description || null, price || null, category || null,
        stock !== undefined ? parseInt(stock) : null,
        image_urls || null, return_policy || null, unit_type || null,
        unit_weight || null, price_per_kg || null, sku || null,
        id,
      ]
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