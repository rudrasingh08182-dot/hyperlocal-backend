const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth.middleware');
const role = require('../../middleware/role.middleware');
const { memoryImageUpload } = require('../../middleware/upload.middleware');
const { getSeller, registerShop, searchShops, getShopProducts, updateSeller, toggleStoreStatus } = require('./seller.controller');
const { getDashboardStats, createProduct } = require('./seller.dashboard');
const { saveBankDetails, getBankDetails } = require('./bank.controller'); // 
const { uploadQrCode, deleteQrCode } = require('./sellerPaymentQr.controller');

const qrUpload = memoryImageUpload({ maxFiles: 1, maxFileSize: 2 * 1024 * 1024 });

router.get('/search', searchShops);
router.get('/:shopId/products', getShopProducts);
router.get('/me', auth, getSeller);
router.patch('/me', auth, updateSeller);
router.patch('/store-status', auth, role('seller'), toggleStoreStatus);
router.post('/register', auth, registerShop);
router.get('/dashboard', auth, role('seller'), getDashboardStats);

// ── Bank Details ─────────────────────────────────────────────
router.post('/bank-details', auth, saveBankDetails);  // 👈 ADD THIS
router.get('/bank-details', auth, getBankDetails);    // 👈 ADD THIS

// ── Payment QR Code (temporary QR-based payment system) ───────
router.post('/payment-qr', auth, role('seller'), qrUpload.single('qr'), uploadQrCode);
router.delete('/payment-qr', auth, role('seller'), deleteQrCode);

router.post('/fcm-token', auth, async (req, res) => {
  try {
    const pool = require('../../config/db');
    const { token } = req.body;
    await pool.query(
      `UPDATE sellers SET fcm_token = $1 WHERE user_id = $2`,
      [token, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('FCM token save error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Get seller's orders
router.get('/my-orders', auth, role('seller'), async (req, res) => {
  try {
    const pool = require('../../config/db');
    const result = await pool.query(
      `SELECT o.*, u.name as buyer_name,
              json_agg(json_build_object(
                'product_id', oi.product_id,
                'quantity', oi.quantity,
                'unit_price', oi.unit_price,
                'name', p.name
              )) as items
       FROM orders o
       JOIN users u ON o.buyer_id = u.id
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON oi.product_id = p.id
       JOIN sellers s ON o.seller_id = s.id
       WHERE s.user_id = $1
       GROUP BY o.id, u.name
       ORDER BY o.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Seller orders fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Confirm order
router.patch('/orders/:id/confirm', auth, role('seller'), async (req, res) => {
  try {
    const pool = require('../../config/db');
    const result = await pool.query(
      `UPDATE orders o SET status = 'confirmed'
       FROM sellers s
       WHERE o.id = $1::uuid AND o.seller_id = s.id AND s.user_id = $2::uuid
       RETURNING o.*, s.shop_name, s.id as s_id`,
      [req.params.id, req.user.id]
    );

    if (!result.rows[0]) return res.status(404).json({ error: 'Order not found' });

    const order = result.rows[0];

    // ── WhatsApp notification (existing) ─────────────────────────────
    try {
      const { sendWhatsApp } = require('../../config/whatsapp');
      const deliveryBoys = await pool.query(
        `SELECT u.phone FROM delivery_boys d JOIN users u ON d.user_id = u.id WHERE d.status = 'approved'`
      );
      for (const db of deliveryBoys.rows) {
        if (!db.phone) continue;
        await sendWhatsApp(
          db.phone,
          `🚴 New Order Ready for Pickup!\n\nOrder ID: #${order.id.slice(-6).toUpperCase()}\nAmount: ₹${order.total_amount}\n\nOpen the Zaplo Delivery app → Available Orders to accept it.`
        );
      }
    } catch (waErr) {
      console.error('WhatsApp notification error (delivery boys):', waErr.message);
    }

    // ── FCM notification — saare approved delivery boys ko ───────────
    try {
      const { sendToMany } = require('../../config/firebase');
      const dbFcmResult = await pool.query(
        `SELECT u.fcm_token
         FROM delivery_boys d
         JOIN users u ON d.user_id = u.id
         WHERE d.status = 'approved'
           AND u.fcm_token IS NOT NULL`
      );
      const deliveryTokens = dbFcmResult.rows.map(r => r.fcm_token);
      if (deliveryTokens.length > 0) {
        await sendToMany(
          deliveryTokens,
          '🚴 Order Pickup Available!',
          `Shop: ${order.shop_name || 'Zaplo Shop'} mein ek order hai. ₹${order.total_amount} — Available Orders tab mein dekho!`,
          {
            orderId: order.id,
            amount: String(order.total_amount),
            shopName: order.shop_name || 'Zaplo',
            type: 'order_available',
          }
        );
      }
    } catch (fcmErr) {
      console.error('FCM delivery boys FCM error:', fcmErr.message);
    }

    // ── Buyer ko "Order Confirmed" notification ───────────────────────
    try {
      const { notifyUser } = require('../notifications/notification.service');
      const buyerFcm = await pool.query(`SELECT fcm_token FROM users WHERE id = $1`, [order.buyer_id]);
      await notifyUser(
        order.buyer_id,
        buyerFcm.rows[0]?.fcm_token,
        '✅ Order Confirm Ho Gaya!',
        `${order.shop_name} ne aapka order #${order.id.slice(-6).toUpperCase()} confirm kar diya hai. Jaldi hi deliver hoga!`,
        'order_confirmed',
        { orderId: order.id }
      );
    } catch (buyerNotifErr) {
      console.error('Buyer order-confirmed notification error:', buyerNotifErr.message);
    }

    res.json({ message: 'Order confirmed!', order });
  } catch (err) {
    console.error('Order confirm error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Cancel order
router.patch('/orders/:id/cancel', auth, role('seller'), async (req, res) => {
  try {
    const pool = require('../../config/db');
    const result = await pool.query(
      `UPDATE orders o SET status = 'cancelled'
       FROM sellers s
       WHERE o.id = $1::uuid AND o.seller_id = s.id AND s.user_id = $2::uuid
       RETURNING o.*`,
      [req.params.id, req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Order not found' });
    res.json({ message: 'Order cancelled', order: result.rows[0] });
  } catch (err) {
    console.error('Order cancel error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;