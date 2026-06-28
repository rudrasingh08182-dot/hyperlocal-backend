// modules/reviews/review.routes.js

const express = require('express');
const router  = express.Router();
const auth    = require('../../middleware/auth.middleware');
const {
  addProductReview, getProductReviews,
  addSellerReview,  getSellerReviews,
} = require('./review.controller');

// Product reviews
router.post('/product/:productId', auth, addProductReview);
router.get('/product/:productId',        getProductReviews);

// Seller reviews
router.post('/seller/:sellerId', auth, addSellerReview);
router.get('/seller/:sellerId',        getSellerReviews);

module.exports = router;