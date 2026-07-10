const express = require('express');
const router  = express.Router();
const Review  = require('../models/Review');
const Order   = require('../models/Order');
const { protect, restrictTo } = require('../middleware/auth');

// ── GET /api/reviews/:productId  — get reviews for a product (public)
router.get('/:productId', async (req, res) => {
  try {
    const reviews = await Review.find({ product: req.params.productId })
      .populate('buyer', 'name')
      .sort({ createdAt: -1 });
    res.json({ reviews });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/reviews/:productId  — submit a review (reader only, must have bought)
router.post('/:productId', protect, restrictTo('reader'), async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const productId = req.params.productId;

    // Must have a completed purchase
    const order = await Order.findOne({
      buyer:         req.user._id,
      product:       productId,
      paymentStatus: 'completed',
    });

    if (!order) {
      return res.status(403).json({ error: 'You must purchase this title before reviewing it.' });
    }

    // Upsert review
    const review = await Review.findOneAndUpdate(
      { product: productId, buyer: req.user._id },
      { rating, comment },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // findOneAndUpdate does NOT trigger document middleware, so recalc manually
    await Review.calcAverageRating(productId);

    res.status(201).json({ message: 'Review submitted', review });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/reviews/:productId  — delete own review
router.delete('/:productId', protect, restrictTo('reader'), async (req, res) => {
  try {
    const review = await Review.findOne({
      product: req.params.productId,
      buyer:   req.user._id,
    });

    if (!review) return res.status(404).json({ error: 'Review not found' });

    await review.deleteOne();

    // deleteOne() does NOT trigger document middleware, so recalc manually
    await Review.calcAverageRating(req.params.productId);

    res.json({ message: 'Review deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
