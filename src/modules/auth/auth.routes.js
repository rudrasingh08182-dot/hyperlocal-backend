const express = require('express');
const router = express.Router();
const { register, login, updateProfile } = require('./auth.controller');
const authMiddleware = require('../../middleware/auth.middleware');
const pool = require('../../config/db');

// POST /api/auth/register (Buyer)
router.post('/register', register);

// POST /api/auth/login
router.post('/login', login);

// PATCH /api/auth/profile — Update address & pincode
router.patch('/profile', authMiddleware, updateProfile);

// POST /api/auth/register-seller
router.post('/register-seller', async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/register-delivery
router.post('/register-delivery', async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;