const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth.middleware');
const role = require('../../middleware/role.middleware');
const {
  createReturn,
  acceptReturn,
  rejectReturn,
  getAvailableReturnPickups,
  acceptReturnPickup,
  getMyReturnPickups,
  markPickedUp,
  markInTransit,
  markReturnDeliveredToSeller,
  confirmReturn,
  getReturn,
  listReturns,
} = require('./return.controller');

// ── Buyer ──────────────────────────────────────────────────────────────────
// POST   /returns          — create a return request
// GET    /returns          — list my returns (buyer sees own, seller sees shop returns)
router.post('/',  auth, role('buyer'), createReturn);
router.get('/',   auth, listReturns);

// ── Seller ─────────────────────────────────────────────────────────────────
router.patch('/:id/accept',  auth, role('seller'), acceptReturn);
router.patch('/:id/reject',  auth, role('seller'), rejectReturn);
router.patch('/:id/confirm', auth, role('seller'), confirmReturn);

// ── Delivery partner ────────────────────────────────────────────────────────
// GET    /returns/available-pickups   — returns waiting for a pickup partner
// GET    /returns/my-return-pickups   — this partner's active return jobs
// PATCH  /returns/:id/accept-pickup   — self-assign a return pickup (removes from pool)
// PATCH  /returns/:id/picked-up       — item collected from buyer
// PATCH  /returns/:id/in-transit      — en route to seller
// PATCH  /returns/:id/complete        — handed item to seller ("Return Complete")
router.get('/available-pickups',      auth, role('delivery'), getAvailableReturnPickups);
router.get('/my-return-pickups',      auth, role('delivery'), getMyReturnPickups);
router.patch('/:id/accept-pickup',    auth, role('delivery'), acceptReturnPickup);
router.patch('/:id/picked-up',        auth, role('delivery'), markPickedUp);
router.patch('/:id/in-transit',       auth, role('delivery'), markInTransit);
router.patch('/:id/complete',         auth, role('delivery'), markReturnDeliveredToSeller);

// ── Shared ─────────────────────────────────────────────────────────────────
router.get('/:id', auth, getReturn);

module.exports = router;