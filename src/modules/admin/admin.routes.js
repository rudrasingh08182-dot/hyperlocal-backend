const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth.middleware');
const role = require('../../middleware/role.middleware');
const {
  getAllSellers, getAllBuyers, approveSeller, suspendSeller,
  getAllDeliveryBoys, approveDeliveryBoy, suspendDeliveryBoy
} = require('./admin.controller');

router.use(auth, role('admin'));

router.get('/sellers', getAllSellers);
router.get('/buyers', getAllBuyers);
router.patch('/sellers/:id/approve', approveSeller);
router.patch('/sellers/:id/suspend', suspendSeller);
router.get('/delivery-boys', getAllDeliveryBoys);
router.patch('/delivery-boys/:id/approve', approveDeliveryBoy);
router.patch('/delivery-boys/:id/suspend', suspendDeliveryBoy);

module.exports = router;