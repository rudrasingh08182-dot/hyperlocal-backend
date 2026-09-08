const pool = require('../../config/db');

exports.getMyNotifications = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM notifications WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications SET is_read = true WHERE user_id = $1::uuid AND is_read = false`,
      [req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};