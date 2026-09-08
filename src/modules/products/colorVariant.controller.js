const pool = require('../../config/db');

// Ownership guard — reused by every handler below
async function assertOwnsProduct(productId, userId) {
  const r = await pool.query(
    `SELECT p.id FROM products p JOIN sellers s ON p.seller_id = s.id
     WHERE p.id = $1::uuid AND s.user_id = $2`,
    [productId, userId]
  );
  return !!r.rows[0];
}
async function assertOwnsColor(colorId, userId) {
  const r = await pool.query(
    `SELECT pc.id FROM product_colors pc
     JOIN products p ON pc.product_id = p.id
     JOIN sellers s ON p.seller_id = s.id
     WHERE pc.id = $1::uuid AND s.user_id = $2`,
    [colorId, userId]
  );
  return !!r.rows[0];
}

// GET /api/products/:id/colors — PUBLIC (buyer product page + seller manager)
exports.getColors = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT pc.id, pc.color_name, pc.color_code, pc.images, pc.display_order,
              COALESCE(
                (SELECT json_agg(json_build_object(
                   'id', pcs.id, 'size', pcs.size, 'stock', pcs.stock,
                   'price', pcs.price, 'sku', pcs.sku
                 ) ORDER BY pcs.size)
                 FROM product_color_sizes pcs WHERE pcs.color_id = pc.id
                ), '[]'::json
              ) as sizes
       FROM product_colors pc
       WHERE pc.product_id = $1::uuid
       ORDER BY pc.display_order`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/products/:id/colors — seller adds a color {color_name, color_code, images: []}
exports.addColor = async (req, res) => {
  try {
    const { id } = req.params;
    if (!(await assertOwnsProduct(id, req.user.id))) return res.status(403).json({ error: 'Not your product' });
    const { color_name, color_code, images } = req.body;
    if (!color_name) return res.status(400).json({ error: 'color_name is required' });

    const orderRes = await pool.query('SELECT COALESCE(MAX(display_order),0)+1 as next FROM product_colors WHERE product_id=$1::uuid', [id]);
    const result = await pool.query(
      `INSERT INTO product_colors (product_id, color_name, color_code, images, display_order)
       VALUES ($1::uuid, $2, $3, $4, $5) RETURNING *`,
      [id, color_name, color_code || null, images || [], orderRes.rows[0].next]
    );
    await pool.query('UPDATE products SET has_color_variants = true WHERE id = $1::uuid', [id]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/products/colors/:colorId — update color name/images
exports.updateColor = async (req, res) => {
  try {
    const { colorId } = req.params;
    if (!(await assertOwnsColor(colorId, req.user.id))) return res.status(403).json({ error: 'Not your color variant' });
    const { color_name, color_code, images } = req.body;
    const result = await pool.query(
      `UPDATE product_colors SET
        color_name = COALESCE($1, color_name),
        color_code = COALESCE($2, color_code),
        images = COALESCE($3, images)
       WHERE id = $4::uuid RETURNING *`,
      [color_name || null, color_code || null, images || null, colorId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/products/colors/:colorId
exports.deleteColor = async (req, res) => {
  try {
    const { colorId } = req.params;
    if (!(await assertOwnsColor(colorId, req.user.id))) return res.status(403).json({ error: 'Not your color variant' });
    await pool.query('DELETE FROM product_colors WHERE id = $1::uuid', [colorId]);
    res.json({ message: 'Color removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/products/colors/:colorId/sizes — add a size row {size, stock, price, sku}
exports.addSize = async (req, res) => {
  try {
    const { colorId } = req.params;
    if (!(await assertOwnsColor(colorId, req.user.id))) return res.status(403).json({ error: 'Not your color variant' });
    const { size, stock, price, sku } = req.body;
    if (!size) return res.status(400).json({ error: 'size is required' });
    const result = await pool.query(
      `INSERT INTO product_color_sizes (color_id, size, stock, price, sku)
       VALUES ($1::uuid, $2, $3, $4, $5) RETURNING *`,
      [colorId, size, parseInt(stock) || 0, price || null, sku || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/products/colors/sizes/:sizeId — edit stock/price for one size
exports.updateSize = async (req, res) => {
  try {
    const { sizeId } = req.params;
    const check = await pool.query(
      `SELECT pcs.id FROM product_color_sizes pcs
       JOIN product_colors pc ON pcs.color_id = pc.id
       JOIN products p ON pc.product_id = p.id
       JOIN sellers s ON p.seller_id = s.id
       WHERE pcs.id = $1::uuid AND s.user_id = $2`,
      [sizeId, req.user.id]
    );
    if (!check.rows[0]) return res.status(403).json({ error: 'Not your size variant' });

    const { stock, price, sku } = req.body;
    const result = await pool.query(
      `UPDATE product_color_sizes SET
        stock = COALESCE($1, stock),
        price = COALESCE($2, price),
        sku = COALESCE($3, sku),
        updated_at = NOW()
       WHERE id = $4::uuid RETURNING *`,
      [stock !== undefined ? parseInt(stock) : null, price || null, sku || null, sizeId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/products/colors/sizes/:sizeId
exports.deleteSize = async (req, res) => {
  try {
    const { sizeId } = req.params;
    const check = await pool.query(
      `SELECT pcs.id FROM product_color_sizes pcs
       JOIN product_colors pc ON pcs.color_id = pc.id
       JOIN products p ON pc.product_id = p.id
       JOIN sellers s ON p.seller_id = s.id
       WHERE pcs.id = $1::uuid AND s.user_id = $2`,
      [sizeId, req.user.id]
    );
    if (!check.rows[0]) return res.status(403).json({ error: 'Not your size variant' });
    await pool.query('DELETE FROM product_color_sizes WHERE id = $1::uuid', [sizeId]);
    res.json({ message: 'Size removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};