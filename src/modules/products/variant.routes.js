// modules/products/variant.routes.js
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth.middleware');
const role = require('../../middleware/role.middleware');
const { upload } = require('../../config/cloudinary'); // same Cloudinary multer instance you already use
const ctrl = require('./variant.controller');

// ── Read (public — buyer product page uses this) ──
router.get('/products/:id/variants', ctrl.getVariants);

// ── Create / update full configuration (seller-only) ──
router.post('/products/:id/variants', auth, role('seller'), ctrl.createVariants);
router.put('/products/:id/variants', auth, role('seller'), ctrl.updateVariants);

// ── Single combination management (seller-only) ──
router.delete('/products/:id/variants/:combinationId', auth, role('seller'), ctrl.deleteCombination);
router.patch('/products/variants/:combinationId/stock', auth, role('seller'), ctrl.updateStock);
router.patch('/products/variants/:combinationId', auth, role('seller'), ctrl.updateCombination);

// ── Group / option removal (seller-only, needs ?confirm=true if destructive) ──
router.delete('/products/variants/groups/:groupId', auth, role('seller'), ctrl.deleteGroup);
router.delete('/products/variants/options/:optionId', auth, role('seller'), ctrl.deleteOption);

// ── Option images (seller-only) ──
router.post(
  '/products/:id/variants/options/:optionId/images',
  auth,
  role('seller'),
  upload.single('image'),
  ctrl.addOptionImage
);
router.delete('/products/variants/options/images/:imageId', auth, role('seller'), ctrl.deleteOptionImage);

module.exports = router;