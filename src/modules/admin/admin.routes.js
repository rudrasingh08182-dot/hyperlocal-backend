const express = require('express');
const router = express.Router();
const multer = require('multer');
const auth = require('../../middleware/auth.middleware');
const role = require('../../middleware/role.middleware');
const {
  getAllSellers, getAllBuyers, approveSeller, suspendSeller,
  getAllDeliveryBoys, approveDeliveryBoy, suspendDeliveryBoy,
  getSellerSalesLast7Days
} = require('./admin.controller');
const {
  validateBulkUpload, importBulkUpload, downloadErrorReport
} = require('./bulkUpload.controller');
const {
  getAllBanners, createBanner, updateBanner, deleteBanner, reorderBanners
} = require('../banners/banner.controller');

const upload = multer({ storage: multer.memoryStorage() });
const bannerUpload = multer({ storage: multer.memoryStorage() });

router.use(auth, role('admin'));

router.get('/sellers', getAllSellers);
router.get('/buyers', getAllBuyers);
router.patch('/sellers/:id/approve', approveSeller);
router.patch('/sellers/:id/suspend', suspendSeller);
router.get('/sellers/:id/sales-last-7-days', getSellerSalesLast7Days);
router.get('/delivery-boys', getAllDeliveryBoys);
router.patch('/delivery-boys/:id/approve', approveDeliveryBoy);
router.patch('/delivery-boys/:id/suspend', suspendDeliveryBoy);

// ── Hero Banner Carousel management ──────────────────────────
router.get('/banners', getAllBanners);
router.post('/banners', bannerUpload.single('image'), createBanner);
router.patch('/banners/reorder', reorderBanners); // must be BEFORE /banners/:id to avoid route collision
router.patch('/banners/:id', bannerUpload.single('image'), updateBanner);
router.delete('/banners/:id', deleteBanner);

// Bulk product upload
router.post(
  '/bulk-upload/validate',
  upload.fields([{ name: 'excel', maxCount: 1 }, { name: 'zip', maxCount: 1 }, { name: 'variants', maxCount: 1 }]),
  validateBulkUpload
);
router.post('/bulk-upload/:uploadId/import', importBulkUpload);
router.get('/bulk-upload/error-report', downloadErrorReport);

module.exports = router;