const express = require('express');
const router = express.Router();
const { register, login, buyerEntry, updateProfile } = require('./auth.controller');
const authMiddleware = require('../../middleware/auth.middleware');
const pool = require('../../config/db');
const { createRateLimiter } = require('../../middleware/rateLimit.middleware');

const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

// POST /api/auth/register (Buyer)
router.post('/register', authLimiter, register);

// POST /api/auth/login — Staff only (Seller / Delivery / Admin)
router.post('/login', authLimiter, login);

// POST /api/auth/buyer-entry — Passwordless buyer entry (phone + pincode)
// NOTE: serviceable=false is NOT a failure here — always returns 200 + JWT.
router.post('/buyer-entry', authLimiter, buyerEntry);

// PATCH /api/auth/profile — Update address & pincode
router.patch('/profile', authMiddleware, updateProfile);

// POST /api/auth/register-seller
router.post('/register-seller', authLimiter, async (req, res) => {
  try {
    const { username, name, phone, password, shop_name, address, locality, contact_phone, pincode } = req.body;

    if (typeof password === 'string' && /\s/.test(password)) {
      return res.status(400).json({ error: 'Space not allowed in password' });
    }
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

    if (typeof password === 'string' && /\s/.test(password)) {
      return res.status(400).json({ error: 'Space not allowed in password' });
    }
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

// GET /api/auth/geocode-search?q=... — address autocomplete (OSM proxy)
const { searchAddress } = require('./geocode.controller');
router.get('/geocode-search', authMiddleware, searchAddress);

// PATCH /api/auth/save-delivery-location — buyer's own confirmed live/home location
router.patch('/save-delivery-location', authMiddleware, async (req, res) => {
  try {
    const { latitude, longitude, label } = req.body;
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'latitude and longitude are required' });
    }
    await pool.query(
      `UPDATE users SET delivery_latitude = $1, delivery_longitude = $2, delivery_location_label = $3 WHERE id = $4`,
      [latitude, longitude, label || null, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Save delivery location error:', err.message);
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

// POST /api/auth/reset-password-otp — Firebase OTP verify karke naya password set
router.post('/reset-password-otp', authLimiter, async (req, res) => {
  try {
    const { id_token, new_password } = req.body;
    if (!id_token || typeof new_password !== 'string') {
      return res.status(400).json({ error: 'Invalid request' });
    }
    if (/\s/.test(new_password)) {
      return res.status(400).json({ error: 'Space not allowed in password' });
    }
    if (new_password.length < 6 || new_password.length > 128) {
      return res.status(400).json({ error: 'Password 6 se 128 characters ka hona chahiye' });
    }

    require('../../config/firebase'); // Firebase Admin init ensure
    const { getAuth } = require('firebase-admin/auth');
    const decoded = await getAuth().verifyIdToken(id_token);
    if (!decoded.phone_number) {
      return res.status(400).json({ error: 'Phone verification failed' });
    }

    const digits = decoded.phone_number.replace(/\D/g, '').slice(-10);
    const found = await pool.query(
      `SELECT id FROM users
       WHERE RIGHT(regexp_replace(phone, '\\D', '', 'g'), 10) = $1
       AND role IN ('seller', 'delivery')`,
      [digits]
    );
    if (found.rows.length === 0) {
      return res.status(404).json({ error: 'Is number se koi Seller/Delivery account nahi mila' });
    }

    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, found.rows[0].id]);

    res.json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('Reset password OTP error:', err.message);
    res.status(400).json({ error: 'OTP verification failed. Please try again.' });
  }
});

module.exports = router;