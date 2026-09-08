const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth.middleware');
const role = require('../../middleware/role.middleware');
const { searchProducts, getMyProducts, updateProduct, deleteProduct } = require('./product.controller');
const { createProduct } = require('../sellers/seller.dashboard');
const colorVariant = require('./colorVariant.controller');

router.get('/search', searchProducts);
router.get('/my-products', auth, role('seller'), getMyProducts);
router.post('/', auth, role('seller'), createProduct);
router.put('/:id', auth, role('seller'), updateProduct);
router.delete('/:id', auth, role('seller'), deleteProduct);

// ── Color + Size variant system (Fashion) ──
router.get('/:id/colors', colorVariant.getColors);                       // public
router.post('/:id/colors', auth, role('seller'), colorVariant.addColor);
router.put('/colors/:colorId', auth, role('seller'), colorVariant.updateColor);
router.delete('/colors/:colorId', auth, role('seller'), colorVariant.deleteColor);
router.post('/colors/:colorId/sizes', auth, role('seller'), colorVariant.addSize);
router.put('/colors/sizes/:sizeId', auth, role('seller'), colorVariant.updateSize);
router.delete('/colors/sizes/:sizeId', auth, role('seller'), colorVariant.deleteSize);

module.exports = router;