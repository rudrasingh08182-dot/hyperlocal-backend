const pool = require('../../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Helper to check pincode against serviceable_pincodes and log unserviceable requests to waiting_pincodes
const checkAndLogPincode = async (pincode) => {
  if (!pincode) return false;
  const cleanPincode = pincode.trim();

  // 1. Check if pincode exists in serviceable_pincodes
  const checkRes = await pool.query(
    'SELECT pincode FROM serviceable_pincodes WHERE pincode = $1',
    [cleanPincode]
  );

  const isServiceable = checkRes.rows.length > 0;

  // 2. If NOT serviceable, log to waiting_pincodes
  if (!isServiceable) {
    await pool.query(
      `INSERT INTO waiting_pincodes (pincode, request_count, last_requested_at)
       VALUES ($1, 1, CURRENT_TIMESTAMP)
       ON CONFLICT (pincode)
       DO UPDATE SET
         request_count = waiting_pincodes.request_count + 1,
         last_requested_at = CURRENT_TIMESTAMP`,
      [cleanPincode]
    );
  }

  return isServiceable;
};

const registerUser = async ({ username, name, phone, password, address, pincode }) => {
  // ── Security: hard cap BEFORE bcrypt hashing ──
  if (typeof password !== 'string' || password.length > 128) {
    throw new Error('Password must be between 8 and 128 characters.');
  }
  if (typeof phone !== 'string' || phone.length > 15) {
    throw new Error('Invalid phone number');
  }
  if (typeof username !== 'string' || username.length > 50) {
    throw new Error('Username too long');
  }
  if (!pincode || typeof pincode !== 'string') {
    throw new Error('Pincode is required');
  }
  if (!address || typeof address !== 'string') {
    throw new Error('Address is required');
  }

  const existing = await pool.query(
    'SELECT id FROM users WHERE phone = $1 OR username = $2',
    [phone, username]
  );

  if (existing.rows.length > 0) {
    throw new Error('Username or phone already exists');
  }

  const isServiceable = await checkAndLogPincode(pincode);
  const password_hash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `INSERT INTO users (username, name, phone, password_hash, role, address, pincode, serviceable)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, username, name, phone, role, pincode, serviceable, created_at`,
    [username, name, phone, password_hash, 'buyer', address, pincode.trim(), isServiceable]
  );

  return result.rows[0];
};

const loginUser = async ({ phone, password }) => {
  // ── Security: hard cap BEFORE bcrypt.compare ──
  if (typeof password !== 'string' || password.length > 128) {
    throw new Error('Invalid phone or password');
  }
  if (typeof phone !== 'string' || phone.length > 15) {
    throw new Error('Invalid phone or password');
  }

  const result = await pool.query(
    'SELECT * FROM users WHERE phone = $1',
    [phone]
  );

  if (result.rows.length === 0) {
    throw new Error('Invalid phone or password');
  }

  const user = result.rows[0];

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    throw new Error('Invalid phone or password');
  }

  // Check if seller is approved
  if (user.role === 'seller') {
    const sellerResult = await pool.query(
      'SELECT status FROM sellers WHERE user_id = $1',
      [user.id]
    );

    if (sellerResult.rows.length === 0) {
      throw new Error('Seller profile not found. Please contact admin.');
    }

    if (sellerResult.rows[0].status === 'pending') {
      throw new Error('Your account is pending approval from admin. Please wait.');
    }

    if (sellerResult.rows[0].status === 'suspended') {
      throw new Error('Your account has been suspended. Please contact admin.');
    }
  }
  // Check if delivery boy is approved
  if (user.role === 'delivery') {
    const deliveryResult = await pool.query(
      'SELECT status FROM delivery_boys WHERE user_id = $1',
      [user.id]
    );

    if (deliveryResult.rows.length === 0) {
      throw new Error('Delivery profile not found. Please contact admin.');
    }

    if (deliveryResult.rows[0].status === 'pending') {
      throw new Error('Your account is pending approval from admin.');
    }

    if (deliveryResult.rows[0].status === 'suspended') {
      throw new Error('Your account has been suspended.');
    }
  }

  // Double-check serviceability from serviceable_pincodes table
  let serviceable = user.serviceable;
  if (user.pincode) {
    const pCheck = await pool.query(
      'SELECT pincode FROM serviceable_pincodes WHERE pincode = $1',
      [user.pincode]
    );
    serviceable = pCheck.rows.length > 0;
  }

  const token = jwt.sign(
    { id: user.id, role: user.role, username: user.username, pincode: user.pincode, serviceable },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      phone: user.phone,
      role: user.role,
      pincode: user.pincode,
      address: user.address,
      serviceable
    }
  };
};

/**
 * ── PASSWORDLESS BUYER ENTRY ──
 * Phone + pincode is enough to enter the buyer experience.
 * The pincode NEVER blocks the buyer — it only determines the
 * `serviceable` flag, which the BuyerDashboard uses to show an
 * informational banner. Unserviceable is a valid state, not an error.
 */
const buyerEntry = async ({ phone, pincode }) => {
  // ── Backend validation (never trust the browser) ──
  if (typeof phone !== 'string' || !/^\d{10}$/.test(phone.trim())) {
    throw new Error('Please enter a valid 10-digit mobile number');
  }
  if (typeof pincode !== 'string' || !/^\d{6}$/.test(pincode.trim())) {
    throw new Error('Please enter a valid 6-digit pincode');
  }

  const cleanPhone = phone.trim();
  const cleanPincode = pincode.trim();

  // Reuses the EXISTING logic: checks serviceable_pincodes AND logs
  // unserviceable requests into waiting_pincodes (admin demand signal).
  const serviceable = await checkAndLogPincode(cleanPincode);

  // Find an existing buyer with this phone, or create a passwordless
  // buyer identity. Existing buyers/orders/carts are never touched.
  let result = await pool.query(
    `SELECT * FROM users WHERE phone = $1 AND role = 'buyer'
     ORDER BY created_at ASC LIMIT 1`,
    [cleanPhone]
  );

  if (result.rows.length === 0) {
    // Create buyer — username is auto-generated from the phone, and the
    // password_hash holds a random hash nobody knows (buyers never log
    // in with a password, and the staff login endpoint stays protected
    // by bcrypt.compare which can never match this random hash).
    const username = `buyer_${cleanPhone}`;
    const randomHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

    try {
      result = await pool.query(
        `INSERT INTO users (username, name, phone, password_hash, role, address, pincode, serviceable)
         VALUES ($1, $2, $3, $4, 'buyer', '', $5, $6)
         RETURNING *`,
        [username, 'Zaplo User', cleanPhone, randomHash, cleanPincode, serviceable]
      );
    } catch (err) {
      // Phone already belongs to a staff account (seller/delivery/admin)
      if (err.code === '23505') {
        throw new Error('This number is registered as a staff account. Please use the staff login below.');
      }
      throw err;
    }
  } else {
    // Existing buyer: refresh pincode + serviceable for THIS session only.
    // No other buyer data (orders, cart, addresses) is modified.
    result = await pool.query(
      'UPDATE users SET pincode = $1, serviceable = $2 WHERE id = $3 RETURNING *',
      [cleanPincode, serviceable, result.rows[0].id]
    );
  }

  const user = result.rows[0];

  const token = jwt.sign(
    { id: user.id, role: 'buyer', username: user.username, pincode: user.pincode, serviceable },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  return {
    token,
    serviceable,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      phone: user.phone,
      role: 'buyer',
      pincode: user.pincode,
      address: user.address,
      serviceable
    }
  };
};

module.exports = { registerUser, loginUser, buyerEntry };