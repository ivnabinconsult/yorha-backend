const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Order = require('../models/Order');
const File = require('../models/File');
const Product = require('../models/Product');
const ReadingProgress = require('../models/ReadingProgress');
const { getSignedFileUrl } = require('../utils/b2Reader');

// GET /api/reader/:productId  -> signed PDF URL, if user owns it
router.get('/:productId', protect, async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user._id;

    const order = await Order.findOne({
      buyer: userId,
      product: productId,
      paymentStatus: 'completed',
    });
    if (!order) return res.status(403).json({ error: 'You do not own this content' });

    const file = await File.findOne({ product: productId });
    if (!file) return res.status(404).json({ error: 'File not found for this product' });

    const fileUrl = await getSignedFileUrl(file.b2Key, file.bucket, 600);

    const product = await Product.findById(productId).select('contentType totalPages title');

    res.json({
      fileUrl,
      contentType: product?.contentType, // 'Manga' | 'Manhwa' | 'Novel' | 'eBook' | 'Short Story'
      totalPages: product?.totalPages,
      title: product?.title,
    });
  } catch (err) {
    console.error('Reader fetch error:', err);
    res.status(500).json({ error: 'Failed to load reader content' });
  }
});

// GET /api/reader/:productId/progress
router.get('/:productId/progress', protect, async (req, res) => {
  try {
    const progress = await ReadingProgress.findOne({
      user: req.user._id,
      product: req.params.productId,
    });
    res.json(progress || null);
  } catch (err) {
    console.error('Get progress error:', err);
    res.status(500).json({ error: 'Failed to get progress' });
  }
});

// POST /api/reader/:productId/progress
router.post('/:productId/progress', protect, async (req, res) => {
  try {
    const { currentPage, totalPages } = req.body;
    if (currentPage === undefined) {
      return res.status(400).json({ error: 'currentPage required' });
    }

    const progress = await ReadingProgress.findOneAndUpdate(
      { user: req.user._id, product: req.params.productId },
      { currentPage, totalPages, lastReadAt: new Date() },
      { upsert: true, new: true }
    );

    res.json(progress);
  } catch (err) {
    console.error('Save progress error:', err);
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

module.exports = router;
