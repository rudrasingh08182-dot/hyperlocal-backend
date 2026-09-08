const pool = require('../../config/db');
const { sendNotification } = require('../../config/firebase');

// Har notification-worthy event pe yeh call karo — push bhejta hai (agar token
// hai) AUR DB mein save karta hai, taaki bell icon mein history dikh sake
// chahe push miss ho jaye ya user offline ho.
async function notifyUser(userId, fcmToken, title, body, type, data = {}) {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, title, body, type, data)
       VALUES ($1::uuid, $2, $3, $4, $5)`,
      [userId, title, body, type || null, JSON.stringify(data)]
    );
  } catch (err) {
    console.error('Notification DB insert failed:', err.message);
  }

  if (fcmToken) {
    try {
      await sendNotification(fcmToken, title, body, data);
    } catch (err) {
      console.error('Push send failed:', err.message);
    }
  }
}

module.exports = { notifyUser };