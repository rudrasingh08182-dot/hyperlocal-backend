// modules/tracking/tracking.routes.js

const express = require('express');
const router  = express.Router();
const auth    = require('../../middleware/auth.middleware');
const { getOrderTracking, updateOrderStatus, updateDeliveryLocation, getDeliveryLocation } = require('./tracking.controller');

// Buyer routes
router.get('/:orderId',          auth, getOrderTracking);
router.get('/:orderId/location', auth, getDeliveryLocation);

// Delivery boy / seller routes
router.patch('/:orderId/status',   auth, updateOrderStatus);
router.patch('/:orderId/location', auth, updateDeliveryLocation);

module.exports = router;