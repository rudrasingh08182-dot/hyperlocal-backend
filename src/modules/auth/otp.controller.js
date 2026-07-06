// otp.controller.js
const pool = require('../../config/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const {
  generateOtp, hashOtp, compareOtp, sendSmsOtp, isValidIndianMobile,
} = require('./otp.util');

const OTP_EXPIRY_MINUTES = 5;
const RESEND_COOLDOWN_SECONDS = 30;
const MAX_OTP_PER_HOUR = 5;
const MAX_VERIFY_ATTEMPTS = 5;

// ─────────────────────────────────────────────
// POST /auth/send-otp
// body: { phone, purpose } — purpose: 'register' | 'forgot_password'
// ─────────────────────────────────────────────
exports.sendOtp = async (req, res) => {
  try {
    const { phone, purpose } = req.body;

    if (!isValidIndianMobile(phone)) {
      return res.status(400).json({ error: 'Invalid Mobile Number' });
    }
    if (!['register', 'forgot_password'].includes(purpose)) {
      return res.status(400).json({ error: 'Invalid purpose' });
    }

    // Registration: phone must NOT already exist
    const existing = await pool.query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (purpose === 'register' && existing.rows[0]) {
      return res.status(400).json({ error: 'This mobile number is already registered.' });
    }
    // Forgot password: phone MUST exist
    if (purpose === 'forgot_password' && !existing.rows[0]) {
      return res.status(404).json({ error: 'No account found with this mobile number.' });
    }

    // Resend cooldown — must wait 30s since the last OTP sent for this phone+purpose
    const lastOtp = await pool.query(
      `SELECT created_at FROM otp_verifications
       WHERE phone = $1 AND purpose = $2
       ORDER BY created_at DESC LIMIT 1`,
      [phone, purpose]
    );
    if (lastOtp.rows[0]) {
      const secondsSinceLast = (Date.now() - new Date(lastOtp.rows[0].created_at).getTime()) / 1000;
      if (secondsSinceLast < RESEND_COOLDOWN_SECONDS) {
        return res.status(429).json({
          error: `Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSinceLast)} seconds before requesting another OTP.`,
        });
      }
    }

    // Hourly cap — max 5 OTP requests per phone+purpose per hour
    const hourlyCount = await pool.query(
      `SELECT COUNT(*) FROM otp_verifications
       WHERE phone = $1 AND purpose = $2 AND created_at > NOW() - INTERVAL '1 hour'`,
      [phone, purpose]
    );
    if (parseInt(hourlyCount.rows[0].count) >= MAX_OTP_PER_HOUR) {
      return res.status(429).json({ error: 'Too Many OTP Requests. Please try again after some time.' });
    }

    // Generate, hash, store, and send
    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await pool.query(
      `INSERT INTO otp_verifications (phone, otp_hash, purpose, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [phone, otpHash, purpose, expiresAt]
    );

    await sendSmsOtp(phone, otp);

    console.log(`OTP sent to ${phone} for ${purpose}`); // NEVER log the OTP value itself

    res.json({ message: 'OTP sent successfully', expiresInMinutes: OTP_EXPIRY_MINUTES });
  } catch (err) {
    console.error('sendOtp error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to send OTP' });
  }
};

// ─────────────────────────────────────────────
// POST /auth/verify-otp
// body: { phone, otp, purpose }
// Returns a short-lived token (10 min) to be used in the NEXT step
// (completing registration, or resetting the password) — avoids
// needing to re-send/re-check the OTP a second time.
// ─────────────────────────────────────────────
exports.verifyOtp = async (req, res) => {
  try {
    const { phone, otp, purpose } = req.body;

    if (!phone || !otp || !purpose) {
      return res.status(400).json({ error: 'phone, otp, and purpose are required' });
    }

    const record = await pool.query(
      `SELECT * FROM otp_verifications
       WHERE phone = $1 AND purpose = $2 AND verified = false
       ORDER BY created_at DESC LIMIT 1`,
      [phone, purpose]
    );

    if (!record.rows[0]) {
      return res.status(400).json({ error: 'OTP not requested or already used. Please request a new OTP.' });
    }

    const otpRow = record.rows[0];

    if (new Date() > new Date(otpRow.expires_at)) {
      return res.status(400).json({ error: 'OTP Expired' });
    }

    if (otpRow.attempts >= MAX_VERIFY_ATTEMPTS) {
      return res.status(400).json({ error: 'Maximum OTP Attempts Reached. Please request a new OTP.' });
    }

    const isMatch = await compareOtp(otp, otpRow.otp_hash);

    if (!isMatch) {
      await pool.query('UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = $1', [otpRow.id]);
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Mark verified — OTP becomes invalid, cannot be reused
    await pool.query('UPDATE otp_verifications SET verified = true WHERE id = $1', [otpRow.id]);

    // Short-lived token proving this phone+purpose was OTP-verified
    const verificationToken = jwt.sign(
      { phone, purpose, verifiedOtp: true },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    console.log(`OTP verified for ${phone} (${purpose})`);

    res.json({ verified: true, token: verificationToken });
  } catch (err) {
    console.error('verifyOtp error:', err.message);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
};

// ─────────────────────────────────────────────
// POST /auth/reset-password
// body: { phone, token, newPassword }
// token = the verificationToken returned by verifyOtp (purpose: forgot_password)
// ─────────────────────────────────────────────
exports.resetPassword = async (req, res) => {
  try {
    const { phone, token, newPassword } = req.body;

    if (!phone || !token || !newPassword) {
      return res.status(400).json({ error: 'phone, token, and newPassword are required' });
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters and include uppercase, lowercase, a number, and a special character.',
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Verification expired. Please verify OTP again.' });
    }

    if (decoded.phone !== phone || decoded.purpose !== 'forgot_password' || !decoded.verifiedOtp) {
      return res.status(401).json({ error: 'Invalid verification token' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE phone = $2', [passwordHash, phone]);

    console.log(`Password reset for ${phone}`);

    res.json({ message: 'Password Updated Successfully' });
  } catch (err) {
    console.error('resetPassword error:', err.message);
    res.status(500).json({ error: 'Failed to reset password' });
  }
};

// ─────────────────────────────────────────────
// Middleware: verifies a registration OTP token before allowing
// the final account-creation step to run.
// Wire this into your EXISTING register route, right before your
// existing registerUser controller function.
// ─────────────────────────────────────────────
exports.requireVerifiedRegistrationToken = (req, res, next) => {
  const { phone, otpToken } = req.body;
  if (!otpToken) {
    return res.status(400).json({ error: 'Mobile number verification is required before registering.' });
  }
  try {
    const decoded = jwt.verify(otpToken, process.env.JWT_SECRET);
    if (decoded.phone !== phone || decoded.purpose !== 'register' || !decoded.verifiedOtp) {
      return res.status(401).json({ error: 'Invalid verification token' });
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Mobile number verification expired. Please verify OTP again.' });
  }
};