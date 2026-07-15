// banner.routes.js
// Public route — buyer app fetches active banners for the home screen carousel.
// Admin management routes (create/update/delete/reorder/getAll) live inside
// admin.routes.js instead, since they already have auth + role('admin') applied.

const express = require('express');
const router = express.Router();
const { getActiveBanners } = require('./banner.controller');

router.get('/active', getActiveBanners);

module.exports = router;