const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth.middleware');
const role = require('../../middleware/role.middleware');
const { searchProducts, getMyProducts, updateProduct, deleteProduct } = require('./product.controller');
const { createProduct } = require('../sellers/seller.dashboard');

router.get('/search', searchProducts);
router.get('/my-products', auth, role('seller'), getMyProducts);
router.post('/', auth, role('seller'), createProduct);
router.put('/:id', auth, role('seller'), updateProduct);
router.delete('/:id', auth, role('seller'), deleteProduct);

module.exports = router;