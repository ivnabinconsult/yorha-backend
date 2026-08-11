const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const startCronJobs = require('./jobs/cron');
require('dotenv').config();

const app = express();

// ── Trust Render's reverse proxy (fixes X-Forwarded-For rate-limit warning)
app.set('trust proxy', 1);

// ── Security middleware
app.use(helmet());
const allowedOrigins = (process.env.CORS_ORIGINS || process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map((url) => url.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, mobile apps, health checks)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// ── Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// ── Body parsers (10mb cap — generous for JSON/form payloads; actual file
// uploads go through multer/multer-s3 on their own routes, not through this)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Strip any Mongo operators ($gt, $ne, etc.) from req.body/query/params
// so a crafted payload like { "email": { "$gt": "" } } can't manipulate
// Mongoose queries (NoSQL injection).
app.use(mongoSanitize());

// ── Routes
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders',   require('./routes/orders'));
app.use('/api/files',    require('./routes/files'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/payouts',  require('./routes/payouts'));
app.use('/api/reviews',  require('./routes/reviews'));
app.use('/api/admin',    require('./routes/admin'));

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
