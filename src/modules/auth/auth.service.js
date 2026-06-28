const pool = require('../../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const registerUser = async ({ username, name, phone, password, role }) => {
  const existing = await pool.query(
    'SELECT id FROM users WHERE phone = $1 OR username = $2',
    [phone, username]
  );

  if (existing.rows.length > 0) {
    throw new Error('Username or phone already exists');
  }

  const password_hash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `INSERT INTO users (username, name, phone, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, username, name, phone, role, created_at`,
    [username, name, phone, password_hash, role || 'buyer']
  );

  return result.rows[0];
};

const loginUser = async ({ phone, password }) => {
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
  const token = jwt.sign(
    { id: user.id, role: user.role, username: user.username },
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
      role: user.role
    }
  };
};

module.exports = { registerUser, loginUser };