const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { createRateLimiter } = require('./middleware/rateLimit.middleware');

const authRoutes = require('./modules/auth/auth.routes');
const productRoutes = require('./modules/products/product.routes');
const orderRoutes = require('./modules/orders/order.routes');
const sellerRoutes = require('./modules/sellers/seller.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const returnRoutes = require('./modules/returns/return.routes');
const paymentRoutes = require('./modules/payments/payment.routes');
const uploadRoutes = require('./modules/uploads/upload.routes');
const bankRoutes = require('./modules/sellers/bank.routes');
const reviewRoutes = require('./modules/reviews/review.routes');
const trackingRoutes = require('./modules/tracking/tracking.routes');
const paymentVerificationRoutes = require('./modules/payments/paymentVerification.routes');
const bannerRoutes = require('./modules/banners/banner.routes');
const notificationRoutes = require('./modules/notifications/notification.routes');
const variantRoutes = require('./modules/products/variant.routes');
const app = express();

// Render/nginx sits in front of the app — without this, req.ip resolves to
// the proxy's IP for every request, so the rate limiter's default
// keyGenerator (req.ip) would bucket ALL users together and block everyone
// once combined traffic crosses the limit.
app.set('trust proxy', 1);

// Health check FIRST (Render needs this)
app.get('/', (req, res) => {
  res.json({ message: '✅ Hyperlocal API is running' });
});

// Middleware
app.use(helmet());
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',').map((origin) => origin.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));
app.use(morgan('dev'));
app.use(createRateLimiter({ windowMs: 15 * 60 * 1000, max: 300 }));

// Stricter limiter for payment endpoints — brute-force / abuse protection.
// Auth routes (/login, /register, /register-seller, /register-delivery)
// already have their own authLimiter applied at the route level in
// auth.routes.js — not duplicated here.
const paymentLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
app.use('/api/payments', paymentLimiter);
app.use('/api/payments/qr', paymentLimiter);

app.use('/api/payments/webhook', express.raw({ type: '*/*' }), paymentRoutes);

// Security: explicit body size cap — rejects oversized JSON payloads
// (e.g. a fake 10MB "password" field) before they ever reach route handlers.
app.use(express.json({ limit: '100kb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/sellers', sellerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/returns', returnRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/sellers', bankRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/payments/qr', paymentVerificationRoutes);
app.use('/api/banners', bannerRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api', variantRoutes);
// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') return res.status(400).json({ error: 'Invalid or oversized upload' });
  if (err && err.message === 'Origin not allowed by CORS') return res.status(403).json({ error: 'Origin not allowed' });
  console.error('Unhandled request error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;