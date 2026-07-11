// sellerPaymentQr.controller.js
// Handles the seller's UPI QR code image — upload / delete.
// UPI ID itself is already stored on seller_bank_details.upi_id
// (see bank.controller.js) so this file only manages the QR image.

const pool = require('../../config/db');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');

function uploadBufferToCloudinary(buffer, folder = 'zaplo_payment_qr') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result.secure_url))
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// POST /sellers/payment-qr  (multipart, field name: "qr")
exports.uploadQrCode = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'QR code image is required' });

    const seller = await pool.query('SELECT id FROM sellers WHERE user_id = $1', [req.user.id]);
    if (!seller.rows[0]) return res.status(404).json({ error: 'Seller profile not found' });
    const sellerId = seller.rows[0].id;

    const qrUrl = await uploadBufferToCloudinary(req.file.buffer);

    // seller_bank_details may not have a row yet for this seller — upsert safely
    const result = await pool.query(
      `INSERT INTO seller_bank_details (seller_id, qr_code_url)
       VALUES ($1, $2)
       ON CONFLICT (seller_id) DO UPDATE SET qr_code_url = $2, updated_at = NOW()
       RETURNING qr_code_url, upi_id`,
      [sellerId, qrUrl]
    );

    res.json({ message: 'QR code uploaded', qr_code_url: result.rows[0].qr_code_url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /sellers/payment-qr
exports.deleteQrCode = async (req, res) => {
  try {
    const seller = await pool.query('SELECT id FROM sellers WHERE user_id = $1', [req.user.id]);
    if (!seller.rows[0]) return res.status(404).json({ error: 'Seller profile not found' });
    const sellerId = seller.rows[0].id;

    await pool.query(
      `UPDATE seller_bank_details SET qr_code_url = NULL, updated_at = NOW() WHERE seller_id = $1`,
      [sellerId]
    );

    res.json({ message: 'QR code removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};