const { registerUser, loginUser, buyerEntry: buyerEntryService } = require('./auth.service');
const pool = require('../../config/db');
const jwt = require('jsonwebtoken');

const register = async (req, res) => {
  try {
    const { username, name, phone, password, address, pincode } = req.body;

    if (!username || !name || !phone || !password || !address || !pincode) {
      return res.status(400).json({ error: 'Username, name, phone, password, address, and pincode are required' });
    }

    // Public registration is deliberately buyer-only. Never trust a role sent by a browser.
    const user = await registerUser({ username, name, phone, password, address, pincode });
    res.status(201).json({ message: 'User registered successfully', user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const login = async (req, res) => {
  try {
    const { phone, password, role } = req.body;

    if (!phone || !password || !role) {
      return res.status(400).json({ error: 'Phone, password, and role are required' });
    }

    const data = await loginUser({ phone, password });

    if (data.user.role !== role) {
      return res.status(403).json({ error: `This account is not registered as a ${role}` });
    }

    res.status(200).json({ message: 'Login successful', ...data });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
};

/**
 * ── PASSWORDLESS BUYER ENTRY ──
 * Body: { phone, pincode }
 * serviceable = false is NOT an auth failure — the response is always
 * 200 with a valid JWT, and the flag only drives the dashboard banner.
 */
const buyerEntry = async (req, res) => {
  try {
    const { phone, pincode } = req.body;

    if (!phone || !pincode) {
      return res.status(400).json({ error: 'Phone and pincode are required' });
    }

    const data = await buyerEntryService({ phone, pincode });

    res.status(200).json({
      message: data.serviceable
        ? 'Welcome to Zaplo!'
        : 'Welcome to Zaplo! We are not available in your area yet.',
      ...data
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const updateProfile = async (req, res) => {
  const { address, pincode } = req.body;
  const userId = req.user.id;

  if (!pincode || pincode.length !== 6) {
    return res.status(400).json({ error: 'Valid 6-digit pincode is required' });
  }

  try {
    const checkRes = await pool.query(
      'SELECT pincode FROM serviceable_pincodes WHERE pincode = $1',
      [pincode.trim()]
    );
    const isServiceable = checkRes.rows.length > 0;

    const result = await pool.query(
      `UPDATE users
       SET address = $1, pincode = $2, serviceable = $3
       WHERE id = $4
       RETURNING id, name, username, phone, role, address, pincode, serviceable, created_at`,
      [address, pincode.trim(), isServiceable, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, pincode: user.pincode, serviceable: user.serviceable },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: isServiceable
        ? 'Address updated! Service is now available in your area.'
        : 'Address updated. Service not available in this area yet.',
      user,
      token,
      serviceable: isServiceable
    });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
};

module.exports = { register, login, buyerEntry, updateProfile };