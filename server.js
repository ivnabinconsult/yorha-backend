const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const startCronJobs = require('./jobs/cron');
require('dotenv').config();

const app = express();

// ── Trust Render's reverse proxy (fixes X-Forwarded-For rate-limit warning)
app.set('trust proxy', 1);

// ── Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
}));

// ── Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// ── Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Routes
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders',   require('./routes/orders'));
app.use('/api/files',    require('./routes/files'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/payouts',  require('./routes/payouts'));
app.use('/api/reviews',  require('./routes/reviews'));

// ── Health check
app.get('/health', (req, res) => res.json({ status: 'ok', env: process.env.NODE_ENV }));

// ── Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Server error' : err.message,
  });
});

// ── 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Connect DB then start server
const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('✅ MongoDB connected');

    // IMPORTANT: your Atlas cluster still has the OLD unique index on
    // `email` alone from before this change. Mongoose does not drop old
    // indexes automatically just because the schema changed — it only
    // creates new ones. syncIndexes() reconciles the actual DB indexes to
    // match what's defined in the schema right now (drops the stale
    // email-only unique index, creates the new compound email+role one).
    // Safe to leave this running on every boot at this project's size;
    // for a much larger users collection later, this is worth moving to a
    // one-off migration script instead of running on every startup.
    const User = require('./models/User');
    await User.syncIndexes();
    console.log('✅ User indexes synced (email+role compound uniqueness)');

    app.listen(PORT, () => console.log(`🚀 Yorha API running on port ${PORT}`));
    startCronJobs();
  })
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });
