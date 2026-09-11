// modules/products/variant.controller.js
const svc = require('./variant.service');

// Every response uses the spec's consistent envelope:
//   success -> { success: true, data: ... }
//   error   -> { success: false, error: { code, message } }
function handleError(err, res) {
  if (err.code) {
    return res.status(err.status || 400).json({ success: false, error: { code: err.code, message: err.message } });
  }
  console.error('Variant system error:', err);
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}

// GET /api/products/:id/variants  (public)
exports.getVariants = async (req, res) => {
  try {
    const data = await svc.getProductVariants(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    handleError(err, res);
  }
};

// POST /api/products/:id/variants  (seller-only)
exports.createVariants = async (req, res) => {
  try {
    const data = await svc.createVariantConfiguration(req.user.id, req.params.id, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) {
    handleError(err, res);
  }
};

// PUT /api/products/:id/variants  (seller-only)
exports.updateVariants = async (req, res) => {
  try {
    const data = await svc.syncVariantConfiguration(req.user.id, req.params.id, req.body);
    res.json({ success: true, data });
  } catch (err) {
    handleError(err, res);
  }
};

// PATCH /api/products/variants/:combinationId/stock  (seller-only)
exports.updateStock = async (req, res) => {
  try {
    const data = await svc.updateCombinationStock(req.user.id, req.params.combinationId, req.body.stock);
    res.json({ success: true, data });
  } catch (err) {
    handleError(err, res);
  }
};

// PATCH /api/products/variants/:combinationId  (seller-only) — price/stock/sku/active
exports.updateCombination = async (req, res) => {
  try {
    const data = await svc.updateCombination(req.user.id, req.params.combinationId, req.body);
    res.json({ success: true, data });
  } catch (err) {
    handleError(err, res);
  }
};

// DELETE /api/products/:id/variants/:combinationId  (seller-only)
exports.deleteCombination = async (req, res) => {
  try {
    const data = await svc.deleteCombination(req.user.id, req.params.combinationId);
    res.json({ success: true, data });
  } catch (err) {
    handleError(err, res);
  }
};

// DELETE /api/products/variants/groups/:groupId?confirm=true  (seller-only)
exports.deleteGroup = async (req, res) => {
  try {
    const confirm = req.query.confirm === 'true';
    const data = await svc.deleteGroup(req.user.id, req.params.groupId, confirm);
    res.json({ success: true, data });
  } catch (err) {
    handleError(err, res);
  }
};

// DELETE /api/products/variants/options/:optionId?confirm=true  (seller-only)
exports.deleteOption = async (req, res) => {
  try {
    const confirm = req.query.confirm === 'true';
    const data = await svc.deleteOption(req.user.id, req.params.optionId, confirm);
    res.json({ success: true, data });
  } catch (err) {
    handleError(err, res);
  }
};

// POST /api/products/:id/variants/options/:optionId/images  (seller-only)
// Expects multer to have already placed the uploaded file's Cloudinary URL
// on req.file.path (same pattern as your existing /uploads/product-image).
exports.addOptionImage = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: { code: 'INVALID_COMBINATION', message: 'No image provided' } });
    const data = await svc.addOptionImage(req.user.id, req.params.optionId, req.file.path);
    res.status(201).json({ success: true, data });
  } catch (err) {
    handleError(err, res);
  }
};

// DELETE /api/products/variants/options/images/:imageId  (seller-only)
exports.deleteOptionImage = async (req, res) => {
  try {
    const data = await svc.deleteOptionImage(req.user.id, req.params.imageId);
    res.json({ success: true, data });
  } catch (err) {
    handleError(err, res);
  }
};