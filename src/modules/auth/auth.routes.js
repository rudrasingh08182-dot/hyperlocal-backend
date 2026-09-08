const express = require('express');
const router = express.Router();
const { register, login, updateProfile } = require('./auth.controller');
const authMiddleware = require('../../middleware/auth.middleware');
const pool = require('../../config/db');
const { createRateLimiter } = require('../../middleware/rateLimit.middleware');

const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

// POST /api/auth/register (Buyer)
router.post('/register', authLimiter, register);

// POST /api/auth/login
router.post('/login', authLimiter, login);

// PATCH /api/auth/profile — Update address & pincode
router.patch('/profile', authMiddleware, updateProfile);

// POST /api/auth/register-seller
router.post('/register-seller', authLimiter, async (req, res) => {
  try {
    const { username, name, phone, password, shop_name, address, locality, contact_phone, pincode } = req.body;

    if (!username || !name || !phone || !password || !shop_name || !address || !locality || !pincode) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const bcrypt = require('bcryptjs');

    const existing = await pool.query(
      'SELECT id FROM users WHERE phone = $1 OR username = $2',
      [phone, username]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Username or phone already exists' });
    }

    const pinCheck = await pool.query(
      'SELECT pincode FROM serviceable_pincodes WHERE pincode = $1',
      [pincode.trim()]
    );
    const isServiceable = pinCheck.rows.length > 0;

    const password_hash = await bcrypt.hash(password, 10);
    const userResult = await pool.query(
      `INSERT INTO users (username, name, phone, password_hash, role, address, pincode, serviceable)
       VALUES ($1, $2, $3, $4, 'seller', $5, $6, $7) 
       RETURNING id, name, username, phone, address, pincode, serviceable`,
      [username, name, phone, password_hash, address, pincode.trim(), isServiceable]
    );

    const user = userResult.rows[0];

    await pool.query(
      `INSERT INTO sellers (user_id, shop_name, address, locality, contact_phone, pincode)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, shop_name, address, locality, contact_phone || phone, pincode.trim()]
    );

    res.status(201).json({
      message: 'Registration successful! Please wait for admin approval.',
      user
    });

  } catch (err) {
    console.error('Register seller error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/register-delivery
router.post('/register-delivery', authLimiter, async (req, res) => {
  try {
    const {
      username, name, phone, password,
      vehicle_type, vehicle_number, locality, address, pincode
    } = req.body;

    if (!username || !name || !phone || !password || !pincode) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const bcrypt = require('bcryptjs');

    const existing = await pool.query(
      'SELECT id FROM users WHERE phone = $1 OR username = $2',
      [phone, username]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Username or phone already exists' });
    }

    const pinCheck = await pool.query(
      'SELECT pincode FROM serviceable_pincodes WHERE pincode = $1',
      [pincode.trim()]
    );
    const isServiceable = pinCheck.rows.length > 0;

    const password_hash = await bcrypt.hash(password, 10);
    const userResult = await pool.query(
      `INSERT INTO users (username, name, phone, password_hash, role, address, pincode, serviceable)
       VALUES ($1, $2, $3, $4, 'delivery', $5, $6, $7) 
       RETURNING id, name, username, phone, address, pincode, serviceable`,
      [username, name, phone, password_hash, address, pincode.trim(), isServiceable]
    );

    const user = userResult.rows[0];

    await pool.query(
      `INSERT INTO delivery_boys (user_id, vehicle_type, vehicle_number, locality, pincode)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, vehicle_type, vehicle_number, locality, pincode.trim()]
    );

    res.status(201).json({
      message: 'Registration successful! Please wait for admin approval.',
      user
    });

  } catch (err) {
    console.error('Register delivery error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/auth/fcm-token — Buyer aur Delivery boy ka FCM token save karo
router.patch('/fcm-token', authMiddleware, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'FCM token required' });

    await pool.query(
      `UPDATE users SET fcm_token = $1 WHERE id = $2`,
      [token, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('FCM token save error (user):', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
