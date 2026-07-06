// otp.util.js
const bcrypt = require('bcryptjs');
const axios = require('axios');

// ─────────────────────────────────────────────
// Generate a 6-digit numeric OTP
// ─────────────────────────────────────────────
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─────────────────────────────────────────────
// Hash / compare OTP (never store the plain OTP in the DB)
// ─────────────────────────────────────────────
async function hashOtp(otp) {
  return bcrypt.hash(otp, 10);
}

async function compareOtp(otp, hash) {
  return bcrypt.compare(otp, hash);
}

// ─────────────────────────────────────────────
// Send OTP via MSG91
// Requires env vars: MSG91_AUTH_KEY, MSG91_TEMPLATE_ID
// (get both from your MSG91 dashboard after creating an OTP template)
// ─────────────────────────────────────────────
async function sendSmsOtp(phone, otp) {
  try {
    await axios.post(
      'https://control.msg91.com/api/v5/otp',
      {
        template_id: process.env.MSG91_TEMPLATE_ID,
        mobile: `91${phone}`, // MSG91 expects country code prefix
        otp,
      },
      {
        headers: {
          authkey: process.env.MSG91_AUTH_KEY,
          'Content-Type': 'application/json',
        },
      }
    );
    return true;
  } catch (err) {
    console.error('MSG91 send OTP failed:', err.response?.data || err.message);
    throw new Error('Failed to send OTP. Please try again.');
  }
}

// ─────────────────────────────────────────────
// Validate Indian mobile number format
// ─────────────────────────────────────────────
function isValidIndianMobile(phone) {
  return /^[6-9]\d{9}$/.test(phone || '');
}

module.exports = {
  generateOtp,
  hashOtp,
  compareOtp,
  sendSmsOtp,
  isValidIndianMobile,
};