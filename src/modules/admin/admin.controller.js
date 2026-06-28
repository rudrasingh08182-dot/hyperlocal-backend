const pool = require('../../config/db');

exports.getAllSellers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, u.username, u.name, u.phone, s.shop_name, s.status, s.created_at
       FROM sellers s
       JOIN users u ON s.user_id = u.id
       ORDER BY s.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAllBuyers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, name, phone, created_at
       FROM users WHERE role = 'buyer'
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.approveSeller = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `UPDATE sellers SET status = 'approved' WHERE id = $1::uuid RETURNING *`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Seller not found' });
    }
    
    res.json({ message: 'Seller approved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.suspendSeller = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `UPDATE sellers SET status = 'suspended' WHERE id = $1::uuid RETURNING *`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Seller not found' });
    }
    
    res.json({ message: 'Seller suspended' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.getAllDeliveryBoys = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.name, u.phone, 
              d.id as delivery_id, d.vehicle_type, 
              d.vehicle_number, d.locality, d.status, d.created_at
       FROM delivery_boys d
       JOIN users u ON d.user_id = u.id
       ORDER BY d.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.approveDeliveryBoy = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE delivery_boys SET status = 'approved' 
       WHERE id = $1::uuid RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Delivery boy not found' });
    }
    res.json({ message: 'Delivery boy approved!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.suspendDeliveryBoy = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      `UPDATE delivery_boys SET status = 'suspended' WHERE id = $1::uuid`,
      [id]
    );
    res.json({ message: 'Delivery boy suspended' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};