const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth.middleware');
const role = require('../../middleware/role.middleware');

let razorpayService;
try {
  razorpayService = require('./razorpay.service');
} catch (err) {
  console.log('Razorpay not configured yet');
}

// ── WEBHOOK (public, no auth, needs raw body) ──────────────
// In app.js mount this BEFORE express.json():
// app.use('/api/payments/webhook', express.raw({ type: '*/*' }), paymentRoutes)
router.post('/webhook', async (req, res) => {
  if (!razorpayService) return res.status(503).json({ error: 'Payment not configured' });
  return razorpayService.handleWebhook(req, res);
});

// ── BUYER routes ────────────────────────────────────────────
router.post('/create-order/:orderId', auth, role('buyer'), async (req, res) => {
  if (!razorpayService) return res.status(503).json({ error: 'Payment not configured' });
  try {
    const data = await razorpayService.createRazorpayOrder(req.params.orderId, req.user.id);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/verify', auth, role('buyer'), async (req, res) => {
  if (!razorpayService) return res.status(503).json({ error: 'Payment not configured' });
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const result = await razorpayService.handleOnlinePaymentSuccess(
      razorpay_order_id, razorpay_payment_id, razorpay_signature, req.user.id
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── DELIVERY / SELLER routes ────────────────────────────────
router.patch('/cod-delivered/:orderId', auth, role('delivery'), async (req, res) => {
  if (!razorpayService) return res.status(503).json({ error: 'Payment not configured' });
  try {
    const result = await razorpayService.handleCODDelivery(req.params.orderId, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── ADMIN routes ────────────────────────────────────────────
router.post('/refund/:orderId', auth, role('admin'), async (req, res) => {
  if (!razorpayService) return res.status(503).json({ error: 'Payment not configured' });
  try {
    const { amount } = req.body;
    const result = await razorpayService.handleRefund(req.params.orderId, amount);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
