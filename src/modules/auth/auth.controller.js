const { registerUser, loginUser } = require('./auth.service');

const register = async (req, res) => {
  try {
    const { username, name, phone, password, role, address, pincode } = req.body;

    if (!username || !name || !phone || !password || !address || !pincode) {
      return res.status(400).json({ error: 'Username, name, phone, password, address, and pincode are required' });
    }

    const user = await registerUser({ username, name, phone, password, role, address, pincode });
    res.status(201).json({ message: 'User registered successfully', user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const login = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone and password are required' });
    }

    const data = await loginUser({ phone, password });
    res.status(200).json({ message: 'Login successful', ...data });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
};

module.exports = { register, login };