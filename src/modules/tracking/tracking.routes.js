/// modules/tracking/tracking.routes.js

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const auth    = require('../../middleware/auth.middleware');
const {
  getOrderTracking,
  updateOrderStatus,
  updateDeliveryLocation,
  getDeliveryLocation,
  getSellerQr,
  submitDeliveryPaymentProof,
  markCashReceived,
} = require('./tracking.controller');

const screenshotUpload = multer({ storage: multer.memoryStorage() });

// Buyer routes
router.get('/:orderId',          auth, getOrderTracking);
router.get('/:orderId/location', auth, getDeliveryLocation);

// Delivery boy / seller routes
router.patch('/:orderId/status',   auth, updateOrderStatus);
router.patch('/:orderId/location', auth, updateDeliveryLocation);

// Delivery boy — collecting payment from buyer at doorstep
router.get('/:orderId/seller-qr',              auth, getSellerQr);
router.post('/:orderId/delivery-payment-proof', auth, screenshotUpload.single('screenshot'), submitDeliveryPaymentProof);
router.patch('/:orderId/cash-received',         auth, markCashReceived);

module.exports = router;