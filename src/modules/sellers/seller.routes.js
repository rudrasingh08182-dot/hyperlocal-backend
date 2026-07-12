const express = require('express');
const router = express.Router();
const multer = require('multer');
const auth = require('../../middleware/auth.middleware');
const role = require('../../middleware/role.middleware');
const { getSeller, registerShop, searchShops, getShopProducts, updateSeller } = require('./seller.controller');
const { getDashboardStats, createProduct } = require('./seller.dashboard');
const { saveBankDetails, getBankDetails } = require('./bank.controller'); // 
const { uploadQrCode, deleteQrCode } = require('./sellerPaymentQr.controller');

const qrUpload = multer({ storage: multer.memoryStorage() });

router.get('/search', searchShops);
router.get('/:shopId/products', getShopProducts);
router.get('/me', auth, getSeller);
router.patch('/me', auth, updateSeller);
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});
// Confirm order
router.patch('/orders/:id/confirm', auth, role('seller'), async (req, res) => {
  try {
    const pool = require('../../config/db');
    const result = await pool.query(
      `UPDATE orders SET status = 'confirmed' WHERE id = $1::uuid RETURNING *`,
      [req.params.id]
    );

    if (!result.rows[0]) return res.status(404).json({ error: 'Order not found' });

    // Notify every approved delivery boy that a new order is ready for pickup —
    // best-effort, never blocks the response.
    try {
      const { sendWhatsApp } = require('../../config/whatsapp');
      const order = result.rows[0];
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

    res.json({ message: 'Order confirmed!', order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel order
router.patch('/orders/:id/cancel', auth, role('seller'), async (req, res) => {
  try {
    const pool = require('../../config/db');
    const result = await pool.query(
      `UPDATE orders SET status = 'cancelled' WHERE id = $1::uuid RETURNING *`,
      [req.params.id]
    );
    res.json({ message: 'Order cancelled', order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;