// banner.controller.js
const pool = require('../../config/db');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

const MAX_BANNERS = 12;

function uploadBufferToCloudinary(buffer, folder = 'zaplo_banners') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result.secure_url))
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// ─────────────────────────────────────────────
// PUBLIC — GET /api/banners/active
// Buyer app calls this. Only returns banners that are active, have an image,
// and (if dates are set) fall within the start/end date window. Never returns
// placeholder/empty entries — if nothing qualifies, returns an empty array,
// and the frontend hides the carousel entirely.
// ─────────────────────────────────────────────
exports.getActiveBanners = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM banners
       WHERE is_active = true
       AND image_url IS NOT NULL
       AND (start_date IS NULL OR start_date <= CURRENT_DATE)
       AND (end_date IS NULL OR end_date >= CURRENT_DATE)
       ORDER BY display_order ASC, created_at ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// ADMIN — GET /api/admin/banners
// Returns ALL banners (active or not), for the management screen.
// ─────────────────────────────────────────────
exports.getAllBanners = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM banners ORDER BY display_order ASC, created_at ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// ADMIN — POST /api/admin/banners  (multipart, field name: "image")
// ─────────────────────────────────────────────
exports.createBanner = async (req, res) => {
  try {
    const countResult = await pool.query('SELECT COUNT(*) FROM banners');
    if (parseInt(countResult.rows[0].count) >= MAX_BANNERS) {
      return res.status(400).json({ error: `Maximum ${MAX_BANNERS} banners allowed. Delete an existing banner first.` });
    }

    if (!req.file) return res.status(400).json({ error: 'Banner image is required' });
    const imageUrl = await uploadBufferToCloudinary(req.file.buffer);

    const {
      title, subtitle, description, discount_badge, cta_text, coupon_code,
      restaurant_name, action_type, action_value, text_position,
      start_date, end_date, display_order, is_active,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO banners
       (image_url, title, subtitle, description, discount_badge, cta_text, coupon_code,
        restaurant_name, action_type, action_value, text_position, start_date, end_date,
        display_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        imageUrl,
        title || null,
        subtitle || null,
        description || null,
        discount_badge || null,
        cta_text || 'Order Now',
        coupon_code || null,
        restaurant_name || null,
        action_type || 'none',
        action_value || null,
        text_position || 'bottom-left',
        start_date || null,
        end_date || null,
        display_order !== undefined && display_order !== '' ? parseInt(display_order) : parseInt(countResult.rows[0].count),
        is_active === 'false' || is_active === false ? false : true,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// ADMIN — PATCH /api/admin/banners/:id  (multipart, image optional)
// ─────────────────────────────────────────────
exports.updateBanner = async (req, res) => {
  try {
    const { id } = req.params;
    let imageUrl = null;
    if (req.file) {
      imageUrl = await uploadBufferToCloudinary(req.file.buffer);
    }

    const {
      title, subtitle, description, discount_badge, cta_text, coupon_code,
      restaurant_name, action_type, action_value, text_position,
      start_date, end_date, display_order, is_active,
    } = req.body;

    const result = await pool.query(
      `UPDATE banners SET
        image_url = COALESCE($1, image_url),
        title = $2,
        subtitle = $3,
        description = $4,
        discount_badge = $5,
        cta_text = $6,
        coupon_code = $7,
        restaurant_name = $8,
        action_type = $9,
        action_value = $10,
        text_position = $11,
        start_date = $12,
        end_date = $13,
        display_order = $14,
        is_active = $15,
        updated_at = NOW()
       WHERE id = $16::uuid
       RETURNING *`,
      [
        imageUrl,
        title || null,
        subtitle || null,
        description || null,
        discount_badge || null,
        cta_text || 'Order Now',
        coupon_code || null,
        restaurant_name || null,
        action_type || 'none',
        action_value || null,
        text_position || 'bottom-left',
        start_date || null,
        end_date || null,
        display_order !== undefined && display_order !== '' ? parseInt(display_order) : 0,
        is_active === 'false' || is_active === false ? false : true,
        id,
      ]
    );

    if (!result.rows[0]) return res.status(404).json({ error: 'Banner not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// ADMIN — DELETE /api/admin/banners/:id
// ─────────────────────────────────────────────
exports.deleteBanner = async (req, res) => {
  try {
    await pool.query('DELETE FROM banners WHERE id = $1::uuid', [req.params.id]);
    res.json({ message: 'Banner deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// ADMIN — PATCH /api/admin/banners/reorder
// body: { order: [id1, id2, id3, ...] } — new order, top to bottom
// ─────────────────────────────────────────────
exports.reorderBanners = async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of banner ids' });

    for (let i = 0; i < order.length; i++) {
      await pool.query('UPDATE banners SET display_order = $1 WHERE id = $2::uuid', [i, order[i]]);
    }

    res.json({ message: 'Banner order updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};