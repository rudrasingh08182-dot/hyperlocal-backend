// modules/admin/broadcast.controller.js
// Admin panel se custom notification saare buyers/sellers ko bhejo

const pool = require('../../config/db');
const { sendToMany } = require('../../config/firebase');

/**
 * POST /api/admin/notify/buyers
 * Body: { title, body }
 */
exports.notifyAllBuyers = async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: 'title aur body dono required hain' });
    }

    const result = await pool.query(
      `SELECT fcm_token FROM users
       WHERE role = 'buyer' AND fcm_token IS NOT NULL`
    );

    const tokens = result.rows.map(r => r.fcm_token);
    if (tokens.length === 0) {
      return res.json({ message: 'Koi buyer registered nahi hai notifications ke liye', sent: 0 });
    }

    const { successCount, failureCount } = await sendToMany(tokens, title, body, {
      type: 'admin_broadcast',
      target: 'buyers',
    });

    res.json({
      message: 'Broadcast complete!',
      totalBuyers: tokens.length,
      sent: successCount,
      failed: failureCount,
    });
  } catch (err) {
    console.error('Broadcast buyers error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /api/admin/notify/sellers
 * Body: { title, body }
 */
exports.notifyAllSellers = async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: 'title aur body dono required hain' });
    }

    const result = await pool.query(
      `SELECT fcm_token FROM sellers
       WHERE fcm_token IS NOT NULL AND status = 'approved'`
    );

    const tokens = result.rows.map(r => r.fcm_token);
    if (tokens.length === 0) {
      return res.json({ message: 'Koi seller registered nahi hai notifications ke liye', sent: 0 });
    }

    const { successCount, failureCount } = await sendToMany(tokens, title, body, {
      type: 'admin_broadcast',
      target: 'sellers',
    });

    res.json({
      message: 'Broadcast complete!',
      totalSellers: tokens.length,
      sent: successCount,
      failed: failureCount,
    });
  } catch (err) {
    console.error('Broadcast sellers error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /api/admin/notify/all
 * Body: { title, body }
 * Buyers + Sellers + Delivery boys sabko
 */
exports.notifyAll = async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: 'title aur body dono required hain' });
    }

    // Buyers + Delivery boys (users table se)
    const usersResult = await pool.query(
      `SELECT fcm_token FROM users
       WHERE fcm_token IS NOT NULL AND role IN ('buyer', 'delivery')`
    );

    // Sellers (sellers table se)
    const sellersResult = await pool.query(
      `SELECT fcm_token FROM sellers
       WHERE fcm_token IS NOT NULL AND status = 'approved'`
    );

    const tokens = [
      ...usersResult.rows.map(r => r.fcm_token),
      ...sellersResult.rows.map(r => r.fcm_token),
    ];

    if (tokens.length === 0) {
      return res.json({ message: 'Koi user registered nahi hai notifications ke liye', sent: 0 });
    }

    const { successCount, failureCount } = await sendToMany(tokens, title, body, {
      type: 'admin_broadcast',
      target: 'all',
    });

    res.json({
      message: 'Broadcast complete!',
      totalUsers: tokens.length,
      sent: successCount,
      failed: failureCount,
    });
  } catch (err) {
    console.error('Broadcast all error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};