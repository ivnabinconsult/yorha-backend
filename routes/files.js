const express = require('express');
const router  = express.Router();
const Order   = require('../models/Order');
const Product = require('../models/Product');
const File    = require('../models/File');
const { protect, restrictTo } = require('../middleware/auth');
const { getSignedDownloadUrl }  = require('../utils/b2Upload');

// ── GET /api/files/:productId
// Verifies the reader has a completed order, then returns a 30-min signed URL
router.get('/:productId', protect, restrictTo('reader'), async (req, res) => {
  try {
    const { productId } = req.params;

    // Check paid order exists
    const order = await Order.findOne({
      buyer:         req.user._id,
      product:       productId,
      paymentStatus: 'completed',
    });

    if (!order) {
      return res.status(403).json({
        error: 'Access denied. Please purchase this title first.',
      });
    }

    // Get file metadata
    const product = await Product.findById(productId).populate('file');
    if (!product?.file) {
      return res.status(404).json({ error: 'File not found for this product' });
    }

    const fileDoc = product.file;

    // Generate short-lived signed URL (30 min)
    const signedUrl = await getSignedDownloadUrl(fileDoc.b2Key, 1800);

    res.json({
      message:   'File access granted',
      url:       signedUrl,
      expiresIn: 1800,
      fileName:  fileDoc.originalName,
      mimeType:  fileDoc.mimeType,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
