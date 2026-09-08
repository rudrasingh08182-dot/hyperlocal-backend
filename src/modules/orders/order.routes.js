const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth.middleware');
const role = require('../../middleware/role.middleware');
const {
  placeOrder, getMyOrders, getAvailableOrders,
  acceptDelivery, getMyDeliveries, markDelivered, updateLocation,
  toggleDeliveryAvailability, getMyAvailability, getDeliveryEstimate
} = require('./order.controller');

router.post('/', auth, role('buyer'), placeOrder);
router.get('/my-orders', auth, role('buyer'), getMyOrders);
router.get('/delivery-estimate', auth, role('buyer'), getDeliveryEstimate);
router.get('/available', auth, role('delivery'), getAvailableOrders);
router.patch('/:id/accept', auth, role('delivery'), acceptDelivery);
router.get('/my-deliveries', auth, role('delivery'), getMyDeliveries);
router.patch('/:id/delivered', auth, role('delivery'), markDelivered);
router.patch('/update-location', auth, role('delivery'), updateLocation);
router.patch('/toggle-availability', auth, role('delivery'), toggleDeliveryAvailability);
router.get('/my-availability', auth, role('delivery'), getMyAvailability);

module.exports = router;