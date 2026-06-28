const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

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


const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use('/api/payments/webhook', express.raw({ type: '*/*' }), paymentRoutes);

app.use(express.json());
app.use('/api/payments', paymentRoutes);


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

// Health check
app.get('/', (req, res) => {
  res.json({ message: '✅ Hyperlocal API is running' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

module.exports = app;