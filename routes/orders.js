const express = require('express');
const router  = express.Router();
const Order   = require('../models/Order');
const { protect, restrictTo } = require('../middleware/auth');

// Payment initiation/verification live in routes/payments.js
// (/api/payments/paystack/initiate + /verify) — that's what the actual
// frontend (auth.js) calls. This file previously also had its own
// /initiate + /verify, which nothing in the frontend used; keeping both
// around is exactly how the frontend/backend integration silently broke
// once already. Removed here to avoid a repeat.

// ── GET /api/orders/my  — reader's purchase history
router.get('/my', protect, restrictTo('reader'), async (req, res) => {
  try {
    const orders = await Order.find({
      buyer: req.user._id,
      paymentStatus: 'completed',
    })
    .populate('product', 'title contentType coverImage authorName price')
    .sort({ paidAt: -1 });

    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/orders/sales  — author's sales list
router.get('/sales', protect, restrictTo('author'), async (req, res) => {
  try {
    const orders = await Order.find({
      author: req.user._id,
      paymentStatus: 'completed',
    })
    .populate('product', 'title contentType coverImage')
    .populate('buyer',   'name email')
    .sort({ paidAt: -1 });

    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
