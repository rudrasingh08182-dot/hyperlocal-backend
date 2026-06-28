const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth.middleware');
const { upload } = require('../../config/cloudinary');

// Upload single product image
router.post('/product-image', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    res.json({
      url: req.file.path,
      public_id: req.file.filename,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload multiple images
router.post('/product-images', auth, upload.array('images', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }
    const urls = req.files.map(f => f.path);
    res.json({ urls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;