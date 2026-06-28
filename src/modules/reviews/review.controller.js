// modules/reviews/review.controller.js

const pool = require('../../config/db');

// ── POST /reviews/product/:productId ────────────────────────
const addProductReview = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const { productId } = req.params;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const result = await pool.query(
      `INSERT INTO product_reviews (product_id, buyer_id, rating, comment)
       VALUES ($1::uuid, $2::uuid, $3, $4)
       ON CONFLICT (product_id, buyer_id) DO UPDATE SET
         rating = $3, comment = $4, created_at = NOW()
       RETURNING *`,
      [productId, req.user.id, rating, comment || null]
    );

    res.json({ success: true, review: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /reviews/product/:productId ─────────────────────────
const getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;

    const { rows } = await pool.query(
      `SELECT pr.*, u.name as buyer_name
       FROM product_reviews pr
       JOIN users u ON pr.buyer_id = u.id
       WHERE pr.product_id = $1::uuid
       ORDER BY pr.created_at DESC`,
      [productId]
    );

    // Calculate average rating
    const avg = rows.length
      ? (rows.reduce((sum, r) => sum + r.rating, 0) / rows.length).toFixed(1)
      : null;

    res.json({ reviews: rows, average_rating: avg, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── POST /reviews/seller/:sellerId ───────────────────────────
const addSellerReview = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const { sellerId } = req.params;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const result = await pool.query(
      `INSERT INTO seller_reviews (seller_id, buyer_id, rating, comment)
       VALUES ($1::uuid, $2::uuid, $3, $4)
       ON CONFLICT (seller_id, buyer_id) DO UPDATE SET
         rating = $3, comment = $4, created_at = NOW()
       RETURNING *`,
      [sellerId, req.user.id, rating, comment || null]
    );

    res.json({ success: true, review: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /reviews/seller/:sellerId ────────────────────────────
const getSellerReviews = async (req, res) => {
  try {
    const { sellerId } = req.params;

    const { rows } = await pool.query(
      `SELECT sr.*, u.name as buyer_name
       FROM seller_reviews sr
       JOIN users u ON sr.buyer_id = u.id
       WHERE sr.seller_id = $1::uuid
       ORDER BY sr.created_at DESC`,
      [sellerId]
    );

    const avg = rows.length
      ? (rows.reduce((sum, r) => sum + r.rating, 0) / rows.length).toFixed(1)
      : null;

    res.json({ reviews: rows, average_rating: avg, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { addProductReview, getProductReviews, addSellerReview, getSellerReviews };