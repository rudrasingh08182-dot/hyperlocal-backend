const multer = require('multer');

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function imageFileFilter(req, file, cb) {
  if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  }
  cb(null, true);
}

function memoryImageUpload({ maxFiles = 1, maxFileSize = 5 * 1024 * 1024 } = {}) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSize, files: maxFiles, fields: 20, parts: maxFiles + 20 },
    fileFilter: imageFileFilter,
  });
}

module.exports = { memoryImageUpload, imageFileFilter };
