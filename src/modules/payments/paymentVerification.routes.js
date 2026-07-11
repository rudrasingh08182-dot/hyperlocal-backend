// paymentVerification.routes.js
// Mounted at /payments/qr — deliberately namespaced apart from the
// existing Razorpay routes (/payments/create-order/:id, /payments/verify)
// so this temporary module can be removed later without any collision.

const express = require('express');
const router = express.Router();
const multer = require('multer');
const auth = require('../../middleware/auth.middleware');
const role = require('../../middleware/role.middleware');

const {
  getPaymentDetailsForOrder,
  submitPaymentVerification,
  getPendingVerifications,
  approvePayment,
  rejectPayment,
} = require('./paymentVerification.controller');

const screenshotUpload = multer({ storage: multer.memoryStorage() });

// Buyer: view seller's UPI/QR + amount for an order they placed
router.get('/order/:orderId', auth, role('buyer'), getPaymentDetailsForOrder);

// Buyer: submit screenshot + optional transaction id
router.post('/verify/:orderId', auth, role('buyer'), screenshotUpload.single('screenshot'), submitPaymentVerification);

// Seller: list pending verification requests
router.get('/pending', auth, role('seller'), getPendingVerifications);

// Seller: approve / reject
router.patch('/:verificationId/approve', auth, role('seller'), approvePayment);
router.patch('/:verificationId/reject', auth, role('seller'), rejectPayment);

module.exports = router;