// modules/tracking/tracking.routes.js

const express = require('express');
const router  = express.Router();
const auth    = require('../../middleware/auth.middleware');
const { memoryImageUpload } = require('../../middleware/upload.middleware');
const {
  getOrderTracking,
  updateOrderStatus,
  updateDeliveryLocation,
  getDeliveryLocation,
  getSellerQr,
  submitDeliveryPaymentProof,
  markCashReceived,
} = require('./tracking.controller');

const screenshotUpload = memoryImageUpload({ maxFiles: 1, maxFileSize: 5 * 1024 * 1024 });

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
