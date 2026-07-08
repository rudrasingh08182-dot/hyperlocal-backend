const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs'); // ✅ Import only once

const { register, login } = require('./auth.controller');
const {
  sendOtp,
  verifyOtp,
  resetPassword,
  requireVerifiedRegistrationToken
} = require('./otp.controller');

const pool = require('../../config/db');

// ── OTP routes (new) ──
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/reset-password', resetPassword);

// POST /api/auth/register (now requires OTP verification first)
router.post('/register', requireVerifiedRegistrationToken, register);

// POST /api/auth/login
router.post('/login', login);

// POST /api/auth/register-seller
router.post('/register-seller', requireVerifiedRegistrationToken, async (req, res) => {
  try {
    const {
      username,
      name,
      phone,
      password,
      shop_name,
      address,
      locality,
      contact_phone
    } = req.body;

    if (!username || !name || !phone || !password || !shop_name || !address || !locality) {
      return res.status(400).json({
        error: 'All fields are required'
      });
    }

    // Password validation
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        error: 'Password must be between 8 and 128 characters.'
      });
    }

    // Check existing user
    const existing = await pool.query(
      'SELECT id FROM users WHERE phone = $1 OR username = $2',
      [phone, username]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        error: 'Username or phone already exists'
      });
    }

    // Create user
    const password_hash = await bcrypt.hash(password, 10);

    const userResult = await pool.query(
      `INSERT INTO users (username, name, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, 'seller')
       RETURNING id, name, username, phone`,
      [username, name, phone, password_hash]
    );

    const user = userResult.rows[0];

    // Create shop
    await pool.query(
      `INSERT INTO sellers (user_id, shop_name, address, locality, contact_phone)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, shop_name, address, locality, contact_phone || phone]
    );

    res.status(201).json({
      message: 'Registration successful! Please wait for admin approval.',
      user
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message
    });
  }
});

// POST /api/auth/register-delivery
router.post('/register-delivery', requireVerifiedRegistrationToken, async (req, res) => {
  try {
    const {
      username,
      name,
      phone,
      password,
      vehicle_type,
      vehicle_number,
      locality
    } = req.body;

    if (!username || !name || !phone || !password) {
      return res.status(400).json({
        error: 'All fields are required'
      });
    }

    // Password validation
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({
        error: 'Password must be between 8 and 128 characters.'
      });
    }

    // Check existing
    const existing = await pool.query(
      'SELECT id FROM users WHERE phone = $1 OR username = $2',
      [phone, username]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        error: 'Username or phone already exists'
      });
    }

    // Create user
    const password_hash = await bcrypt.hash(password, 10);

    const userResult = await pool.query(
      `INSERT INTO users (username, name, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, 'delivery')
       RETURNING id, name, username, phone`,
      [username, name, phone, password_hash]
    );

    const user = userResult.rows[0];

    // Create delivery boy profile
    await pool.query(
      `INSERT INTO delivery_boys (user_id, vehicle_type, vehicle_number, locality)
       VALUES ($1, $2, $3, $4)`,
      [user.id, vehicle_type, vehicle_number, locality]
    );

    res.status(201).json({
      message: 'Registration successful! Please wait for admin approval.',
      user
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message
    });
  }
});

module.exports = router;